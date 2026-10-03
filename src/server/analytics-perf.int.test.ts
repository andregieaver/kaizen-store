import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { bucketFor, customPeriod, presetPeriod, previousPeriodOf } from "@/lib/analytics-period";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
}));

const totals = await import("./analytics-totals");
const customers = await import("./analytics-customers-data");
const products = await import("./analytics-products-data");
const inventory = await import("./analytics-inventory-data");
const discounts = await import("./analytics-discounts-data");
const refunds = await import("./analytics-refunds-data");
const returns = await import("./analytics-returns-data");
const subscriptions = await import("./analytics-subscriptions-data");
const geo = await import("./analytics-geo-data");
const time = await import("./analytics-time-data");
const traffic = await import("./analytics-traffic-data");
const { getAnalyticsSettings } = await import("./analytics-settings");

/**
 * A guard for the speed of the analytics reads (D152, docs/analytics.md): one store with a few thousand paid orders, their lines,
 * payments, refunds, customers, visits and subscriptions, made by set-based SQL, and every report timed. Nothing is analysed after
 * the seed on purpose: the planner then knows nothing of the tables, which is when a read that leans on its estimates turns into a
 * nested loop that reads a side once per row (a store of 60 000 orders ran for minutes that way). The bound is generous, a few
 * times what a report takes here, so that only a plan that has gone quadratic can break it.
 */

/** Paid orders seeded; a tenth as many again are unpaid. */
const ORDERS = 3_000;
/** What one report may take. */
const BOUND_MS = 3_000;

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const localization = localizationOf(
  [],
  [
    { currency: "NOK", rate: 10, roundTo: 1 },
    { currency: "EUR", rate: 1, roundTo: 1 },
  ],
  [no],
);

let store: Store;
const NOW = new Date("2026-10-02T10:00:00Z");
const YEAR = customPeriod("2025-10-03", "2026-10-02");
const MONTH = presetPeriod("30d", "2026-10-02");

/**
 * The whole seed in one transaction (temporary tables live only in it); the replica role skips triggers and key checks, as a bulk
 * load would, where the role may set it.
 */
async function seedStore(storeId: string, orders: number) {
  const sid = storeId;
  await db().transaction(async (tx) => {
    try {
      await tx.execute(sql`set local session_replication_role = replica`);
    } catch {
      // Not allowed for this role: the rows go in through the triggers, only slower.
    }
    await tx.execute(sql`create temp table perf_prod on commit drop as select i, gen_random_uuid() as id from generate_series(1, 40) i`);
    await tx.execute(sql`
      insert into commerce.products (id, store_id, handle, status, tax_code, delivery, kind)
      select id, ${sid}::uuid, 'perf-' || i, 'active', 'txcd_99999999', 'physical', 'goods' from perf_prod
    `);
    await tx.execute(sql`
      insert into commerce.product_translations (store_id, product_id, locale, title) select ${sid}::uuid, id, 'nb-NO', 'Produkt ' || i from perf_prod
    `);
    await tx.execute(sql`create temp table perf_var on commit drop as select i, gen_random_uuid() as id, 1 + (i % 40) as pi, 500 + (i * 37 % 9000) as price from generate_series(1, 120) i`);
    await tx.execute(sql`
      insert into commerce.product_variants (id, store_id, product_id, sku, active, delivery, cost_minor)
      select v.id, ${sid}::uuid, p.id, 'PERF-' || v.i, true, 'physical', case when v.i % 5 = 0 then null else (v.price * 0.4)::bigint end
      from perf_var v join perf_prod p on p.i = v.pi
    `);
    await tx.execute(sql`
      with loc as (insert into commerce.inventory_locations (id, store_id, name, country) values (gen_random_uuid(), ${sid}::uuid, 'Main', 'NO') returning id)
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
      select ${sid}::uuid, v.id, loc.id, (random() * 50)::int from perf_var v cross join loc
    `);

    // Customers: accounts for a part of the buyers, the rest buy as guests.
    await tx.execute(sql`create temp table perf_cust on commit drop as select i, gen_random_uuid() as id from generate_series(1, 300) i`);
    await tx.execute(sql`insert into commerce.customers (id, store_id, email, name) select id, ${sid}::uuid, 'acct' || i || '@perf.example', 'Customer ' || i from perf_cust`);
    await tx.execute(sql`create temp table perf_code on commit drop as select i, gen_random_uuid() as id from generate_series(1, 10) i`);
    await tx.execute(sql`insert into commerce.discount_codes (id, store_id, code, kind, percent, active) select id, ${sid}::uuid, 'PERF' || i, 'percent', 10, true from perf_code`);

    // Orders over three years, mostly recent: a tenth more than `orders`, the extra ones unpaid.
    await tx.execute(sql`
      create temp table perf_ord on commit drop as
      select i, gen_random_uuid() as id,
        1 + floor(600 * power(random(), 1.7))::int as ck,
        timestamptz '2026-10-02 12:00+02' - ((1095 * (1 - power(random(), 0.6))) || ' days')::interval - (random() * 86400 || ' seconds')::interval as at,
        case when random() < 0.9 then 'NOK' else 'EUR' end as cur,
        random() as r1, random() as r2, random() as r3, (i <= ${orders}::int) as is_paid
      from generate_series(1, ${orders}::int + (${orders}::int * 0.1)::int) i
    `);
    await tx.execute(sql`
      create temp table perf_o2 on commit drop as
      select o.*, case when o.cur = 'NOK' then (3 + o.r2 * 40)::int * 1000 else (3 + o.r2 * 40)::int * 100 end as unit,
        case when o.r3 < 0.15 then 1 else 0 end as disc, case when o.ck <= 300 then (select c.id from perf_cust c where c.i = o.ck) end as customer_id
      from perf_ord o
    `);
    await tx.execute(sql`create index on perf_o2 (i)`);
    await tx.execute(sql`
      insert into commerce.orders (id, store_id, number, market_code, currency, locale, customer_id, email, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, cart_id, discount_code_id)
      select o.id, ${sid}::uuid, 'PF-' || o.i, case when o.cur = 'NOK' then 'NO' else 'DE' end, o.cur, 'nb-NO', o.customer_id,
        case when o.customer_id is null then 'guest' || o.ck || '@perf.example' else 'acct' || o.ck || '@perf.example' end,
        (case when not o.is_paid then 'pending_payment' when o.r1 < 0.05 then 'cancelled' else 'paid' end)::commerce.order_status,
        o.unit * 2, 0, o.disc * o.unit / 10, ((o.unit * 2 - o.disc * o.unit / 10) * 0.2)::bigint, o.unit * 2 - o.disc * o.unit / 10,
        case when o.r1 < 0.8 then '{"country":"NO","city":"Oslo"}'::jsonb else '{"country":"DE","city":"Berlin"}'::jsonb end,
        case when o.r1 < 0.8 then '{"country":"NO","city":"Oslo"}'::jsonb else '{"country":"DE","city":"Berlin"}'::jsonb end,
        o.at, o.id, case when o.disc = 1 then (select id from perf_code where i = 1 + (o.i % 10)) end
      from perf_o2 o
    `);
    await tx.execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery, unit_cost_minor)
      select ${sid}::uuid, o.id, v.id, 'PERF-' || v.i, 'Produkt ' || v.pi, q.q, o.unit, o.disc * o.unit / 10 / n.k,
        o.unit * q.q - o.disc * o.unit / 10 / n.k, ((o.unit * q.q - o.disc * o.unit / 10 / n.k) * 0.2)::bigint, 0.25, 'txcd_99999999', 'physical',
        case when v.i % 5 = 0 then null else (v.price * 0.4)::bigint end
      from perf_o2 o
      cross join lateral (select 1 + (case when o.r2 < 0.3 then 0 when o.r2 < 0.8 then 1 else 2 end) as k) n
      cross join lateral generate_series(1, n.k) li
      join perf_var v on v.i = 1 + ((o.i * 7 + li * 131) % 120)
      cross join lateral (select 1 + ((o.i + li) % 3) as q) q
    `);
    await tx.execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status, created_at, kaizen_fee_minor)
      select ${sid}::uuid, o.id, 'stripe', 'pi_${sql.raw(run)}_' || o.i, 'acct_perf', o.unit * 2 - o.disc * o.unit / 10, o.cur,
        (case when o.is_paid then 'captured' else 'pending' end)::commerce.payment_status, o.at, (o.unit * 2 - o.disc * o.unit / 10) / 50
      from perf_o2 o
    `);
    // A few in every hundred orders are refunded, some of them putting the goods back.
    await tx.execute(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, created_at)
      select ${sid}::uuid, p.id, p.amount_minor / 2, (array['Damaged', 'Too small', 'Wrong item', 'Changed mind'])[1 + (random() * 3)::int], 're_' || p.provider_reference, 'succeeded', p.created_at + interval '5 days'
      from commerce.payments p where p.store_id = ${sid}::uuid and p.status = 'captured' and (hashtext(p.provider_reference) % 100) between 0 and 2
    `);
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor, created_at)
      select o.store_id, o.id, 'order.refunded', jsonb_build_object('restocked', jsonb_build_array(jsonb_build_object('sku', ol.sku, 'quantity', 1))), 'staff', o.placed_at + interval '3 days'
      from commerce.orders o join lateral (select sku from commerce.order_lines where order_id = o.id limit 1) ol on true
      where o.store_id = ${sid}::uuid and (hashtext(o.number) % 25) = 0
    `);
    // Visits, and a cart for every order, a part of them from a visit.
    await tx.execute(sql`
      create temp table perf_vis on commit drop as
      select i, gen_random_uuid() as id, (date '2026-10-01' - (i % 700))::date as day, substr(md5(i::text), 1, 24) as visitor,
        (array['mobile', 'desktop', 'tablet'])[1 + i % 3] as device, (array['direct', 'organic_search', 'paid_search', 'email', 'organic_social', 'referral'])[1 + i % 6] as channel
      from generate_series(1, ${orders * 3}::int) i
    `);
    await tx.execute(sql`create index on perf_vis (i)`);
    await tx.execute(sql`
      insert into commerce.visits (id, store_id, day, visitor, market_code, device, channel, landing_path, page_views, product_views, checkout_at, first_seen, last_seen)
      select id, ${sid}::uuid, day, visitor, 'NO', device, channel, '/p/' || (i % 20), 1 + i % 7, i % 4, case when i % 20 = 0 then day + interval '12 hours' end, day + interval '10 hours', day + interval '10 hours'
      from perf_vis
    `);
    await tx.execute(sql`
      insert into commerce.carts (id, store_id, market_code, currency, locale, customer_id, status, created_at, updated_at, expires_at, visit_id)
      select o.id, ${sid}::uuid, 'NO', o.cur, 'nb-NO', o.customer_id, 'converted', o.at, o.at, o.at + interval '30 days',
        case when o.r1 < 0.4 then (select v.id from perf_vis v where v.i = 1 + (o.i % ${orders * 3}::int)) end
      from perf_o2 o
    `);
    // Subscriptions, and orders that renew them.
    await tx.execute(sql`
      insert into commerce.subscriptions (store_id, number, status, market_code, currency, locale, email, interval, interval_count, subtotal_minor, shipping_minor, total_minor, tax_minor,
        first_order_id, manage_token, created_at, customer_id, current_period_end, cancelled_at)
      select ${sid}::uuid, 'PS-' || s.i, (array['active', 'active', 'active', 'cancelled', 'past_due'])[1 + s.i % 5]::commerce.subscription_status, 'NO', 'NOK', 'nb-NO', 'acct' || s.i || '@perf.example', 'month', 1,
        40000, 0, 40000, 8000, (select id from perf_o2 where i = s.i), md5('${sql.raw(run)}' || s.i), timestamptz '2025-01-01' + (s.i || ' days')::interval, (select id from perf_cust where i = s.i),
        now() + interval '10 days', case when s.i % 5 = 3 then timestamptz '2026-06-01' end
      from generate_series(1, 100) s(i)
    `);
    await tx.execute(sql`
      update commerce.orders o set subscription_id = s.id
      from (select id, row_number() over (order by number) as rn from commerce.subscriptions where store_id = ${sid}::uuid) s
      where o.store_id = ${sid}::uuid and (hashtext(o.number) % 7) = 0 and s.rn = 1 + (abs(hashtext(o.number)) % 100)
    `);
  });
}

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

/** Runs a read, returns its answer and fails when it took longer than the bound. */
async function within<T>(name: string, read: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const answer = await read();
  const took = performance.now() - started;
  expect(took, `${name} took ${Math.round(took)} ms`).toBeLessThan(BOUND_MS);
  return answer;
}

beforeAll(async () => {
  const id = await makeStore(`perf-${run}`);
  await seedStore(id, ORDERS);
  store = { id, slug: `perf-${run}`, timeZone: "Europe/Oslo", markets: [no], localization, visitCounting: true } as unknown as Store;
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("analytics reads on a busy store, with no statistics", () => {
  it("has the paid orders it should", async () => {
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.orders o
      where o.store_id = ${store.id}::uuid and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured')
    `);
    expect(Number(row.n)).toBe(ORDERS);
  });

  it("totals: a period, its series, the top products and the overview", async () => {
    const settings = await getAnalyticsSettings(store.id);
    const year = await within("periodTotals (365 days)", () => totals.periodTotals(store, YEAR, settings));
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.orders o
      where o.store_id = ${store.id}::uuid and o.copied_from is null and o.host_id is null and o.placed_at >= '2025-10-02T22:00:00Z' and o.placed_at < '2026-10-02T22:00:00Z'
        and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured')
    `);
    expect(year.totals.orders).toBe(Number(row.n));
    expect(year.totals.orders).toBeGreaterThan(500);
    await within("periodTotals (30 days)", () => totals.periodTotals(store, MONTH, settings));
    const series = await within("seriesByBucket", () => totals.seriesByBucket(store, YEAR, bucketFor(YEAR), settings));
    expect(series.reduce((n, p) => n + p.orders, 0)).toBe(year.totals.orders);
    await within("topProducts", () => totals.topProducts(store, YEAR));
    const overview = await within("overviewData", () => totals.overviewData(store, { period: "30d" }, NOW, { sessions: (period) => traffic.sessionTotals(store, period) }));
    expect(overview.current.totals.orders).toBeGreaterThan(0);
    await within("overviewData (year)", () => totals.overviewData(store, { period: "year" }, NOW, { sessions: (period) => traffic.sessionTotals(store, period) }));
  });

  it("customers", async () => {
    const settings = await getAnalyticsSettings(store.id);
    const report = await within("customersReport", () => customers.customersReport(store, YEAR, settings, NOW));
    expect(report.customers).toBeGreaterThan(100);
  });

  it("products, inventory, discounts and refunds", async () => {
    const report = await within("productsReport", () => products.productsReport(store, YEAR, previousPeriodOf(YEAR)));
    expect(report.rows.length).toBeGreaterThan(5);
    const stock = await within("inventoryReport", () => inventory.inventoryReport(store, NOW));
    expect(stock.variants).toBeGreaterThanOrEqual(120);
    const offers = await within("discountsReport", () => discounts.discountsReport(store, YEAR));
    expect(offers.summary.orders).toBeGreaterThan(0);
    const back = await within("refundsReport", () => refunds.refundsReport(store, YEAR));
    expect(back.refunds).toBeGreaterThan(0);
    // The returns section reads the same orders; with no return recorded it still reads the whole cohort, and says what is missing.
    const returned = await within("returnsReport", () => returns.returnsReport(store, YEAR, NOW));
    expect(returned.cohort.orders).toBeGreaterThan(500);
    expect(returned.tracked).toBe(false);
    expect(returned.orderRate.value).toBeNull();
  });

  it("subscriptions, geography and times", async () => {
    await within("subscriptionsReport", () => subscriptions.subscriptionsReport(store, YEAR, NOW));
    const countries = await within("geoReport", () => geo.geoReport(store, YEAR));
    expect(countries.totals.orders).toBeGreaterThan(0);
    const when = await within("timeReport", () => time.timeReport(store, YEAR));
    expect(when.totals.orders).toBeGreaterThan(0);
  });

  it("traffic and marketing", async () => {
    const visits = await within("trafficReport", () => traffic.trafficReport(store, YEAR, NOW));
    expect(visits.sessions).toBeGreaterThan(0);
    const channels = await within("marketingReport", () => traffic.marketingReport(store, YEAR, NOW));
    expect(channels.table).not.toBeNull();
  });
});
