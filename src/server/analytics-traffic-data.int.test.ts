import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const { sessionTotals, trafficReport, marketingReport } = await import("./analytics-traffic-data");
const { periodTotals } = await import("./analytics-totals");
const { getAnalyticsSettings } = await import("./analytics-settings");

/**
 * Visits, the funnel and the channel table (D152, docs/analytics.md) against a small hand-made shop, every expectation worked
 * out by hand from the tables below. Money in NOK minor units (the main currency) without VAT, EUR at 1 EUR = 10 NOK, SEK with
 * no rate, Europe/Oslo (UTC+2 in September). Visits were counted from 3 September; the period is 1 to 7 September.
 *
 * Visits (day, channel, device, market, landing, product pages seen, checkout reached):
 *   V1 09-03 organic_search mobile  NO  mug page      1
 *   V2 09-03 paid_search    desktop NO  mug page      1  checkout
 *   V3 09-04 direct         desktop NO  front page    0
 *   V4 09-04 email          mobile  NO  front page    2
 *   V5 09-05 organic_social tablet  SE  /se           0
 *   V6 09-05 direct         desktop --  front door    0
 *   V7 09-06 paid_search    mobile  NO  tote page     1
 *   V8 09-07 organic_search desktop NO  mug page      1
 *   V9 09-08 direct, after the period.   (another store has a visit and an order in the same days)
 *
 * Carts: C1 of V2, C2 of V1, C3 of V7, C4 of V4, C5 of V8.
 * Orders (NOK unless said; revenue is total less VAT):
 *   Oa 09-03 alice, C1  1 mug 100.00 (cost 30.00)                       total 10000 VAT 2000 revenue  8000, Kaizen fee 200
 *   Ob 09-04 bob, no cart  1 mug 100.00 less 10.00                       total  9000 VAT 1800 revenue  7200, Kaizen fee 90
 *   Oc 09-06 eva, C3, EUR  1 tote 20.00 (cost unknown), VAT 15 %        total  2000 VAT  261 revenue  1739 EUR = 17390, fee 150 EUR = 1500
 *   Od 09-07 dan, C5  2 mugs 100.00 + 50.00 shipping                     total 25000 VAT 5000 revenue 20000, Kaizen fee 250
 *   Oe 09-05 C2, waiting for payment (never counts, but its visit reached checkout)
 *   Of 09-02 alice, no cart, before counting began                       revenue  8000 (alice's first order: she is not new on 09-03)
 *   Og host's order, Oh copied order, Oj 09-04 SEK (left out, counted), Ok 09-08 after the period.
 */

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
const storeOf = (id: string, slug: string, visitCounting = true) => ({ id, slug, timeZone: "Europe/Oslo", markets: [no], localization, visitCounting }) as unknown as Store;

let store: Store;
let other: Store;
let serial = 0;
const variants: Record<string, Record<string, string>> = {};
const visit: Record<string, string> = {};
const cart: Record<string, string> = {};

const taxOf = (amount: number, rate: number) => amount - Math.round(amount / (1 + rate));

type Line = { sku: "DEMO-MUG-WHITE" | "DEMO-TOTE"; qty: number; unit: number; discount?: number; rate: number; cost?: number | null };

async function placeOrder(s: Store, o: { currency?: string; at: string; email: string; cart?: string | null; status?: string; lines: Line[]; shipping?: number; fee?: number; paid?: boolean; host?: string | null; copied?: boolean }) {
  serial += 1;
  const currency = o.currency ?? "NOK";
  const lines = o.lines.map((l) => {
    const total = l.unit * l.qty - (l.discount ?? 0);
    return { ...l, total, tax: taxOf(total, l.rate) };
  });
  const shipping = o.shipping ?? 0;
  const subtotal = lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  const discount = lines.reduce((sum, l) => sum + (l.discount ?? 0), 0);
  const tax = lines.reduce((sum, l) => sum + l.tax, 0) + taxOf(shipping, 0.25);
  const total = subtotal + shipping - discount;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
      billing_address, shipping_address, placed_at, cart_id, host_id, copied_from)
    values (${s.id}::uuid, ${o.copied ? `C-${run}-${serial}` : `T-${run}-${serial}`}, 'NO', ${currency}, 'nb-NO', ${o.email}, ${o.status ?? "paid"},
      ${subtotal}, ${shipping}, ${discount}, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, ${o.cart ?? null}::uuid, ${o.host ?? null},
      ${o.copied ? crypto.randomUUID() : null})
    returning id
  `);
  const insertLines = async (runner: Pick<ReturnType<typeof db>, "execute">) => {
    for (const l of lines) {
      await runner.execute(sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
        values (${s.id}::uuid, ${String(order.id)}::uuid, ${variants[s.id][l.sku]}, ${l.sku}, ${l.sku}, ${l.qty}, ${l.unit}, ${l.cost ?? null}, ${l.discount ?? 0},
          ${l.total}, ${l.tax}, ${l.rate}, 'txcd_99999999', 'physical'::commerce.delivery)
      `);
    }
  };
  if (o.copied) {
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.copying', 'on', true)`);
      await insertLines(tx);
    });
  } else {
    await insertLines(db());
  }
  if (!o.copied && o.paid !== false) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
      values (${s.id}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_traffic', ${total}, ${o.fee ?? 0}, ${currency}, 'captured'::commerce.payment_status)
    `);
  }
  return String(order.id);
}

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

async function addVisit(s: Store, key: string, v: { day: string; channel: string; device: string; market: string | null; landing: string; products?: number; checkout?: string; source?: string; campaign?: string }) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.visits (store_id, day, visitor, market_code, device, channel, source, campaign, landing_path, product_views, checkout_at)
    values (${s.id}::uuid, ${v.day}::date, ${Buffer.from(key).toString("hex").padEnd(24, "0")}, ${v.market}, ${v.device}, ${v.channel}, ${v.source ?? ""}, ${v.campaign ?? ""}, ${v.landing}, ${v.products ?? 0}, ${v.checkout ?? null}::timestamptz)
    returning id
  `);
  visit[`${s.id}:${key}`] = String(row.id);
  return String(row.id);
}

async function addCart(s: Store, visitId: string | null) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at, visit_id) values (${s.id}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '30 days', ${visitId}::uuid) returning id
  `);
  return String(row.id);
}

const PERIOD = customPeriod("2026-09-01", "2026-09-07");
const COVERED = customPeriod("2026-09-03", "2026-09-07");
const NOW = new Date("2026-09-08T10:00:00Z");
const MUG = { sku: "DEMO-MUG-WHITE", rate: 0.25, cost: 3_000 } as const;
const TOTE = { sku: "DEMO-TOTE", rate: 0.15 } as const;
let path: (suffix?: string) => string;

beforeAll(async () => {
  const id = await makeStore(`traffic-${run}`);
  const otherId = await makeStore(`traffic-other-${run}`);
  store = storeOf(id, `traffic-${run}`);
  other = storeOf(otherId, `traffic-other-${run}`);
  path = (suffix = "") => `/s/${store.slug}${suffix}`;
  for (const storeId of [id, otherId]) {
    variants[storeId] = {};
    for (const row of await db().execute<Row>(sql`select sku, id from commerce.product_variants where store_id = ${storeId}::uuid`)) variants[storeId][String(row.sku)] = String(row.id);
  }
  await db().execute(sql`
    insert into commerce.analytics_settings (store_id, payment_fee_bps, payment_fee_fixed_minor, shipping_cost_minor, fixed_costs_monthly_minor, ltv_lifespan_years)
    values (${id}::uuid, 200, 100, 2500, 0, 3)
  `);

  await addVisit(store, "v1", { day: "2026-09-03", channel: "organic_search", source: "google", device: "mobile", market: "NO", landing: path("/no/p/demo-mug"), products: 1 });
  await addVisit(store, "v2", { day: "2026-09-03", channel: "paid_search", source: "google", campaign: "spring", device: "desktop", market: "NO", landing: path("/no/p/demo-mug"), products: 1, checkout: "2026-09-03T09:00:00Z" });
  await addVisit(store, "v3", { day: "2026-09-04", channel: "direct", device: "desktop", market: "NO", landing: path("/no") });
  await addVisit(store, "v4", { day: "2026-09-04", channel: "email", source: "newsletter", device: "mobile", market: "NO", landing: path("/no"), products: 2 });
  await addVisit(store, "v5", { day: "2026-09-05", channel: "organic_social", source: "facebook", device: "tablet", market: "SE", landing: path("/se") });
  await addVisit(store, "v6", { day: "2026-09-05", channel: "direct", device: "desktop", market: null, landing: path() });
  await addVisit(store, "v7", { day: "2026-09-06", channel: "paid_search", source: "google", device: "mobile", market: "NO", landing: path("/no/p/demo-tote"), products: 1 });
  await addVisit(store, "v8", { day: "2026-09-07", channel: "organic_search", source: "google", device: "desktop", market: "NO", landing: path("/no/p/demo-mug"), products: 1 });
  await addVisit(store, "v9", { day: "2026-09-08", channel: "direct", device: "desktop", market: "NO", landing: path("/no") });
  const v = (key: string) => visit[`${id}:${key}`];
  cart.c1 = await addCart(store, v("v2"));
  cart.c2 = await addCart(store, v("v1"));
  cart.c3 = await addCart(store, v("v7"));
  cart.c4 = await addCart(store, v("v4"));
  cart.c5 = await addCart(store, v("v8"));

  await placeOrder(store, { at: "2026-09-03T11:00:00+02:00", email: "Alice@Example.com", cart: cart.c1, fee: 200, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-04T12:00:00+02:00", email: "bob@example.com", fee: 90, lines: [{ ...MUG, qty: 1, unit: 10_000, discount: 1_000 }] });
  await placeOrder(store, { currency: "EUR", at: "2026-09-06T12:00:00+02:00", email: "eva@example.com", cart: cart.c3, fee: 150, lines: [{ ...TOTE, qty: 1, unit: 2_000 }] });
  await placeOrder(store, { at: "2026-09-07T12:00:00+02:00", email: "dan@example.com", cart: cart.c5, fee: 250, shipping: 5_000, lines: [{ ...MUG, qty: 2, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-05T12:00:00+02:00", email: "pia@example.com", cart: cart.c2, status: "pending_payment", paid: false, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-02T12:00:00+02:00", email: "alice@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-${run}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${id}::uuid, ${String(account.id)}::uuid, 'Host') returning id`);
  await placeOrder(store, { at: "2026-09-04T13:00:00+02:00", email: "host-guest@example.com", host: String(host.id), cart: cart.c4, lines: [{ ...MUG, qty: 4, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-04T14:00:00+02:00", email: "copied@example.com", copied: true, lines: [{ ...MUG, qty: 3, unit: 10_000 }] });
  await placeOrder(store, { currency: "SEK", at: "2026-09-04T15:00:00+02:00", email: "sven@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-08T09:00:00+02:00", email: "late@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });

  for (const [day, channel, campaign, amount] of [
    ["2026-09-01", "paid_search", "", 2_000],
    ["2026-09-03", "paid_search", "spring", 5_000],
    ["2026-09-05", "paid_search", "", 3_000],
    ["2026-09-04", "email", "", 1_000],
    ["2026-09-06", "paid_social", "", 4_000],
  ] as const) {
    await db().execute(sql`insert into commerce.marketing_spend (store_id, day, channel, campaign, amount_minor) values (${id}::uuid, ${day}::date, ${channel}, ${campaign}, ${amount})`);
  }

  // Another store with a visit and a paid order in the same days: none of it may reach the first.
  const otherVisit = await addVisit(other, "vo", { day: "2026-09-04", channel: "paid_search", device: "desktop", market: "NO", landing: `/s/${other.slug}/no`, products: 1 });
  await placeOrder(other, { at: "2026-09-04T10:00:00+02:00", email: "elsewhere@example.com", cart: await addCart(other, otherVisit), shipping: 4_900, lines: [{ ...TOTE, qty: 1, unit: 5_750 }] });
});

afterAll(async () => {
  await closeDb();
});

const byKey = <T extends { key: string }>(rows: T[], key: string) => rows.find((r) => r.key === key);

describe("sessionTotals", () => {
  it("counts the period's visitor-days, per day, with the first counted day", async () => {
    expect(await sessionTotals(store, PERIOD)).toEqual({
      sessions: 8,
      firstDay: "2026-09-03",
      byDay: { "2026-09-03": 2, "2026-09-04": 2, "2026-09-05": 2, "2026-09-06": 1, "2026-09-07": 1 },
    });
  });

  it("is null for a period with no visit and for a store that does not count", async () => {
    expect(await sessionTotals(store, customPeriod("2026-08-01", "2026-08-31"))).toEqual({ sessions: null, firstDay: "2026-09-03", byDay: {} });
    expect(await sessionTotals(storeOf(store.id, store.slug, false), PERIOD)).toEqual({ sessions: null, firstDay: null, byDay: {} });
  });
});

describe("trafficReport", () => {
  it("says the period is only partly covered, and over which days", async () => {
    const report = await trafficReport(store, PERIOD, NOW);
    expect(report.coverage).toEqual({ counting: true, firstDay: "2026-09-03", partial: true, from: "2026-09-03", to: "2026-09-08", days: 5 });
    expect(report.sessions).toBe(8);
    expect(report.notes.join(" ")).toContain("since 2026-09-03");
  });

  it("builds the funnel from visits, product pages, carts, checkout and paid orders", async () => {
    const { funnel } = await trafficReport(store, PERIOD, NOW);
    // 8 visits; product pages seen by V1, V2, V4, V7, V8; carts of V1, V2, V4, V7, V8; checkout: V2 (reached it), V1 (an order waiting for payment),
    // V7, V8 (paid) = 4, and V4's cart has no order; paid: V2, V7, V8 (V1's order was never paid).
    expect(funnel.stages.map((s) => [s.key, s.count])).toEqual([
      ["sessions", 8],
      ["productViewers", 5],
      ["carts", 5],
      ["checkouts", 4],
      ["purchases", 3],
    ]);
    expect(funnel.purchaseConversion).toBeCloseTo(3 / 8);
    expect(funnel.cartAbandonment).toBeCloseTo(1 - 3 / 5);
    expect(funnel.clampedStages).toEqual([]);
  });

  it("works conversion out over the covered days only, orders included", async () => {
    const report = await trafficReport(store, PERIOD, NOW);
    // Paid orders on 3-7 September: Oa, Ob, Oc, Od. Not Of (2 September, before counting), the SEK one, the host's, the copied, the unpaid, or the one on 8 September.
    expect(report.conversion).toEqual({ orders: 4, sessions: 8, rate: 0.5 });
    expect(report.uncoveredOrders).toEqual({ orders: 1, revenueMinor: 8_000 });
    expect(report.unconverted).toBe(1);
    expect(report.missingCurrencies).toEqual(["SEK"]);
  });

  it("splits sessions, orders and revenue by device, the orders through their carts' visits", async () => {
    const { byDevice } = await trafficReport(store, PERIOD, NOW);
    expect(byKey(byDevice, "mobile")).toMatchObject({ sessions: 3, orders: 1, revenueMinor: 17_390, aov: 17_390 });
    expect(byKey(byDevice, "mobile")!.conversion).toBeCloseTo(1 / 3);
    expect(byKey(byDevice, "tablet")).toMatchObject({ sessions: 1, orders: 0, revenueMinor: 0, conversion: 0, aov: null });
    expect(byKey(byDevice, "desktop")).toMatchObject({ sessions: 4, orders: 2, revenueMinor: 28_000, aov: 14_000, conversion: 0.5 });
    // Bob's order has no cart, so no visit.
    expect(byKey(byDevice, "unknown")).toMatchObject({ sessions: null, orders: 1, revenueMinor: 7_200, conversion: null });
  });

  it("splits by country: sessions by landing market, orders by the order's own", async () => {
    const { byMarket } = await trafficReport(store, PERIOD, NOW);
    expect(byKey(byMarket, "NO")).toMatchObject({ label: no.name, sessions: 6, orders: 4, revenueMinor: 52_590 });
    expect(byKey(byMarket, "SE")).toMatchObject({ sessions: 1, orders: 0, conversion: 0 });
    expect(byKey(byMarket, "front_door")).toMatchObject({ sessions: 1, orders: 0 });
    expect(byMarket[0].key).toBe("NO");
  });

  it("lists the landing pages by visits with the orders that came from them", async () => {
    const { landingPages, landingTruncated } = await trafficReport(store, PERIOD, NOW);
    expect(landingTruncated).toBe(false);
    expect(landingPages.map((p) => p.path).slice(0, 2)).toEqual([path("/no/p/demo-mug"), path("/no")]);
    expect(landingPages[0]).toMatchObject({ sessions: 3, kind: "product", handle: "demo-mug", orders: 2, revenueMinor: 28_000 });
    expect(landingPages[1]).toMatchObject({ sessions: 2, kind: "other", handle: null, orders: 0 });
    expect(landingPages.find((p) => p.path === path("/no/p/demo-tote"))).toMatchObject({ sessions: 1, orders: 1, revenueMinor: 17_390 });
    expect(landingPages).toHaveLength(5);
  });

  it("holds the orders no visit explains apart", async () => {
    expect((await trafficReport(store, PERIOD, NOW)).unknownOrders).toEqual({ orders: 1, revenueMinor: 7_200 });
  });

  it("is fully covered when the period starts on the first counted day, and then nothing is uncovered", async () => {
    const report = await trafficReport(store, COVERED, NOW);
    expect(report.coverage).toMatchObject({ partial: false, from: "2026-09-03", to: "2026-09-08", days: 5 });
    expect(report.uncoveredOrders).toEqual({ orders: 0, revenueMinor: 0 });
    expect(report.conversion.rate).toBe(0.5);
  });

  it("stops at today, so days to come do not count as covered", async () => {
    const report = await trafficReport(store, PERIOD, new Date("2026-09-05T10:00:00Z"));
    expect(report.coverage).toMatchObject({ from: "2026-09-03", to: "2026-09-06", days: 3 });
    // Visits V1-V6 on 3-5 September; the later ones are not in what it covers.
    expect(report.sessions).toBe(6);
    expect(report.uncoveredOrders.orders).toBe(3);
  });

  it("knows nothing, and says so, with counting off or before the first counted day", async () => {
    const off = await trafficReport(storeOf(store.id, store.slug, false), PERIOD, NOW);
    expect(off.counting).toBe(false);
    expect(off.sessions).toBeNull();
    expect(off.funnel.stages.every((s) => s.count === null)).toBe(true);
    expect(off.byDevice).toEqual([]);
    expect(off.notes.join(" ")).toContain("Visit counting is off");
    const before = await trafficReport(store, customPeriod("2026-08-01", "2026-08-31"), NOW);
    expect(before.coverage).toMatchObject({ counting: true, partial: true, from: null, days: 0 });
    expect(before.sessions).toBeNull();
  });
});

describe("marketingReport", () => {
  it("makes a row per channel with its visits, orders, revenue, new customers and spend", async () => {
    const report = await marketingReport(store, PERIOD, NOW);
    expect(report.table).not.toBeNull();
    const rows = report.table!.rows;
    const row = (channel: string) => rows.find((r) => r.channel === channel)!;
    // Paid search: V2, V7 -> Oa 8000 + Oc 17390 = 25390, 2 orders. Eva is new (Alice's first order was on 2 September); 8000 spent on the covered days (5000 + 3000).
    expect(row("paid_search")).toMatchObject({ sessions: 2, orders: 2, revenueMinor: 25_390, newCustomers: 1, spendMinor: 8_000 });
    expect(row("paid_search").roas).toBeCloseTo(25_390 / 8_000);
    expect(row("paid_search").cac).toBe(8_000);
    expect(row("organic_search")).toMatchObject({ sessions: 2, orders: 1, revenueMinor: 20_000, newCustomers: 1, spendMinor: 0, roas: null, cac: null });
    expect(row("direct")).toMatchObject({ sessions: 2, orders: 0, revenueMinor: 0 });
    expect(row("email")).toMatchObject({ sessions: 1, orders: 0, spendMinor: 1_000, roas: 0, cac: null });
    expect(row("organic_social")).toMatchObject({ sessions: 1, orders: 0 });
    // Spend with no visits at all is a row too.
    expect(row("paid_social")).toMatchObject({ sessions: 0, orders: 0, spendMinor: 4_000 });
    // Bob's order has no visit.
    expect(row("unknown")).toMatchObject({ sessions: null, orders: 1, revenueMinor: 7_200, newCustomers: 1, label: "Unknown" });
  });

  it("works the contribution before marketing out per channel from costs, fees and shipping", async () => {
    const rows = (await marketingReport(store, PERIOD, NOW)).table!.rows;
    const row = (channel: string) => rows.find((r) => r.channel === channel)!;
    // Settings: 2.00 % + 1.00 per order, 25.00 shipping per order with a physical line. Prices with VAT, Kaizen's fees as recorded.
    // Paid search: 25390 - cost 3000 (the tote's is unknown) - payment fees (200+100) + (400+100) - Kaizen 200 + 1500 - 2 x 2500 = 14890.
    expect(row("paid_search").contributionBeforeMarketingMinor).toBe(25_390 - 3_000 - 800 - 1_700 - 5_000);
    expect(row("paid_search").contributionBeforeMarketingMinor).toBe(14_890);
    expect(row("paid_search").profitRoas).toBeCloseTo(14_890 / 8_000);
    // Organic search: 20000 - 6000 - (500+100) - 250 - 2500.
    expect(row("organic_search").contributionBeforeMarketingMinor).toBe(10_650);
    // Unknown: 7200 - 3000 - (180+100) - 90 - 2500.
    expect(row("unknown").contributionBeforeMarketingMinor).toBe(1_330);
    expect(row("email").contributionBeforeMarketingMinor).toBe(0);
  });

  it("adds up to the shop's own totals: every covered paid order is in exactly one row", async () => {
    const report = await marketingReport(store, PERIOD, NOW);
    const { blended, rows } = report.table!;
    expect(rows.reduce((sum, r) => sum + r.revenueMinor, 0)).toBe(blended.revenueMinor);
    expect(rows.reduce((sum, r) => sum + r.orders, 0)).toBe(blended.orders);
    expect(blended).toMatchObject({ sessions: 8, orders: 4, revenueMinor: 52_590, newCustomers: 3, spendMinor: 13_000, contributionBeforeMarketingMinor: 26_870 });
    // ROAS (blended) is over the channels with ad spend only (paid search, email, paid social: 25 390 of sales for 13 000); organic and
    // unknown sales are in MER, every sale over every ad krone (52 590 / 13 000).
    expect(report.table!.spendChannels).toEqual({ channels: 3, revenueMinor: 25_390, spendMinor: 13_000, contributionBeforeMarketingMinor: 14_890 });
    expect(blended.roas).toBeCloseTo(25_390 / 13_000, 10);
    expect(blended.profitRoas).toBeCloseTo(14_890 / 13_000, 10);
    expect(report.table!.mer).toBeCloseTo(52_590 / 13_000, 10);
    // The overview's totals over the same days, and together with the uncovered orders over the whole period.
    const covered = await periodTotals(store, COVERED, await getAnalyticsSettings(store.id));
    expect(covered.totals.revenueMinor).toBe(blended.revenueMinor);
    expect(covered.totals.orders).toBe(blended.orders);
    const whole = await periodTotals(store, PERIOD, await getAnalyticsSettings(store.id));
    expect(whole.totals.revenueMinor).toBe(blended.revenueMinor + report.uncoveredOrders.revenueMinor);
    // Over the covered days Alice (first order 2 September) is returning; over the whole period she is new too.
    expect(covered.totals.newCustomers).toBe(blended.newCustomers);
    expect(whole.totals.newCustomers).toBe(blended.newCustomers + 1);
    expect(blended.conversion).toBe(0.5);
  });

  it("reports the spend entered, and the part outside the covered days that CAC and ROAS leave out", async () => {
    const { spend, notes } = await marketingReport(store, PERIOD, NOW);
    expect(spend.totalMinor).toBe(15_000);
    expect(spend.outsideCoverageMinor).toBe(2_000);
    expect(spend.byChannel.map((s) => [s.channel, s.amountMinor])).toEqual([
      ["paid_search", 10_000],
      ["paid_social", 4_000],
      ["email", 1_000],
    ]);
    expect(notes.join(" ")).toContain("Spend entered for days with no counted visits");
  });

  it("shows a contribution of none, never a partial sum, while some channel's costs are unknown", async () => {
    // Only the tote (no known cost) is sold in this other store's period, with 49.00 of shipping: shipping income is no product, so it
    // does not make the channel's sales costed.
    const unknownCosts = await marketingReport(other, customPeriod("2026-09-04", "2026-09-04"), NOW);
    const [row] = unknownCosts.table!.rows.filter((r) => r.orders > 0);
    expect(row.contributionBeforeMarketingMinor).toBeNull();
    expect(unknownCosts.table!.blended.contributionBeforeMarketingMinor).toBeNull();
    expect(unknownCosts.notes.join(" ")).toContain("Product costs are missing");
  });

  it("keeps stores apart", async () => {
    const mine = await marketingReport(store, PERIOD, NOW);
    expect(mine.table!.rows.some((r) => r.orders > 0 && r.channel === "paid_search" && r.revenueMinor !== 25_390)).toBe(false);
    const theirs = await trafficReport(other, customPeriod("2026-09-04", "2026-09-04"), NOW);
    expect(theirs.sessions).toBe(1);
    expect(theirs.funnel.stages.map((s) => s.count)).toEqual([1, 1, 1, 1, 1]);
  });

  it("has no table with counting off, but still lists the spend", async () => {
    const off = await marketingReport(storeOf(store.id, store.slug, false), PERIOD, NOW);
    expect(off.table).toBeNull();
    expect(off.counting).toBe(false);
    expect(off.spend.totalMinor).toBe(15_000);
    expect(off.notes.join(" ")).toContain("Visit counting is off");
  });
});
