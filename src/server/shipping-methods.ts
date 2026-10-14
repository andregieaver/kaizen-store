import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { DEFAULT_WEIGHT_GRAMS } from "@/lib/shipping-limits";
import { defaultWeightInput, methodInput, profileInput, zoneInput } from "@/lib/shipping-methods-schema";
import { shippingWarnings, type MarketShippingFacts, type MethodRate, type RateBasis, type ShippingWarning } from "@/lib/shipping-methods";
import { zoneFor } from "@/lib/postal-patterns";
import { cleanPostalCode } from "@/lib/postal-code";

import { audit } from "./auth";
import { catalogTag } from "./catalog";
import { refreshTag } from "./refresh";
import { shippingGuard, type ShippingRefused } from "./shipping-errors";
import { textList, uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * The store's own shipping methods, zones, profiles and default weight (D237, `docs/wave-3-shipping-methods.md` 2.1): the admin's reads and saves. Each
 * save is one transaction (a rate group is replaced inside it, because the tier check runs at commit), audit-logged under `shipping.*` with names,
 * counts and amounts in minor units (never a pattern list), and refreshes the catalogue's tag (structured data and the chat read shipping). The
 * checkout reads the same rows through `marketShipping()` in `delivery-options.ts`; only these two modules read `shipping_method_rates` (a scan test).
 * Every query names the store.
 */

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export type ShippingMethodRow = {
  id: string;
  marketCode: string;
  currency: string;
  name: string;
  names: Record<string, string>;
  estimate: { min: number; max: number } | null;
  freeOverMinor: number | null;
  active: boolean;
  position: number;
  rates: MethodRate[];
};

export type ShippingZoneRow = { id: string; marketCode: string; name: string; patterns: string[]; position: number };
export type ShippingProfileRow = { id: string; name: string; position: number; products: number };

export type ShippingSetup = {
  methods: ShippingMethodRow[];
  zones: ShippingZoneRow[];
  profiles: ShippingProfileRow[];
  defaultWeightGrams: number;
  /** Markets with a flat rate set (`shipping_rates`). */
  flatMarkets: string[];
};

/** Everything the Shipping pages show, every market at once. */
export async function getShippingSetup(storeId: string): Promise<ShippingSetup> {
  const [methods, rates, zones, profiles, [settings], flats] = await Promise.all([
    db().execute<Row>(sql`select * from commerce.shipping_methods where store_id = ${storeId}::uuid order by market_code, position, id`),
    db().execute<Row>(sql`select * from commerce.shipping_method_rates where store_id = ${storeId}::uuid order by method_id, zone_id nulls first, profile_id nulls first, min_value`),
    db().execute<Row>(sql`select * from commerce.shipping_zones where store_id = ${storeId}::uuid order by market_code, position, id`),
    db().execute<Row>(sql`
      select p.id, p.name, p.position,
        (select count(*)::int from commerce.products pr where pr.store_id = p.store_id and pr.shipping_profile_id = p.id) as products
      from commerce.shipping_profiles p where p.store_id = ${storeId}::uuid order by p.position, p.name, p.id
    `),
    db().execute<Row>(sql`select default_weight_grams from commerce.shipping_settings where store_id = ${storeId}::uuid`),
    db().execute<Row>(sql`select market_code from commerce.shipping_rates where store_id = ${storeId}::uuid`),
  ]);
  return {
    methods: methods.map((m) => ({
      id: String(m.id),
      marketCode: String(m.market_code).trim(),
      currency: String(m.currency).trim(),
      name: String(m.name),
      names: (m.names ?? {}) as Record<string, string>,
      estimate: m.estimate_min_days === null || m.estimate_min_days === undefined ? null : { min: Number(m.estimate_min_days), max: Number(m.estimate_max_days) },
      freeOverMinor: nullableNumber(m.free_over_minor),
      active: Boolean(m.active),
      position: Number(m.position),
      rates: rates
        .filter((r) => String(r.method_id) === String(m.id))
        .map((r) => ({
          zoneId: r.zone_id ? String(r.zone_id) : null,
          profileId: r.profile_id ? String(r.profile_id) : null,
          basis: r.basis as RateBasis,
          minValue: Number(r.min_value),
          maxValue: nullableNumber(r.max_value),
          amountMinor: Number(r.amount_minor),
        })),
    })),
    zones: zones.map((z) => ({ id: String(z.id), marketCode: String(z.market_code).trim(), name: String(z.name), patterns: (z.patterns ?? []) as string[], position: Number(z.position) })),
    profiles: profiles.map((p) => ({ id: String(p.id), name: String(p.name), position: Number(p.position), products: Number(p.products) })),
    defaultWeightGrams: settings ? Number(settings.default_weight_grams) : DEFAULT_WEIGHT_GRAMS,
    flatMarkets: flats.map((f) => String(f.market_code).trim()),
  };
}

/**
 * The Shipping hub's warnings (2.1, `shippingWarnings()`), computed and never stored: a market with methods and no flat rate, zones and no Rest of
 * country rate, subscriptions or weekly boxes on without a flat rate, weight tiers while active goods variants have no weight.
 */
export async function shippingWarningsFor(storeId: string, marketCodes: readonly string[]): Promise<ShippingWarning[]> {
  const setup = await getShippingSetup(storeId);
  const [facts] = await db().execute<Row>(sql`
    select commerce.feature_on(${storeId}::uuid, 'subscriptions') or commerce.feature_on(${storeId}::uuid, 'boxes') as recurring,
      (select count(*)::int from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
        where v.store_id = ${storeId}::uuid and v.active and p.status = 'active' and v.delivery = 'physical' and v.weight_grams is null) as weightless
  `);
  const markets: MarketShippingFacts[] = marketCodes.map((code) => ({
    marketCode: code,
    hasFlat: setup.flatMarkets.includes(code),
    zones: setup.zones.filter((z) => z.marketCode === code).length,
    methods: setup.methods.filter((m) => m.marketCode === code).map((m) => ({ active: m.active, rates: m.rates })),
  }));
  return shippingWarnings(markets, { recurringOn: Boolean(facts?.recurring), variantsWithoutWeight: Number(facts?.weightless ?? 0) });
}

type Saved = { ok: true; id: string } | { ok: false; problem: "invalid" | "not_found" | "not_market" | "taken"; message: string } | ShippingRefused;

const invalid = (error: z.ZodError): Saved => ({ ok: false, problem: "invalid", message: error.issues[0]?.message ?? "Check the fields and try again." });

/**
 * Saves a method with all its rate groups (`methodInput`): new when `id` is null. Every group of the method is replaced in the same transaction (a group
 * left out is *Not offered*); zones and profiles named must be the store's and the zones in the method's market. The market's currency is the market's
 * own. Audit `shipping.method_saved` with the name, the counts of groups and tiers, the free-above in minor units.
 */
export async function saveShippingMethod(accountId: string, storeId: string, input: unknown): Promise<Saved> {
  const parsed = methodInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const m = parsed.data;
  const result = await shippingGuard(() =>
    db().transaction(async (tx): Promise<Saved> => {
      const [market] = await tx.execute<Row>(sql`select currency from commerce.markets where store_id = ${storeId}::uuid and code = ${m.marketCode}`);
      if (!market) return { ok: false, problem: "not_market", message: "This is not a country you sell to." };
      const zoneIds = [...new Set(m.groups.map((g) => g.zoneId).filter((id): id is string => id !== null))];
      const profileIds = [...new Set(m.groups.map((g) => g.profileId).filter((id): id is string => id !== null))];
      if (zoneIds.length > 0) {
        const [found] = await tx.execute<Row>(sql`
          select count(*)::int as n from commerce.shipping_zones where store_id = ${storeId}::uuid and market_code = ${m.marketCode} and id = any(${uuidList(zoneIds)})
        `);
        if (Number(found.n) !== zoneIds.length) return { ok: false, problem: "not_found", message: "A zone of these rates no longer exists in this country." };
      }
      if (profileIds.length > 0) {
        const [found] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.shipping_profiles where store_id = ${storeId}::uuid and id = any(${uuidList(profileIds)})`);
        if (Number(found.n) !== profileIds.length) return { ok: false, problem: "not_found", message: "A profile of these rates no longer exists." };
      }
      const fields = sql`
        name = ${m.name}, names = ${JSON.stringify(m.names)}::jsonb, estimate_min_days = ${m.estimate?.min ?? null}, estimate_max_days = ${m.estimate?.max ?? null},
        free_over_minor = ${m.freeOverMinor}, active = ${m.active}, updated_at = now()
      `;
      let id: string;
      if (m.id) {
        const [row] = await tx.execute<Row>(sql`
          update commerce.shipping_methods set ${fields} where store_id = ${storeId}::uuid and id = ${m.id}::uuid and market_code = ${m.marketCode} returning id
        `);
        if (!row) return { ok: false, problem: "not_found", message: "That method no longer exists." };
        id = String(row.id);
        await tx.execute(sql`delete from commerce.shipping_method_rates where store_id = ${storeId}::uuid and method_id = ${id}::uuid`);
      } else {
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.shipping_methods (store_id, market_code, currency, name, names, estimate_min_days, estimate_max_days, free_over_minor, active, position)
          values (${storeId}::uuid, ${m.marketCode}, ${String(market.currency).trim()}, ${m.name}, ${JSON.stringify(m.names)}::jsonb, ${m.estimate?.min ?? null},
                  ${m.estimate?.max ?? null}, ${m.freeOverMinor}, ${m.active},
                  (select coalesce(max(position) + 1, 0) from commerce.shipping_methods where store_id = ${storeId}::uuid and market_code = ${m.marketCode}))
          returning id
        `);
        id = String(row.id);
      }
      for (const group of m.groups) {
        for (const tier of group.tiers) {
          await tx.execute(sql`
            insert into commerce.shipping_method_rates (store_id, method_id, zone_id, profile_id, basis, min_value, max_value, amount_minor)
            values (${storeId}::uuid, ${id}::uuid, ${group.zoneId}::uuid, ${group.profileId}::uuid, ${tier.basis}, ${tier.minValue}, ${tier.maxValue}, ${tier.amountMinor})
          `);
        }
      }
      return { ok: true, id };
    }),
  );
  if (result.ok) {
    await audit(
      accountId,
      storeId,
      "shipping.method_saved",
      { id: result.id, market: m.marketCode, name: m.name, active: m.active, groups: m.groups.filter((g) => g.tiers.length > 0).length, tiers: m.groups.reduce((n, g) => n + g.tiers.length, 0), freeOverMinor: m.freeOverMinor },
      { area: "settings", target: { type: "shipping", id: result.id } },
    );
    refreshTag(catalogTag(storeId));
  }
  return result;
}

/** Deletes a method and its rates (a cart that chose it falls back to the default). */
export async function deleteShippingMethod(accountId: string, storeId: string, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const rows = await db().execute<Row>(sql`delete from commerce.shipping_methods where store_id = ${storeId}::uuid and id = ${id}::uuid returning name`);
  if (rows.length === 0) return false;
  await audit(accountId, storeId, "shipping.method_deleted", { id, name: String(rows[0].name) }, { area: "settings", target: { type: "shipping", id } });
  refreshTag(catalogTag(storeId));
  return true;
}

/** The order of a market's methods (or zones): the ids in the new order; anything else of the market keeps its place after them. */
export async function reorderShipping(accountId: string, storeId: string, table: "methods" | "zones", marketCode: string, ids: readonly string[]): Promise<boolean> {
  if (!/^[A-Z]{2}$/.test(marketCode) || ids.some((id) => !z.uuid().safeParse(id).success)) return false;
  const target = table === "methods" ? sql`commerce.shipping_methods` : sql`commerce.shipping_zones`;
  await db().transaction(async (tx) => {
    for (const [i, id] of ids.entries()) {
      await tx.execute(sql`update ${target} set position = ${i} where store_id = ${storeId}::uuid and market_code = ${marketCode} and id = ${id}::uuid`);
    }
  });
  await audit(accountId, storeId, `shipping.${table === "methods" ? "method" : "zone"}s_reordered`, { market: marketCode, count: ids.length }, { area: "settings" });
  refreshTag(catalogTag(storeId));
  return true;
}

/**
 * Saves a zone (`zoneInput`, patterns already cleaned by `parsePatternList()` in the editor and checked again here by the schema and the database). A
 * pattern another zone of the market holds is refused naming the zone (`taken`). Audit `shipping.zone_saved` with the name and the number of patterns.
 */
export async function saveShippingZone(accountId: string, storeId: string, input: unknown): Promise<Saved> {
  const parsed = zoneInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const zIn = parsed.data;
  const result = await shippingGuard(() =>
    db().transaction(async (tx): Promise<Saved> => {
      const [market] = await tx.execute<Row>(sql`select 1 from commerce.markets where store_id = ${storeId}::uuid and code = ${zIn.marketCode}`);
      if (!market) return { ok: false, problem: "not_market", message: "This is not a country you sell to." };
      const [taken] = await tx.execute<Row>(sql`
        select z.name, p as pattern from commerce.shipping_zones z, unnest(z.patterns) p
        where z.store_id = ${storeId}::uuid and z.market_code = ${zIn.marketCode} and z.id is distinct from ${zIn.id}::uuid and p = any(${textList(zIn.patterns)})
        limit 1
      `);
      if (taken) return { ok: false, problem: "taken", message: `${String(taken.pattern)} is already in the zone ${String(taken.name)}.` };
      if (zIn.id) {
        const [row] = await tx.execute<Row>(sql`
          update commerce.shipping_zones set name = ${zIn.name}, patterns = ${textList(zIn.patterns)}, updated_at = now()
          where store_id = ${storeId}::uuid and id = ${zIn.id}::uuid and market_code = ${zIn.marketCode} returning id
        `);
        return row ? { ok: true, id: String(row.id) } : { ok: false, problem: "not_found", message: "That zone no longer exists." };
      }
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.shipping_zones (store_id, market_code, name, patterns, position)
        values (${storeId}::uuid, ${zIn.marketCode}, ${zIn.name}, ${textList(zIn.patterns)},
                (select coalesce(max(position) + 1, 0) from commerce.shipping_zones where store_id = ${storeId}::uuid and market_code = ${zIn.marketCode}))
        returning id
      `);
      return { ok: true, id: String(row.id) };
    }),
  );
  if (result.ok) {
    await audit(accountId, storeId, "shipping.zone_saved", { id: result.id, market: zIn.marketCode, name: zIn.name, patterns: zIn.patterns.length }, { area: "settings", target: { type: "shipping", id: result.id } });
    refreshTag(catalogTag(storeId));
  }
  return result;
}

/** Deletes a zone and its rates (its codes become Rest of country). */
export async function deleteShippingZone(accountId: string, storeId: string, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const rows = await db().execute<Row>(sql`delete from commerce.shipping_zones where store_id = ${storeId}::uuid and id = ${id}::uuid returning name`);
  if (rows.length === 0) return false;
  await audit(accountId, storeId, "shipping.zone_deleted", { id, name: String(rows[0].name) }, { area: "settings", target: { type: "shipping", id } });
  refreshTag(catalogTag(storeId));
  return true;
}

/** *Check a postal code* on the Zones page: the code as the country writes it and the zone it falls in (null: Rest of country). */
export async function checkZoneCode(storeId: string, marketCode: string, typed: string): Promise<{ code: string | null; zone: { id: string; name: string } | null }> {
  const code = cleanPostalCode(marketCode, typed.slice(0, 20));
  if (!code) return { code: null, zone: null };
  const zones = (await getShippingSetup(storeId)).zones.filter((zone) => zone.marketCode === marketCode);
  const zone = zoneFor(zones, code);
  return { code, zone: zone ? { id: zone.id, name: zone.name } : null };
}

/**
 * Saves a profile and the products in it (`profileInput`): the products listed are moved into it, and products that were in it and are not listed go back
 * to General, in the same transaction. Products must be the store's. Audit `shipping.profile_saved` with the name and the count.
 */
export async function saveShippingProfile(accountId: string, storeId: string, input: unknown): Promise<Saved> {
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const p = parsed.data;
  const result = await shippingGuard(() =>
    db().transaction(async (tx): Promise<Saved> => {
      let id: string;
      if (p.id) {
        const [row] = await tx.execute<Row>(sql`
          update commerce.shipping_profiles set name = ${p.name}, updated_at = now() where store_id = ${storeId}::uuid and id = ${p.id}::uuid returning id
        `);
        if (!row) return { ok: false, problem: "not_found", message: "That profile no longer exists." };
        id = String(row.id);
      } else {
        const [dupe] = await tx.execute<Row>(sql`select 1 from commerce.shipping_profiles where store_id = ${storeId}::uuid and lower(name) = lower(${p.name})`);
        if (dupe) return { ok: false, problem: "taken", message: "Another profile has this name." };
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.shipping_profiles (store_id, name, position)
          values (${storeId}::uuid, ${p.name}, (select coalesce(max(position) + 1, 0) from commerce.shipping_profiles where store_id = ${storeId}::uuid))
          returning id
        `);
        id = String(row.id);
      }
      const products = [...new Set(p.productIds)];
      await tx.execute(sql`
        update commerce.products set shipping_profile_id = null
        where store_id = ${storeId}::uuid and shipping_profile_id = ${id}::uuid and not (id = any(${uuidList(products)}))
      `);
      if (products.length > 0) {
        await tx.execute(sql`update commerce.products set shipping_profile_id = ${id}::uuid where store_id = ${storeId}::uuid and id = any(${uuidList(products)})`);
      }
      return { ok: true, id };
    }),
  ).catch((error: unknown): Saved => {
    // The name is unique per store, ignoring case (a race with another save).
    if (String((error as { cause?: { code?: string } })?.cause?.code ?? "") === "23505") return { ok: false, problem: "taken", message: "Another profile has this name." };
    throw error;
  });
  if (result.ok) {
    await audit(accountId, storeId, "shipping.profile_saved", { id: result.id, name: p.name, products: new Set(p.productIds).size }, { area: "settings", target: { type: "shipping", id: result.id } });
    refreshTag(catalogTag(storeId));
  }
  return result;
}

/** Deletes a profile: its products go back to General first, and its rates go with it, in one transaction. Returns how many products moved. */
export async function deleteShippingProfile(accountId: string, storeId: string, id: string): Promise<{ ok: true; moved: number } | { ok: false }> {
  if (!z.uuid().safeParse(id).success) return { ok: false };
  const done = await db().transaction(async (tx) => {
    const moved = await tx.execute<Row>(sql`update commerce.products set shipping_profile_id = null where store_id = ${storeId}::uuid and shipping_profile_id = ${id}::uuid returning id`);
    const rows = await tx.execute<Row>(sql`delete from commerce.shipping_profiles where store_id = ${storeId}::uuid and id = ${id}::uuid returning name`);
    return rows.length === 0 ? null : { moved: moved.length, name: String(rows[0].name) };
  });
  if (!done) return { ok: false };
  await audit(accountId, storeId, "shipping.profile_deleted", { id, name: done.name, moved: done.moved }, { area: "settings", target: { type: "shipping", id } });
  refreshTag(catalogTag(storeId));
  return { ok: true, moved: done.moved };
}

/** The store's default weight per unit for goods without a weight, in methods' weight tiers (`shipping_settings`). */
export async function saveDefaultWeight(accountId: string, storeId: string, input: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = defaultWeightInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the weight." };
  const [before] = await db().execute<Row>(sql`select default_weight_grams from commerce.shipping_settings where store_id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.shipping_settings (store_id, default_weight_grams, updated_by) values (${storeId}::uuid, ${parsed.data.grams}, ${accountId}::uuid)
    on conflict (store_id) do update set default_weight_grams = excluded.default_weight_grams, updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(accountId, storeId, "shipping.default_weight_saved", { from: before ? Number(before.default_weight_grams) : DEFAULT_WEIGHT_GRAMS, to: parsed.data.grams }, { area: "settings" });
  refreshTag(catalogTag(storeId));
  return { ok: true };
}
