import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { cheapestCover, coverSaving, type Cover, type CoverOption } from "@/lib/extension-cover";
import { isExtensionId, type ExtensionId } from "@/lib/extensions";
import type { PlanInterval } from "@/lib/plans";

import { col, typedRows } from "./typed-rows";

/**
 * The cheapest cover for an account (D748 step E6, `docs/extensions.md` 8.3): what it can buy in its currency and interval, what it has bought
 * (on its own or in a bundle), and the cheapest way to have that with one extension added or taken off (`cheapestCover()`). Adding an
 * extension, ending one and changing the plan all buy this answer, so the account never pays twice.
 */

const OPTION_ROW = z.object({
  kind: z.enum(["extension", "bundle"]),
  id: col.text,
  price_id: col.uuid,
  amount_minor: col.minor,
  size_id: col.uuid.nullable(),
  smallest: col.bool,
  members: z.array(z.string()),
});

type Option = CoverOption & { sizeId: string | null; smallest: boolean };

/** Every offered extension size and bundle priced in this currency and interval. */
async function coverOptions(currency: string, interval: PlanInterval): Promise<Option[]> {
  const rows = await typedRows(
    OPTION_ROW,
    sql`
      select 'extension' as kind, es.extension_id as id, ep.id as price_id, ep.amount_minor, es.id as size_id,
             es.id = (select s2.id from commerce.extension_sizes s2 where s2.extension_id = es.extension_id and s2.active
                       order by s2.position, s2.created_at limit 1) as smallest,
             array[es.extension_id] as members
        from commerce.extension_prices ep
        join commerce.extension_sizes es on es.id = ep.size_id and es.active
        join commerce.extensions e on e.id = es.extension_id and e.active
       where ep.active and ep.currency = ${currency} and ep.interval = ${interval}
      union all
      select 'bundle', b.id::text, bp.id, bp.amount_minor, null, true,
             array(select m.extension_id from commerce.extension_bundle_members m where m.bundle_id = b.id order by m.extension_id)
        from commerce.extension_bundle_prices bp
        join commerce.extension_bundles b on b.id = bp.bundle_id and b.active
       where bp.active and bp.currency = ${currency} and bp.interval = ${interval}
    `,
  );
  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    priceId: r.price_id,
    amountMinor: r.amount_minor,
    covers: r.members.filter(isExtensionId),
    sizeId: r.size_id,
    smallest: r.smallest,
  }));
}

/** What the account pays for now, on its own or in a bundle, at its size. */
async function ownedAddOns(organisationId: string): Promise<{ extensionId: ExtensionId; sizeId: string | null; bundleId: string | null }[]> {
  const rows = await typedRows(
    z.object({ extension_id: col.text, size_id: col.uuid.nullable(), bundle_id: col.uuid.nullable() }),
    sql`
      select extension_id, size_id, bundle_id from commerce.organisation_extensions
       where organisation_id = ${organisationId}::uuid and source in ('bought', 'bundle') and ended_at is null
    `,
  );
  return rows.flatMap((r) => (isExtensionId(r.extension_id) ? [{ extensionId: r.extension_id, sizeId: r.size_id, bundleId: r.bundle_id }] : []));
}

/** What a plan includes. */
async function planIncludes(planId: string | null): Promise<ExtensionId[]> {
  if (!planId) return [];
  const rows = await typedRows(z.object({ extension_id: col.text }), sql`select extension_id from commerce.plan_extension_grants where plan_id = ${planId}::uuid`);
  return rows.map((r) => r.extension_id).filter(isExtensionId);
}

export type AccountCover = Cover & {
  /** The extensions it has, after the change (what the plan includes left out). */
  wanted: ExtensionId[];
  /** Bundles among the picks the account does not have now. */
  newBundles: string[];
};

type At = { currency: string; interval: PlanInterval; planId: string | null };
type Facts = { usable: Option[]; owned: Awaited<ReturnType<typeof ownedAddOns>>; included: ExtensionId[] };

/**
 * What a cover is worked out from: the options the account can use (an extension bought at a bigger size keeps that size, and no bundle
 * covers it, as a bundle holds the smallest; every other extension at its smallest), what it pays for now, and what the plan includes.
 */
async function coverFacts(organisationId: string, at: At): Promise<Facts> {
  const [options, owned, included] = await Promise.all([coverOptions(at.currency, at.interval), ownedAddOns(organisationId), planIncludes(at.planId)]);
  const sized = new Map(owned.map((o) => [o.extensionId, o.sizeId]));
  const bigger = new Set(owned.filter((o) => options.some((x) => x.kind === "extension" && x.sizeId === o.sizeId && !x.smallest)).map((o) => o.extensionId));
  const usable = options.filter((o) =>
    o.kind === "bundle"
      ? !o.covers.some((id) => bigger.has(id))
      : bigger.has(o.covers[0])
        ? o.sizeId === sized.get(o.covers[0])
        : o.smallest,
  );
  return { usable, owned, included };
}

/** The cover from the facts with `add` added or `drop` taken off; an extension with no price is left out, except `add` (then null). */
function coverFrom(facts: Facts, add?: ExtensionId, drop?: ExtensionId): AccountCover | null {
  const { usable, owned, included } = facts;
  const coverable = (id: ExtensionId) => usable.some((o) => o.covers.includes(id));
  if (add && !included.includes(add) && !coverable(add)) return null;
  const wanted = [...new Set([...owned.map((o) => o.extensionId), ...(add ? [add] : [])])].filter((id) => id !== drop && !included.includes(id) && coverable(id));
  const cover = cheapestCover(wanted, included, usable, drop ? [drop] : []);
  if (!cover) return null;
  const ownedBundles = new Set(owned.map((o) => o.bundleId).filter(Boolean));
  return { ...cover, wanted, newBundles: cover.picks.filter((p) => p.kind === "bundle" && !ownedBundles.has(p.id)).map((p) => p.id) };
}

/**
 * The cheapest way for an account to have what it pays for now, with `add` added or `drop` taken off, on this plan, in this currency and
 * interval. An extension with no price here is left out, except `add`, for which the answer is null.
 */
export async function accountCover(organisationId: string, at: At & { add?: ExtensionId; drop?: ExtensionId }): Promise<AccountCover | null> {
  return coverFrom(await coverFacts(organisationId, at), at.add, at.drop);
}

/** What adding an extension buys when that is a bundle the account does not have: its name, its price and what it saves (Account → Extensions). */
export type BundleHint = { bundle: string; amountMinor: number; savingMinor: number };

/** For each of these extensions, the bundle adding it would buy, when the cheapest way is one; read once for them all. */
export async function bundleHints(organisationId: string, at: At, ids: readonly ExtensionId[]): Promise<Partial<Record<ExtensionId, BundleHint>>> {
  const facts = await coverFacts(organisationId, at);
  const out: Partial<Record<ExtensionId, { id: string; amountMinor: number; savingMinor: number }>> = {};
  for (const id of ids) {
    const cover = coverFrom(facts, id);
    const bundle = cover?.picks.find((p) => p.kind === "bundle" && cover.newBundles.includes(p.id) && p.covers.includes(id));
    if (cover && bundle) out[id] = { id: bundle.id, amountMinor: bundle.amountMinor, savingMinor: coverSaving(cover) };
  }
  const wantedIds = [...new Set(Object.values(out).map((h) => h!.id))];
  if (wantedIds.length === 0) return {};
  const names = await typedRows(
    z.object({ id: col.uuid, name: col.text }),
    sql`select id, name from commerce.extension_bundles where id in (${sql.join(wantedIds.map((b) => sql`${b}::uuid`), sql`, `)})`,
  );
  return Object.fromEntries(
    Object.entries(out).map(([id, h]) => [id, { bundle: names.find((n) => n.id === h!.id)?.name ?? "", amountMinor: h!.amountMinor, savingMinor: h!.savingMinor }]),
  );
}
