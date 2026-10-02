import { describe, expect, it } from "vitest";

import {
  couponTable,
  CREEP_MIN_ORDERS,
  CREEP_MONTHS,
  CREEP_RISE,
  CREEP_Z,
  detectCreeping,
  discountSummary,
  MIN_MONTH_ORDERS,
  type CouponRow,
  type DiscountMonth,
  type DiscountOrderRow,
  twoProportionZ,
} from "./analytics-discounts";

const row = (month: string, discounted: boolean, orders: number, over: Partial<DiscountOrderRow> = {}): DiscountOrderRow => ({
  month,
  discounted,
  orders,
  revenueMinor: orders * 10_000,
  grossGoodsMinor: orders * (discounted ? 12_500 : 10_000),
  discountMinor: discounted ? orders * 2500 : 0,
  ...over,
});

// Four hundred orders a month: enough that a rise of 8 points or more is also too big to be chance (z >= 2.58) in these fixtures.
const month = (m: string, share: number | null, orders = 400): DiscountMonth => ({
  month: m,
  orders,
  discountedOrders: share === null ? 0 : Math.round(share * orders),
  share,
});

describe("discountSummary", () => {
  const s = discountSummary([row("2026-08", false, 60), row("2026-08", true, 40, { revenueMinor: 300_000 }), row("2026-09", false, 50), row("2026-09", true, 50, { revenueMinor: 350_000 })]);

  it("counts the share of discounted orders", () => {
    expect(s.orders).toBe(200);
    expect(s.discountedOrders).toBe(90);
    expect(s.dependency).toBe(0.45);
  });

  it("adds up revenue sold with a discount and the average discount, weighted by size", () => {
    expect(s.discountedRevenueMinor).toBe(650_000);
    // 2500 off 12 500 per order.
    expect(s.discountMinor).toBe(90 * 2500);
    expect(s.averageDiscountPct).toBeCloseTo(0.2, 10);
  });

  it("compares the basket of discounted orders with full price", () => {
    expect(s.aovDiscountedMinor).toBe(Math.round(650_000 / 90));
    expect(s.aovFullPriceMinor).toBe(10_000);
    expect(s.aovRatio).toBeCloseTo(650_000 / 90 / 10_000, 10);
  });

  it("shows the share by month, oldest first", () => {
    expect(s.trend).toEqual([
      { month: "2026-08", orders: 100, discountedOrders: 40, share: 0.4 },
      { month: "2026-09", orders: 100, discountedOrders: 50, share: 0.5 },
    ]);
  });

  it("is empty without orders", () => {
    const e = discountSummary([]);
    expect(e).toMatchObject({ orders: 0, dependency: null, averageDiscountPct: null, aovDiscountedMinor: null, aovFullPriceMinor: null, aovRatio: null, trend: [] });
    expect(e.creeping.creeping).toBe(false);
    expect(discountSummary([row("2026-08", true, 0)]).orders).toBe(0);
  });

  it("copes with only discounted or only full-price orders", () => {
    const all = discountSummary([row("2026-08", true, 20)]);
    expect(all.dependency).toBe(1);
    expect(all.aovFullPriceMinor).toBeNull();
    expect(all.aovRatio).toBeNull();
    const none = discountSummary([row("2026-08", false, 20)]);
    expect(none.dependency).toBe(0);
    expect(none.aovDiscountedMinor).toBeNull();
    expect(none.averageDiscountPct).toBeNull();
    expect(none.discountedRevenueMinor).toBe(0);
  });

  it("has no average discount when goods before discounts are unknown", () => {
    expect(discountSummary([row("2026-08", true, 5, { grossGoodsMinor: 0 })]).averageDiscountPct).toBeNull();
  });

  it("adds together rows for the same month and flag, and sorts months however they come", () => {
    const t = discountSummary([row("2026-09", true, 10), row("2026-08", true, 5), row("2026-09", true, 10), row("2026-08", false, 10)]);
    expect(t.trend.map((m) => m.month)).toEqual(["2026-08", "2026-09"]);
    expect(t.trend[1]).toMatchObject({ orders: 20, discountedOrders: 20, share: 1 });
    expect(t.trend[0]).toMatchObject({ orders: 15, discountedOrders: 5 });
  });

  it("has no share for a month with too few orders", () => {
    expect(MIN_MONTH_ORDERS).toBe(10);
    const t = discountSummary([row("2026-08", true, 3), row("2026-08", false, 6), row("2026-09", true, 5), row("2026-09", false, 5)]);
    expect(t.trend[0].share).toBeNull();
    expect(t.trend[1].share).toBe(0.5);
    // The overall figure still uses every order.
    expect(t.dependency).toBeCloseTo(8 / 19, 10);
  });
});

describe("detectCreeping", () => {
  it("is on when the share rises three months in a row by 8 points", () => {
    const r = detectCreeping([month("2026-05", 0.2), month("2026-06", 0.24), month("2026-07", 0.27), month("2026-08", 0.3)]);
    expect(r.creeping).toBe(true);
    expect(r.risingMonths).toBe(3);
    expect(r.rise).toBeCloseTo(0.1, 10);
    expect(r).toMatchObject({ from: "2026-05", to: "2026-08" });
  });

  it("needs the whole 8 points", () => {
    expect(CREEP_MONTHS).toBe(3);
    expect(CREEP_RISE).toBe(0.08);
    const small = detectCreeping([month("2026-05", 0.2), month("2026-06", 0.22), month("2026-07", 0.25), month("2026-08", 0.27)]);
    expect(small.creeping).toBe(false);
    expect(small.risingMonths).toBe(3);
    const exact = detectCreeping([month("2026-05", 0.2), month("2026-06", 0.23), month("2026-07", 0.25), month("2026-08", 0.28)]);
    expect(exact.creeping).toBe(true);
  });

  it("needs three rises, not two", () => {
    const r = detectCreeping([month("2026-06", 0.1), month("2026-07", 0.2), month("2026-08", 0.4)]);
    expect(r.risingMonths).toBe(2);
    expect(r.creeping).toBe(false);
  });

  it("is off when the last month fell or stood still", () => {
    expect(detectCreeping([month("2026-05", 0.1), month("2026-06", 0.2), month("2026-07", 0.3), month("2026-08", 0.4), month("2026-09", 0.35)]).creeping).toBe(false);
    expect(detectCreeping([month("2026-05", 0.1), month("2026-06", 0.2), month("2026-07", 0.3), month("2026-08", 0.3)]).risingMonths).toBe(0);
  });

  it("looks at the run that ends with the last month, however long", () => {
    const r = detectCreeping([month("2026-01", 0.5), month("2026-02", 0.1), month("2026-03", 0.15), month("2026-04", 0.2), month("2026-05", 0.25), month("2026-06", 0.3)]);
    expect(r).toMatchObject({ creeping: true, risingMonths: 4, from: "2026-02", to: "2026-06" });
    expect(r.rise).toBeCloseTo(0.2, 10);
  });

  it("does not fire on a rise that is only small months' chance (the QA counter-example)", () => {
    // Shares 7, 16, 18, 32 % on 15, 28, 33 and 41 orders: three rises and 25 points, but the first month is 15 orders.
    const trend = [month("2026-05", 0.07, 15), month("2026-06", 0.16, 28), month("2026-07", 0.18, 33), month("2026-08", 0.32, 41)];
    const r = detectCreeping(trend);
    expect(r.risingMonths).toBe(3);
    expect(r.rise).toBeCloseTo(0.25, 10);
    expect(r.creeping).toBe(false);
    // Even with a month of 30 orders at each end, the z-test alone says no (z is about 1.9).
    const z = twoProportionZ(1, 15, 13, 41);
    expect(z).toBeGreaterThan(1.5);
    expect(z).toBeLessThan(CREEP_Z);
  });

  it("fires on a true creep: 22, 31, 46 and 58 % on 120 orders or more", () => {
    const r = detectCreeping([month("2026-05", 0.22, 120), month("2026-06", 0.31, 130), month("2026-07", 0.46, 140), month("2026-08", 0.58, 150)]);
    expect(r).toMatchObject({ creeping: true, risingMonths: 3, from: "2026-05", to: "2026-08" });
    expect(r.z).toBeGreaterThan(CREEP_Z);
  });

  it("needs 30 orders in the first and in the last month of the run", () => {
    expect(CREEP_MIN_ORDERS).toBe(30);
    const rising = (first: number, last: number) => [month("2026-05", 0.1, first), month("2026-06", 0.25, 200), month("2026-07", 0.4, 200), month("2026-08", 0.55, last)];
    expect(detectCreeping(rising(30, 30)).creeping).toBe(true);
    expect(detectCreeping(rising(29, 200)).creeping).toBe(false);
    expect(detectCreeping(rising(200, 29)).creeping).toBe(false);
    // The months in between may be small: only the ends are tested.
    expect(detectCreeping([month("2026-05", 0.1, 200), month("2026-06", 0.25, 12), month("2026-07", 0.4, 12), month("2026-08", 0.55, 200)]).creeping).toBe(true);
  });

  it("needs the rise to be clear of chance: z of the first month against the last at 2.58", () => {
    // 6 of 30 (20 %) to 13 of 30 (43 %) over three rises is 23 points, but z is about 1.9.
    const r = detectCreeping([month("2026-05", 0.2, 30), month("2026-06", 0.3, 30), month("2026-07", 0.4, 30), month("2026-08", 13 / 30, 30)]);
    expect(r.risingMonths).toBe(3);
    expect(r.rise).toBeGreaterThan(CREEP_RISE);
    expect(r.z).toBeLessThan(CREEP_Z);
    expect(r.creeping).toBe(false);
  });

  it("is broken by a month with too few orders", () => {
    const r = detectCreeping([month("2026-05", 0.1), month("2026-06", 0.2), month("2026-07", null, 4), month("2026-08", 0.4), month("2026-09", 0.5)]);
    expect(r.risingMonths).toBe(1);
    expect(r.creeping).toBe(false);
  });

  it("is broken by a missing calendar month", () => {
    const r = detectCreeping([month("2026-04", 0.1), month("2026-06", 0.2), month("2026-07", 0.3), month("2026-08", 0.4)]);
    expect(r.risingMonths).toBe(2);
    expect(r.creeping).toBe(false);
  });

  it("follows the calendar over a year's end", () => {
    const r = detectCreeping([month("2025-11", 0.1), month("2025-12", 0.15), month("2026-01", 0.2), month("2026-02", 0.25)]);
    expect(r).toMatchObject({ creeping: true, risingMonths: 3, from: "2025-11", to: "2026-02" });
  });

  it("says nothing of nothing or one month", () => {
    expect(detectCreeping([]).creeping).toBe(false);
    expect(detectCreeping([month("2026-08", 0.5)])).toEqual({ creeping: false, risingMonths: 0, rise: null, from: null, to: null });
  });

  it("is found through discountSummary", () => {
    const rows: DiscountOrderRow[] = [];
    [["2026-05", 80], ["2026-06", 100], ["2026-07", 120], ["2026-08", 140]].forEach(([m, d]) => {
      rows.push(row(m as string, true, d as number), row(m as string, false, 400 - (d as number)));
    });
    expect(discountSummary(rows).creeping).toMatchObject({ creeping: true, risingMonths: 3 });
  });
});

describe("twoProportionZ", () => {
  it("is the pooled two-proportion z, positive when the second share is higher", () => {
    // 20 % of 400 against 30 % of 400: pooled 25 %, se sqrt(0.25 × 0.75 × 2 / 400).
    expect(twoProportionZ(80, 400, 120, 400)).toBeCloseTo(0.1 / Math.sqrt(0.1875 * 0.005), 10);
    expect(twoProportionZ(120, 400, 80, 400)).toBeLessThan(0);
  });

  it("has none without orders or without spread", () => {
    expect(twoProportionZ(0, 0, 5, 10)).toBeNull();
    expect(twoProportionZ(0, 40, 0, 40)).toBeNull();
    expect(twoProportionZ(40, 40, 40, 40)).toBeNull();
  });
});

describe("couponTable", () => {
  const rows: CouponRow[] = [
    { code: "SUMMER", orders: 10, revenueMinor: 90_000, grossGoodsMinor: 100_000, discountMinor: 10_000 },
    { code: "WELCOME10", orders: 40, revenueMinor: 270_000, grossGoodsMinor: 300_000, discountMinor: 30_000 },
    { code: "UNUSED", orders: 0, revenueMinor: 0, grossGoodsMinor: 0, discountMinor: 0 },
  ];
  const t = couponTable(rows);

  it("ranks by revenue", () => {
    expect(t.map((c) => c.code)).toEqual(["WELCOME10", "SUMMER", "UNUSED"]);
  });

  it("works out each code's figures", () => {
    expect(t[0]).toMatchObject({ discountPct: 0.1, aovMinor: 6750, discountPerOrderMinor: 750 });
    expect(t[0].revenueShare).toBeCloseTo(0.75, 10);
    expect(t[1]).toMatchObject({ aovMinor: 9000, discountPerOrderMinor: 1000 });
  });

  it("has no figures for a code with no orders", () => {
    expect(t[2]).toMatchObject({ discountPct: null, aovMinor: null, discountPerOrderMinor: null });
    expect(t[2].revenueShare).toBe(0);
  });

  it("adds together the same code in another case", () => {
    const merged = couponTable([
      { code: "Summer", orders: 1, revenueMinor: 100, grossGoodsMinor: 120, discountMinor: 20 },
      { code: " summer ", orders: 2, revenueMinor: 200, grossGoodsMinor: 240, discountMinor: 40 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ code: "Summer", orders: 3, revenueMinor: 300, discountMinor: 60 });
  });

  it("has no revenue share when no code brought any", () => {
    expect(couponTable([{ code: "A", orders: 0, revenueMinor: 0, grossGoodsMinor: 0, discountMinor: 0 }])[0].revenueShare).toBeNull();
  });

  it("is empty without rows and does not change its input", () => {
    expect(couponTable([])).toEqual([]);
    expect(rows[0].orders).toBe(10);
    couponTable([rows[0], { ...rows[0] }]);
    expect(rows[0].orders).toBe(10);
  });

  it("breaks ties by orders, then code", () => {
    const tie = couponTable([
      { code: "B", orders: 1, revenueMinor: 100, grossGoodsMinor: 100, discountMinor: 0 },
      { code: "A", orders: 1, revenueMinor: 100, grossGoodsMinor: 100, discountMinor: 0 },
      { code: "C", orders: 5, revenueMinor: 100, grossGoodsMinor: 100, discountMinor: 0 },
    ]);
    expect(tie.map((c) => c.code)).toEqual(["C", "A", "B"]);
  });
});
