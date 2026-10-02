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

const { productsReport, OTHER_ID } = await import("./analytics-products-data");
const { periodTotals } = await import("./analytics-totals");

/**
 * The Products page's figures (D152, docs/analytics.md) against a small hand-made shop. Money in NOK minor units (the main
 * currency) without VAT, EUR at 1 EUR = 10 NOK, SEK with no rate, Europe/Oslo (UTC+2 in September). The period is 1-7 September;
 * the comparison the seven days before.
 *
 *   id    day        what                                                                      counts?
 *   P1    08-27      1 mug 50.00 (cost 30.00)                                                   previous period; refunded 25.00 on 09-03
 *   P2    08-28      1 tote 57.50 (cost unknown)                                                previous period
 *   A9    09-01      1 mug 100.00 (cost 30.00)                                                  yes (before the first counted view day)
 *   A1    09-02      2 mugs 200.00 less 20.00, 1 tote 57.50 (cost unknown), 49.00 shipping       yes
 *   A6    09-02      1 mug 100.00, free shipping                                                yes
 *   A2    09-03      EUR: 1 mug 100.00 less 10.00, 12.50 shipping                               yes, converted
 *   A3    09-04      SEK: 1 mug 100.00; a SEK refund                                            left out, counted
 *   A10   09-04      1 unit of a product with no translation and no cost, 25.00                  yes
 *   A4    09-05      a sign-up fee 50.00 (no variant), cancelled; refunded in full on 09-06      yes, "Other lines"
 *   A5    09-06      3 totes 172.50 (cost 10.00 each) and 1 notebook 125.00 (cost 12.00);        yes
 *                    57.50 refunded on 09-07 (and 10.00 that failed)
 *   A7    09-07 23:30  1 mug 100.00                                                           yes (last minute of the last day)
 *   host, copied, unpaid, 09-08 00:30                                                           never
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

type Sku = "DEMO-MUG-WHITE" | "DEMO-TOTE" | "DEMO-NOTEBOOK-LINED" | "SIGNUP-FEE" | "NO-TITLE";
type Line = { sku: Sku; qty: number; unit: number; discount?: number; rate: number; cost?: number | null; delivery?: "physical" | "service" };

const taxOf = (amount: number, rate: number) => amount - Math.round(amount / (1 + rate));

async function placeOrder(
  s: Store,
  o: { currency?: string; at: string; email: string; status?: string; lines: Line[]; shipping?: number; shippingDiscount?: number; payment?: { status?: string } | null; host?: string | null; copied?: boolean },
): Promise<{ orderId: string; paymentId: string | null }> {
  serial += 1;
  const currency = o.currency ?? "NOK";
  const lines = o.lines.map((l) => {
    const total = l.unit * l.qty - (l.discount ?? 0);
    return { ...l, total, tax: taxOf(total, l.rate) };
  });
  const shipping = o.shipping ?? 0;
  const shippingDiscount = o.shippingDiscount ?? 0;
  const subtotal = lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  const discount = lines.reduce((sum, l) => sum + (l.discount ?? 0), 0) + shippingDiscount;
  const tax = lines.reduce((sum, l) => sum + l.tax, 0) + taxOf(shipping - shippingDiscount, 0.25);
  const total = subtotal + shipping - discount;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
      discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, host_id, copied_from)
    values (${s.id}::uuid, ${o.copied ? `C-${run}-${serial}` : `T-${run}-${serial}`}, 'NO', ${currency}, 'nb-NO', ${o.email}, ${o.status ?? "paid"},
      ${subtotal}, ${shipping}, ${discount}, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, ${o.host ?? null},
      ${o.copied ? crypto.randomUUID() : null})
    returning id
  `);
  const orderId = String(order.id);
  const insertLines = async (runner: Pick<ReturnType<typeof db>, "execute">) => {
    for (const l of lines) {
      await runner.execute(sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor,
          total_minor, tax_minor, tax_rate, tax_code, delivery)
        values (${s.id}::uuid, ${orderId}::uuid, ${l.sku === "SIGNUP-FEE" ? null : variants[s.id][l.sku]}, ${l.sku}, ${l.sku}, ${l.qty}, ${l.unit}, ${l.cost ?? null},
          ${l.discount ?? 0}, ${l.total}, ${l.tax}, ${l.rate}, 'txcd_99999999', ${l.delivery ?? "physical"}::commerce.delivery)
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
  let paymentId: string | null = null;
  if (o.payment !== null && !o.copied) {
    const [payment] = await db().execute<Row>(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${s.id}::uuid, ${orderId}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_products', ${total}, ${currency}, ${o.payment?.status ?? "captured"}::commerce.payment_status)
      returning id
    `);
    paymentId = String(payment.id);
  }
  return { orderId, paymentId };
}

async function refund(s: Store, paymentId: string, amount: number, at: string, status = "succeeded") {
  serial += 1;
  await db().execute(sql`
    insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, created_at)
    values (${s.id}::uuid, ${paymentId}::uuid, ${amount}, 'test', ${`re_${run}_${serial}`}, ${status}::commerce.refund_status, ${at}::timestamptz)
  `);
}

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

const PERIOD = customPeriod("2026-09-01", "2026-09-07");
const BEFORE = customPeriod("2026-08-25", "2026-08-31");
const MUG = { sku: "DEMO-MUG-WHITE", rate: 0.25, cost: 3_000 } as const;
const TOTE = { sku: "DEMO-TOTE", rate: 0.15 } as const;
const NOTEBOOK = { sku: "DEMO-NOTEBOOK-LINED", rate: 0.25, cost: 1_200 } as const;

beforeAll(async () => {
  const id = await makeStore(`prodrep-${run}`);
  const otherId = await makeStore(`prodrep-other-${run}`);
  store = storeOf(id, `prodrep-${run}`);
  other = storeOf(otherId, `prodrep-other-${run}`);
  for (const storeId of [id, otherId]) {
    variants[storeId] = {};
    for (const row of await db().execute<Row>(sql`select sku, id, product_id from commerce.product_variants where store_id = ${storeId}::uuid`)) {
      variants[storeId][String(row.sku)] = String(row.id);
      if (storeId === id) products[String(row.sku)] = String(row.product_id);
    }
  }

  // A product with no translation (its handle is its name) and no cost.
  const [product] = await db().execute<Row>(sql`
    insert into commerce.products (store_id, handle, tax_code, status) values (${id}::uuid, 'no-title', 'txcd_99999999', 'draft') returning id
  `);
  const [variant] = await db().execute<Row>(sql`
    insert into commerce.product_variants (store_id, product_id, sku) values (${id}::uuid, ${String(product.id)}::uuid, 'NO-TITLE') returning id
  `);
  variants[id]["NO-TITLE"] = String(variant.id);
  products["NO-TITLE"] = String(product.id);

  // Before the period: P1 (refunded in the period) and P2.
  const p1 = await placeOrder(store, { at: "2026-08-27T12:00:00+02:00", email: "a@example.com", lines: [{ ...MUG, qty: 1, unit: 5_000 }] });
  await placeOrder(store, { at: "2026-08-28T12:00:00+02:00", email: "b@example.com", lines: [{ ...TOTE, qty: 1, unit: 5_750 }] });
  // 25.00 of P1 (total 50.00, 40.00 without VAT) comes back on 09-03: 20.00 without VAT, all of it the mug's.
  await refund(store, p1.paymentId!, 2_500, "2026-09-03T10:00:00+02:00");

  await placeOrder(store, { at: "2026-09-01T12:00:00+02:00", email: "c@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await placeOrder(store, {
    at: "2026-09-02T10:00:00+02:00",
    email: "d@example.com",
    shipping: 4_900,
    lines: [
      { ...MUG, qty: 2, unit: 10_000, discount: 2_000 },
      { ...TOTE, qty: 1, unit: 5_750 },
    ],
  });
  await placeOrder(store, { at: "2026-09-02T15:00:00+02:00", email: "e@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await placeOrder(store, { currency: "EUR", at: "2026-09-03T12:00:00+02:00", email: "f@example.com", shipping: 1_250, lines: [{ ...MUG, qty: 1, unit: 10_000, discount: 1_000 }] });
  const sek = await placeOrder(store, { currency: "SEK", at: "2026-09-04T12:00:00+02:00", email: "g@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await refund(store, sek.paymentId!, 2_000, "2026-09-04T13:00:00+02:00");
  await placeOrder(store, { at: "2026-09-04T14:00:00+02:00", email: "h@example.com", lines: [{ sku: "NO-TITLE", qty: 1, unit: 2_500, rate: 0.25 }] });
  const fee = await placeOrder(store, {
    at: "2026-09-05T09:00:00+02:00",
    email: "i@example.com",
    status: "cancelled",
    lines: [{ sku: "SIGNUP-FEE", qty: 1, unit: 5_000, rate: 0.25, delivery: "service" }],
  });
  await refund(store, fee.paymentId!, 5_000, "2026-09-06T15:00:00+02:00");
  // Two lines in one order: 57.50 comes back, which is 48.32 without VAT (25000 / 29750 of it), shared 15000 : 10000.
  const a5 = await placeOrder(store, {
    at: "2026-09-06T11:00:00+02:00",
    email: "j@example.com",
    lines: [
      { ...TOTE, qty: 3, unit: 5_750, cost: 1_000 },
      { ...NOTEBOOK, qty: 1, unit: 12_500 },
    ],
  });
  await refund(store, a5.paymentId!, 5_750, "2026-09-07T15:00:00+02:00");
  await refund(store, a5.paymentId!, 1_000, "2026-09-07T16:00:00+02:00", "failed");
  await refund(store, a5.paymentId!, 1_000, "2026-09-07T17:00:00+02:00", "pending");
  await placeOrder(store, { at: "2026-09-07T23:30:00+02:00", email: "k@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });

  // Never counted: a host's order (and its refund), a copied order, an unpaid one, one after the period.
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-prod-${run}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${id}::uuid, ${String(account.id)}::uuid, 'Host') returning id`);
  const hosted = await placeOrder(store, { at: "2026-09-03T13:00:00+02:00", email: "host-guest@example.com", host: String(host.id), lines: [{ ...MUG, qty: 4, unit: 10_000 }] });
  await refund(store, hosted.paymentId!, 10_000, "2026-09-04T10:00:00+02:00");
  await placeOrder(store, { at: "2026-09-03T14:00:00+02:00", email: "copied@example.com", copied: true, lines: [{ ...MUG, qty: 3, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-03T15:00:00+02:00", email: "pia@example.com", status: "pending_payment", payment: { status: "pending" }, lines: [{ ...MUG, qty: 2, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-08T00:30:00+02:00", email: "late@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });

  // Product views are counted from 09-02 on: the 09-01 mug order is before the first counted day.
  for (const [day, sku, views] of [
    ["2026-09-02", "DEMO-MUG-WHITE", 100],
    ["2026-09-05", "DEMO-MUG-WHITE", 50],
    ["2026-09-03", "DEMO-TOTE", 40],
  ] as const) {
    await db().execute(sql`insert into commerce.product_views (store_id, day, product_id, views) values (${id}::uuid, ${day}::date, ${products[sku]}::uuid, ${views})`);
  }

  // Another store, with a sale in the same days: nothing of it may reach the first.
  await placeOrder(other, { at: "2026-09-02T10:00:00+02:00", email: "elsewhere@example.com", lines: [{ ...TOTE, qty: 9, unit: 5_750 }] });
});

afterAll(async () => {
  await closeDb();
});

describe("productsReport", () => {
  it("adds up each product's lines of paid orders, without VAT, in the main currency", async () => {
    const report = await productsReport(store, PERIOD, BEFORE);
    expect(report.currency).toBe("NOK");
    // Ranked by revenue. Mug: A9 8000 + A1 14400 + A6 8000 + A2 (7200 EUR-minor) 72000 + A7 8000; the SEK order is left out.
    // Tote: A1 5000 + A5 15000. Notebook: A5 10000. Other lines: the sign-up fee 4000. No title: 2000.
    expect(report.rows.map((r) => [r.productId, r.revenueMinor])).toEqual([
      [products["DEMO-MUG-WHITE"], 110_400],
      [products["DEMO-TOTE"], 20_000],
      [products["DEMO-NOTEBOOK-LINED"], 10_000],
      [OTHER_ID, 4_000],
      [products["NO-TITLE"], 2_000],
    ]);
    expect(report.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    // Units of goods: mug 1 + 2 + 1 + 1 + 1 = 6, tote 1 + 3, notebook 1, the fee none (it has no variant), no title 1.
    expect(report.rows.map((r) => r.units)).toEqual([6, 4, 1, 0, 1]);
    // Paid orders with a line of the product: the mug is in five, the tote in two.
    expect(report.rows.map((r) => r.orders)).toEqual([5, 2, 1, 1, 1]);
    // Costs kept on the lines in the main currency, never converted (the euro sale's mug cost 30.00 NOK): 6 x 30.00; 3 x 10.00; 12.00; the fee's known 0; none.
    expect(report.rows.map((r) => r.cogsMinor)).toEqual([18_000, 3_000, 1_200, 0, null]);
    // The part of revenue whose cost is known: all but the tote's 5000 in A1 and the product with no cost at all.
    expect(report.rows.map((r) => r.knownCostRevenueMinor)).toEqual([110_400, 15_000, 10_000, 4_000, 0]);
    expect(report.rows.map((r) => r.costCoverage)).toEqual([1, 0.75, 1, 1, 0]);
    expect(report.rows.map((r) => r.unitsPerDay)).toEqual([6 / 7, 4 / 7, 1 / 7, 0, 1 / 7]);
    expect(report.totals).toMatchObject({ revenueMinor: 146_400, units: 12, cogsMinor: 22_200 });
    expect(report.costCoverage).toBeCloseTo(139_400 / 146_400, 10);
  });

  it("splits refunds, dated by their own date, over the lines of their order", async () => {
    const report = await productsReport(store, PERIOD, BEFORE);
    const byId = new Map(report.rows.map((r) => [r.productId, r]));
    // The mug: 20.00 of P1 (placed before the period, refunded in it). The host order's refund and the SEK refund are not counted.
    expect(byId.get(products["DEMO-MUG-WHITE"])!.refundsMinor).toBe(2_000);
    // The sign-up fee: 50.00 less its VAT is 40.00, all of it the only line's.
    expect(byId.get(OTHER_ID)!.refundsMinor).toBe(4_000);
    // A5: 5750 x 25000 / 29750 = 4831.93 -> 4832 without VAT, shared 15000 : 10000 = 2899.2 : 1932.8, the spare unit to the larger remainder.
    expect(byId.get(products["DEMO-TOTE"])!.refundsMinor).toBe(2_899);
    expect(byId.get(products["DEMO-NOTEBOOK-LINED"])!.refundsMinor).toBe(1_933);
    expect(byId.get(products["NO-TITLE"])!.refundsMinor).toBe(0);
    expect(report.totals.refundsMinor).toBe(2_000 + 4_000 + 4_832);
    // The failed and the pending refund are not refunds.
    // Net revenue, profit (where a cost is known) and the rates the table works out.
    const mug = byId.get(products["DEMO-MUG-WHITE"])!;
    expect(mug.netRevenueMinor).toBe(108_400);
    expect(mug.profitMinor).toBe(110_400 - 2_000 - 18_000);
    expect(mug.margin).toBeCloseTo(90_400 / 108_400, 10);
    expect(mug.refundRate).toBeCloseTo(2_000 / 110_400, 10);
    expect(byId.get(products["DEMO-TOTE"])!.profitMinor).toBe(20_000 - 2_899 - 3_000);
    // No cost known at all: no profit, never a made-up one.
    expect(byId.get(products["NO-TITLE"])!.profitMinor).toBeNull();
    expect(byId.get(products["NO-TITLE"])!.margin).toBeNull();
    expect(report.totals.profitMinor).toBe(90_400 + 14_101 + 6_867 + 0);
  });

  it("agrees with the period's totals: product revenue + shipping income = revenue, refunds and units as the overview has them", async () => {
    const report = await productsReport(store, PERIOD, BEFORE);
    // Revenue of the paid orders: A9 8000, A1 23320, A6 8000, A2 82000, A10 2000, A4 4000, A5 25000, A7 8000.
    expect(report.reconciliation).toEqual({ revenueMinor: 160_320, shippingMinor: 13_920, linesMinor: 146_400, differenceMinor: 0, orders: 8 });
    expect(report.reconciliation.linesMinor + report.reconciliation.shippingMinor).toBe(report.reconciliation.revenueMinor);
    expect(report.shareOfRevenue).toBeCloseTo(146_400 / 160_320, 10);

    const { totals } = await periodTotals(store, PERIOD);
    expect(report.reconciliation.revenueMinor).toBe(totals.revenueMinor);
    expect(report.reconciliation.shippingMinor).toBe(totals.shippingMinor);
    expect(report.reconciliation.orders).toBe(totals.orders);
    expect(report.totals.refundsMinor).toBe(totals.refundsMinor);
    expect(report.totals.units).toBe(totals.units);
    expect(report.totals.cogsMinor).toBe(totals.cogsMinor);
    expect(report.totals.revenueMinor + report.reconciliation.shippingMinor).toBe(totals.revenueMinor);
  });

  it("counts what it left out for want of a rate, and ignores host, copied, unpaid and later orders", async () => {
    const report = await productsReport(store, PERIOD);
    // The SEK order and the SEK refund.
    expect(report.unconverted).toBe(2);
    expect(report.missingCurrencies).toEqual(["SEK"]);
    expect(report.truncated).toBe(false);
    // 4 mugs of the host, 3 copied, 2 unpaid and 1 later would have added 10 units: none of them did.
    expect(report.rows.find((r) => r.productId === products["DEMO-MUG-WHITE"])!.units).toBe(6);
  });

  it("names a product in the store's main language, its handle when it has no translation, and the rest 'Other lines'", async () => {
    const report = await productsReport(store, PERIOD);
    const byId = new Map(report.rows.map((r) => [r.productId, r]));
    expect(byId.get(products["DEMO-MUG-WHITE"])).toMatchObject({ name: "Demo: Keramikkopp", handle: "demo-keramikkopp", other: false });
    expect(byId.get(products["DEMO-TOTE"])!.name).toBe("Demo: Handlenett i lerret");
    expect(byId.get(products["NO-TITLE"])).toMatchObject({ name: "no-title", handle: "no-title" });
    expect(byId.get(OTHER_ID)).toMatchObject({ name: "Other lines", handle: null, other: true });
  });

  it("compares revenue with the previous period, and with nothing", async () => {
    const report = await productsReport(store, PERIOD, BEFORE);
    expect(report.compare).toEqual({ from: "2026-08-25", to: "2026-09-01", days: 7 });
    // Before: P1's mug 4000 (1 unit) and P2's tote 5000 (1 unit).
    expect(report.previous).toEqual({ revenueMinor: 9_000, units: 2 });
    const byId = new Map(report.rows.map((r) => [r.productId, r]));
    const mug = byId.get(products["DEMO-MUG-WHITE"])!;
    expect(mug).toMatchObject({ previousRevenueMinor: 4_000, previousUnits: 1 });
    expect(mug.revenueChange!.abs).toBe(106_400);
    expect(mug.revenueChange!.pct).toBeCloseTo(26.6, 10);
    expect(byId.get(products["DEMO-TOTE"])!.revenueChange).toEqual({ abs: 15_000, pct: 3 });
    // A product that did not sell before has no percentage, only the amount.
    expect(byId.get(products["DEMO-NOTEBOOK-LINED"])).toMatchObject({ previousRevenueMinor: 0, revenueChange: { abs: 10_000, pct: null } });
    expect(report.revenueChange!.abs).toBe(146_400 - 9_000);

    const alone = await productsReport(store, PERIOD);
    expect(alone.compare).toBeNull();
    expect(alone.previous).toBeNull();
    expect(alone.revenueChange).toBeNull();
    expect(alone.rows.every((r) => r.previousRevenueMinor === null && r.revenueChange === null)).toBe(true);
  });

  it("shows views and conversion only where views were counted, and only over the days they were", async () => {
    const report = await productsReport(store, PERIOD);
    expect(report.viewsFrom).toBe("2026-09-02");
    const byId = new Map(report.rows.map((r) => [r.productId, r]));
    // The mug: 150 views from 09-02; its five orders are four from that day (the 09-01 order is before it).
    expect(byId.get(products["DEMO-MUG-WHITE"])).toMatchObject({ views: 150 });
    expect(byId.get(products["DEMO-MUG-WHITE"])!.conversion).toBeCloseTo(4 / 150, 10);
    expect(byId.get(products["DEMO-TOTE"])).toMatchObject({ views: 40 });
    expect(byId.get(products["DEMO-TOTE"])!.conversion).toBeCloseTo(2 / 40, 10);
    // Counting was on and nobody looked at it: zero views, but no conversion out of nothing.
    expect(byId.get(products["DEMO-NOTEBOOK-LINED"])).toMatchObject({ views: 0, conversion: null });
    // Lines with no product have no views.
    expect(byId.get(OTHER_ID)).toMatchObject({ views: null, conversion: null });

    // A period with no counted day: views are unknown, not zero.
    const before = await productsReport(store, BEFORE);
    expect(before.viewsFrom).toBeNull();
    expect(before.rows.every((r) => r.views === null && r.conversion === null)).toBe(true);
  });

  it("works out the Pareto summary over products, leaving out lines that are no product", async () => {
    const report = await productsReport(store, PERIOD);
    // Mug 110400 of 142400 is 77.5 %: short of 80 %, so the tote is needed too. Four products: too few to say it in words.
    expect(report.pareto).toMatchObject({ products: 4, topCount: 2, threshold: 0.8, text: null });
    expect(report.pareto!.revenueShare).toBeCloseTo(130_400 / 142_400, 10);
    // Shares add up to one over the table.
    expect(report.rows.reduce((s, r) => s + (r.revenueShare ?? 0), 0)).toBeCloseTo(1, 10);
    expect(report.rows.at(-1)!.cumulativeShare).toBeCloseTo(1, 10);
  });

  it("never reaches another store, and an empty period is an empty table, not made-up figures", async () => {
    const mine = await productsReport(other, PERIOD, BEFORE);
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0]).toMatchObject({ revenueMinor: 45_000, units: 9, cogsMinor: null, profitMinor: null, views: null });
    expect(mine.reconciliation).toMatchObject({ revenueMinor: 45_000, shippingMinor: 0, differenceMinor: 0 });

    const empty = await productsReport(store, customPeriod("2025-09-01", "2025-09-07"), customPeriod("2025-08-25", "2025-08-31"));
    expect(empty.rows).toEqual([]);
    expect(empty.totals).toMatchObject({ revenueMinor: 0, units: 0, profitMinor: null });
    expect(empty.pareto).toBeNull();
    expect(empty.shareOfRevenue).toBeNull();
    expect(empty.costCoverage).toBeNull();
    expect(empty.unconverted).toBe(0);
  });

  it("counts a period's edges in the store's own days, and keeps a refund with its own day", async () => {
    // The last minute of 07 September in Oslo is in a period ending that day; half an hour later is not.
    const last = await productsReport(store, customPeriod("2026-09-07", "2026-09-07"));
    expect(last.rows.filter((r) => r.revenueMinor > 0).map((r) => [r.productId, r.revenueMinor])).toEqual([[products["DEMO-MUG-WHITE"], 8_000]]);
    // The refund of 09-07 15:00 belongs to that day whatever the order's day: a row with refunds and no sales.
    expect(last.totals.refundsMinor).toBe(4_832);
    const refundOnly = await productsReport(store, customPeriod("2026-09-07", "2026-09-07"));
    const byId = new Map(refundOnly.rows.map((r) => [r.productId, r]));
    expect(byId.get(products["DEMO-TOTE"])).toMatchObject({ revenueMinor: 0, units: 0, refundsMinor: 2_899, name: "Demo: Handlenett i lerret" });
    expect(byId.get(products["DEMO-NOTEBOOK-LINED"])).toMatchObject({ revenueMinor: 0, refundsMinor: 1_933 });
  });

  it("reads at most its cap of products per currency, best first, and says so", async () => {
    const report = await productsReport(store, PERIOD, null, { productCap: 2 });
    expect(report.truncated).toBe(true);
    // In kroner the mug (38400) and the tote (20000) lead; the euro group holds the mug alone.
    expect(report.rows.filter((r) => r.revenueMinor > 0).map((r) => r.productId)).toEqual([products["DEMO-MUG-WHITE"], products["DEMO-TOTE"]]);
    // What was cut off shows in the reconciliation instead of vanishing.
    expect(report.reconciliation.differenceMinor).toBe(160_320 - 13_920 - report.totals.revenueMinor);
    expect(report.reconciliation.differenceMinor).toBeGreaterThan(0);
  });

  it("is plain data", async () => {
    const report = await productsReport(store, PERIOD, BEFORE);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe("productsReport: a free-shipping code", () => {
  it("reconciles with the shipping that was charged after the code, and agrees with the Overview's discounts and shipping income", async () => {
    const id = await makeStore(`prodrep-free-${run}`);
    const free = storeOf(id, `prodrep-free-${run}`);
    variants[id] = {};
    for (const row of await db().execute<Row>(sql`select sku, id from commerce.product_variants where store_id = ${id}::uuid`)) variants[id][String(row.sku)] = String(row.id);
    // F1: mug 100.00 and 49.00 shipping, all of it taken off by the code (the order's discount, in no line, and off the shipping's VAT):
    // total 10000, tax 2000. F2: the same without a code: total 14900, tax 2980.
    await placeOrder(free, { at: "2026-09-02T10:00:00+02:00", email: "f1@example.com", shipping: 4_900, shippingDiscount: 4_900, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
    await placeOrder(free, { at: "2026-09-03T10:00:00+02:00", email: "f2@example.com", shipping: 4_900, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });

    const report = await productsReport(free, PERIOD, null);
    // Revenue 8000 + 11920; the lines 8000 + 8000; the shipping in revenue is F2's 3920 alone.
    expect(report.reconciliation).toEqual({ revenueMinor: 19_920, shippingMinor: 3_920, linesMinor: 16_000, differenceMinor: 0, orders: 2 });
    const { totals } = await periodTotals(free, PERIOD);
    // The Overview shows shipping before the code (7840) and the code as a discount (3920): the same 3920 is what revenue holds.
    expect(totals.shippingMinor - totals.discountsMinor).toBe(report.reconciliation.shippingMinor);
    expect(totals.revenueMinor).toBe(report.reconciliation.revenueMinor);
  });
});
