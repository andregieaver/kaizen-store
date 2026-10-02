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

const { discountsReport, COUPONS_LISTED } = await import("./analytics-discounts-data");

/**
 * The discounts and coupons figures (D152, docs/analytics.md) against a small hand-made shop. Money is in NOK minor units (the main
 * currency) without VAT unless a comment says otherwise; EUR is 1 EUR = 10 NOK, SEK has no rate; Europe/Oslo.
 *
 * September 2026 (the period), VAT 25 % on mugs and 15 % on totes, every amount below incl. VAT as sold:
 *
 *   D1  09-02  NOK  2 mugs 100.00 less 20.00 (customer group), 49.00 shipping       gross 16000, off 1600, revenue 14400 + 3920 shipping
 *   D2  09-03  NOK  2 totes 57.50 less 23.00 (campaign 11.50 + code SAVE10 11.50)    gross 10000, off 2000 = 1000 + 1000, revenue 8000
 *   D3  09-04  NOK  1 mug 100.00 less 37.50 (welcome discount 25.00 + bonus credit 12.50)   gross 8000, off 3000 = 2000 + 1000, revenue 5000
 *   D4  09-05  NOK  1 mug 100.00, code FREESHIP (free shipping: nothing off goods)  gross 8000, off 0, revenue 8000
 *   D5  09-06  EUR  1 mug 100.00 less 10.00 with SAVE10                              x 10: gross 80000, off 8000, revenue 72000
 *   D6  09-07  SEK  a paid order in a currency with no rate                          left out, counted
 *   D7 (host's order), D8 (a copied one), D9 (waiting for payment), all 09-03        never count
 *   D10 09-08  NOK  1 tote 57.50, cancelled but paid                                 full price: gross 5000, revenue 5000
 *   F1..F6 09-09..09-14, 1 mug 100.00 each, full price                               gross 8000, revenue 8000
 *   G1 09-20, G2 09-25  1 mug 100.00 less 10.00 (customer group)                     gross 8000, off 800, revenue 7200
 *
 * Earlier months for the trend: June 10 orders (2 discounted), July 10 (3), August 10 (4), March 2 (1), and one in September 2025,
 * outside the 12 months.
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
let serial = 0;

type Line = {
  sku: "DEMO-MUG-WHITE" | "DEMO-TOTE";
  qty: number;
  unit: number;
  rate: number;
  discount?: number;
  member?: number;
  campaign?: number;
  bonus?: number;
  referral?: number;
};

const taxOf = (amount: number, rate: number) => amount - Math.round(amount / (1 + rate));
const MUG = { sku: "DEMO-MUG-WHITE", rate: 0.25 } as const;
const TOTE = { sku: "DEMO-TOTE", rate: 0.15 } as const;

async function order(
  s: Store,
  o: { at: string; email: string; lines: Line[]; currency?: string; status?: string; shipping?: number; code?: { id: string; text: string }; host?: string; copied?: boolean; paid?: boolean },
) {
  serial += 1;
  const currency = o.currency ?? "NOK";
  const lines = o.lines.map((l) => {
    const discount = l.discount ?? 0;
    const total = l.unit * l.qty - discount;
    return { ...l, discount, total, tax: taxOf(total, l.rate) };
  });
  const shipping = o.shipping ?? 0;
  const subtotal = lines.reduce((a, l) => a + l.unit * l.qty, 0);
  const discount = lines.reduce((a, l) => a + l.discount, 0);
  const tax = lines.reduce((a, l) => a + l.tax, 0) + taxOf(shipping, 0.25);
  const total = subtotal + shipping - discount;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, host_id, copied_from, discount_code_id, discount_code)
    values (${s.id}::uuid, ${o.copied ? `C-${run}-${serial}` : `D-${run}-${serial}`}, 'NO', ${currency}, 'nb-NO', ${o.email}, ${o.status ?? "paid"},
      ${subtotal}, ${shipping}, ${discount}, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, ${o.host ?? null},
      ${o.copied ? crypto.randomUUID() : null}, ${o.code?.id ?? null}, ${o.code?.text ?? null})
    returning id
  `);
  const insertLines = async (runner: Pick<ReturnType<typeof db>, "execute">) => {
    for (const l of lines) {
      await runner.execute(sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, member_discount_minor,
          campaign_discount_minor, bonus_discount_minor, referral_discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
        values (${s.id}::uuid, ${String(row.id)}::uuid, ${variants[s.id][l.sku]}, ${l.sku}, ${l.sku}, ${l.qty}, ${l.unit}, ${l.discount}, ${l.member ?? 0},
          ${l.campaign ?? 0}, ${l.bonus ?? 0}, ${l.referral ?? 0}, ${l.total}, ${l.tax}, ${l.rate}, 'txcd_99999999', 'physical'::commerce.delivery)
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
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${s.id}::uuid, ${String(row.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_discounts', ${total}, ${currency}, 'captured'::commerce.payment_status)
    `);
  } else if (!o.copied) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${s.id}::uuid, ${String(row.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_discounts', ${total}, ${currency}, 'pending'::commerce.payment_status)
    `);
  }
  return String(row.id);
}

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

const code = async (s: Store, text: string, kind: "percent" | "fixed" | "free_shipping", percent = 0) => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.discount_codes (store_id, code, kind, percent) values (${s.id}::uuid, ${text}, ${kind}, ${percent}) returning id
  `);
  return { id: String(row.id), text };
};

/** A month's cheap orders: `n` mugs at 100.00, the first `discounted` with a 10.00 group discount. */
async function fillMonth(s: Store, month: string, n: number, discounted: number) {
  for (let i = 0; i < n; i++) {
    const day = String(i + 2).padStart(2, "0");
    await order(s, {
      at: `${month}-${day}T12:00:00+02:00`,
      email: `fill-${month}-${i}@example.com`,
      lines: [{ ...MUG, qty: 1, unit: 10_000, ...(i < discounted ? { discount: 1_000, member: 1_000 } : {}) }],
    });
  }
}

const FULL = customPeriod("2026-09-01", "2026-09-30");
const PARTIAL = customPeriod("2026-09-01", "2026-09-15");

beforeAll(async () => {
  const id = await makeStore(`disc-${run}`);
  const otherId = await makeStore(`disc-other-${run}`);
  store = storeOf(id, `disc-${run}`);
  other = storeOf(otherId, `disc-other-${run}`);
  for (const storeId of [id, otherId]) {
    variants[storeId] = {};
    for (const row of await db().execute<Row>(sql`select sku, id from commerce.product_variants where store_id = ${storeId}::uuid`)) variants[storeId][String(row.sku)] = String(row.id);
  }
  const save10 = await code(store, "SAVE10", "percent", 10);
  const freeship = await code(store, "FREESHIP", "free_shipping");

  await order(store, {
    at: "2026-09-02T10:00:00+02:00",
    email: "d1@example.com",
    shipping: 4_900,
    lines: [{ ...MUG, qty: 2, unit: 10_000, discount: 2_000, member: 2_000 }],
  });
  await order(store, {
    at: "2026-09-03T10:00:00+02:00",
    email: "d2@example.com",
    code: save10,
    lines: [{ ...TOTE, qty: 2, unit: 5_750, discount: 2_300, campaign: 1_150 }],
  });
  await order(store, {
    at: "2026-09-04T10:00:00+02:00",
    email: "d3@example.com",
    lines: [{ ...MUG, qty: 1, unit: 10_000, discount: 3_750, referral: 2_500, bonus: 1_250 }],
  });
  await order(store, { at: "2026-09-05T10:00:00+02:00", email: "d4@example.com", code: freeship, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await order(store, {
    at: "2026-09-06T10:00:00+02:00",
    email: "d5@example.com",
    currency: "EUR",
    code: save10,
    lines: [{ ...MUG, qty: 1, unit: 10_000, discount: 1_000 }],
  });
  await order(store, {
    at: "2026-09-07T10:00:00+02:00",
    email: "d6@example.com",
    currency: "SEK",
    lines: [{ ...MUG, qty: 1, unit: 10_000, discount: 1_000, member: 1_000 }],
  });
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-disc-${run}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${id}::uuid, ${String(account.id)}::uuid, 'Host') returning id`);
  await order(store, { at: "2026-09-03T11:00:00+02:00", email: "d7@example.com", host: String(host.id), code: save10, lines: [{ ...MUG, qty: 4, unit: 10_000, discount: 4_000, member: 4_000 }] });
  await order(store, { at: "2026-09-03T12:00:00+02:00", email: "d8@example.com", copied: true, code: save10, lines: [{ ...MUG, qty: 3, unit: 10_000, discount: 3_000, member: 3_000 }] });
  await order(store, { at: "2026-09-03T13:00:00+02:00", email: "d9@example.com", status: "pending_payment", paid: false, lines: [{ ...MUG, qty: 2, unit: 10_000, discount: 2_000, member: 2_000 }] });
  await order(store, { at: "2026-09-08T10:00:00+02:00", email: "d10@example.com", status: "cancelled", lines: [{ ...TOTE, qty: 1, unit: 5_750 }] });
  for (let i = 0; i < 6; i++) {
    await order(store, { at: `2026-09-${String(9 + i).padStart(2, "0")}T12:00:00+02:00`, email: `f${i}@example.com`, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  }
  for (const day of ["20", "25"]) {
    await order(store, { at: `2026-09-${day}T12:00:00+02:00`, email: `g${day}@example.com`, lines: [{ ...MUG, qty: 1, unit: 10_000, discount: 1_000, member: 1_000 }] });
  }
  await fillMonth(store, "2026-06", 10, 2);
  await fillMonth(store, "2026-07", 10, 3);
  await fillMonth(store, "2026-08", 10, 4);
  await fillMonth(store, "2026-03", 2, 1);
  await order(store, { at: "2025-09-15T12:00:00+02:00", email: "old@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000, discount: 1_000, member: 1_000 }] });

  // Another store's discounted order in the same days: nothing of it may reach the first store.
  const otherCode = await code(other, "SAVE10", "percent", 10);
  await order(other, { at: "2026-09-02T10:00:00+02:00", email: "elsewhere@example.com", code: otherCode, lines: [{ ...MUG, qty: 1, unit: 10_000, discount: 1_000 }] });
});

afterAll(async () => {
  await closeDb();
});

describe("discountsReport: the period", () => {
  it("counts paid orders only, in the main currency without VAT, and says what it left out", async () => {
    const report = await discountsReport(store, FULL);
    const s = report.summary;
    expect(report.currency).toBe("NOK");
    // D1-D5, D10, F1-F6, G1, G2 = 14 paid orders; not D6 (SEK), D7 (host), D8 (copied), D9 (unpaid).
    expect(s.orders).toBe(14);
    expect(s.discountedOrders).toBe(7);
    expect(s.dependency).toBe(0.5);
    // Discounted orders' revenue: 18320 + 8000 + 5000 + 8000 + 72000 + 7200 + 7200 (D1 has 3920 shipping income without VAT).
    expect(s.discountedRevenueMinor).toBe(125_720);
    expect(s.discountMinor).toBe(16_200);
    // 16200 off 138000 of goods before discounts.
    expect(s.averageDiscountPct).toBeCloseTo(16_200 / 138_000, 10);
    expect(s.aovDiscountedMinor).toBe(17_960);
    // Full price: D10 5000 + 6 x 8000 = 53000 over 7 orders.
    expect(s.aovFullPriceMinor).toBe(Math.round(53_000 / 7));
    expect(s.aovRatio).toBeCloseTo(125_720 / 53_000, 10);
    // Money identity of the doc, over all 14 orders: revenue 178720 = gross 191000 - discounts 16200 + shipping 3920.
    expect(s.discountedRevenueMinor + 53_000).toBe(191_000 - 16_200 + 3_920);
    expect(report.unconverted).toBe(1);
    expect(report.missingRates).toEqual(["SEK"]);
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toMatch(/SEK/);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("splits the discounts by kind from the lines, and the kinds add up to the discounts", async () => {
    const { breakdown } = await discountsReport(store, FULL);
    const byKind = Object.fromEntries(breakdown.kinds.map((k) => [k.kind, [k.orders, k.discountMinor]]));
    // Group: D1 1600, G1 800, G2 800. Campaign: D2 1000. Welcome: D3 2000. Credit: D3 1000. Code: D2 1000 + D5 (800 EUR-minor) 8000.
    expect(byKind).toEqual({ group: [3, 3_200], campaign: [1, 1_000], referral: [1, 2_000], credit: [1, 1_000], code: [2, 9_000] });
    expect(breakdown.totalMinor).toBe(16_200);
    expect(breakdown.roundingMinor).toBe(0);
    expect(breakdown.kinds.reduce((a, k) => a + k.discountMinor, 0)).toBe(breakdown.totalMinor);
    // Biggest first, with shares of the whole.
    expect(breakdown.kinds.map((k) => k.kind)).toEqual(["code", "group", "referral", "campaign", "credit"]);
    expect(breakdown.kinds[0].share).toBeCloseTo(9_000 / 16_200, 10);
    expect(breakdown.kinds.reduce((a, k) => a + (k.share ?? 0), 0)).toBeCloseTo(1, 10);
  });

  it("ranks the codes by revenue with what each took off, and keeps the type of code", async () => {
    const { coupons, couponCount, couponsTruncated } = await discountsReport(store, FULL);
    expect(couponCount).toBe(2);
    expect(couponsTruncated).toBe(false);
    expect(COUPONS_LISTED).toBeGreaterThanOrEqual(2);
    // SAVE10: D2 (8000, goods 10000, 1000 off) and D5 (72000, goods 80000, 8000 off); the host's and the copied order do not count.
    expect(coupons[0]).toMatchObject({
      code: "SAVE10",
      orders: 2,
      revenueMinor: 80_000,
      grossGoodsMinor: 90_000,
      discountMinor: 9_000,
      aovMinor: 40_000,
      discountPerOrderMinor: 4_500,
      codeKind: "percent",
      active: true,
    });
    expect(coupons[0].discountPct).toBeCloseTo(0.1, 10);
    expect(coupons[0].revenueShare).toBeCloseTo(80_000 / 88_000, 10);
    // Free shipping takes nothing off goods: a real 0, with its type to say why.
    expect(coupons[1]).toMatchObject({ code: "FREESHIP", orders: 1, revenueMinor: 8_000, discountMinor: 0, discountPerOrderMinor: 0, codeKind: "free_shipping" });
  });
});

describe("discountsReport: the trend", () => {
  it("is the last 12 months whatever the period, with months that are too small left without a share", async () => {
    const { trend, trendWindow, summary } = await discountsReport(store, FULL);
    expect(trendWindow).toEqual({ from: "2025-10-01", to: "2026-10-01" });
    // September 2025 is outside the window; empty months are skipped.
    expect(trend.map((m) => [m.month, m.orders, m.discountedOrders, m.share, m.partial])).toEqual([
      ["2026-03", 2, 1, null, false],
      ["2026-06", 10, 2, 0.2, false],
      ["2026-07", 10, 3, 0.3, false],
      ["2026-08", 10, 4, 0.4, false],
      ["2026-09", 14, 7, 0.5, false],
    ]);
    expect(summary.trend).toEqual(trend);
    // Three months of rising share in a row, 20 % to 50 %, but the first month has 10 orders and a rise needs 30 in the first and the
    // last month (and a z-test): too few orders to call it creeping, whatever the points.
    expect(summary.creeping).toMatchObject({ creeping: false, risingMonths: 3, rise: expect.closeTo(0.3, 10), from: "2026-06", to: "2026-09" });
  });

  it("shows a month the period does not finish, but never judges on it", async () => {
    const report = await discountsReport(store, PARTIAL);
    // To 14 September: D1-D5, D10 and F1-F6 = 12 orders, 5 of them discounted.
    expect(report.summary.orders).toBe(12);
    expect(report.summary.discountedOrders).toBe(5);
    expect(report.trend.at(-1)).toMatchObject({ month: "2026-09", orders: 12, discountedOrders: 5, partial: true });
    expect(report.trend.at(-1)!.share).toBeCloseTo(5 / 12, 10);
    // Judged on June to August only: two rises, not three.
    expect(report.summary.creeping).toMatchObject({ creeping: false, risingMonths: 2, from: "2026-06", to: "2026-08" });
    // The SEK order is in the period and still counted as left out; the unconverted count is the period's own.
    expect(report.unconverted).toBe(1);
  });

  it("has an empty trend and no figures for a period with no orders, never made-up zeros as shares", async () => {
    const report = await discountsReport(store, customPeriod("2024-01-01", "2024-01-31"));
    expect(report.summary).toMatchObject({ orders: 0, dependency: null, averageDiscountPct: null, aovDiscountedMinor: null, aovFullPriceMinor: null, aovRatio: null });
    expect(report.trend).toEqual([]);
    expect(report.coupons).toEqual([]);
    expect(report.breakdown.totalMinor).toBe(0);
    expect(report.breakdown.kinds.every((k) => k.share === null)).toBe(true);
  });
});

describe("discountsReport: isolation", () => {
  it("never reaches another store's orders or codes", async () => {
    const mine = await discountsReport(other, FULL);
    expect(mine.summary.orders).toBe(1);
    expect(mine.summary.discountedOrders).toBe(1);
    expect(mine.summary.discountMinor).toBe(800);
    // Its own SAVE10: a code of the same name in two stores is two codes.
    expect(mine.coupons.map((c) => [c.code, c.orders, c.discountMinor])).toEqual([["SAVE10", 1, 800]]);
    const first = await discountsReport(store, FULL);
    expect(first.summary.orders).toBe(14);
  });
});
