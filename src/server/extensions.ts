import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  EXTENSION_IDS,
  isExtensionId,
  readAllowances,
  readExtensionFacts,
  standingOf,
  type Allowances,
  type ExtensionId,
  type ExtensionState,
  type StateSource,
} from "@/lib/extensions";
import type { ExtensionPriceInput, ExtensionInput, BundleInput, GrantInput } from "@/lib/extension-form";
import type { PlanInterval } from "@/lib/plans";

import { audit, type Account } from "./auth";
import { planCurrencies } from "./billing";
import { refreshTag } from "./refresh";
import { experimentsTag } from "./experiments";
import { storeTag } from "./stores";
import type { SaveResult } from "./settings";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Paid extensions (D748 step E2, `docs/extensions.md`): the catalogue (extensions, their sizes and prices, bundles, what each plan includes)
 * and an account's standing with each extension. Prices are never changed in place: a new amount is a new row and the old one is switched
 * off, as for plans, so what an account pays stays what it signed up at.
 */

export type ExtensionPrice = { id: string; currency: string; interval: PlanInterval; amountMinor: number };
export type ExtensionSize = { id: string; label: string; allowances: Allowances; position: number; active: boolean; prices: ExtensionPrice[] };
export type CatalogueExtension = {
  id: ExtensionId;
  name: string;
  description: string;
  standalone: boolean;
  storeOnly: boolean;
  position: number;
  active: boolean;
  sizes: ExtensionSize[];
};
export type CatalogueBundle = { id: string; name: string; description: string; position: number; active: boolean; members: ExtensionId[]; prices: ExtensionPrice[] };
export type PlanGrant = { planId: string; extensionId: ExtensionId; sizeId: string };
export type Catalogue = { extensions: CatalogueExtension[]; bundles: CatalogueBundle[]; grants: PlanGrant[] };

const extensionId = z.string().refine(isExtensionId);
const interval = z.enum(["month", "year"]);

const EXTENSION_ROW = z.object({
  id: extensionId,
  name: col.text,
  description: col.text,
  standalone: col.bool,
  store_only: col.bool,
  position: col.int,
  active: col.bool,
});
const SIZE_ROW = z.object({ id: col.uuid, extension_id: extensionId, label: col.text, allowances: z.unknown(), position: col.int, active: col.bool });
const PRICE_ROW = z.object({ id: col.uuid, owner_id: col.uuid, currency: col.currency, interval, amount_minor: col.minor });
const BUNDLE_ROW = z.object({ id: col.uuid, name: col.text, description: col.text, position: col.int, active: col.bool });
const MEMBER_ROW = z.object({ bundle_id: col.uuid, extension_id: extensionId });
const GRANT_ROW = z.object({ plan_id: col.uuid, extension_id: extensionId, size_id: col.uuid });

const priceOf = (row: z.output<typeof PRICE_ROW>): ExtensionPrice => ({ id: row.id, currency: row.currency, interval: row.interval, amountMinor: row.amount_minor });

/** The whole catalogue, offered or not, with only the prices on offer. For the platform admin's editor; nothing here is secret. */
export async function getExtensionCatalogue(): Promise<Catalogue> {
  const [extensions, sizes, sizePrices, bundles, members, bundlePrices, grants] = await Promise.all([
    typedRows(EXTENSION_ROW, sql`select id, name, description, standalone, store_only, position, active from commerce.extensions order by position, id`),
    typedRows(SIZE_ROW, sql`select id, extension_id, label, allowances, position, active from commerce.extension_sizes order by position, created_at`),
    typedRows(
      PRICE_ROW,
      sql`select id, size_id as owner_id, currency, interval, amount_minor from commerce.extension_prices where active order by currency, interval`,
    ),
    typedRows(BUNDLE_ROW, sql`select id, name, description, position, active from commerce.extension_bundles order by position, created_at`),
    typedRows(MEMBER_ROW, sql`select bundle_id, extension_id from commerce.extension_bundle_members`),
    typedRows(
      PRICE_ROW,
      sql`select id, bundle_id as owner_id, currency, interval, amount_minor from commerce.extension_bundle_prices where active order by currency, interval`,
    ),
    typedRows(GRANT_ROW, sql`select plan_id, extension_id, size_id from commerce.plan_extension_grants`),
  ]);
  const order = (id: ExtensionId) => EXTENSION_IDS.indexOf(id);
  return {
    extensions: extensions.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      standalone: e.standalone,
      storeOnly: e.store_only,
      position: e.position,
      active: e.active,
      sizes: sizes
        .filter((s) => s.extension_id === e.id)
        .map((s) => ({
          id: s.id,
          label: s.label,
          allowances: readAllowances(s.allowances),
          position: s.position,
          active: s.active,
          prices: sizePrices.filter((p) => p.owner_id === s.id).map(priceOf),
        })),
    })),
    bundles: bundles.map((b) => ({
      ...b,
      members: members
        .filter((m) => m.bundle_id === b.id)
        .map((m) => m.extension_id)
        .sort((a, c) => order(a) - order(c)),
      prices: bundlePrices.filter((p) => p.owner_id === b.id).map(priceOf),
    })),
    grants: grants.map((g) => ({ planId: g.plan_id, extensionId: g.extension_id, sizeId: g.size_id })),
  };
}

export type ExtensionStanding = { state: ExtensionState; source: StateSource };
export type ExtensionStandings = Record<ExtensionId, ExtensionStanding>;

const FACTS_ROW = z.object({ facts: z.unknown() });

/**
 * An account's standing with every extension (`extensionState()`), from `commerce.organisation_extension_facts()`, the facts every store read
 * carries: Kaizena Flow's own has them all; until extensions are sold every account has every one; then what a plan of one of its stores
 * includes, and its own rows. Read per request, never cached.
 */
export async function organisationExtensionStandings(organisationId: string, now = new Date(), executor: Executor = db()): Promise<ExtensionStandings> {
  const row = await typedRow(FACTS_ROW, sql`select commerce.organisation_extension_facts(${organisationId}::uuid) as facts`, executor);
  const facts = readExtensionFacts(row?.facts);
  const out = {} as ExtensionStandings;
  for (const id of EXTENSION_IDS) out[id] = standingOf(facts, id, now);
  return out;
}

/**
 * Refreshes the cached store reads that carry the extension facts: every store of an account (after its own row changes), or of the accounts
 * on some plans (after what a plan includes changes). Call it after the write's transaction has committed.
 */
export async function refreshExtensionFacts(scope: { organisationId: string } | { planIds: readonly string[] }): Promise<void> {
  const rows =
    "organisationId" in scope
      ? await typedRows(SLUG_ROW, sql`select id, slug from commerce.stores where organisation_id = ${scope.organisationId}::uuid`)
      : scope.planIds.length === 0
        ? []
        : await typedRows(
            SLUG_ROW,
            sql`
              select distinct s.id, s.slug from commerce.stores s
               where s.organisation_id in (
                 select s2.organisation_id from commerce.stores s2 join commerce.store_billing b on b.store_id = s2.id
                  where b.plan_id in (${sql.join(scope.planIds.map((id) => sql`${id}::uuid`), sql`, `)}) and s2.organisation_id is not null
               )
            `,
          );
  for (const row of rows) {
    refreshTag(storeTag(row.slug));
    refreshTag(experimentsTag(row.id));
  }
}

const SLUG_ROW = z.object({ id: col.uuid, slug: col.text });

const ACTIVE_PRICE_ROW = z.object({ id: col.uuid, currency: col.currency, interval, amount_minor: col.minor });

/** The two price tables, each with its owner column, as fixed queries: nothing here is built from input. */
const PRICE_TABLES = {
  size: {
    current: (ownerId: string) => sql`select id, currency, interval, amount_minor from commerce.extension_prices where size_id = ${ownerId}::uuid and active`,
    off: (id: string) => sql`update commerce.extension_prices set active = false where id = ${id}::uuid`,
    add: (ownerId: string, p: ExtensionPriceInput) =>
      sql`insert into commerce.extension_prices (size_id, currency, interval, amount_minor) values (${ownerId}::uuid, ${p.currency}, ${p.interval}, ${p.amountMinor})`,
  },
  bundle: {
    current: (ownerId: string) => sql`select id, currency, interval, amount_minor from commerce.extension_bundle_prices where bundle_id = ${ownerId}::uuid and active`,
    off: (id: string) => sql`update commerce.extension_bundle_prices set active = false where id = ${id}::uuid`,
    add: (ownerId: string, p: ExtensionPriceInput) =>
      sql`insert into commerce.extension_bundle_prices (bundle_id, currency, interval, amount_minor) values (${ownerId}::uuid, ${p.currency}, ${p.interval}, ${p.amountMinor})`,
  },
};

/**
 * Makes an owner's prices on offer the wanted ones: a price whose amount is unchanged stays, any other is switched off, and a new amount is
 * a new row, as for plans.
 */
async function replacePrices(tx: Executor, kind: keyof typeof PRICE_TABLES, ownerId: string, wanted: readonly ExtensionPriceInput[]): Promise<void> {
  const table = PRICE_TABLES[kind];
  const current = await typedRows(ACTIVE_PRICE_ROW, table.current(ownerId), tx);
  const left = new Map(wanted.map((p) => [`${p.currency}:${p.interval}`, p]));
  for (const row of current) {
    const want = left.get(`${row.currency}:${row.interval}`);
    if (want && row.amount_minor === want.amountMinor) left.delete(`${row.currency}:${row.interval}`);
    else await tx.execute(table.off(row.id));
  }
  for (const price of left.values()) await tx.execute(table.add(ownerId, price));
}

const ID_ROW = z.object({ id: col.uuid });

/** Saves an extension's words, whether it is sold on its own, and its sizes with their allowances and prices. */
export async function saveExtension(actor: Account, id: ExtensionId, input: ExtensionInput): Promise<SaveResult> {
  const known = await typedRow(z.object({ store_only: col.bool }), sql`select store_only from commerce.extensions where id = ${id}`);
  if (!known) return { ok: false, problems: ["There is no such extension."] };
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.extensions
         set name = ${input.name}, description = ${input.description}, standalone = ${input.standalone && !known.store_only},
             position = ${input.position}, active = ${input.active}, updated_at = now(), updated_by = ${actor.id}::uuid
       where id = ${id}
    `);
    for (const size of input.sizes) {
      let sizeId = size.id;
      if (sizeId) {
        await tx.execute(sql`
          update commerce.extension_sizes
             set label = ${size.label}, allowances = ${JSON.stringify(size.allowances)}::jsonb, position = ${size.position}, active = ${size.active},
                 updated_at = now(), updated_by = ${actor.id}::uuid
           where id = ${sizeId}::uuid and extension_id = ${id}
        `);
      } else {
        const row = await typedRow(
          ID_ROW,
          sql`
            insert into commerce.extension_sizes (extension_id, label, allowances, position, active, updated_by)
            values (${id}, ${size.label}, ${JSON.stringify(size.allowances)}::jsonb, ${size.position}, ${size.active}, ${actor.id}::uuid)
            returning id
          `,
          tx,
        );
        if (!row) throw new Error("The size was not written.");
        sizeId = row.id;
      }
      await replacePrices(tx, "size", sizeId, size.active ? size.prices : []);
    }
  });
  await audit(actor.id, null, "platform.extension_updated", { extension: id, sizes: input.sizes.length, active: input.active });
  return { ok: true };
}

/** Creates or saves a bundle: its words, which extensions it holds and its prices. */
export async function saveBundle(actor: Account, bundleId: string | null, input: BundleInput): Promise<SaveResult> {
  const id = await db().transaction(async (tx) => {
    let id = bundleId;
    if (id) {
      await tx.execute(sql`
        update commerce.extension_bundles
           set name = ${input.name}, description = ${input.description}, position = ${input.position}, active = ${input.active},
               updated_at = now(), updated_by = ${actor.id}::uuid
         where id = ${id}::uuid
      `);
    } else {
      const row = await typedRow(
        ID_ROW,
        sql`
          insert into commerce.extension_bundles (name, description, position, active, updated_by)
          values (${input.name}, ${input.description}, ${input.position}, ${input.active}, ${actor.id}::uuid)
          returning id
        `,
        tx,
      );
      if (!row) throw new Error("The bundle was not written.");
      id = row.id;
    }
    await tx.execute(sql`delete from commerce.extension_bundle_members where bundle_id = ${id}::uuid`);
    for (const member of input.members) {
      await tx.execute(sql`insert into commerce.extension_bundle_members (bundle_id, extension_id) values (${id}::uuid, ${member})`);
    }
    await replacePrices(tx, "bundle", id, input.active ? input.prices : []);
    return id;
  });
  await audit(actor.id, null, bundleId ? "platform.extension_bundle_updated" : "platform.extension_bundle_created", { bundleId: id, members: input.members });
  return { ok: true };
}

/** What each of the shown plans includes: every grant of those plans is replaced by the given ones (a size's id, or nothing). */
export async function savePlanGrants(actor: Account, planIds: readonly string[], grants: readonly GrantInput[]): Promise<SaveResult> {
  if (planIds.length === 0) return { ok: true };
  await db().transaction(async (tx) => {
    await tx.execute(sql`delete from commerce.plan_extension_grants where plan_id in (${sql.join(planIds.map((p) => sql`${p}::uuid`), sql`, `)})`);
    for (const grant of grants) {
      if (!planIds.includes(grant.planId)) continue;
      await tx.execute(sql`
        insert into commerce.plan_extension_grants (plan_id, extension_id, size_id)
        values (${grant.planId}::uuid, ${grant.extensionId}, ${grant.sizeId}::uuid)
      `);
    }
  });
  await audit(actor.id, null, "platform.extension_grants_updated", { plans: planIds.length, grants: grants.length });
  await refreshExtensionFacts({ planIds });
  return { ok: true };
}

/** When extensions started being sold, or null while every account has every extension (step E5 sets it). */
export async function extensionsLaunchedAt(): Promise<Date | null> {
  const row = await typedRow(z.object({ at: col.timestampOrNull }), sql`select extensions_launched_at as at from commerce.platform_settings`);
  return row?.at ? new Date(row.at) : null;
}

/**
 * The currencies the editor shows a price box for: the plans' (`planCurrencies()`) and every currency an extension or bundle already has a
 * price in, so that saving a form never drops a price the form did not show.
 */
export async function extensionCurrencies(): Promise<string[]> {
  const [plans, priced] = await Promise.all([
    planCurrencies(),
    typedRows(
      z.object({ currency: col.currency }),
      sql`select currency from commerce.extension_prices where active union select currency from commerce.extension_bundle_prices where active order by currency`,
    ),
  ]);
  return [...new Set([...plans, ...priced.map((row) => row.currency)])];
}
