import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { marketCheck } = await import("./market-check");

/**
 * The market check's facts (D900 M1, `docs/analytics.md` "Markets") against a small hand-made shop in Norway and Germany, in NOK without
 * VAT, Europe/Oslo, the period 1 to 30 September, read on 2 October. Every figure is worked out by hand from the rows below.
 *
 *   Visits, counted from 10 September:  NO 1,000, DE 1,000, the front door 50 (no country: left out).
 *   Checkout orders, paid, 10 September: NO 40, DE 4, each 10,000 with 2,000 VAT (revenue 8,000). A NO order waiting for payment never counts.
 *   Searches:   DE "leinen" 6 times, nothing found; NO "ull" 3 times and "leinen" once, nothing found; NO "kopp" once, found.
 *               Another store searched "leinen" 20 times in the same days.
 *   Products:   mc-1 priced in NO and DE, named in nb-NO and de-DE; mc-2 priced in NO only, named in nb-NO; mc-3 priced in NO, switched off
 *               in DE, named in nb-NO. The store's demo products are archived.
 */

const run = Date.now().toString(36);
const NOW = new Date("2026-10-02T10:00:00Z");
const PERIOD = customPeriod("2026-09-01", "2026-09-30");
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const de = toMarket({ code: "DE", currency: "EUR", defaultLocale: "de-DE" });
const localization = localizationOf(
  [],
  [
    { currency: "NOK", rate: 1, roundTo: 1 },
    { currency: "EUR", rate: 0.1, roundTo: 1 },
  ],
  [no, de],
);
const storeOf = (id: string, slug: string, over: Partial<Store> = {}) =>
  ({ id, slug, timeZone: "Europe/Oslo", markets: [no, de], localization, visitCounting: true, house: false, features: ["shop"], ...over }) as unknown as Store;

let store: Store;
let other: Store;

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.products set status = 'archived' where store_id = ${id}::uuid`);
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active) values (${id}::uuid, 'DE', 'EUR', 'de-DE', '{de-DE}', true)
    on conflict do nothing
  `);
  return id;
}

const visits = (storeId: string, market: string | null, n: number) =>
  db().execute(sql`
    insert into commerce.visits (store_id, day, visitor, market_code, device, channel, landing_path)
    select ${storeId}::uuid, '2026-09-10'::date, substr(md5(${`${run}-${market ?? "door"}-`} || g), 1, 24), ${market}, 'mobile', 'direct', '/'
    from generate_series(1, ${n}) g
  `);

async function orders(storeId: string, market: string, n: number, paid = true) {
  const made = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, placed_at)
    select ${storeId}::uuid, ${`MC-${run}-${market}-${paid ? "p" : "w"}-`} || g, ${market}, 'NOK', 'nb-NO', 'kari@example.com', ${paid ? "paid" : "pending_payment"},
      10000, 0, 0, 2000, 10000, '{}'::jsonb, '{}'::jsonb, '2026-09-10T10:00:00Z'::timestamptz
    from generate_series(1, ${n}) g
    returning id
  `);
  if (!paid) return;
  for (const o of made) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`pi_${run}_${String(o.id).slice(0, 8)}`}, 10000, 'NOK', 'captured')
    `);
  }
}

const searches = (storeId: string, market: string, query: string, n: number, results = 0) =>
  db().execute(sql`
    insert into commerce.search_queries (store_id, market_code, query, results, meaning_results, created_at)
    select ${storeId}::uuid, ${market}, ${query}, ${results}, 0, '2026-09-12T10:00:00Z'::timestamptz from generate_series(1, ${n})
  `);

async function product(storeId: string, handle: string, prices: string[], names: string[], offIn: string[] = []) {
  // On sale without the pictures and maker publishing asks for: the rule's own test is elsewhere.
  const [p] = await db().transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    return tx.execute<Row>(sql`
      insert into commerce.products (store_id, handle, tax_code, kind, status) values (${storeId}::uuid, ${handle}, 'txcd_99999999', 'goods', 'active') returning id
    `);
  });
  const [v] = await db().execute<Row>(sql`
    insert into commerce.product_variants (store_id, product_id, sku, delivery) values (${storeId}::uuid, ${String(p.id)}::uuid, ${handle.toUpperCase()}, 'physical') returning id
  `);
  for (const locale of names) {
    await db().execute(sql`insert into commerce.product_translations (store_id, product_id, locale, title) values (${storeId}::uuid, ${String(p.id)}::uuid, ${locale}, ${handle})`);
  }
  for (const market of prices) await db().execute(sql`select commerce.set_price(${String(v.id)}::uuid, ${market}, 19900)`);
  for (const market of offIn) {
    await db().execute(sql`insert into commerce.market_availability (store_id, product_id, market_code) values (${storeId}::uuid, ${String(p.id)}::uuid, ${market})`);
  }
}

beforeAll(async () => {
  const id = await makeStore(`mcheck-${run}`);
  store = storeOf(id, `mcheck-${run}`);
  const otherId = await makeStore(`mcheck-other-${run}`);
  other = storeOf(otherId, `mcheck-other-${run}`);
  await visits(id, "NO", 1000);
  await visits(id, "DE", 1000);
  await visits(id, null, 50);
  await orders(id, "NO", 40);
  await orders(id, "NO", 1, false);
  await orders(id, "DE", 4);
  await searches(id, "DE", "leinen", 6);
  await searches(id, "NO", "ull", 3);
  await searches(id, "NO", "leinen", 1);
  await searches(id, "NO", "kopp", 1, 2);
  await searches(otherId, "DE", "leinen", 20);
  await visits(otherId, "DE", 300);
  await product(id, `mc-1-${run}`, ["NO", "DE"], ["nb-NO", "de-DE"]);
  await product(id, `mc-2-${run}`, ["NO"], ["nb-NO"]);
  await product(id, `mc-3-${run}`, ["NO"], ["nb-NO"], ["DE"]);
});

afterAll(async () => {
  await closeDb();
});

describe("the market check's facts (D900 M1)", () => {
  it("reads each country's visits, orders, searches, prices and names, and nothing of another store's", async () => {
    const check = await marketCheck(store, PERIOD, { now: NOW, locale: "en-GB" });
    expect(check.markets.map((m) => m.code)).toEqual(["NO", "DE"]);
    const [norway, germany] = check.markets;
    expect(norway).toMatchObject({
      name: "Norway",
      sells: true,
      visits: 1000,
      visitOrders: 40,
      orders: 40,
      revenueMinor: 320_000,
      searches: 5,
      misses: 4,
      missedTerms: [
        { term: "ull", misses: 3 },
        { term: "leinen", misses: 1 },
      ],
      unpriced: 0,
      locale: null,
      untranslated: null,
    });
    expect(germany).toMatchObject({
      name: "Germany",
      visits: 1000,
      visitOrders: 4,
      orders: 4,
      revenueMinor: 32_000,
      searches: 6,
      misses: 6,
      missedTerms: [{ term: "leinen", misses: 6 }],
      unpriced: 1,
      locale: "de-DE",
      untranslated: 2,
    });
    expect(check.products).toBe(3);
    expect(check.demand).toEqual([{ term: "leinen", misses: 7, markets: [{ code: "DE", misses: 6 }, { code: "NO", misses: 1 }] }]);
    expect(check.coverage).toMatchObject({ counting: true, partial: true, from: "2026-09-10" });
  });

  it("finds Germany buying less, the search that found nothing, the missing names and the missing price", async () => {
    const { findings } = await marketCheck(store, PERIOD, { now: NOW });
    expect(findings).toEqual([
      expect.objectContaining({ kind: "weak_market", market: "DE", visits: 1000, orders: 4, restVisits: 1000, restOrders: 40, gap: 36 }),
      { kind: "unmet_demand", term: "leinen", misses: 7, markets: [{ code: "DE", misses: 6 }, { code: "NO", misses: 1 }] },
      { kind: "untranslated", market: "DE", locale: "de-DE", products: 2, of: 3 },
      { kind: "unpriced", market: "DE", products: 1, of: 3 },
    ]);
  });

  it("says what it cannot know: no visits while counting is off, no searches older than 90 days", async () => {
    const off = await marketCheck({ ...store, visitCounting: false } as Store, PERIOD, { now: NOW });
    expect(off.markets.every((m) => m.visits === null && m.visitOrders === null)).toBe(true);
    expect(off.findings.some((f) => f.kind === "weak_market")).toBe(false);
    const late = await marketCheck(store, PERIOD, { now: new Date("2027-03-01T10:00:00Z") });
    expect(late.searchesEmpty).toBe(true);
    expect(late.markets.every((m) => m.searches === null)).toBe(true);
  });

  it("reads no orders or prices for Kaizena Flow's own store", async () => {
    const house = await marketCheck({ ...other, house: true } as Store, PERIOD, { now: NOW });
    expect(house).toMatchObject({ sells: false, house: true, products: 0 });
    const germany = house.markets.find((m) => m.code === "DE");
    expect(germany).toMatchObject({ visits: 300, orders: null, revenueMinor: null, unpriced: null, locale: null, untranslated: null, searches: 20, misses: 20 });
  });
});
