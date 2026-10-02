import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
import type { AnalyticsSettings } from "@/lib/analytics-settings";
import { toRates } from "@/lib/currency";

import { customersReport } from "./analytics-customers-data";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The Customers page's figures (D152) on a small seeded history, every expectation worked out by hand (see the comments).
 * Store time zone Europe/Oslo, main currency NOK, 1 EUR = 10 NOK in minor units (rate 10 NOK per 1 EUR). Costs are
 * entered: payment fee 2.5 % of the total with VAT plus 200 per order, shipping 1 500 per order with a physical line,
 * lifespan 3 years. "Now" is 2026-10-02T10:00:00Z (the 2nd of October in Oslo) and the period is September 2026.
 */

const run = Date.now().toString(36);
const NOW = new Date("2026-10-02T10:00:00Z");
const SETTINGS: AnalyticsSettings = {
  paymentFeeBps: 250,
  paymentFeeFixedMinor: 200,
  shippingCostMinor: 1_500,
  fixedCostsMonthlyMinor: 0,
  ltvLifespanYears: 3,
};
const ZERO: AnalyticsSettings = { paymentFeeBps: 0, paymentFeeFixedMinor: 0, shippingCostMinor: 0, fixedCostsMonthlyMinor: 0, ltvLifespanYears: 3 };
const SEPTEMBER = customPeriod("2026-09-01", "2026-09-30");

let store: Store;
let other: Store;
let empty: Store;
let nocost: Store;
const variants = new Map<string, string>();
let n = 0;
const ids: Record<string, string> = {};

async function makeStore(slug: string): Promise<Store> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  return {
    id: String(created.id),
    slug: `${slug}-${run}`,
    timeZone: "Europe/Oslo",
    markets: [{ nativeCurrency: "NOK" }],
    localization: { locales: ["nb-NO"], currencies: [], rates: toRates([{ currency: "NOK", rate: 10, roundTo: 1 }]) },
  } as unknown as Store;
}

type Line = { qty?: number; price: number; discount?: number; rate: number; tax: number; cost: number | null; delivery?: "physical" | "digital" };
type Spec = {
  email: string;
  at: string;
  lines: Line[];
  currency?: string;
  customerId?: string;
  shipping?: number;
  shippingTax?: number;
  status?: string;
  /** Payment status; "none" for no payment at all. */
  payment?: "captured" | "pending";
  fee?: number;
  refunds?: { amount: number; status?: string }[];
  copied?: boolean;
  hostId?: string;
  shipName?: string;
};

/** Inserts an order with its lines, payment and refunds straight into the tables, and returns its id. */
async function order(s: Store, spec: Spec): Promise<string> {
  n += 1;
  const currency = spec.currency ?? "NOK";
  const variantId = variants.get(s.id);
  const subtotal = spec.lines.reduce((a, l) => a + (l.qty ?? 1) * l.price, 0);
  const discount = spec.lines.reduce((a, l) => a + (l.discount ?? 0), 0);
  const shipping = spec.shipping ?? 0;
  const tax = spec.lines.reduce((a, l) => a + l.tax, 0) + (spec.shippingTax ?? 0);
  const total = subtotal - discount + shipping;
  return db().transaction(async (tx) => {
    // The database never lets a copied order get lines or a payment (D129), so the order that tests the exclusion is written with its
    // rules off, as data from before them could be: `copied_from` alone must keep it out of the figures.
    if (spec.copied) await tx.execute(sql`set local session_replication_role = replica`);
    const [o] = await tx.execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, customer_id, email, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, copied_from, host_id)
      values (${s.id}::uuid, ${`${spec.copied ? "C-" : ""}${run}-${n}`}, 'NO', ${currency}, 'nb-NO', ${spec.customerId ?? null}::uuid, ${spec.email},
        ${(spec.status ?? "paid") as string}::commerce.order_status, ${subtotal}, ${shipping}, ${discount}, ${tax}, ${total},
        '{}'::jsonb, ${JSON.stringify({ name: spec.shipName ?? "" })}::jsonb, ${spec.at}::timestamptz,
        ${spec.copied ? sql`gen_random_uuid()` : sql`null`}, ${spec.hostId ?? null}::uuid)
      returning id
    `);
    const orderId = String(o.id);
    for (const l of spec.lines) {
      const qty = l.qty ?? 1;
      await tx.execute(sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor,
          total_minor, tax_minor, tax_rate, tax_code, delivery)
        values (${s.id}::uuid, ${orderId}::uuid, ${variantId}::uuid, 'X', 'Thing', ${qty}, ${l.price}, ${l.cost}, ${l.discount ?? 0},
          ${qty * l.price - (l.discount ?? 0)}, ${l.tax}, ${l.rate}, 'txcd_99999999', ${l.delivery ?? "physical"}::commerce.delivery)
      `);
    }
    const [p] = await tx.execute<Row>(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, kaizen_fee_minor, currency, status)
      values (${s.id}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${run}_${n}`}, ${total}, ${spec.fee ?? 0}, ${currency},
        ${(spec.payment ?? "captured") as string}::commerce.payment_status)
      returning id
    `);
    for (const [i, r] of (spec.refunds ?? []).entries()) {
      await tx.execute(sql`
        insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
        values (${s.id}::uuid, ${String(p.id)}::uuid, ${r.amount}, 'test', ${`re_${run}_${n}_${i}`}, ${(r.status ?? "succeeded") as string}::commerce.refund_status)
      `);
    }
    return orderId;
  });
}

const account = async (s: Store, email: string, name: string) => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name, email_verified_at) values (${s.id}::uuid, ${email}, ${name}, now()) returning id
  `);
  return String(row.id);
};

beforeAll(async () => {
  store = await makeStore("cust");
  other = await makeStore("cust-other");
  empty = await makeStore("cust-empty");
  nocost = await makeStore("cust-nocost");
  for (const s of [store, other, nocost]) {
    const [v] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${s.id}::uuid limit 1`);
    variants.set(s.id, String(v.id));
  }

  const anna = await account(store, "anna@example.com", "Anna Konto");
  const david = await account(store, "david@example.com", "");
  ids.anna = anna;
  ids.david = david;

  // Anna. a1 is a guest order from before she had an account (the email's case differs), a2 is placed signed in under another
  // order email and in euros, half refunded; a3 has two VAT rates, a discount and shipping.
  await order(store, { email: "Anna@Example.com", at: "2025-08-15T10:00:00Z", fee: 125, lines: [{ price: 12_500, rate: 0.25, tax: 2_500, cost: 4_000 }] });
  // 2025-10-31 23:30 UTC is already the 1st of November in Oslo: her month is 2025-11.
  await order(store, {
    email: "old@example.com",
    customerId: anna,
    at: "2025-10-31T23:30:00Z",
    currency: "EUR",
    fee: 25,
    lines: [{ price: 2_500, rate: 0.25, tax: 500, cost: 1_000 }],
    refunds: [{ amount: 1_250 }, { amount: 700, status: "failed" }, { amount: 300, status: "pending" }],
  });
  const a3 = await order(store, {
    email: "anna@example.com",
    customerId: anna,
    at: "2026-09-20T08:00:00Z",
    fee: 300,
    shipping: 1_250,
    shippingTax: 250,
    status: "fulfilled",
    lines: [
      { price: 12_500, discount: 2_500, rate: 0.25, tax: 2_000, cost: 3_000 },
      { price: 11_200, rate: 0.12, tax: 1_200, cost: 2_500 },
    ],
  });
  ids.a3 = a3;
  // An unpaid order of hers, and the same email in another store: neither counts.
  await order(store, { email: "anna@example.com", customerId: anna, at: "2026-09-29T08:00:00Z", payment: "pending", status: "pending_payment", lines: [{ price: 9_000, rate: 0.25, tax: 1_800, cost: 1 }] });

  // Bjørn, a guest. His first order has a line whose cost was never known (null), so his contribution is unknown.
  await order(store, { email: "bjorn@example.com", at: "2026-02-10T12:00:00Z", shipName: "Bjørn Gjest", lines: [{ price: 5_000, rate: 0.25, tax: 1_000, cost: null }] });
  ids.b2 = await order(store, { email: "bjorn@example.com", at: "2026-09-05T12:00:00Z", shipName: "Bjørn Gjest", lines: [{ price: 6_250, rate: 0.25, tax: 1_250, cost: 2_000 }] });
  // His later, unpaid order does not make it his latest.
  await order(store, { email: "bjorn@example.com", at: "2026-09-25T12:00:00Z", payment: "pending", status: "pending_payment", lines: [{ price: 1_000, rate: 0.25, tax: 200, cost: 1 }] });

  // Cecilie: one digital order late in September (22:00 in Oslo).
  await order(store, { email: "cecilie@example.com", at: "2026-09-28T20:00:00Z", shipName: "Cecilie Ny", lines: [{ price: 3_125, rate: 0.25, tax: 625, cost: 1_000, delivery: "digital" }] });

  // David, in euros: one order in the period and one half an hour after it (00:30 on the 1st of October in Oslo).
  await order(store, { email: "david@example.com", customerId: david, at: "2026-09-12T10:00:00Z", currency: "EUR", shipName: "David Skipper", lines: [{ price: 1_000, rate: 0.25, tax: 200, cost: 500 }] });
  await order(store, { email: "david@example.com", customerId: david, at: "2026-09-30T22:30:00Z", currency: "EUR", shipName: "David Skipper", lines: [{ price: 2_000, rate: 0.25, tax: 400, cost: 500 }] });

  // Erik: paid, then cancelled and refunded in full. It still counts as an order (with no revenue left).
  await order(store, {
    email: "erik@example.com",
    at: "2026-07-01T10:00:00Z",
    status: "cancelled",
    lines: [{ price: 10_000, rate: 0.25, tax: 2_000, cost: 3_000 }],
    refunds: [{ amount: 10_000 }],
  });

  // Never counted: a copied order, a host's order, and an order with no email behind it.
  await order(store, { email: "frida@example.com", at: "2026-09-10T10:00:00Z", copied: true, lines: [{ price: 5_000, rate: 0.25, tax: 1_000, cost: 1 }] });
  const [hostAccount] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-${run}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`
    insert into commerce.hosts (store_id, account_id, name) values (${store.id}::uuid, ${String(hostAccount.id)}::uuid, 'Host') returning id
  `);
  await order(store, { email: "gina@example.com", at: "2026-09-11T10:00:00Z", hostId: String(host.id), lines: [{ price: 5_000, rate: 0.25, tax: 1_000, cost: 1 }] });
  await order(store, { email: "", at: "2026-09-11T11:00:00Z", lines: [{ price: 5_000, rate: 0.25, tax: 1_000, cost: 1 }] });

  // Another store, with the same email as Anna and a currency with no rate. Costs are not entered there.
  await order(other, { email: "anna@example.com", at: "2026-09-13T10:00:00Z", lines: [{ price: 2_500, rate: 0.25, tax: 500, cost: 100 }] });
  await order(other, { email: "dk@example.com", at: "2026-09-10T10:00:00Z", currency: "DKK", lines: [{ price: 10_000, rate: 0.25, tax: 2_000, cost: 1_000 }] });
  await order(other, { email: "ok1@example.com", at: "2026-09-11T10:00:00Z", lines: [{ price: 5_000, rate: 0.25, tax: 1_000, cost: 500 }] });
  await order(other, { email: "ok2@example.com", at: "2026-09-12T10:00:00Z", lines: [{ price: 6_250, rate: 0.25, tax: 1_250, cost: 500 }] });

  // A store that has not entered any costs: every line's cost is unknown.
  await order(nocost, { email: "x@example.com", at: "2026-03-01T10:00:00Z", lines: [{ price: 5_000, rate: 0.25, tax: 1_000, cost: null }] });
  await order(nocost, { email: "x@example.com", at: "2026-09-05T10:00:00Z", lines: [{ price: 6_250, rate: 0.25, tax: 1_250, cost: null }] });
  await order(nocost, { email: "y@example.com", at: "2026-09-06T10:00:00Z", lines: [{ price: 2_500, rate: 0.25, tax: 500, cost: null }] });
});

afterAll(async () => {
  await closeDb();
});

describe("the seeded data", () => {
  it("keeps the doc's identity: revenue = gross sales - discounts + shipping income, without VAT", async () => {
    const [row] = await db().execute<Row>(sql`
      select o.total_minor - o.tax_minor as revenue,
        (select round(sum(ol.unit_price_minor * ol.quantity / (1 + ol.tax_rate))) from commerce.order_lines ol where ol.order_id = o.id) as gross,
        (select round(sum(ol.discount_minor / (1 + ol.tax_rate))) from commerce.order_lines ol where ol.order_id = o.id) as discounts,
        o.shipping_minor - (o.tax_minor - (select sum(ol.tax_minor) from commerce.order_lines ol where ol.order_id = o.id)) as shipping
      from commerce.orders o where o.id = ${ids.a3}::uuid
    `);
    expect([Number(row.gross), Number(row.discounts), Number(row.shipping), Number(row.revenue)]).toEqual([20_000, 2_000, 1_000, 19_000]);
  });
});

describe("customersReport", () => {
  it("counts the customers: accounts and guests together, never copied, host's, unpaid or keyless orders, nor another store's", async () => {
    const r = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(r.customers).toBe(5);
    expect([r.currency, r.today, r.truncated, r.unconverted, r.missingRates]).toEqual(["NOK", "2026-10-02", false, 0, []]);
    expect(r.period).toEqual({ from: "2026-09-01", to: "2026-10-01", days: 30 });
    // Plain JSON: nothing a page could not be handed.
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("splits new and returning customers in the period, the period ending at midnight in Oslo", async () => {
    // September: Anna (a3, 19 000, first in 2025) and Bjørn (5 000, first in February) are returning; Cecilie (2 500) and David
    // (his first, 8 000 = 800 EUR; his second order is after midnight on the 1st of October) are new.
    const { newVsReturning: nv } = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(nv).toEqual({
      newCustomers: 2,
      returningCustomers: 2,
      newOrders: 2,
      returningOrders: 2,
      newRevenueMinor: 10_500,
      returningRevenueMinor: 24_000,
      returningShare: 0.5,
      returningRevenueShare: 24_000 / 34_500,
    });
  });

  it("gives the repeat purchase rate for each window from the first and second order", async () => {
    // First order at least N days old at now / second order within N days of it:
    //  Anna 2025-08-15 / 77.6 days later; Bjørn 2026-02-10 (234 days) / 207 days later; Erik 2026-07-01 (93 days) / never;
    //  David (20 days) and Cecilie (3.5 days) are too young for any window.
    const { repeatRates } = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(repeatRates.map((r) => [r.days, r.base, r.repeaters, r.rate])).toEqual([
      [30, 3, 0, 0],
      [90, 3, 1, 1 / 3],
      [180, 2, 1, 0.5],
      [365, 1, 1, 1],
    ]);
  });

  it("gives purchase frequency over the 365 days up to now", async () => {
    // Orders after 2025-10-02T10:00Z: Anna 2 (not her first), Bjørn 2, Cecilie 1, David 2, Erik 1 = 8 by 5 customers.
    const { frequency } = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(frequency).toEqual({ orders365: 8, customers365: 5, perCustomer: 1.6 });
  });

  it("values customers to date: net revenue after refunds, and contribution before marketing where costs are known", async () => {
    // Net revenue: Anna 10 000 + 10 000 (2 000 EUR less the 1 000 EUR refund, the failed and pending ones not counted) + 19 000 = 39 000;
    // Bjørn 4 000 + 5 000; Cecilie 2 500; David 8 000 + 16 000; Erik 8 000 - 8 000 = 0. Together 74 500, 14 900 each.
    // Contribution = net revenue - fee (2.5 % of the total with VAT) - Kaizen's fee, converted, minus costs (goods + 200 fixed per order
    // + 1 500 shipping for a physical order):
    //  Anna  9 563 (10 000 - 312.5 - 125) + 9 130 (913 EUR) + 18 139 (19 000 - 561.25 - 300) - (10 500 + 600 + 4 500) = 21 232
    //  Bjørn unknown (a line with no cost)
    //  Cecilie 2 422 (2 500 - 78.125) - (1 000 + 200) = 1 222
    //  David 7 750 + 15 500 - (1 000 + 400 + 3 000) = 18 850
    //  Erik  -250 - (3 000 + 200 + 1 500) = -4 950
    // Mean over the four known: 36 354 / 4 = 9 088.5.
    const { ltv } = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(ltv.historic).toEqual({ customers: 5, revenueMinor: 14_900, contributionMinor: 9_089, contributionCoverage: 0.8 });
  });

  it("predicts lifetime value from contribution per order, orders per year and the lifespan", async () => {
    // 36 354 over their 7 orders = 5 193 an order (before marketing spend); 1.6 orders a year; 3 years: 24 926.
    const { ltv } = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(ltv.inputs).toEqual({
      contributionPerOrderMinor: 5_193,
      revenuePerOrderMinor: 8_278,
      ordersPerYear: 1.6,
      lifespanYears: 3,
      contributionCustomers: 4,
      contributionOrders: 7,
    });
    expect(ltv.predicted).toMatchObject({ minor: 24_926, basis: "contribution" });
    // A longer lifespan from the settings.
    const longer = await customersReport(store, SEPTEMBER, { ...SETTINGS, ltvLifespanYears: 5 }, NOW);
    expect(longer.ltv.predicted.minor).toBe(Math.round(5_193 * 1.6 * 5));
  });

  it("falls back to revenue per order, saying so, when no costs are entered", async () => {
    // Nothing is known about costs: revenue 9 000 and 2 000, so 5 500 a customer and no contribution (never zero). 11 000 over 3 orders
    // = 3 667 an order; 3 orders by 2 customers = 1.5 a year; 3 years: 16 501.5, so 16 502.
    const r = await customersReport(nocost, SEPTEMBER, ZERO, NOW);
    expect(r.ltv.historic).toEqual({ customers: 2, revenueMinor: 5_500, contributionMinor: null, contributionCoverage: 0 });
    expect(r.ltv.inputs).toMatchObject({ contributionPerOrderMinor: null, revenuePerOrderMinor: 3_667, ordersPerYear: 1.5, contributionCustomers: 0 });
    expect(r.ltv.predicted).toMatchObject({ minor: 16_502, basis: "revenue" });
    expect(r.ltv.predicted.label).toContain("costs not entered");
    // No customers at all: nothing to predict from.
    const none = await customersReport(empty, SEPTEMBER, ZERO, NOW);
    expect(none.ltv.predicted).toMatchObject({ minor: null, basis: null });
    expect(none.ltv.historic).toEqual({ customers: 0, revenueMinor: null, contributionMinor: null, contributionCoverage: null });
  });

  it("builds cohorts in the store's time zone, filling an offset only once its month is over", async () => {
    // Anna's second order is 2025-10-31 23:30 UTC = 1 November in Oslo, so her cohort 2025-08 has bought again by month 3 (not 2).
    // 2026-09 is Cecilie and David: David's second order is in October, which is not over, so only month 0 shows.
    const { cohorts, cohortTrend } = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(cohorts.offsets).toEqual([0, 1, 2, 3, 6, 12]);
    expect(cohorts.rows).toEqual([
      { cohort: "2025-08", size: 1, repeaters: [0, 0, 0, 1, 1, 1], retention: [0, 0, 0, 1, 1, 1], revenuePerCustomerMinor: [10_000, 10_000, 10_000, 20_000, 20_000, 20_000] },
      { cohort: "2026-02", size: 1, repeaters: [0, 0, 0, 0, 0, null], retention: [0, 0, 0, 0, 0, null], revenuePerCustomerMinor: [4_000, 4_000, 4_000, 4_000, 4_000, null] },
      { cohort: "2026-07", size: 1, repeaters: [0, 0, 0, null, null, null], retention: [0, 0, 0, null, null, null], revenuePerCustomerMinor: [0, 0, 0, null, null, null] },
      { cohort: "2026-09", size: 2, repeaters: [0, null, null, null, null, null], retention: [0, null, null, null, null, null], revenuePerCustomerMinor: [5_250, null, null, null, null, null] },
    ]);
    // Far too few customers for a verdict.
    expect(cohortTrend.verdict).toBe("unknown");
  });

  it("scores recency, frequency and revenue and sums the segments", async () => {
    // Recency (days): David 2, Cecilie 3, Anna 12, Bjørn 26, Erik 93 -> R 5, 4, 3, 2, 1. Orders: Anna 3, Bjørn and David 2,
    // Cecilie and Erik 1: ties share their middle rank (percentile of 5 customers), so F is 5 for Anna, 4 for Bjørn and David, 2 for the
    // other two. Revenue: Anna 39 000, David 24 000, Bjørn 9 000, Cecilie 2 500, Erik 0 -> M 5, 4, 3, 2, 1.
    // David VIP (R5 F4 M4), Anna Loyal (R3 F5), Cecilie New, Bjørn At risk (quiet, F4), Erik Lost. Too few customers to be more than a sketch.
    const { segments } = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect([segments.enough, segments.customers, segments.minCustomers]).toEqual([false, 5, 20]);
    expect(segments.summary.map((s) => [s.segment, s.customers, s.revenueMinor, s.customerShare])).toEqual([
      ["VIP", 1, 24_000, 0.2],
      ["Loyal", 1, 39_000, 0.2],
      ["Promising", 0, 0, 0],
      ["New", 1, 2_500, 0.2],
      ["At risk", 1, 9_000, 0.2],
      ["Lost", 1, 0, 0.2],
    ]);
    expect(segments.summary.find((s) => s.segment === "Loyal")).toMatchObject({ averageOrders: 3, averageRecencyDays: 12, revenueShare: 39_000 / 74_500 });
  });

  it("lists the best customers of the period by revenue, with where their admin page is", async () => {
    const { topCustomers } = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(topCustomers).toEqual([
      // An account: the page is the account's, the name the account's.
      { key: "anna@example.com", email: "anna@example.com", name: "Anna Konto", customerId: ids.anna, account: true, orders: 1, revenueMinor: 19_000, lifetimeOrders: 3, lastOrderAt: "2026-09-20T08:00:00.000Z" },
      // An account with no name: the name on the order.
      { key: "david@example.com", email: "david@example.com", name: "David Skipper", customerId: ids.david, account: true, orders: 1, revenueMinor: 8_000, lifetimeOrders: 2, lastOrderAt: "2026-09-30T22:30:00.000Z" },
      // A guest: the page is their latest paid order's (not the unpaid one after it).
      { key: "bjorn@example.com", email: "bjorn@example.com", name: "Bjørn Gjest", customerId: ids.b2, account: false, orders: 1, revenueMinor: 5_000, lifetimeOrders: 2, lastOrderAt: "2026-09-05T12:00:00.000Z" },
      { key: "cecilie@example.com", email: "cecilie@example.com", name: "Cecilie Ny", customerId: expect.any(String), account: false, orders: 1, revenueMinor: 2_500, lifetimeOrders: 1, lastOrderAt: "2026-09-28T20:00:00.000Z" },
    ]);
  });

  it("agrees with itself: period revenue, lifetime revenue and the cohorts add up to the same money", async () => {
    const r = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    const periodRevenue = r.newVsReturning.newRevenueMinor + r.newVsReturning.returningRevenueMinor;
    expect(periodRevenue).toBe(19_000 + 5_000 + 2_500 + 8_000);
    expect(r.topCustomers.reduce((a, c) => a + c.revenueMinor, 0)).toBe(periodRevenue);
    expect((r.ltv.historic.revenueMinor ?? 0) * r.ltv.historic.customers).toBe(74_500);
    // A cohort's revenue per customer at its longest known offset, times its size, is what its customers had spent by then.
    const lastKnown = r.cohorts.rows.map((row) => row.size * (row.revenuePerCustomerMinor.filter((x): x is number => x !== null).at(-1) ?? 0));
    expect(lastKnown).toEqual([20_000, 4_000, 0, 10_500]);
  });

  it("changes with the period and with now, nothing else", async () => {
    // October so far: only David's second order (1 600 EUR = 16 000), and he is returning.
    const october = customPeriod("2026-10-01", "2026-10-02");
    const r = await customersReport(store, october, SETTINGS, NOW);
    expect(r.newVsReturning).toMatchObject({ newCustomers: 0, returningCustomers: 1, returningOrders: 1, returningRevenueMinor: 16_000 });
    expect(r.topCustomers.map((c) => [c.key, c.revenueMinor])).toEqual([["david@example.com", 16_000]]);
    // Run the same history a year later: nobody has bought in the last 365 days.
    const later = await customersReport(store, SEPTEMBER, SETTINGS, new Date("2027-10-02T10:00:00Z"));
    expect(later.today).toBe("2027-10-02");
    expect(later.frequency).toEqual({ orders365: 0, customers365: 0, perCustomer: null });
    expect(later.ltv.predicted.minor).toBeNull();
  });

  it("is a store's own: another store's customer with the same email is a different customer", async () => {
    const r = await customersReport(other, SEPTEMBER, ZERO, NOW);
    expect(r.customers).toBe(4);
    expect(r.topCustomers.find((c) => c.key === "anna@example.com")).toMatchObject({ revenueMinor: 2_000, lifetimeOrders: 1, account: false });
  });

  it("says what it could not convert instead of counting it as nothing", async () => {
    // dk@example.com ordered in Danish kroner, which have no rate: left out of lifetime value and of the best customers.
    const r = await customersReport(other, SEPTEMBER, ZERO, NOW);
    expect([r.unconverted, r.missingRates]).toEqual([1, ["DKK"]]);
    // As on the Overview, the Danish order is no order and its customer no new customer here: the others are all there is, so the
    // average order is their revenue over their own orders.
    expect(r.newVsReturning).toMatchObject({ newCustomers: 3, newOrders: 3, returningCustomers: 0, returningOrders: 0 });
    // The others: revenue 4 000, 5 000, 2 000 with costs 500, 500, 100: contribution 3 500, 4 500, 1 900.
    expect(r.ltv.historic).toEqual({ customers: 3, revenueMinor: 3_667, contributionMinor: 3_300, contributionCoverage: 1 });
    expect(r.topCustomers.map((c) => c.key)).toEqual(["ok2@example.com", "ok1@example.com", "anna@example.com"]);
  });

  it("reads at most the cap's worth of customers, the most recently active, and says so", async () => {
    const r = await customersReport(other, SEPTEMBER, ZERO, NOW, { cap: 2 });
    expect([r.truncated, r.cap, r.customers]).toEqual([true, 2, 2]);
    expect(r.topCustomers.map((c) => c.key)).toEqual(["ok2@example.com", "anna@example.com"]);
    const all = await customersReport(other, SEPTEMBER, ZERO, NOW, { cap: 4 });
    expect([all.truncated, all.customers]).toEqual([false, 4]);
  });

  it("is empty and honest for a store with no orders", async () => {
    const r = await customersReport(empty, SEPTEMBER, SETTINGS, NOW);
    expect(r.customers).toBe(0);
    expect(r.newVsReturning).toMatchObject({ newCustomers: 0, returningCustomers: 0, returningShare: null });
    expect(r.repeatRates.map((x) => [x.base, x.rate])).toEqual([[0, null], [0, null], [0, null], [0, null]]);
    expect(r.frequency.perCustomer).toBeNull();
    expect(r.cohorts.rows).toEqual([]);
    expect(r.topCustomers).toEqual([]);
    expect(r.segments).toMatchObject({ enough: false, customers: 0 });
  });
});
