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

const { trafficReport, marketingReport } = await import("./analytics-traffic-data");
const { periodTotals, seriesByBucket } = await import("./analytics-totals");
const { productsReport, CUSTOM_ID, CUSTOM_NAME, OTHER_ID } = await import("./analytics-products-data");
const { discountsReport } = await import("./analytics-discounts-data");
const { getAnalyticsSettings } = await import("./analytics-settings");
const { derive } = await import("@/lib/analytics-kpi");
const { STAFF_CHANNEL } = await import("@/lib/analytics-traffic");
const { diagnosisFor } = await import("./analytics-insights");
const { parseAnalyticsParams } = await import("@/lib/analytics-period");

/**
 * Staff-made orders in the analytics (D173, `docs/analytics.md`, "Staff-made order", "Custom item", "Custom price"), against a small hand-made shop whose every expectation is
 * worked out by hand. NOK is the main currency, EUR is 10 NOK, Europe/Oslo, 25 % VAT, visits counted from 3 September; the period is 3 to 4 September.
 *
 * Visits: V1 09-03 organic_search mobile NO, V2 09-03 direct desktop NO. Carts: C1 of V1.
 *   O1 09-03 a shopper's checkout, cart C1: 1 mug 100.00, cost 30.00                      total 10000 VAT 2000 revenue  8000
 *   O2 09-03 staff-made: 1 mug 100.00 less a 10.00 staff discount (no cost known)
 *            + a custom item "Custom job" 50.00 (a service, no variant, no cost)         total 14000 VAT 2800 revenue 11200
 *   O3 09-04 staff-made in EUR: 1 mug at the typed price 15.00 EUR (list price 100 NOK)   total  1500 EUR VAT 300 EUR revenue 1200 EUR = 12000 NOK
 *   O4 09-04 a shopper's checkout with no cart (bought on a browser that was not counted)  total  5000 VAT 1000 revenue 4000
 * Each staff-made order was paid outside Kaizen (a `manual` payment); O1 and O4 through Stripe. Another store has a staff-made order in the same days that must never reach this one.
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
const storeOf = (id: string, slug: string) => ({ id, slug, timeZone: "Europe/Oslo", markets: [no], localization, visitCounting: true }) as unknown as Store;

let store: Store;
let other: Store;
let accountId: string;
let serial = 0;
const variants: Record<string, Record<string, string>> = {};

const taxOf = (amount: number, rate = 0.25) => amount - Math.round(amount / (1 + rate));

type Line = { sku: string; qty: number; unit: number; discount?: number; staffDiscount?: number; cost?: number | null; custom?: boolean; title?: string };

async function order(
  s: Store,
  o: { currency?: string; at: string; email: string; cart?: string | null; staff?: boolean; lines: Line[]; manual?: boolean; fee?: number; label?: string },
): Promise<string> {
  serial += 1;
  const currency = o.currency ?? "NOK";
  const lines = o.lines.map((l) => {
    const total = l.unit * l.qty - (l.discount ?? 0);
    return { ...l, total, tax: taxOf(total) };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  const discount = lines.reduce((sum, l) => sum + (l.discount ?? 0), 0);
  const staffDiscount = lines.reduce((sum, l) => sum + (l.staffDiscount ?? 0), 0);
  const tax = lines.reduce((sum, l) => sum + l.tax, 0);
  const total = subtotal - discount;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
      billing_address, shipping_address, placed_at, cart_id, source, draft_id, made_by, staff_discount_minor, staff_discount_label)
    values (${s.id}::uuid, ${`S-${run}-${serial}`}, 'NO', ${currency}, 'nb-NO', ${o.email}, 'paid', ${subtotal}, 0, ${discount}, ${tax}, ${total},
      '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, ${o.cart ?? null}::uuid, ${o.staff ? "draft" : "checkout"}, ${o.staff ? sql`gen_random_uuid()` : sql`null`},
      ${o.staff ? accountId : null}::uuid, ${staffDiscount}, ${staffDiscount > 0 ? "Loyal customer" : null})
    returning id
  `);
  const id = String(row.id);
  for (const l of lines) {
    await db().execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code,
        delivery, custom, staff_discount_minor)
      values (${s.id}::uuid, ${id}::uuid, ${l.custom ? null : variants[s.id][l.sku]}::uuid, ${l.custom ? "CUSTOM" : l.sku}, ${l.title ?? l.sku}, ${l.qty}, ${l.unit}, ${l.cost ?? null},
        ${l.discount ?? 0}, ${l.total}, ${l.tax}, 0.25, 'txcd_99999999', ${l.custom ? "service" : "physical"}::commerce.delivery, ${Boolean(l.custom)}, ${l.staffDiscount ?? 0})
    `);
  }
  if (o.manual) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, method, recorded_by)
      values (${s.id}::uuid, ${id}::uuid, 'manual', ${`manual_${run}_${serial}`}, ${total}, ${currency}, 'captured'::commerce.payment_status, 'bank_transfer', ${accountId}::uuid)
    `);
  } else {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
      values (${s.id}::uuid, ${id}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_staff', ${total}, ${o.fee ?? 0}, ${currency}, 'captured'::commerce.payment_status)
    `);
  }
  return id;
}

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

const PERIOD = customPeriod("2026-09-03", "2026-09-04");
const NOW = new Date("2026-09-05T10:00:00Z");
const MUG = { sku: "DEMO-MUG-WHITE" } as const;

beforeAll(async () => {
  const id = await makeStore(`staffan-${run}`);
  const otherId = await makeStore(`staffan-other-${run}`);
  store = storeOf(id, `staffan-${run}`);
  other = storeOf(otherId, `staffan-other-${run}`);
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`staff-${run}@example.com`}, 'Staff') returning id`);
  accountId = String(account.id);
  for (const storeId of [id, otherId]) {
    variants[storeId] = {};
    for (const row of await db().execute<Row>(sql`select sku, id from commerce.product_variants where store_id = ${storeId}::uuid`)) variants[storeId][String(row.sku)] = String(row.id);
  }
  const visit = async (key: string, channel: string, device: string) => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.visits (store_id, day, visitor, market_code, device, channel, landing_path)
      values (${id}::uuid, '2026-09-03'::date, ${Buffer.from(key).toString("hex").padEnd(24, "0")}, 'NO', ${device}, ${channel}, ${`/s/${store.slug}/no`}) returning id
    `);
    return String(row.id);
  };
  const v1 = await visit("v1", "organic_search", "mobile");
  await visit("v2", "direct", "desktop");
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at, visit_id) values (${id}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '30 days', ${v1}::uuid) returning id
  `);

  await order(store, { at: "2026-09-03T11:00:00+02:00", email: "alice@example.com", cart: String(cart.id), fee: 200, lines: [{ ...MUG, qty: 1, unit: 10_000, cost: 3_000 }] });
  await order(store, {
    at: "2026-09-03T14:00:00+02:00",
    email: "bob@example.com",
    staff: true,
    manual: true,
    lines: [
      { ...MUG, qty: 1, unit: 10_000, discount: 1_000, staffDiscount: 1_000 },
      { sku: "CUSTOM", title: "Custom job", qty: 1, unit: 5_000, custom: true },
    ],
  });
  await order(store, { currency: "EUR", at: "2026-09-04T10:00:00+02:00", email: "eva@example.com", staff: true, manual: true, lines: [{ ...MUG, qty: 1, unit: 1_500 }] });
  await order(store, { at: "2026-09-04T12:00:00+02:00", email: "dan@example.com", fee: 100, lines: [{ ...MUG, qty: 1, unit: 5_000, cost: 1_500 }] });
  // Another store's staff-made order in the same days: none of it may reach the first.
  await order(other, { at: "2026-09-03T13:00:00+02:00", email: "x@example.com", staff: true, manual: true, lines: [{ ...MUG, qty: 9, unit: 10_000 }] });
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("a staff-made order is a paid order like any other for the figures", () => {
  it("is in orders, revenue, VAT, gross sales and customers, in the main currency without VAT, and the other store's is not", async () => {
    const { totals, unconverted } = await periodTotals(store, PERIOD);
    expect(unconverted).toBe(0);
    // O1 8000 + O2 11200 + O3 1200 EUR = 12000 NOK + O4 4000
    expect(totals.orders).toBe(4);
    expect(totals.revenueMinor).toBe(8_000 + 11_200 + 12_000 + 4_000);
    expect(totals.vatMinor).toBe(2_000 + 2_800 + 3_000 + 1_000);
    // Gross sales are the prices charged: O2's mug 8000 and custom job 4000 (a typed price is no discount), O3's mug at 15.00 EUR (1200 EUR net = 12000 NOK).
    expect(totals.grossSalesMinor).toBe(8_000 + 8_000 + 4_000 + 12_000 + 4_000);
    // Discounts hold the staff discount without VAT: 1000 / 1.25.
    expect(totals.discountsMinor).toBe(800);
    expect(totals.revenueMinor).toBe(totals.grossSalesMinor - totals.discountsMinor + totals.shippingMinor);
    expect(totals.newCustomers).toBe(4);
  });

  it("counts only the orders from a checkout against the sessions: conversion is 2 over 2 visits, not 4", async () => {
    const { totals } = await periodTotals(store, PERIOD);
    expect(totals.checkoutOrders).toBe(2);
    const d = derive({ ...totals, sessions: 2 }, { fixedCostsMonthlyMinor: 0 }, 2);
    expect(d.conversionRate).toBe(1);
    expect(d.orders).toBe(4);
    // The daily series keeps both counts for the alerts.
    const days = await seriesByBucket(store, PERIOD, "day");
    expect(days.map((p) => [p.key, p.orders, p.checkoutOrders])).toEqual([["2026-09-03", 2, 1], ["2026-09-04", 2, 1]]);
  });

  it("counts a custom item's cost as not known, never as 0: the coverage is what the costed lines make of the line revenue", async () => {
    const { totals } = await periodTotals(store, PERIOD);
    // Costed lines: O1's mug (8000) and O4's mug (4000). Line revenue: 8000 + 7200 + 4000 + 12000 + 4000 = 35200.
    expect(totals.knownCostRevenueMinor).toBe(12_000);
    expect(totals.lineRevenueMinor).toBe(35_200);
    expect(totals.cogsMinor).toBe(3_000 + 1_500);
  });
});

describe("the Traffic page leaves staff-made orders out of every rate", () => {
  it("names them apart: the tables and the conversion hold the two checkout orders, the report holds the two staff-made ones", async () => {
    const report = await trafficReport(store, PERIOD, NOW);
    expect(report.sessions).toBe(2);
    expect(report.conversion).toEqual({ orders: 2, sessions: 2, rate: 1 });
    expect(report.staffOrders).toEqual({ orders: 2, revenueMinor: 11_200 + 12_000 });
    // Device: O1 on mobile; O4 has no cart so its device is unknown; neither staff-made order is a device's.
    const mobile = report.byDevice.find((r) => r.key === "mobile")!;
    expect([mobile.orders, mobile.revenueMinor]).toEqual([1, 8_000]);
    const unknown = report.byDevice.find((r) => r.key === "unknown")!;
    expect([unknown.orders, unknown.revenueMinor]).toEqual([1, 4_000]);
    expect(report.byDevice.reduce((n, r) => n + r.orders, 0)).toBe(2);
    expect(report.byMarket.reduce((n, r) => n + r.orders, 0)).toBe(2);
    // The funnel's purchases (as counted, before the funnel holds a stage to the one before it): one visit made a cart and bought; a staff-made order has no cart.
    expect(report.funnel.stages.find((s) => s.key === "purchases")?.raw).toBe(1);
    expect(report.notes.some((n) => /2 staff-made paid orders \(draft orders\) are left out of these tables and of conversion/.test(n))).toBe(true);
  });
});

describe("the channel table has a Staff-made row", () => {
  it("holds the staff-made orders and their revenue as a row of its own, with no sessions and no conversion, so the table's revenue still adds up", async () => {
    const report = await marketingReport(store, PERIOD, NOW);
    const table = report.table!;
    const staff = table.rows.find((r) => r.channel === STAFF_CHANNEL)!;
    expect(staff).toMatchObject({ label: "Staff-made", sessions: null, conversion: null, orders: 2, revenueMinor: 23_200, spendMinor: 0 });
    // The channels' own rows and the unknown row are as before: the staff-made orders are nobody's visit.
    expect(table.rows.find((r) => r.channel === "organic_search")).toMatchObject({ orders: 1, revenueMinor: 8_000, sessions: 1 });
    expect(table.rows.find((r) => r.channel === "unknown")).toMatchObject({ orders: 1, revenueMinor: 4_000 });
    expect(table.rows.reduce((n, r) => n + r.revenueMinor, 0)).toBe(8_000 + 23_200 + 4_000);
    // The blended conversion leaves them out: 2 checkout orders over 2 sessions.
    expect(table.blended.orders).toBe(4);
    expect(table.blended.conversion).toBe(1);
    // Their customers are new customers of the Staff-made channel.
    expect(staff.newCustomers).toBe(2);
    expect(report.unknownOrders).toEqual({ orders: 1, revenueMinor: 4_000 });
  });
});

describe("the Products page", () => {
  it("shows the custom items as one row of their own, in no ranking, with a cost that is not known; Other lines stay for lines that are not products", async () => {
    const report = await productsReport(store, PERIOD, null);
    const custom = report.rows.find((r) => r.productId === CUSTOM_ID)!;
    expect(custom).toMatchObject({ name: CUSTOM_NAME, other: true, revenueMinor: 4_000, units: 0, orders: 1, views: null, conversion: null, handle: null });
    expect(custom.cogsMinor).toBeNull();
    expect(report.rows.some((r) => r.productId === OTHER_ID)).toBe(false);
    // The product rows plus the custom row are every line's revenue.
    expect(report.rows.reduce((n, r) => n + r.revenueMinor, 0)).toBe(35_200);
    expect(report.reconciliation.differenceMinor).toBe(0);
  });
});

describe("the discounts: a staff discount is a discount, a custom price is not", () => {
  it("is its own kind, Staff discounts, and is never lumped into the discount codes", async () => {
    const report = await discountsReport(store, PERIOD);
    const staff = report.breakdown.kinds.find((k) => k.kind === "staff")!;
    expect(staff).toMatchObject({ label: "Staff discounts", orders: 1, discountMinor: 800 });
    expect(report.breakdown.kinds.find((k) => k.kind === "code")).toMatchObject({ discountMinor: 0, orders: 0 });
    expect(report.breakdown.totalMinor).toBe(800);
    expect(report.breakdown.roundingMinor).toBe(0);
    // O3's typed price (15.00 EUR against a list price of 100 NOK) is no discount: one discounted order of four.
    expect(report.summary.discountedOrders).toBe(1);
    expect(report.coupons).toEqual([]);
  });

  it("has no Staff discounts row in a store that never gave one", async () => {
    const report = await discountsReport(other, customPeriod("2026-09-03", "2026-09-04"));
    expect(report.breakdown.kinds.map((k) => k.kind)).not.toContain("staff");
  });
});

describe("the diagnosis says what its conversion counts when orders were staff-made", () => {
  it("notes the staff-made orders of both periods, and says nothing of them in a store that made none", async () => {
    const params = (store: Store) => parseAnalyticsParams({ period: "custom", from: "2026-09-03", to: "2026-09-04", compare: "previous" }, { now: NOW, timeZone: store.timeZone });
    const d = await diagnosisFor(store, params(store), NOW);
    expect(d?.notes.join(" ")).toMatch(/Orders here include 2 staff-made orders in this period and 0 in the one compared with/);
    expect(d?.notes.join(" ")).toMatch(/not the Overview's conversion rate/);
    const quiet = storeOf(await makeStore(`staffan-quiet2-${run}`), `staffan-quiet2-${run}`);
    expect((await diagnosisFor(quiet, params(quiet), NOW))?.notes.join(" ") ?? "").not.toMatch(/staff-made/);
  });
});

describe("a store with no staff-made order", () => {
  it("reads as it always did: every order counts for conversion, no Staff-made row, no custom row", async () => {
    const quiet = storeOf(await makeStore(`staffan-quiet-${run}`), `staffan-quiet-${run}`);
    const totals = (await periodTotals(quiet, PERIOD)).totals;
    expect(totals.orders).toBe(0);
    expect(totals.checkoutOrders).toBe(0);
    const marketing = await marketingReport(quiet, PERIOD, NOW);
    expect(marketing.table?.rows.some((r) => r.channel === STAFF_CHANNEL) ?? false).toBe(false);
    const products = await productsReport(quiet, PERIOD, null);
    expect(products.rows.some((r) => r.productId === CUSTOM_ID)).toBe(false);
    expect(await getAnalyticsSettings(quiet.id)).toBeTruthy();
  });
});
