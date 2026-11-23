import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { cheapestCover, coverSaving, type Cover, type CoverOption } from "@/lib/extension-cover";
import { FOUNDING_PREFIX, foundingOpen, isExtensionId, type ExtensionId } from "@/lib/extensions";
import type { PlanInterval } from "@/lib/plans";

import { col, typedRow, typedRows } from "./typed-rows";

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
  founding_minor: col.minorOrNull,
  size_id: col.uuid.nullable(),
  position: col.int.nullable(),
  smallest: col.bool,
  members: z.array(z.string()),
});

type Option = CoverOption & { sizeId: string | null; position: number | null; smallest: boolean; foundingMinor: number | null };

/** Every offered extension size and bundle priced in this currency and interval. */
async function coverOptions(currency: string, interval: PlanInterval): Promise<Option[]> {
  const rows = await typedRows(
    OPTION_ROW,
    sql`
      select 'extension' as kind, es.extension_id as id, ep.id as price_id, ep.amount_minor, ep.founding_minor, es.id as size_id, es.position,
             es.id = (select s2.id from commerce.extension_sizes s2 where s2.extension_id = es.extension_id and s2.active
                       order by s2.position, s2.created_at limit 1) as smallest,
             array[es.extension_id] as members
        from commerce.extension_prices ep
        join commerce.extension_sizes es on es.id = ep.size_id and es.active
        join commerce.extensions e on e.id = es.extension_id and e.active
       where ep.active and ep.currency = ${currency} and ep.interval = ${interval}
      union all
      select 'bundle', b.id::text, bp.id, bp.amount_minor, bp.founding_minor, null, null, true,
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
    foundingMinor: r.founding_minor,
    covers: r.members.filter(isExtensionId),
    sizeId: r.size_id,
    position: r.position,
    smallest: r.smallest,
  }));
}

/** What the account pays for now, on its own or in a bundle, at its size, and until when it keeps a founding price (E6). */
async function ownedAddOns(
  organisationId: string,
): Promise<{ extensionId: ExtensionId; sizeId: string | null; bundleId: string | null; foundingEndsAt: string | null }[]> {
  const rows = await typedRows(
    z.object({ extension_id: col.text, size_id: col.uuid.nullable(), bundle_id: col.uuid.nullable(), founding_ends_at: col.timestampOrNull }),
    sql`
      select extension_id, size_id, bundle_id, founding_ends_at from commerce.organisation_extensions
       where organisation_id = ${organisationId}::uuid and source in ('bought', 'bundle') and ended_at is null
    `,
  );
  return rows.flatMap((r) =>
    isExtensionId(r.extension_id) ? [{ extensionId: r.extension_id, sizeId: r.size_id, bundleId: r.bundle_id, foundingEndsAt: r.founding_ends_at }] : [],
  );
}

/** Until when founding prices are offered (D748 E6), or null. */
async function foundingUntil(): Promise<Date | null> {
  const row = await typedRow(z.object({ until: col.timestampOrNull }), sql`select extension_founding_until as until from commerce.platform_settings`);
  return row?.until ? new Date(row.until) : null;
}

/** What a plan includes, each at the position of the size it includes. */
async function planIncludes(planId: string | null): Promise<{ id: ExtensionId; position: number }[]> {
  if (!planId) return [];
  const rows = await typedRows(
    z.object({ extension_id: col.text, position: col.int }),
    sql`select g.extension_id, gs.position from commerce.plan_extension_grants g join commerce.extension_sizes gs on gs.id = g.size_id where g.plan_id = ${planId}::uuid`,
  );
  return rows.flatMap((r) => (isExtensionId(r.extension_id) ? [{ id: r.extension_id, position: r.position }] : []));
}

export type AccountCover = Cover & {
  /** The extensions it has, after the change (what the plan includes left out). */
  wanted: ExtensionId[];
  /** Bundles among the picks the account does not have now. */
  newBundles: string[];
};

type At = {
  currency: string;
  interval: PlanInterval;
  planId: string | null;
  now?: Date;
  /** A size wanted for an extension (D876, moving up): in place of the one it has. */
  sizes?: Partial<Record<ExtensionId, string>>;
};
type Facts = { usable: Option[]; owned: Awaited<ReturnType<typeof ownedAddOns>>; included: ExtensionId[] };

/**
 * What a cover is worked out from: the options the account can use (an extension bought at a bigger size keeps that size, and no bundle
 * covers it, as a bundle holds the smallest; every other extension at its smallest), what it pays for now, and what the plan includes: an
 * extension wanted at a bigger size than the plan's is bought on its own, so the plan no longer counts as having it (D876). An
 * option is priced at its founding price (E6, `founding:{price id}`) while founding prices are offered, or while the account keeps that
 * founding price for what it already has; else at its price.
 */
async function coverFacts(organisationId: string, at: At): Promise<Facts> {
  const now = at.now ?? new Date();
  const [found, owned, included, until] = await Promise.all([
    coverOptions(at.currency, at.interval),
    ownedAddOns(organisationId),
    planIncludes(at.planId),
    foundingUntil(),
  ]);
  const open = foundingOpen(until, now);
  const locked = (o: Option) =>
    owned.some(
      (x) => x.foundingEndsAt !== null && new Date(x.foundingEndsAt) > now && (o.kind === "bundle" ? x.bundleId === o.id : x.bundleId === null && x.sizeId === o.sizeId),
    );
  const options = found.map((o) =>
    o.foundingMinor !== null && (open || locked(o)) ? { ...o, priceId: `${FOUNDING_PREFIX}${o.priceId}`, amountMinor: o.foundingMinor } : o,
  );
  const sized = new Map<ExtensionId, string | null>(owned.map((o) => [o.extensionId, o.sizeId]));
  for (const [id, size] of Object.entries(at.sizes ?? {})) if (isExtensionId(id) && size) sized.set(id, size);
  const sizeOption = (id: ExtensionId) => options.find((x) => x.kind === "extension" && x.covers[0] === id && x.sizeId === sized.get(id));
  const bigger = new Set([...sized.keys()].filter((id) => sizeOption(id) && !sizeOption(id)!.smallest));
  const usable = options.filter((o) =>
    o.kind === "bundle"
      ? !o.covers.some((id) => bigger.has(id))
      : bigger.has(o.covers[0])
        ? o.sizeId === sized.get(o.covers[0])
        : o.smallest,
  );
  return {
    usable,
    owned,
    included: included.filter((g) => !(bigger.has(g.id) && (sizeOption(g.id)?.position ?? -1) > g.position)).map((g) => g.id),
  };
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
