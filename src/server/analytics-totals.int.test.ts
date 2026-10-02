import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { financeStatement } from "@/lib/analytics-finance";
import { coverageText, derive } from "@/lib/analytics-kpi";
import { customPeriod, daysBetween, enumerateBuckets } from "@/lib/analytics-period";
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

const { alignedSpans, overviewData, overviewHead, periodTotals, seriesByBucket, topProducts } = await import("./analytics-totals");
const { getAnalyticsSettings } = await import("./analytics-settings");

/**
 * The analytics totals (D152, docs/analytics.md) against a small hand-made shop. Every figure in the expectations is worked out
 * by hand in the comments, from the orders below: money in NOK minor units (the main currency) without VAT, EUR at 1 EUR =
 * 10 NOK, SEK with no rate, Europe/Oslo (UTC+2 in September).
 *
 *   id    day     who                currency  what                                       in the period?
 *   O0    08-27   Anna (account)     NOK       1 mug 50.00, cost 30.00                     before it (the previous period)
 *   O1    09-02   Anna (account)     NOK       2 mugs (-20.00), 1 tote (cost unknown), +49 shipping
 *   O2    09-02   Gus (guest)        NOK       1 mug 100.00, free shipping
 *   O3    09-03   Eva (guest)        EUR       1 mug 100.00 (-10.00), 12.50 shipping
 *   O4    09-04   Sven (guest)       SEK       a sale in a currency with no rate           left out, counted
 *   O5    09-05   Anna (account)     NOK       a sign-up fee, cancelled and refunded in full   counts, refund 09-06
 *   O6    09-06   GUS (guest)        NOK       3 totes, refunded 57.50 on 09-07            counts
 *   O7    09-03   a host's order     NOK       paid                                         never counts
 *   O8    09-03   a copied order     NOK       history                                      never counts
 *   O9    09-03   Pia                NOK       waiting for payment                         never counts
 *   Bin   09-07 23:30 Kari           NOK       1 mug 100.00                                 counts (the last minute of the last day)
 *   Bout  09-08 00:30 Olav           NOK       1 mug 100.00                                 after the period
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
let ship: Store;
let costless: Store;
let shifted: Store;
const variants: Record<string, Record<string, string>> = {};
let serial = 0;

type Line = { sku: "DEMO-MUG-WHITE" | "DEMO-TOTE" | "SIGNUP-FEE"; qty: number; unit: number; discount?: number; rate: number; cost?: number | null; delivery?: "physical" | "service" };

/** Splits a VAT-inclusive amount into what is left and its VAT, as the checkout does. */
const taxOf = (amount: number, rate: number) => amount - Math.round(amount / (1 + rate));

async function placeOrder(s: Store, o: {
  currency?: string;
  at: string;
  email: string;
  customer?: string | null;
  status?: string;
  lines: Line[];
  shipping?: number;
  /** A free-shipping code: part of the order's discount, in no line's, and off the shipping's VAT (as `placeOrder()` does). */
  shippingDiscount?: number;
  payment?: { status?: string; fee?: number } | null;
  host?: string | null;
  copied?: boolean;
}): Promise<{ orderId: string; paymentId: string | null; total: number }> {
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
    insert into commerce.orders (store_id, number, market_code, currency, locale, customer_id, email, status, subtotal_minor, shipping_minor,
      discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, host_id, copied_from)
    values (${s.id}::uuid, ${o.copied ? `C-${run}-${serial}` : `T-${run}-${serial}`}, 'NO', ${currency}, 'nb-NO', ${o.customer ?? null}, ${o.email}, ${o.status ?? "paid"},
      ${subtotal}, ${shipping}, ${discount}, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, ${o.host ?? null},
      ${o.copied ? crypto.randomUUID() : null})
    returning id
  `);
  const orderId = String(order.id);
  const insertLines = async (run: Pick<ReturnType<typeof db>, "execute">) => {
    for (const l of lines) {
      await run.execute(sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor,
          total_minor, tax_minor, tax_rate, tax_code, delivery)
        values (${s.id}::uuid, ${orderId}::uuid, ${l.sku === "SIGNUP-FEE" ? null : variants[s.id][l.sku]}, ${l.sku}, ${l.sku}, ${l.qty}, ${l.unit}, ${l.cost ?? null},
          ${l.discount ?? 0}, ${l.total}, ${l.tax}, ${l.rate}, 'txcd_99999999', ${l.delivery ?? "physical"}::commerce.delivery)
      `);
    }
  };
  // A copied order's lines are written only the way the store copy does it, with its setting on.
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
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
      values (${s.id}::uuid, ${orderId}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_totals', ${total}, ${o.payment?.fee ?? 0}, ${currency},
        ${o.payment?.status ?? "captured"}::commerce.payment_status)
      returning id
    `);
    paymentId = String(payment.id);
  }
  return { orderId, paymentId, total };
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

const customer = async (s: Store, email: string) => {
  const [row] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${s.id}::uuid, ${email}) returning id`);
  return String(row.id);
};

const PERIOD = customPeriod("2026-09-01", "2026-09-07");
const MUG = { sku: "DEMO-MUG-WHITE", rate: 0.25, cost: 3_000 } as const;
const TOTE = { sku: "DEMO-TOTE", rate: 0.15 } as const;

beforeAll(async () => {
  const id = await makeStore(`totals-${run}`);
  const otherId = await makeStore(`totals-other-${run}`);
  store = storeOf(id, `totals-${run}`);
  other = storeOf(otherId, `totals-other-${run}`);
  ship = storeOf(await makeStore(`totals-ship-${run}`), `totals-ship-${run}`);
  costless = storeOf(await makeStore(`totals-costless-${run}`), `totals-costless-${run}`);
  shifted = storeOf(await makeStore(`totals-shifted-${run}`), `totals-shifted-${run}`);
  for (const storeId of [id, otherId, ship.id, costless.id, shifted.id]) {
    variants[storeId] = {};
    for (const row of await db().execute<Row>(sql`select sku, id from commerce.product_variants where store_id = ${storeId}::uuid`)) variants[storeId][String(row.sku)] = String(row.id);
  }
  await db().execute(sql`
    insert into commerce.analytics_settings (store_id, payment_fee_bps, payment_fee_fixed_minor, shipping_cost_minor, fixed_costs_monthly_minor, ltv_lifespan_years)
    values (${id}::uuid, 200, 100, 2500, 3650000, 3)
  `);

  const anna = await customer(store, "anna@example.com");
  // O0: Anna's first order, in the previous period.
  await placeOrder(store, { at: "2026-08-27T12:00:00+02:00", email: "anna.old@example.com", customer: anna, lines: [{ ...MUG, qty: 1, unit: 5_000 }] });
  // O1: 2 mugs at 100.00 less 20.00, a tote with no known cost, 49.00 shipping.
  await placeOrder(store, {
    at: "2026-09-02T10:00:00+02:00",
    email: "anna.old@example.com",
    customer: anna,
    shipping: 4_900,
    payment: { fee: 300 },
    lines: [
      { ...MUG, qty: 2, unit: 10_000, discount: 2_000 },
      { ...TOTE, qty: 1, unit: 5_750 },
    ],
  });
  // O2: a guest, 1 mug, free shipping.
  await placeOrder(store, { at: "2026-09-02T15:00:00+02:00", email: "Gus@Example.com", payment: { fee: 100 }, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  // O3: Eva pays in euro: 1 mug 100.00 less 10.00, 12.50 shipping; Kaizen took 1.50.
  await placeOrder(store, {
    currency: "EUR",
    at: "2026-09-03T12:00:00+02:00",
    email: "Eva@Example.com",
    shipping: 1_250,
    payment: { fee: 150 },
    lines: [{ ...MUG, qty: 1, unit: 10_000, discount: 1_000 }],
  });
  // O4: Swedish kronor, which the store has no rate for.
  await placeOrder(store, { currency: "SEK", at: "2026-09-04T12:00:00+02:00", email: "sven@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  // O5: a sign-up fee (no variant, not shipped), cancelled and refunded in full on 09-06.
  const o5 = await placeOrder(store, {
    at: "2026-09-05T09:00:00+02:00",
    email: "anna.old@example.com",
    customer: anna,
    status: "cancelled",
    lines: [{ sku: "SIGNUP-FEE", qty: 1, unit: 5_000, rate: 0.25, delivery: "service" }],
  });
  await refund(store, o5.paymentId!, 5_000, "2026-09-06T15:00:00+02:00");
  // O6: 3 totes at 57.50 (cost 10.00 each), the same guest as O2 with another spelling of the email; 57.50 refunded on 09-07, and a refund that failed.
  const o6 = await placeOrder(store, { at: "2026-09-06T11:00:00+02:00", email: "GUS@example.com", lines: [{ ...TOTE, qty: 3, unit: 5_750, cost: 1_000 }] });
  await refund(store, o6.paymentId!, 5_750, "2026-09-07T15:00:00+02:00");
  await refund(store, o6.paymentId!, 1_000, "2026-09-07T16:00:00+02:00", "failed");
  // O7: a host's order, paid. O8: a copied one. O9: waiting for payment.
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-${run}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${id}::uuid, ${String(account.id)}::uuid, 'Host') returning id`);
  await placeOrder(store, { at: "2026-09-03T13:00:00+02:00", email: "host-guest@example.com", host: String(host.id), lines: [{ ...MUG, qty: 4, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-03T14:00:00+02:00", email: "copied@example.com", copied: true, lines: [{ ...MUG, qty: 3, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-03T15:00:00+02:00", email: "pia@example.com", status: "pending_payment", payment: { status: "pending" }, lines: [{ ...MUG, qty: 2, unit: 10_000 }] });
  // The last minute of the last day counts; half an hour later does not.
  await placeOrder(store, { at: "2026-09-07T23:30:00+02:00", email: "kari@example.com", payment: { fee: 100 }, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-08T00:30:00+02:00", email: "olav@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });

  // Marketing spend: 35.00 in the period (30.00 + 5.00 on 09-02), and two days outside it.
  for (const [day, channel, amount] of [
    ["2026-09-02", "paid_search", 3_000],
    ["2026-09-02", "email", 500],
    ["2026-09-08", "paid_search", 999],
    ["2026-08-31", "paid_search", 777],
  ] as const) {
    await db().execute(sql`insert into commerce.marketing_spend (store_id, day, channel, amount_minor) values (${id}::uuid, ${day}::date, ${channel}, ${amount})`);
  }

  // A store whose shoppers used a free-shipping code: S1 mug 100.00 + 49.00 shipping, all of the shipping taken off by the code (the
  // discount is the order's, no line's, and the shipping's VAT is gone with it); S2 the same without a code.
  await placeOrder(ship, { at: "2026-09-02T10:00:00+02:00", email: "s1@example.com", shipping: 4_900, shippingDiscount: 4_900, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await placeOrder(ship, { at: "2026-09-03T10:00:00+02:00", email: "s2@example.com", shipping: 4_900, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  // A store that charges shipping and has entered no product cost at all.
  await placeOrder(costless, { at: "2026-09-02T10:00:00+02:00", email: "c1@example.com", shipping: 4_900, lines: [{ ...MUG, qty: 1, unit: 10_000, cost: null }] });

  // A store for the comparison's alignment (see the last describe): one order in each of two days of the previous period.
  await placeOrder(shifted, { at: "2026-04-02T12:00:00+02:00", email: "p1@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await placeOrder(shifted, { at: "2026-04-05T12:00:00+02:00", email: "p2@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await placeOrder(shifted, { at: "2026-07-02T12:00:00+02:00", email: "p3@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });

  // Another store, with a paid order in the same days and a cost that is not known: nothing of it may reach the first store.
  await placeOrder(other, { at: "2026-09-02T10:00:00+02:00", email: "elsewhere@example.com", lines: [{ ...TOTE, qty: 1, unit: 5_750 }] });
});

afterAll(async () => {
  await closeDb();
});

describe("periodTotals", () => {
  it("adds up the paid orders of the period, in the main currency without VAT", async () => {
    const { totals, unconverted, missingCurrencies } = await periodTotals(store, PERIOD, await getAnalyticsSettings(store.id));
    // Paid orders in the period: O1, O2, O3, O5 (cancelled but paid), O6, Bin = 6. Not O0 (before), O4 (SEK), O7 (host), O8 (copied), O9 (unpaid), Bout.
    expect(totals.orders).toBe(6);
    // Revenue = total - VAT: O1 28650-5330=23320, O2 8000, O3 (10250-2050=8200 EUR) 82000 NOK, O5 4000, O6 15000, Bin 8000.
    expect(totals.revenueMinor).toBe(23_320 + 8_000 + 82_000 + 4_000 + 15_000 + 8_000);
    expect(totals.revenueMinor).toBe(140_320);
    // Goods before discounts, without VAT: 21000 + 8000 + 80000 + 4000 + 15000 + 8000.
    expect(totals.grossSalesMinor).toBe(136_000);
    // Discounts without VAT: O1 2000/1.25 = 1600, O3 1000 EUR-minor/1.25 = 800 -> 8000 NOK.
    expect(totals.discountsMinor).toBe(9_600);
    // Shipping income without VAT: O1 4900 - 980 = 3920, O3 1000 EUR-minor -> 10000.
    expect(totals.shippingMinor).toBe(13_920);
    // The identity of the document: revenue = gross sales - discounts + shipping income (exact here: no rounding left over).
    expect(totals.grossSalesMinor - totals.discountsMinor + totals.shippingMinor).toBe(totals.revenueMinor);
    // VAT: 5330 + 2000 + 20500 + 1000 + 2250 + 2000; and revenue + VAT is what the shoppers paid.
    expect(totals.vatMinor).toBe(33_080);
    expect(totals.revenueMinor + totals.vatMinor).toBe(28_650 + 10_000 + 102_500 + 5_000 + 17_250 + 10_000);
    // Refunds by their own date, without VAT: O5's 50.00 x (4000/5000) = 4000, O6's 57.50 x (15000/17250) = 5000; the failed one is not counted.
    expect(totals.refundsMinor).toBe(9_000);
    // Units of goods: O1 2+1, O2 1, O3 1, O6 3, Bin 1 (the sign-up fee has no variant).
    expect(totals.units).toBe(9);
    // Costs kept on the lines, in the main currency: 2x30 (the tote's is unknown) + 30 + 30 + 3x10 + 30.
    expect(totals.cogsMinor).toBe(6_000 + 3_000 + 3_000 + 3_000 + 3_000);
    // Cost coverage is a share of the lines' revenue (shipping income is no product): 140320 - 13920 = 126400, all of it known but the
    // tote's 5750 - 750 = 5000 in O1.
    expect(totals.lineRevenueMinor).toBe(140_320 - 13_920);
    expect(totals.knownCostRevenueMinor).toBe(140_320 - 13_920 - 5_000);
    // Estimated payment fees: 2 % of each total (with VAT, O3 converted: 102500) + 1.00 each.
    expect(totals.paymentFeesMinor).toBe(673 + 300 + 2_150 + 200 + 445 + 300);
    // Kaizen's fees, as taken: 3.00 + 1.00 + (1.50 EUR = 15.00 NOK) + 1.00.
    expect(totals.platformFeesMinor).toBe(300 + 100 + 1_500 + 100);
    // Shipping costs: 25.00 for each order with a physical line (not the sign-up fee).
    expect(totals.shippingCostsMinor).toBe(5 * 2_500);
    expect(totals.marketingMinor).toBe(3_500);
    expect(totals.sessions).toBeNull();
    // Customers by the customer key: Anna's account (first order 08-27: returning), Gus (both spellings, one customer), Eva, Kari. Sven is left out.
    expect(totals.newCustomers).toBe(3);
    expect(totals.returningCustomers).toBe(1);
    // The SEK order is counted, not lost.
    expect(unconverted).toBe(1);
    expect(missingCurrencies).toEqual(["SEK"]);
  });

  it("works out profit from them and says how much of sales it rests on", async () => {
    const settings = await getAnalyticsSettings(store.id);
    const { totals } = await periodTotals(store, PERIOD, settings);
    const d = derive(totals, settings, PERIOD.days);
    expect(d.netRevenue).toBe(140_320 - 9_000);
    // The cost is known for 96 % of sales (121 400 of 126 400), so profit is an estimate: the known cost of goods, 18 000, scaled to all sales.
    expect(d.profitEstimated).toBe(true);
    const cogs = Math.round((18_000 * 126_400) / 121_400);
    expect(cogs).toBe(18_741);
    expect(d.grossProfit).toBe(131_320 - cogs);
    expect(d.grossProfit).toBe(112_579);
    expect(d.contributionProfit).toBe(131_320 - cogs - 4_068 - 2_000 - 12_500 - 3_500);
    expect(d.contributionProfit).toBe(90_511);
    // The margin is on the covered sales only: (96 % of net revenue − the known cost) / that.
    const covered = 131_320 * (121_400 / 126_400);
    expect(d.grossMarginPct).toBeCloseTo((covered - 18_000) / covered, 10);
    expect(d.aov).toBe(Math.round(140_320 / 6));
    expect(d.costCoverage).toBeCloseTo(121_400 / 126_400, 10);
    expect(coverageText(d.costCoverage)).toBe("based on 96 % of sales");
    // 3 650 000 a month over 7 days: round(3650000 x 12 x 7 / 365).
    expect(d.fixedCosts).toBe(840_000);
  });

  it("reads the settings itself when none are given, and a period with nothing in it is all zero, never a made-up figure", async () => {
    const same = await periodTotals(store, PERIOD);
    expect(same.totals.revenueMinor).toBe(140_320);
    const empty = await periodTotals(store, customPeriod("2025-09-01", "2025-09-07"));
    expect(empty.totals).toMatchObject({ orders: 0, revenueMinor: 0, refundsMinor: 0, newCustomers: 0, returningCustomers: 0, marketingMinor: 0 });
    expect(empty.unconverted).toBe(0);
    expect(derive(empty.totals, await getAnalyticsSettings(store.id), 7).grossProfit).toBe(0);
  });

  it("never reaches another store's orders, and a store with no known cost has no profit", async () => {
    const mine = await periodTotals(other, PERIOD);
    expect(mine.totals.orders).toBe(1);
    // 5750 - 750 VAT, with no cost known.
    expect(mine.totals.revenueMinor).toBe(5_000);
    expect(mine.totals.cogsMinor).toBe(0);
    expect(mine.totals.knownCostRevenueMinor).toBe(0);
    const d = derive(mine.totals, await getAnalyticsSettings(other.id), 7);
    expect(d.costCoverage).toBe(0);
    expect(d.grossProfit).toBeNull();
    expect(d.contributionProfit).toBeNull();
  });

  it("counts a period's edges in the store's own days", async () => {
    // The last minute of 07 September in Oslo is in a period ending that day; half an hour later is not.
    expect((await periodTotals(store, customPeriod("2026-09-07", "2026-09-07"))).totals.orders).toBe(1);
    expect((await periodTotals(store, customPeriod("2026-09-08", "2026-09-08"))).totals.orders).toBe(1);
    expect((await periodTotals(store, customPeriod("2026-09-08", "2026-09-08"))).totals.revenueMinor).toBe(8_000);
    // The refund of 09-07 15:00 belongs to that day, whatever the order's day.
    expect((await periodTotals(store, customPeriod("2026-09-07", "2026-09-07"))).totals.refundsMinor).toBe(5_000);
  });
});

describe("seriesByBucket", () => {
  it("gives a point for every day, zero-filled, whose sums are the period's totals", async () => {
    const settings = await getAnalyticsSettings(store.id);
    const points = await seriesByBucket(store, PERIOD, "day", settings);
    expect(points.map((p) => p.key)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(points.map((p) => p.orders)).toEqual([0, 2, 1, 0, 1, 1, 1]);
    expect(points.map((p) => p.revenueMinor)).toEqual([0, 31_320, 82_000, 0, 4_000, 15_000, 8_000]);
    expect(points.map((p) => p.refundsMinor)).toEqual([0, 0, 0, 0, 0, 4_000, 5_000]);
    expect(points.map((p) => p.netRevenueMinor)).toEqual([0, 31_320, 82_000, 0, 4_000, 11_000, 3_000]);
    expect(points.map((p) => p.cogsMinor)).toEqual([0, 9_000, 3_000, 0, 0, 3_000, 3_000]);
    // Each day has its own coverage: the day with a line whose cost is not known is estimated (9 000 of cost scaled to the day's goods:
    // 31 320 − 11 009), the others are exact. The days therefore do not add up to the period's own estimate.
    expect(points.map((p) => p.grossProfitMinor)).toEqual([0, 20_311, 79_000, 0, 4_000, 8_000, 0]);
    // Contribution: gross profit - payment fees - Kaizen's fees - shipping costs - marketing, day by day.
    expect(points.map((p) => p.contributionMinor)).toEqual([
      0,
      20_311 - (673 + 300) - (300 + 100) - 5_000 - 3_500,
      79_000 - 2_150 - 1_500 - 2_500,
      0,
      4_000 - 200,
      8_000 - 445 - 2_500,
      0 - 300 - 100 - 2_500,
    ]);
    // New customers fall in one bucket each (Gus 09-02, Eva 09-03, Kari 09-07); returning ones in each bucket they come back in.
    expect(points.map((p) => p.newCustomers)).toEqual([0, 1, 1, 0, 0, 0, 1]);
    expect(points.map((p) => p.returningCustomers)).toEqual([0, 1, 0, 0, 1, 1, 0]);

    const { totals } = await periodTotals(store, PERIOD, settings);
    const sum = (key: "orders" | "revenueMinor" | "refundsMinor" | "cogsMinor" | "newCustomers") => points.reduce((s, p) => s + p[key], 0);
    expect(sum("orders")).toBe(totals.orders);
    expect(sum("revenueMinor")).toBe(totals.revenueMinor);
    expect(sum("refundsMinor")).toBe(totals.refundsMinor);
    expect(sum("cogsMinor")).toBe(totals.cogsMinor);
    expect(sum("newCustomers")).toBe(totals.newCustomers);
    // Net revenue = revenue - refunds in every point, and the totals' too.
    for (const p of points) expect(p.netRevenueMinor).toBe(p.revenueMinor - p.refundsMinor);
  });

  it("cuts weeks and months to the period, and a customer is new in the bucket of the first order", async () => {
    const weeks = await seriesByBucket(store, PERIOD, "week");
    // 1 September 2026 is a Tuesday: the first week starts Monday 31 August but is cut to the period.
    expect(weeks.map((w) => [w.key, w.from, w.to])).toEqual([
      ["2026-08-31", "2026-09-01", "2026-09-07"],
      ["2026-09-07", "2026-09-07", "2026-09-08"],
    ]);
    expect(weeks.map((w) => w.orders)).toEqual([5, 1]);
    expect(weeks.map((w) => w.revenueMinor)).toEqual([132_320, 8_000]);
    // Week one: Anna, Gus and Eva ordered; Gus and Eva for the first time, Anna not. Week two: Kari, new.
    expect(weeks.map((w) => [w.newCustomers, w.returningCustomers])).toEqual([
      [2, 1],
      [1, 0],
    ]);
    const months = await seriesByBucket(store, PERIOD, "month");
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({ key: "2026-09-01", from: "2026-09-01", to: "2026-09-08", orders: 6, revenueMinor: 140_320, refundsMinor: 9_000, newCustomers: 3, returningCustomers: 1 });
  });

  it("leaves a bucket's profit out while no sold line in it has a known cost", async () => {
    const points = await seriesByBucket(other, customPeriod("2026-09-01", "2026-09-03"), "day");
    expect(points.map((p) => p.revenueMinor)).toEqual([0, 5_000, 0]);
    expect(points[1].grossProfitMinor).toBeNull();
    expect(points[1].contributionMinor).toBeNull();
    // A day with nothing sold is a zero, not unknown.
    expect(points[0].grossProfitMinor).toBe(0);
  });
});

describe("topProducts", () => {
  it("ranks products by revenue and by profit over their lines, converted into the main currency", async () => {
    const top = await topProducts(store, PERIOD);
    // Mug: O1 14400 + O2 8000 + O3 (7200 EUR-minor) 72000 + Bin 8000, 5 units, cost 6000+3000+3000+3000.
    // Tote: O1 5000 (cost unknown) + O6 15000 (3 x 10.00): 4 units, profit over the known line only.
    expect(top.byRevenue.map((p) => [p.revenueMinor, p.units, p.profitMinor, p.costCoverage])).toEqual([
      [102_400, 5, 102_400 - 15_000, 1],
      [20_000, 4, 15_000 - 3_000, 0.75],
    ]);
    expect(top.byProfit.map((p) => p.profitMinor)).toEqual([87_400, 12_000]);
    expect(top.byRevenue.map((p) => p.productId)).toEqual(top.byProfit.map((p) => p.productId));
    expect(top.byRevenue.every((p) => p.name.length > 0 && !/^[0-9a-f-]{36}$/.test(p.name))).toBe(true);
    expect(top.truncated).toBe(false);
  });
});

describe("overviewData", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const query = { period: "custom", from: "2026-09-01", to: "2026-09-07", compare: "previous" };

  it("has a head that is the page's first screen: all of it but the best sellers, the same with the settings handed in or read", async () => {
    const sessions = async () => ({ sessions: 2000, firstDay: "2026-08-01", byDay: {} });
    const [head, again, full] = await Promise.all([
      overviewHead(store, query, now, { sessions }),
      overviewHead(store, query, now, { sessions, settings: await getAnalyticsSettings(store.id) }),
      overviewData(store, query, now, { sessions }),
    ]);
    const { topProducts: top, ...rest } = full;
    expect(top.byRevenue.length).toBeGreaterThan(0);
    expect("topProducts" in head).toBe(false);
    expect(head).toEqual(rest);
    expect(again).toEqual(head);
  });

  it("gives the period, the previous period and last year with their derived figures, and the series aligned for the chart", async () => {
    const data = await overviewData(store, query, now);
    expect(data.currency).toBe("NOK");
    expect(data.bucket).toBe("day");
    expect(data.params.period.from).toBe("2026-09-01");
    expect(data.current.totals.revenueMinor).toBe(140_320);
    expect(data.current.derived).toMatchObject({ revenue: 140_320, netRevenue: 131_320, grossProfit: 112_579, contributionProfit: 90_511, sessions: null, conversionRate: null });
    expect(data.current.visitsFrom).toBeNull();
    // The seven days before: Anna's first order, 50.00 with 25 % VAT, a mug costing 30.00, shipped (25.00), fees 1.00 + 1.00.
    expect(data.previous.period).toMatchObject({ from: "2026-08-25", to: "2026-09-01" });
    expect(data.previous.totals).toMatchObject({ orders: 1, revenueMinor: 4_000, cogsMinor: 3_000, newCustomers: 1, returningCustomers: 0 });
    // ... and the 7.77 spent on 08-31, which the period only reached.
    expect(data.previous.totals.marketingMinor).toBe(777);
    expect(data.previous.derived.contributionProfit).toBe(4_000 - 3_000 - 200 - 2_500 - 777);
    expect(data.lastYear.period).toMatchObject({ from: "2025-09-01", to: "2025-09-08" });
    expect(data.lastYear.totals.orders).toBe(0);
    // Series: the current period by day, the comparison (previous period) by the same index.
    expect(data.series.current.map((p) => p.revenueMinor)).toEqual([0, 31_320, 82_000, 0, 4_000, 15_000, 8_000]);
    expect(data.series.comparison).toHaveLength(7);
    expect(data.series.comparison!.map((p) => p?.orders)).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(data.series.comparison![2]).toMatchObject({ key: "2026-08-27", revenueMinor: 4_000 });
    // One sparkline per card; visits are not counted here.
    expect(data.sparklines.revenue).toEqual([0, 31_320, 82_000, 0, 4_000, 15_000, 8_000]);
    expect(data.sparklines.orders).toEqual([0, 2, 1, 0, 1, 1, 1]);
    expect(data.sparklines.netRevenue).toEqual([0, 31_320, 82_000, 0, 4_000, 11_000, 3_000]);
    expect(data.sparklines.conversion.every((v) => v === null)).toBe(true);
    expect(data.sparklines.sessions.every((v) => v === null)).toBe(true);
    expect(data.topProducts.byRevenue).toHaveLength(2);
    // What was left out, and how much of sales the profit rests on.
    expect(data.unconverted).toBe(1);
    expect(data.missingCurrencies).toEqual(["SEK"]);
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0]).toMatch(/SEK/);
    expect(data.costCoverageText).toBe("based on 96 % of sales");
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("compares with last year, or with nothing, as the address asks", async () => {
    const year = await overviewData(store, { ...query, compare: "year" }, now);
    expect(year.series.comparison).toHaveLength(7);
    expect(year.series.comparison!.every((p) => p !== null && p.orders === 0)).toBe(true);
    const none = await overviewData(store, { ...query, compare: "none" }, now);
    expect(none.series.comparison).toBeNull();
    // The previous period and last year are still worked out: the cards show both changes.
    expect(none.previous.totals.orders).toBe(1);
  });

  it("counts conversion only over the days visits were counted, when counting began inside the period", async () => {
    const byDay = { "2026-09-03": 40, "2026-09-04": 10, "2026-09-05": 20, "2026-09-06": 20, "2026-09-07": 10 };
    const sessions = async (p: { from: string }) => (p.from === "2026-09-01" ? { sessions: 100, firstDay: "2026-09-03", byDay } : { sessions: null, firstDay: null });
    const data = await overviewData(store, query, now, { sessions });
    expect(data.current.visitsFrom).toBe("2026-09-03");
    expect(data.current.derived.sessions).toBe(100);
    // Orders from 09-03 on: O3, O5, O6, Bin = 4 of 100 visits (not 6: two orders came before the first counted day).
    expect(data.current.derived.conversionRate).toBeCloseTo(0.04, 10);
    // Net revenue over those days: (82000 + 4000 + 15000 + 8000) - 9000 = 100000, over 100 visits.
    expect(data.current.derived.revenuePerVisitor).toBe(1_000);
    expect(data.previous.derived.sessions).toBeNull();
    expect(data.previous.derived.conversionRate).toBeNull();
    // The sparklines know the days before the first counted one are unknown, not zero.
    expect(data.sparklines.sessions).toEqual([null, null, 40, 10, 20, 20, 10]);
    expect(data.sparklines.conversion).toEqual([null, null, 1 / 40, 0, 1 / 20, 1 / 20, 1 / 10]);
  });

  it("uses everything when visits were counted from before the period", async () => {
    const sessions = async (p: { from: string }) => ({ sessions: p.from === "2026-09-01" ? 120 : null, firstDay: p.from === "2026-09-01" ? "2026-08-01" : null });
    const data = await overviewData(store, query, now, { sessions });
    expect(data.current.visitsFrom).toBeNull();
    expect(data.current.derived.conversionRate).toBeCloseTo(6 / 120, 10);
  });
});

describe("a free-shipping code", () => {
  it("is a discount of shipping income: shipping is shown as charged, the code's discount beside the others, and the identity holds", async () => {
    const settings = await getAnalyticsSettings(ship.id);
    const { totals } = await periodTotals(ship, PERIOD, settings);
    // S1: mug 10000 with 25 % VAT, shipping 4900 taken off by the code: stored shipping 4900, discount 4900, tax 2000, total 10000.
    // S2: the same without a code: total 14900, tax 2980. Revenue = total - tax: 8000 + 11920.
    expect(totals.orders).toBe(2);
    expect(totals.revenueMinor).toBe(19_920);
    expect(totals.grossSalesMinor).toBe(16_000);
    // The code's discount without VAT is 4900 / 1.25 = 3920 (no line carries it); shipping income is what both orders were charged
    // for shipping before it, 3920 each.
    expect(totals.discountsMinor).toBe(3_920);
    expect(totals.shippingMinor).toBe(7_840);
    expect(totals.grossSalesMinor - totals.discountsMinor + totals.shippingMinor).toBe(totals.revenueMinor);
    // So the statement needs no rounding line to bridge to revenue.
    const statement = financeStatement(totals, settings, PERIOD.days);
    expect(statement.lines.some((l) => l.key === "rounding")).toBe(false);
    expect(statement.lines.find((l) => l.key === "discounts")?.amountMinor).toBe(-3_920);
    expect(statement.reconciles).toBe(true);
  });

  it("is the same in a series, bucket by bucket", async () => {
    const points = await seriesByBucket(ship, customPeriod("2026-09-02", "2026-09-03"), "day");
    expect(points.map((p) => p.revenueMinor)).toEqual([8_000, 11_920]);
  });
});

describe("cost coverage", () => {
  it("is 0 for a store that charges shipping and has entered no product cost, so profit is not shown", async () => {
    const settings = await getAnalyticsSettings(costless.id);
    const { totals } = await periodTotals(costless, PERIOD, settings);
    // 1 mug 10000 (cost unknown) + 4900 shipping: revenue 14900 - 2980 = 11920 of which the line is 8000; shipping income is no product.
    expect(totals.revenueMinor).toBe(11_920);
    expect(totals.lineRevenueMinor).toBe(8_000);
    expect(totals.knownCostRevenueMinor).toBe(0);
    const d = derive(totals, settings, PERIOD.days);
    expect(d.costCoverage).toBe(0);
    expect(d.grossProfit).toBeNull();
    expect(d.grossMarginPct).toBeNull();
    expect(d.contributionProfit).toBeNull();
    const statement = financeStatement(totals, settings, PERIOD.days);
    expect(statement.costCoverage).toBe(0);
    expect(statement.hasCosts).toBe(false);
    const data = await overviewData(costless, { period: "custom", from: "2026-09-01", to: "2026-09-07", compare: "none" }, new Date("2026-09-10T12:00:00Z"));
    expect(data.costCoverage).toBe(0);
  });

  it("is the share of the lines' revenue with a known cost, shipping left out of both", async () => {
    const settings = await getAnalyticsSettings(ship.id);
    const { totals } = await periodTotals(ship, PERIOD, settings);
    expect(derive(totals, settings, PERIOD.days).costCoverage).toBe(1);
  });
});

describe("the comparison series", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const query = { period: "custom", from: "2026-07-01", to: "2026-09-30", compare: "previous" };

  it("holds each bucket against the same days of the comparison, so a partial first or last bucket compares like with like", async () => {
    const data = await overviewData(shifted, query, now);
    // 92 days by week: 1 July is a Wednesday, so the first bucket is 5 days (1-5 July) and the last 3 (28-30 September).
    expect(data.bucket).toBe("week");
    const current = data.series.current;
    expect([current[0].key, current[0].from, current[0].to]).toEqual(["2026-06-29", "2026-07-01", "2026-07-06"]);
    expect(daysBetween(current.at(-1)!.from, current.at(-1)!.to)).toBe(3);
    const comparison = data.series.comparison!;
    expect(comparison).toHaveLength(current.length);
    // The previous period starts on Tuesday 31 March. Its first five days are held against the first bucket: 2 April is in them,
    // Sunday 5 April (the sixth day) is not; it belongs to the second bucket's seven days.
    expect([comparison[0]!.from, comparison[0]!.to, comparison[0]!.orders]).toEqual(["2026-03-31", "2026-04-05", 1]);
    expect([comparison[1]!.from, comparison[1]!.to, comparison[1]!.orders]).toEqual(["2026-04-05", "2026-04-12", 1]);
    expect([comparison.at(-1)!.from, comparison.at(-1)!.to]).toEqual(["2026-06-28", "2026-07-01"]);
    // Every pair spans as many days, and together they are the whole comparison period.
    current.forEach((p, i) => expect(daysBetween(comparison[i]!.from, comparison[i]!.to)).toBe(daysBetween(p.from, p.to)));
    expect(comparison.reduce((sum, p) => sum + p!.orders, 0)).toBe(data.previous.totals.orders);
    expect(comparison.reduce((sum, p) => sum + p!.revenueMinor, 0)).toBe(data.previous.totals.revenueMinor);
    expect(current.reduce((sum, p) => sum + p.orders, 0)).toBe(data.current.totals.orders);
  });

  it("has no point where the comparison ends before the bucket does", () => {
    const march = customPeriod("2026-03-01", "2026-03-31");
    const spans = enumerateBuckets(march, "week");
    // February is 28 days against March's 31: the last two weeks have no full counterpart, and are null rather than a shorter one.
    const aligned = alignedSpans(march, { from: "2026-02-01", to: "2026-03-01" }, spans);
    expect(aligned.map((s) => (s ? [s.from, s.to] : null))).toEqual([
      ["2026-02-01", "2026-02-02"],
      ["2026-02-02", "2026-02-09"],
      ["2026-02-09", "2026-02-16"],
      ["2026-02-16", "2026-02-23"],
      null,
      null,
    ]);
  });
});
