import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
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

const { refundsReport, normaliseReason, TOP_REASONS, NOT_SEEN_NOTE } = await import("./analytics-refunds-data");

/**
 * The refunds drill-down (D152, docs/analytics.md) against a small hand-made shop. NOK minor units (the main currency) without VAT
 * unless a comment says otherwise; EUR is 1 EUR = 10 NOK, SEK has no rate; Europe/Oslo. VAT: 25 % on mugs, 15 % on totes.
 *
 * Orders (placed in September 2026 unless said), then refunds, each scaled to without VAT by its order's (total - tax) / total:
 *
 *   R0  08-20 Anna (account)  1 mug                                  her first order: earlier than the period, so she is returning
 *   R9  08-25 Kari (guest)    1 tote 57.50, total 5750 rev 5000      an August order: not in the cohort, its refund counts in September
 *   R1  09-02 Anna            1 mug 100.00 + 1 tote 57.50 = 157.50, rev 13000
 *   R2  09-03 Gus (guest)     2 totes = 115.00, rev 10000
 *   R3  09-04 Eva (guest)     EUR, market SE, 1 mug 100.00, rev 8000 EUR-minor (80000 NOK-minor)
 *   R4  09-05 nobody          no email on the order, 1 mug 100.00, rev 8000 (cancelled but paid)
 *   R5  09-06 Sven            SEK, a paid order in a currency with no rate
 *   R6  09-03 a host's order  paid, never counts
 *   R10 09-10 Lena, R11 09-11 Nils, R13 09-13 Ola    1 mug each, rev 8000
 *   R12 09-12 Tove            1 mug, rev 8000
 *
 *   A  R1  09-05  78.75   "Damaged item"        value 7875 x 13000/15750 = 6500: mug 4000, tote 2500; restocked 1 mug
 *   B  R2  09-10  57.50   "damaged item "       5750 x 10000/11500 = 5000 (tote); restocked 2 totes
 *   C  R2  09-12  11.50   "Changed my mind."    1000
 *   D  R3  09-15  50.00 EUR  "Wrong size"       4000 EUR-minor = 40000 NOK-minor (mug)
 *   E  R4  09-20  100.00  "   " (blank)         8000 (mug); restocked 1 mug
 *   H  R9  09-02  28.75   "DAMAGED   ITEM"      2875 x 5000/5750 = 2500 (tote; the order is from August)
 *   T1-T6 R12 09-14..09-19  1.00 each, "tiny 1".."tiny 6"   value 80 each (mug), 480 in all
 *   F  R5  SEK, never counts and is counted as left out;  G  the host's order, never counts
 *   X  a failed and a pending refund on R1, never count;  Z  R10's refund dated 3 October: not in the period, but R10 is in its cohort
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
const storeOf = (id: string, slug: string) => ({ id, slug, timeZone: "Europe/Oslo", markets: [no], localization }) as unknown as Store;

let store: Store;
let other: Store;
const variants: Record<string, Record<string, string>> = {};
const products: Record<string, string> = {};
let serial = 0;

type Line = { sku: "DEMO-MUG-WHITE" | "DEMO-TOTE" | "SIGNUP-FEE"; qty: number; unit: number; rate: number };
const MUG = { sku: "DEMO-MUG-WHITE", rate: 0.25 } as const;
const TOTE = { sku: "DEMO-TOTE", rate: 0.15 } as const;
const taxOf = (amount: number, rate: number) => amount - Math.round(amount / (1 + rate));

async function order(
  s: Store,
  o: { at: string; email: string; lines: Line[]; customer?: string; currency?: string; market?: string; status?: string; host?: string },
): Promise<{ orderId: string; paymentId: string }> {
  serial += 1;
  const currency = o.currency ?? "NOK";
  const lines = o.lines.map((l) => ({ ...l, total: l.unit * l.qty, tax: taxOf(l.unit * l.qty, l.rate) }));
  const total = lines.reduce((a, l) => a + l.total, 0);
  const tax = lines.reduce((a, l) => a + l.tax, 0);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, customer_id, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, host_id)
    values (${s.id}::uuid, ${`RF-${run}-${serial}`}, ${o.market ?? "NO"}, ${currency}, 'nb-NO', ${o.customer ?? null}, ${o.email}, ${o.status ?? "paid"},
      ${total}, 0, 0, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, ${o.host ?? null})
    returning id
  `);
  for (const l of lines) {
    await db().execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${s.id}::uuid, ${String(row.id)}::uuid, ${l.sku === "SIGNUP-FEE" ? null : variants[s.id][l.sku]}, ${l.sku}, ${l.sku}, ${l.qty}, ${l.unit}, 0,
        ${l.total}, ${l.tax}, ${l.rate}, 'txcd_99999999', 'physical'::commerce.delivery)
    `);
  }
  const [payment] = await db().execute<Row>(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${s.id}::uuid, ${String(row.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_refunds', ${total}, ${currency}, 'captured'::commerce.payment_status)
    returning id
  `);
  return { orderId: String(row.id), paymentId: String(payment.id) };
}

async function refund(s: Store, paymentId: string, amount: number, at: string, reason: string, extra: { status?: string; restocked?: { sku: string; quantity: number }[] } = {}) {
  serial += 1;
  await db().execute(sql`
    insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, restocked, created_at)
    values (${s.id}::uuid, ${paymentId}::uuid, ${amount}, ${reason}, ${`re_${run}_${serial}`}, ${extra.status ?? "succeeded"}::commerce.refund_status,
      ${JSON.stringify(extra.restocked ?? [])}::jsonb, ${at}::timestamptz)
  `);
}

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

const PERIOD = customPeriod("2026-09-01", "2026-09-30");

beforeAll(async () => {
  const id = await makeStore(`refunds-${run}`);
  const otherId = await makeStore(`refunds-other-${run}`);
  store = storeOf(id, `refunds-${run}`);
  other = storeOf(otherId, `refunds-other-${run}`);
  for (const storeId of [id, otherId]) {
    variants[storeId] = {};
    for (const row of await db().execute<Row>(sql`select sku, id, product_id from commerce.product_variants where store_id = ${storeId}::uuid`)) {
      variants[storeId][String(row.sku)] = String(row.id);
      if (storeId === id) products[String(row.sku)] = String(row.product_id);
    }
  }
  const [anna] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${id}::uuid, 'anna@example.com') returning id`);
  const annaId = String(anna.id);

  await order(store, { at: "2026-08-20T12:00:00+02:00", email: "anna.other@example.com", customer: annaId, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  const r9 = await order(store, { at: "2026-08-25T12:00:00+02:00", email: "kari@example.com", lines: [{ ...TOTE, qty: 1, unit: 5_750 }] });
  const r1 = await order(store, { at: "2026-09-02T12:00:00+02:00", email: "anna.other@example.com", customer: annaId, lines: [{ ...MUG, qty: 1, unit: 10_000 }, { ...TOTE, qty: 1, unit: 5_750 }] });
  const r2 = await order(store, { at: "2026-09-03T12:00:00+02:00", email: "Gus@Example.com", lines: [{ ...TOTE, qty: 2, unit: 5_750 }] });
  const r3 = await order(store, { at: "2026-09-04T12:00:00+02:00", email: "eva@example.com", currency: "EUR", market: "SE", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  const r4 = await order(store, { at: "2026-09-05T12:00:00+02:00", email: "", status: "cancelled", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  const r5 = await order(store, { at: "2026-09-06T12:00:00+02:00", email: "sven@example.com", currency: "SEK", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-refunds-${run}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${id}::uuid, ${String(account.id)}::uuid, 'Host') returning id`);
  const r6 = await order(store, { at: "2026-09-03T13:00:00+02:00", email: "host-guest@example.com", host: String(host.id), lines: [{ ...MUG, qty: 2, unit: 10_000 }] });
  const r10 = await order(store, { at: "2026-09-10T12:00:00+02:00", email: "lena@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await order(store, { at: "2026-09-11T12:00:00+02:00", email: "nils@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  const r12 = await order(store, { at: "2026-09-12T12:00:00+02:00", email: "tove@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await order(store, { at: "2026-09-13T12:00:00+02:00", email: "ola@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });

  await refund(store, r1.paymentId, 7_875, "2026-09-05T10:00:00+02:00", "Damaged item", { restocked: [{ sku: "DEMO-MUG-WHITE", quantity: 1 }] });
  await refund(store, r2.paymentId, 5_750, "2026-09-10T10:00:00+02:00", "damaged item ", { restocked: [{ sku: "DEMO-TOTE", quantity: 2 }] });
  await refund(store, r2.paymentId, 1_150, "2026-09-12T10:00:00+02:00", "Changed my mind.");
  await refund(store, r3.paymentId, 5_000, "2026-09-15T10:00:00+02:00", "Wrong size");
  await refund(store, r4.paymentId, 10_000, "2026-09-20T10:00:00+02:00", "   ", { restocked: [{ sku: "DEMO-MUG-WHITE", quantity: 1 }] });
  await refund(store, r9.paymentId, 2_875, "2026-09-02T10:00:00+02:00", "DAMAGED   ITEM");
  for (let i = 1; i <= 6; i++) await refund(store, r12.paymentId, 100, `2026-09-${13 + i}T10:00:00+02:00`, `tiny ${i}`);
  await refund(store, r5.paymentId, 2_500, "2026-09-08T10:00:00+02:00", "No rate for this currency");
  await refund(store, r6.paymentId, 5_000, "2026-09-09T10:00:00+02:00", "Host's order");
  await refund(store, r1.paymentId, 1_000, "2026-09-06T10:00:00+02:00", "failed one", { status: "failed" });
  await refund(store, r1.paymentId, 1_000, "2026-09-06T11:00:00+02:00", "pending one", { status: "pending" });
  await refund(store, r10.paymentId, 3_000, "2026-10-03T10:00:00+02:00", "Late");

  // Another store: a sign-up fee (no product) refunded in the same days; nothing of it may reach the first store.
  const fee = await order(other, { at: "2026-09-04T12:00:00+02:00", email: "fee@example.com", lines: [{ sku: "SIGNUP-FEE", qty: 1, unit: 5_000, rate: 0.25 }] });
  await refund(other, fee.paymentId, 2_500, "2026-09-08T10:00:00+02:00", "Fee waived");
});

afterAll(async () => {
  await closeDb();
});

describe("normaliseReason", () => {
  it("trims, lower-cases, collapses spaces and drops closing punctuation", () => {
    expect(normaliseReason("  Damaged   Item. ")).toBe("damaged item");
    expect(normaliseReason("DAMAGED\tITEM")).toBe("damaged item");
    expect(normaliseReason("Changed my mind!!")).toBe("changed my mind");
    expect(normaliseReason("   ")).toBe("");
    expect(normaliseReason(null)).toBe("");
    expect(normaliseReason("x".repeat(200))).toHaveLength(80);
  });
});

describe("refundsReport: the period", () => {
  it("counts succeeded refunds by their own date, without VAT, in the main currency", async () => {
    const r = await refundsReport(store, PERIOD);
    expect(r.currency).toBe("NOK");
    // A 6500 + B 5000 + C 1000 + D 40000 + E 8000 + H 2500 + 6 x 80; not F (SEK), G (host), the failed and pending ones, nor Z (October).
    expect(r.refundsMinor).toBe(6_500 + 5_000 + 1_000 + 40_000 + 8_000 + 2_500 + 480);
    expect(r.refundsMinor).toBe(63_480);
    expect(r.refunds).toBe(12);
    // R1, R2 (two refunds), R3, R4, R9 (an August order), R12 (six refunds).
    expect(r.refundedOrders).toBe(6);
    expect(r.notSeen).toBe(true);
    expect(r.notSeenNote).toBe(NOT_SEEN_NOTE);
    expect(r.unconverted).toBe(1);
    expect(r.missingRates).toEqual(["SEK"]);
    expect(r.notes.join(" ")).toMatch(/SEK/);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("sets them against the period's revenue, and gives the share of orders with a refund as a cohort", async () => {
    const r = await refundsReport(store, PERIOD);
    // Paid orders placed in the period, in a currency with a rate: R1 13000, R2 10000, R3 80000, R4, R10, R11, R12, R13 8000 each = 8 orders.
    expect(r.orders).toBe(8);
    expect(r.revenueMinor).toBe(13_000 + 10_000 + 80_000 + 5 * 8_000);
    expect(r.refundRate).toBeCloseTo(63_480 / 143_000, 10);
    // Of them R1, R2, R3, R4, R12 were refunded in the period and R10 in October: 6 of 8. R9 and R0 are August orders.
    expect(r.cohort).toEqual({ orders: 8, refundedOrders: 6, share: 0.75 });
  });

  it("groups the reasons as written, top eight with the rest as other", async () => {
    const r = await refundsReport(store, PERIOD);
    expect(TOP_REASONS).toBe(8);
    // Wrong size 40000; damaged item (three spellings) 6500 + 5000 + 2500; no reason 8000; changed my mind 1000; six tiny ones at 80.
    expect(r.reasons.map((x) => [x.reason, x.refunds, x.valueMinor])).toEqual([
      ["wrong size", 1, 40_000],
      ["damaged item", 3, 14_000],
      ["", 1, 8_000],
      ["changed my mind", 1, 1_000],
      ["tiny 1", 1, 80],
      ["tiny 2", 1, 80],
      ["tiny 3", 1, 80],
      ["tiny 4", 1, 80],
    ]);
    expect(r.reasons.map((x) => x.label).slice(0, 3)).toEqual(["Wrong size", "Damaged item", "No reason given"]);
    expect(r.reasons[0].share).toBeCloseTo(40_000 / 63_480, 10);
    expect(r.other).toEqual({ reasons: 2, refunds: 2, valueMinor: 160 });
    // Nothing is lost: the listed reasons and the rest are the refunds.
    expect(r.reasons.reduce((a, x) => a + x.valueMinor, 0) + r.other.valueMinor).toBe(r.refundsMinor);
    expect(r.reasons.reduce((a, x) => a + x.refunds, 0) + r.other.refunds).toBe(r.refunds);
  });

  it("shares each refund over its lines by what they sold for, so the products add up to the refunds", async () => {
    const r = await refundsReport(store, PERIOD);
    // Mug: A 4000 + D 40000 + E 8000 + 480; tote: A 2500 + B 5000 + C 1000 + H 2500.
    expect(r.products.map((p) => [p.productId, p.valueMinor, p.refunds, p.restockedUnits])).toEqual([
      [products["DEMO-MUG-WHITE"], 52_480, 9, 2],
      [products["DEMO-TOTE"], 11_000, 4, 2],
    ]);
    expect(r.productCount).toBe(2);
    expect(r.productsTruncated).toBe(false);
    expect(r.products.reduce((a, p) => a + p.valueMinor, 0)).toBe(r.refundsMinor);
    expect(r.products.every((p) => p.name.length > 0 && !/^[0-9a-f-]{36}$/.test(p.name))).toBe(true);
    expect(r.products[0].share).toBeCloseTo(52_480 / 63_480, 10);
  });

  it("splits them by new and returning customers, and keeps an order with no customer apart", async () => {
    const r = await refundsReport(store, PERIOD);
    const by = Object.fromEntries(r.segments.map((s) => [s.segment, [s.refunds, s.orders, s.valueMinor]]));
    // New (first paid order in the period): Gus' B and C (one order), Eva's D, Tove's six. Returning: Anna (R0 in August) and Kari (August).
    expect(by).toEqual({ new: [9, 3, 46_480], returning: [2, 2, 9_000], unknown: [1, 1, 8_000] });
    expect(r.segments.reduce((a, s) => a + s.valueMinor, 0)).toBe(r.refundsMinor);
    expect(r.segments.reduce((a, s) => a + s.refunds, 0)).toBe(r.refunds);
  });

  it("splits them by market with each market's own rate", async () => {
    const r = await refundsReport(store, PERIOD);
    // Norway: 63480 - 40000 = 23480 on revenue 13000 + 10000 + 5 x 8000 = 63000; Sweden: Eva's 40000 on 80000.
    expect(r.markets.map((m) => [m.market, m.refunds, m.orders, m.valueMinor, m.revenueMinor])).toEqual([
      ["SE", 1, 1, 40_000, 80_000],
      ["NO", 11, 5, 23_480, 63_000],
    ]);
    expect(r.markets[0].rate).toBeCloseTo(0.5, 10);
    expect(r.markets[1].rate).toBeCloseTo(23_480 / 63_000, 10);
    expect(r.markets.reduce((a, m) => a + m.valueMinor, 0)).toBe(r.refundsMinor);
  });

  it("reaches the same refunds as the totals module", async () => {
    // The Finance page's refunds are the same definition: succeeded, by their own date, scaled by (total - tax) / total.
    const { periodTotals } = await import("./analytics-totals");
    const { totals } = await periodTotals(store, PERIOD);
    const r = await refundsReport(store, PERIOD);
    expect(r.refundsMinor).toBe(totals.refundsMinor);
  });

  it("has no refunds and no made-up rate for a period without any", async () => {
    const r = await refundsReport(store, customPeriod("2024-01-01", "2024-01-31"));
    expect(r).toMatchObject({ refundsMinor: 0, refunds: 0, refundedOrders: 0, revenueMinor: 0, orders: 0, refundRate: null, productCount: 0, reasons: [], products: [], markets: [] });
    expect(r.cohort).toEqual({ orders: 0, refundedOrders: 0, share: null });
    expect(r.segments.every((s) => s.share === null && s.valueMinor === 0)).toBe(true);
    expect(r.notSeen).toBe(true);
  });

  it("counts a refund on the day it was made, in the store's own days", async () => {
    const day = await refundsReport(store, customPeriod("2026-09-05", "2026-09-05"));
    // Only A (09-05 10:00 Oslo) is made that day.
    expect([day.refunds, day.refundsMinor]).toEqual([1, 6_500]);
    const october = await refundsReport(store, customPeriod("2026-10-03", "2026-10-03"));
    // Z: 30.00 on R10 (rev 8000 of 10000): 2400.
    expect([october.refunds, october.refundsMinor]).toEqual([1, 2_400]);
  });
});

describe("refundsReport: isolation", () => {
  it("never reaches another store's refunds, and a line with no product is its own row", async () => {
    const r = await refundsReport(other, PERIOD);
    // 25.00 of a 50.00 sign-up fee (VAT 25 %: 4000 without): 2000.
    expect(r.refundsMinor).toBe(2_000);
    expect(r.refunds).toBe(1);
    expect(r.products).toEqual([{ productId: null, name: "No product", valueMinor: 2_000, refunds: 1, restockedUnits: 0, share: 1 }]);
    expect(r.reasons.map((x) => x.reason)).toEqual(["fee waived"]);
    expect((await refundsReport(store, PERIOD)).refunds).toBe(12);
  });
});
