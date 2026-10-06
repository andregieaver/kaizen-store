import { describe, expect, it } from "vitest";

import { formatCount } from "./analytics-core";
import type { StockoutAlert } from "./analytics-inventory";
import {
  ALERT_RULES,
  alertsFor,
  MAX_ALERTS,
  median,
  orderAlerts,
  type Alert,
  type AlertSnapshot,
  type ChannelCacRow,
  type DailyPoint,
  type ProductRefundRow,
  type ReturningMonth,
} from "./analytics-alerts";
import { targetProgress } from "./analytics-targets";
import { formatMoney } from "./money";

const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// 2026-09-30 is a Wednesday.
const TODAY = "2026-09-30";
const m = (minor: number) => formatMoney(minor, "EUR", "en");

/**
 * Ninety-one days (90 before today, and today) of a quiet shop: 20 orders, 200 000 revenue and 800 sessions a day (a
 * conversion rate of 2.5 %). `f(k)` changes the day `k` days before today (0 is today) or, returning null, takes it away.
 */
function daily(f: (k: number) => Partial<DailyPoint> | null = () => ({}), from = 90): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let k = from; k >= 0; k--) {
    const over = f(k);
    if (over === null) continue;
    out.push({ day: addDays(TODAY, -k), orders: 20, revenueMinor: 200_000, sessions: 800, ...over });
  }
  return out;
}

/** A snapshot of the quiet shop, early in the day (so today's own rules sleep), with anything changed. */
const snap = (over: Partial<AlertSnapshot> = {}): AlertSnapshot => ({ currency: "EUR", locale: "en", today: TODAY, dayShare: 0.3, daily: daily(), ...over });

const ids = (alerts: Alert[]) => alerts.map((a) => a.id);
const only = (alerts: Alert[], id: string) => alerts.find((a) => a.id === id);

describe("a quiet shop", () => {
  it("raises nothing", () => {
    expect(alertsFor(snap())).toEqual([]);
  });

  it("raises nothing, and nothing about it, with no visit counting and no other input at all", () => {
    expect(alertsFor(snap({ daily: daily(() => ({ sessions: null })) }))).toEqual([]);
    expect(alertsFor(snap({ daily: [] }))).toEqual([]);
  });

  it("rejects a today that is not a day", () => {
    expect(() => alertsFor(snap({ today: "yesterday" }))).toThrow(RangeError);
  });
});

describe("conversion drop", () => {
  const r = ALERT_RULES.conversion;
  /** The last 7 complete days with `orders` orders on 800 sessions each. */
  const week = (orders: number, sessions = 800) => daily((k) => (k >= 1 && k <= 7 ? { orders, sessions } : {}));
  const conv = (s: AlertSnapshot) => only(alertsFor(s), "conversion-drop");

  it("fires at the threshold: 2.0 % against 2.5 % is exactly 20 % lower", () => {
    const a = conv(snap({ daily: week(16) }))!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe("Conversion rate is 20 % lower over the last 7 days than the four weeks before (2.0 % against 2.5 %).");
    expect(a.href).toBe("/analytics/traffic");
    expect(a.action).toBeTruthy();
    expect(a.evidence.map((e) => e.value)).toEqual(["2.0 %", formatCount(5600), formatCount(112)]);
    expect(a.evidence[0].baseline).toBe("2.5 % over the four weeks before");
  });

  it("is quiet just under it (15 % lower) and says it past it (25 % lower)", () => {
    expect(r.minDrop).toBe(0.2);
    expect(conv(snap({ daily: week(17) }))).toBeUndefined();
    const a = conv(snap({ daily: week(15) }))!;
    expect(a.text).toBe("Conversion rate is 25 % lower over the last 7 days than the four weeks before (1.9 % against 2.5 %).");
    expect(a.severity).toBe("warning");
  });

  it("is urgent from 40 % lower: 35 % is a warning", () => {
    expect(conv(snap({ daily: week(12) }))!.severity).toBe("urgent");
    expect(conv(snap({ daily: week(13) }))!.severity).toBe("warning");
    expect(r.urgentDrop).toBe(0.4);
  });

  it("is quiet when conversion rose", () => {
    expect(conv(snap({ daily: week(30) }))).toBeUndefined();
  });

  it("needs 700 sessions in the week: 100 a day is enough, 99 is not", () => {
    expect(r.minSessions7d).toBe(700);
    expect(conv(snap({ daily: week(1, 100) }))).toBeDefined();
    expect(conv(snap({ daily: week(1, 99) }))).toBeUndefined();
  });

  it("needs five days with a visit count in the week", () => {
    const known = (n: number) => daily((k) => (k >= 1 && k <= 7 ? (k <= n ? { orders: 12, sessions: 800 } : { orders: 12, sessions: null }) : {}));
    expect(conv(snap({ daily: known(5) }))).toBeDefined();
    expect(conv(snap({ daily: known(4) }))).toBeUndefined();
  });

  it("needs 1 500 sessions and 30 orders in the four weeks it is compared with, over 14 known days", () => {
    // The comparison window is the 28 days before the week: days 8 to 35 before today.
    const base = (known: number, sessions: number, orders: number) =>
      daily((k) => {
        if (k >= 1 && k <= 7) return { orders: 0, sessions: 800 };
        if (k >= 8 && k <= 35) return k - 8 < known ? { orders, sessions } : { orders: 5, sessions: null };
        return {};
      });
    // 14 known days of 108 sessions and 3 orders: 1 512 sessions, 42 orders, a rate of 2.8 %.
    expect(conv(snap({ daily: base(14, 108, 3) }))).toBeDefined();
    // 107 sessions: 1 498, one under.
    expect(conv(snap({ daily: base(14, 107, 3) }))).toBeUndefined();
    // 13 known days.
    expect(conv(snap({ daily: base(13, 120, 3) }))).toBeUndefined();
    // Orders: 28 days of 1 is 28, two days of 2 gets to 30. (Sessions 100 a day: 2 800.)
    const orders = (twos: number) => daily((k) => (k <= 7 ? { orders: 0, sessions: 800 } : k <= 35 ? { orders: k - 8 < twos ? 2 : 1, sessions: 100 } : {}));
    expect(conv(snap({ daily: orders(1) }))).toBeUndefined(); // 29
    expect(conv(snap({ daily: orders(2) }))).toBeDefined(); // 30
    expect(r.minBaselineSessions).toBe(1500);
    expect(r.minBaselineOrders).toBe(30);
  });

  it("leaves out orders of days whose visits were not counted, so a late start of counting is not a drop", () => {
    // Visit counting began 3 days ago: the older days have orders but no sessions.
    const s = daily((k) => (k > 3 ? { sessions: null } : {}));
    expect(alertsFor(snap({ daily: s }))).toEqual([]);
  });

  describe("today so far", () => {
    const todayRow = (orders: number, sessions: number) => daily((k) => (k === 0 ? { orders, sessions } : {}));

    it("is judged from noon, against the last four weeks, with 150 sessions", () => {
      const a = conv(snap({ daily: todayRow(0, 150), dayShare: 0.5 }))!;
      expect(a.text).toBe("Conversion rate is 100 % lower today than the last four weeks (0.0 % against 2.5 %).");
      expect(a.severity).toBe("urgent");
      expect(a.evidence[0].label).toBe("Conversion rate, today so far");
    });

    it("sleeps before noon", () => {
      expect(conv(snap({ daily: todayRow(0, 150), dayShare: 0.49 }))).toBeUndefined();
      expect(r.minDayShare).toBe(0.5);
    });

    it("needs 150 sessions today", () => {
      expect(conv(snap({ daily: todayRow(0, 149), dayShare: 0.9 }))).toBeUndefined();
      expect(r.minSessionsToday).toBe(150);
    });

    it("fires at 20 % lower and not under: 200 sessions with 4 orders is 2.0 %", () => {
      expect(conv(snap({ daily: todayRow(4, 200), dayShare: 0.6 }))!.text).toContain("20 % lower today");
      expect(conv(snap({ daily: todayRow(17, 800), dayShare: 0.6 }))).toBeUndefined(); // 2.125 %: 15 % lower
    });

    it("lets the week speak first when both are down", () => {
      const both = daily((k) => (k === 0 ? { orders: 0, sessions: 800 } : k >= 1 && k <= 7 ? { orders: 12 } : {}));
      const a = conv(snap({ daily: both, dayShare: 0.8 }))!;
      expect(a.text).toContain("over the last 7 days");
    });
  });
});

describe("revenue against the weekday's usual", () => {
  const r = ALERT_RULES.weekdayRevenue;
  const rev = (s: AlertSnapshot) => only(alertsFor(s), "revenue-weekday");
  /** Today's own revenue, and a usual Wednesday's orders. */
  const withToday = (revenueMinor: number, usualOrders = 20) =>
    daily((k) => (k === 0 ? { revenueMinor, orders: 3 } : k % 7 === 0 ? { orders: usualOrders } : {}));

  it("fires at half the expected by now: 90 000 of 180 000 (90 % of a 200 000 day)", () => {
    const a = rev(snap({ daily: withToday(90_000), dayShare: 0.9 }))!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe(`Revenue so far today is ${m(90_000)}, 50 % under a usual Wednesday by this time (${m(180_000)}).`);
    expect(a.href).toBe("/analytics");
    expect(a.evidence[1]).toEqual({ label: "A usual Wednesday, all day", value: m(200_000), baseline: "median of the last 8 Wednesdays" });
  });

  it("is quiet just above it", () => {
    expect(rev(snap({ daily: withToday(90_001), dayShare: 0.9 }))).toBeUndefined();
    expect(r.minDrop).toBe(0.5);
  });

  it("is urgent from 80 % under", () => {
    expect(rev(snap({ daily: withToday(36_000), dayShare: 0.9 }))!.severity).toBe("urgent");
    expect(rev(snap({ daily: withToday(36_001), dayShare: 0.9 }))!.severity).toBe("warning");
    expect(r.urgentDrop).toBe(0.8);
  });

  it("says no revenue as no revenue, not as a negative", () => {
    const a = rev(snap({ daily: withToday(-5000), dayShare: 0.9 }))!;
    expect(a.text).toContain(`Revenue so far today is ${m(0)}, 100 % under`);
  });

  it("sleeps until 20:00 and speaks at it, with the expectation scaled to the share of the day", () => {
    expect(r.minDayShare).toBeCloseTo(20 / 24, 12);
    for (const share of [0.3, 0.5, 0.6, 0.8, 19 / 24, 0.8333]) expect(rev(snap({ daily: withToday(0), dayShare: share }))).toBeUndefined();
    const a = rev(snap({ daily: withToday(40_000), dayShare: 20 / 24 }))!; // expected 166 667, 76 % under
    expect(a.text).toContain(`(${m(166_667)})`);
  });

  it("never judges a morning, however quiet: a store whose sales come late is not behind at noon", () => {
    expect(rev(snap({ daily: withToday(0), dayShare: 0.5 }))).toBeUndefined();
    expect(rev(snap({ daily: withToday(30_000), dayShare: 0.5 }))).toBeUndefined();
  });

  it("needs the usual day to bring 15 orders by now: 18 a day at 20:00 is enough, 17 is not", () => {
    expect(r.minExpectedOrders).toBe(15);
    expect(rev(snap({ daily: withToday(0, 18), dayShare: 20 / 24 }))).toBeDefined();
    expect(rev(snap({ daily: withToday(0, 17), dayShare: 20 / 24 }))).toBeUndefined();
  });

  it("needs six of the last eight same weekdays", () => {
    const missing = (n: number) => daily((k) => (k === 0 ? { revenueMinor: 0 } : k % 7 === 0 && k / 7 <= n ? null : {}));
    expect(rev(snap({ daily: missing(2), dayShare: 0.9 }))).toBeDefined(); // 6 left
    expect(rev(snap({ daily: missing(3), dayShare: 0.9 }))).toBeUndefined(); // 5 left
    expect(r.minObservations).toBe(6);
  });

  it("uses the median, so one freak Wednesday does not move the usual", () => {
    // Three of the eight Wednesdays at 10 times the usual: the median of eight is still 200 000.
    const spiky = daily((k) => (k === 0 ? { revenueMinor: 60_000 } : k % 7 === 0 && k <= 21 ? { revenueMinor: 2_000_000 } : {}));
    expect(rev(snap({ daily: spiky, dayShare: 0.9 }))!.text).toContain(`(${m(180_000)})`);
  });

  it("does nothing without a row for today (it is not taken as no sales), or without a day share", () => {
    expect(rev(snap({ daily: daily((k) => (k === 0 ? null : {})), dayShare: 0.9 }))).toBeUndefined();
    expect(rev(snap({ daily: withToday(0), dayShare: Number.NaN }))).toBeUndefined();
  });

  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("product refunds", () => {
  const r = ALERT_RULES.refunds;
  const row = (over: Partial<ProductRefundRow> = {}): ProductRefundRow => ({ productId: "p1", name: "Wool hat", sold14: 20, refunded14: 2, soldBaseline: 100, refundedBaseline: 5, ...over });
  const refund = (...rows: ProductRefundRow[]) => only(alertsFor(snap({ productRefunds: rows })), "refund-rate");

  it("fires at twice the usual rate: 2 of 20 (10 %) against 5 %", () => {
    const a = refund(row())!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe("Refunds on Wool hat are running at 2 times their usual rate: 2 of 20 sold in the last 14 days (10 %) against 5.0 % before.");
    expect(a.href).toBe("/analytics/products?sort=refunds");
    expect(a.evidence).toEqual([{ label: "Refunded units, Wool hat, last 14 days", value: "2 of 20 (10.0 %)", baseline: "5.0 % over the 90 days before" }]);
    expect(r.minRatio).toBe(2);
  });

  it("is quiet under it: 2 of 21 is 9.5 %, 1.9 times", () => {
    expect(refund(row({ sold14: 21 }))).toBeUndefined();
  });

  it("needs 5 sold and 2 refunded in the last 14 days", () => {
    expect(refund(row({ sold14: 5, refunded14: 2 }))).toBeDefined();
    expect(refund(row({ sold14: 4, refunded14: 2 }))).toBeUndefined();
    expect(refund(row({ sold14: 20, refunded14: 1 }))).toBeUndefined();
    expect(r.minSold).toBe(5);
    expect(r.minRefunded).toBe(2);
  });

  it("needs 20 sold in the baseline to have a usual", () => {
    expect(refund(row({ soldBaseline: 20, refundedBaseline: 1 }))).toBeDefined();
    expect(refund(row({ soldBaseline: 19, refundedBaseline: 1 }))).toBeUndefined();
  });

  it("compares a product that has never had a refund with a floor of 2 %, and says so without a multiple", () => {
    const a = refund(row({ refundedBaseline: 0 }))!;
    expect(a.text).toBe("Refunds on Wool hat are well above what they usually are: 2 of 20 sold in the last 14 days (10 %) against 0.0 % before.");
    // Right on the floor's twice: a recent rate of 4 % is under the 5 % that is worth a word.
    expect(refund(row({ sold14: 50, refunded14: 2, refundedBaseline: 0 }))).toBeUndefined();
  });

  it("says nothing of a recent rate under 5 %, however it compares, and does at 5 %", () => {
    expect(refund(row({ sold14: 100, refunded14: 2, soldBaseline: 400, refundedBaseline: 2 }))).toBeUndefined(); // 2 % against 0.5 %
    expect(refund(row({ sold14: 40, refunded14: 2, soldBaseline: 400, refundedBaseline: 4 }))).toBeDefined(); // 5 % against 1 %
    expect(r.minRate).toBe(0.05);
  });

  it("is urgent at four times the usual with five refunds", () => {
    expect(refund(row({ sold14: 20, refunded14: 5 }))!.severity).toBe("urgent"); // 25 % against 5 %
    expect(refund(row({ sold14: 16, refunded14: 4 }))!.severity).toBe("warning"); // 25 % but four refunds
    expect(refund(row({ sold14: 25, refunded14: 5, soldBaseline: 100, refundedBaseline: 6 }))!.severity).toBe("warning"); // 3.3 times
  });

  it("names the worst product and counts the others", () => {
    const a = refund(row({ productId: "a", name: "Mild", sold14: 20, refunded14: 2 }), row({ productId: "b", name: "Worst", sold14: 10, refunded14: 5 }), row({ productId: "c", name: "Third", sold14: 20, refunded14: 3 }))!;
    expect(a.text.startsWith("Refunds on Worst")).toBe(true);
    expect(a.text).toContain("2 other products are also over twice their usual rate.");
    expect(a.evidence).toHaveLength(3);
    expect(refund(row({ productId: "a" }), row({ productId: "b", name: "Other", sold14: 10, refunded14: 3 }))!.text).toContain("Another product is also over twice its usual rate.");
  });

  it("skips rows with missing figures", () => {
    expect(refund(row({ sold14: Number.NaN }))).toBeUndefined();
  });
});

describe("cost per new customer", () => {
  const r = ALERT_RULES.cac;
  /** 4 new customers for 40 000 now (10 000 each), 16 for 160 000 before (10 000 each), unless changed. */
  const ch = (over: Partial<ChannelCacRow> = {}): ChannelCacRow => ({ channel: "paid_search", label: "Paid search", spend7Minor: 40_000, newCustomers7: 4, spendPrev28Minor: 160_000, newCustomersPrev28: 16, ...over });
  const cac = (...rows: ChannelCacRow[]) => only(alertsFor(snap({ channelCac: rows })), "cac-up");

  it("is quiet when the cost is the same", () => {
    expect(cac(ch())).toBeUndefined();
  });

  it("fires at a quarter more: 12 500 against 10 000", () => {
    const a = cac(ch({ spend7Minor: 50_000 }))!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe(`A new customer from Paid search cost ${m(12_500)} over the last 7 days, 25 % more than the ${m(10_000)} of the four weeks before.`);
    expect(a.href).toBe("/analytics/marketing");
    expect(r.minRise).toBe(0.25);
  });

  it("is quiet just under (22.5 %) and speaks over (50 %)", () => {
    expect(cac(ch({ spend7Minor: 49_000 }))).toBeUndefined();
    expect(cac(ch({ spend7Minor: 60_000 }))!.text).toContain("50 % more");
  });

  it("is quiet when the cost fell", () => {
    expect(cac(ch({ spend7Minor: 20_000 }))).toBeUndefined();
  });

  it("needs 200 spent in the week and in the four weeks before", () => {
    // 3 new customers keep the cost up while the spend moves.
    const base = { newCustomers7: 3, spendPrev28Minor: 40_000, newCustomersPrev28: 10 }; // 4 000 before
    expect(cac(ch({ ...base, spend7Minor: 20_000 }))).toBeDefined(); // 6 667 now
    expect(cac(ch({ ...base, spend7Minor: 19_999 }))).toBeUndefined();
    const prior = { spend7Minor: 20_000, newCustomers7: 3, newCustomersPrev28: 8 };
    expect(cac(ch({ ...prior, spendPrev28Minor: 20_000 }))).toBeDefined(); // 2 500 before
    expect(cac(ch({ ...prior, spendPrev28Minor: 19_999 }))).toBeUndefined();
    expect(r.minSpend7d).toBe(20_000);
    expect(r.minSpend28d).toBe(20_000);
  });

  it("needs 3 new customers in the week and 8 in the four weeks before", () => {
    expect(cac(ch({ spend7Minor: 60_000, newCustomers7: 2 }))).toBeUndefined();
    expect(cac(ch({ spend7Minor: 40_000, newCustomers7: 3, spendPrev28Minor: 80_000, newCustomersPrev28: 8 }))).toBeDefined(); // 13 333 against 10 000
    expect(cac(ch({ spend7Minor: 40_000, newCustomers7: 3, spendPrev28Minor: 70_000, newCustomersPrev28: 7 }))).toBeUndefined();
  });

  it("names the channel with the biggest rise and counts the others", () => {
    const a = cac(ch({ spend7Minor: 60_000 }), ch({ channel: "social", label: "Paid social", spend7Minor: 100_000 }), ch({ channel: "email", label: "Email", spend7Minor: 55_000 }))!;
    expect(a.text.startsWith("A new customer from Paid social")).toBe(true);
    expect(a.text).toContain("2 other channels are also up by a quarter or more.");
    expect(a.evidence.map((e) => e.label)).toEqual(["Cost per new customer, Paid social", "Cost per new customer, Paid search", "Cost per new customer, Email"]);
    expect(cac(ch({ spend7Minor: 60_000 }), ch({ channel: "social", label: "Paid social", spend7Minor: 100_000 }))!.text).toContain("Another channel is also up");
  });
});

describe("stock running out", () => {
  const so = (name: string, kind: "out" | "soon", days: number, sold30 = 12): StockoutAlert => ({
    kind,
    days,
    row: { variantId: name, productId: name, name, sku: null, tracked: true, onHand: kind === "out" ? 0 : 5, stockPolicy: "deny", owed: 0, sold7: 3, sold30, soldPeriod: sold30, lastSoldDaysAgo: 1, ageDays: 200, costMinor: null, lowStockThreshold: null },
  });
  const stock = (...rows: StockoutAlert[]) => only(alertsFor(snap({ stockouts: rows })), "stockout");

  it("is urgent for something that sells and is gone", () => {
    const a = stock(so("Wool hat", "out", 0))!;
    expect(a.severity).toBe("urgent");
    expect(a.text).toBe("Out of stock: Wool hat (out).");
    expect(a.href).toBe("/analytics/inventory");
    expect(a.evidence).toEqual([{ label: "Wool hat", value: "Out of stock", baseline: "12 sold in 30 days" }]);
  });

  it("is a warning for something that will be gone within a week", () => {
    const a = stock(so("Scarf", "soon", 2.4), so("Mug", "soon", 0.4), so("Cap", "soon", 1))!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe("Running out within a week: Mug (under a day), Cap (about 1 day), Scarf (about 2 days).");
  });

  it("names three, soonest first with the out ones before, and counts the rest", () => {
    const a = stock(so("E", "soon", 6), so("D", "soon", 5), so("C", "soon", 3), so("B", "out", 0), so("A", "out", 0))!;
    expect(a.text).toBe("Out of stock or running out within a week: A (out), B (out), C (about 3 days) and 2 more.");
    expect(a.severity).toBe("urgent");
    expect(a.evidence).toHaveLength(3);
    expect(stock(so("A", "out", 0), so("B", "out", 0), so("C", "out", 0), so("D", "out", 0))!.text).toBe("Out of stock: A (out), B (out), C (out) and 1 more.");
  });

  it("leaves out those with more than 7 days, and says nothing for none", () => {
    expect(stock(so("Late", "soon", 7.5))).toBeUndefined();
    expect(stock(so("Edge", "soon", 7))).toBeDefined();
    expect(stock()).toBeUndefined();
    expect(ALERT_RULES.stockout.withinDays).toBe(7);
    expect(ALERT_RULES.stockout.named).toBe(3);
  });
});

describe("checkout abandonment", () => {
  const r = ALERT_RULES.abandonment;
  /** Baseline: 400 started, 240 completed (40 % not completed). */
  const BASE = { started: 400, completed: 240 };
  const aband = (recent: { started: number; completed: number }, baseline = BASE) => only(alertsFor(snap({ checkout: { recent, baseline } })), "checkout-abandonment");

  it("fires at ten points more: 50 % against 40 %", () => {
    const a = aband({ started: 100, completed: 50 })!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe("50 % of the checkouts started in the last 7 days were not completed, against 40 % over the four weeks before.");
    expect(a.href).toBe("/analytics/traffic");
    expect(r.minRisePoints).toBe(0.1);
  });

  it("is quiet at nine points and speaks above", () => {
    expect(aband({ started: 100, completed: 51 })).toBeUndefined();
    expect(aband({ started: 100, completed: 40 })).toBeDefined();
  });

  it("is urgent from 25 points: 65 % against 40 %", () => {
    expect(aband({ started: 100, completed: 35 })!.severity).toBe("urgent");
    expect(aband({ started: 100, completed: 36 })!.severity).toBe("warning");
    expect(r.urgentRisePoints).toBe(0.25);
  });

  it("needs 50 checkouts started in the week and 200 in the four weeks before", () => {
    expect(aband({ started: 50, completed: 25 })).toBeDefined();
    expect(aband({ started: 49, completed: 24 })).toBeUndefined();
    expect(aband({ started: 100, completed: 50 }, { started: 200, completed: 120 })).toBeDefined();
    expect(aband({ started: 100, completed: 50 }, { started: 199, completed: 119 })).toBeUndefined();
  });

  it("does nothing without visit counting, and does not count more completed than started", () => {
    expect(only(alertsFor(snap({ checkout: null })), "checkout-abandonment")).toBeUndefined();
    expect(aband({ started: 100, completed: 150 })).toBeUndefined();
  });
});

describe("discounts creeping", () => {
  it("says it, as information", () => {
    const a = only(alertsFor(snap({ discountCreeping: { creeping: true, risingMonths: 3, rise: 0.1, from: "2026-06", to: "2026-09" } })), "discount-creep")!;
    expect(a.severity).toBe("info");
    expect(a.text).toBe("The share of orders with a discount has risen 3 months in a row, by 10 percentage points from June 2026 to September 2026.");
    expect(a.href).toBe("/analytics/marketing");
  });

  it("says nothing when it is not creeping, or unknown", () => {
    expect(alertsFor(snap({ discountCreeping: { creeping: false, risingMonths: 2, rise: 0.05, from: "2026-07", to: "2026-09" } }))).toEqual([]);
    expect(alertsFor(snap({ discountCreeping: { creeping: false, risingMonths: 0, rise: null, from: null, to: null } }))).toEqual([]);
    expect(alertsFor(snap({ discountCreeping: null }))).toEqual([]);
  });
});

describe("a target at risk", () => {
  const progress = (actualMinor: number, today = "2026-09-10") => targetProgress({ targetMinor: 300_000, actualMinor, monthStart: "2026-09-01", today });
  const tgt = (t: ReturnType<typeof progress> | null) => only(alertsFor(snap({ target: t })), "target-behind");

  it("says how far behind and where the month ends at this pace, with the words 'an estimate'", () => {
    const a = tgt(progress(80_000))!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe(
      `Net revenue is ${m(20_000)} behind the pace the September target needs: ${m(80_000)} so far against ${m(100_000)} expected by now. At this pace the month ends near ${m(240_000)}, 80 % of the ${m(300_000)} target (an estimate).`,
    );
    expect(a.href).toBe("/analytics");
    expect(a.evidence.map((e) => e.value)).toEqual([m(80_000), m(240_000)]);
  });

  it("is urgent when the month is on course for 70 % of the target or less", () => {
    expect(tgt(progress(70_000))!.severity).toBe("urgent"); // 210 000 of 300 000
    expect(tgt(progress(72_000))!.severity).toBe("warning"); // 216 000
    expect(ALERT_RULES.target.urgentProjectedShare).toBe(0.7);
  });

  it("is quiet when on track, ahead, without a target or too early in the month", () => {
    expect(tgt(progress(100_000))).toBeUndefined();
    expect(tgt(progress(150_000))).toBeUndefined();
    expect(tgt(targetProgress({ targetMinor: null, actualMinor: 1, monthStart: "2026-09-01", today: "2026-09-10" }))).toBeUndefined();
    const early = progress(0, "2026-09-02");
    expect(early.tooEarly).toBe(true);
    expect(tgt(early)).toBeUndefined();
    expect(tgt(null)).toBeUndefined();
  });

  it("speaks from the eighth day of the month, once seven whole days have passed (the figures show from the fourth)", () => {
    expect(progress(0, "2026-09-03").tooEarly).toBe(false);
    expect(tgt(progress(0, "2026-09-03"))).toBeUndefined();
    expect(tgt(progress(0, "2026-09-07"))).toBeUndefined();
    expect(tgt(progress(0, "2026-09-08"))).toBeDefined();
    expect(ALERT_RULES.target.minDaysElapsed).toBe(7);
  });
});

describe("a target at risk: volume and chance", () => {
  const SEP10 = "2026-09-10";
  /** A month's days (from 1 September to `today`) of a shop selling `orders` orders and `revenue` a day, with 56 days before. */
  const month = (today: string, orders: number, revenue: number, revenueOf?: (day: string) => number): DailyPoint[] => {
    const out: DailyPoint[] = [];
    for (let d = addDays(today, -56); d <= today; d = addDays(d, 1)) out.push({ day: d, orders, revenueMinor: revenueOf ? revenueOf(d) : revenue, sessions: 800 });
    return out;
  };
  const alertFor = (rows: DailyPoint[], actualMinor: number, today = SEP10, target = 300_000) =>
    only(
      alertsFor({
        currency: "EUR",
        today,
        dayShare: 0.3,
        daily: rows,
        target: targetProgress({ targetMinor: target, actualMinor, monthStart: "2026-09-01", today }),
      }),
      "target-behind",
    );
  const monthSoFar = (rows: DailyPoint[], today: string) => rows.filter((d) => d.day >= "2026-09-01" && d.day <= today).reduce((a, d) => a + d.revenueMinor, 0);

  it("has a minimum volume of its own: 30 orders in the month so far", () => {
    expect(ALERT_RULES.target.minOrders).toBe(30);
    // Eight whole days and a bit of the ninth: a shortfall in revenue (5 000 a day against a target of 10 000 a day)...
    const few = (orders: number) => month(SEP10, orders, 5_000);
    const rows = few(3); // 10 days with a row, 30 orders
    expect(alertFor(rows, monthSoFar(rows, SEP10))).toBeDefined();
    const fewer = few(2); // 20 orders
    expect(alertFor(fewer, monthSoFar(fewer, SEP10))).toBeUndefined();
  });

  it("needs seven whole days of the month, not three", () => {
    const rows = month("2026-09-07", 20, 5_000);
    expect(alertFor(rows, monthSoFar(rows, "2026-09-07"), "2026-09-07")).toBeUndefined();
    const later = month("2026-09-08", 20, 5_000);
    expect(alertFor(later, monthSoFar(later, "2026-09-08"), "2026-09-08")).toBeDefined();
  });

  it("needs a history of 14 days to know how much a day varies", () => {
    expect(ALERT_RULES.target.minHistoryDays).toBe(14);
    const full = month(SEP10, 20, 5_000);
    expect(alertFor(full, monthSoFar(full, SEP10))).toBeDefined();
    // From 1 September on there are nine whole days before the 10th, plus three of August: 12 known days.
    const thin = full.filter((d) => d.day >= "2026-08-29");
    expect(alertFor(thin, monthSoFar(thin, SEP10))).toBeUndefined();
    const enough = full.filter((d) => d.day >= "2026-08-27"); // 14 known days
    expect(alertFor(enough, monthSoFar(enough, SEP10))).toBeDefined();
  });

  it("stays quiet about a shortfall that a run of quiet days explains, and speaks about one it does not", () => {
    // Daily revenue swings from 100 000 to 300 000 (a spread of about 100 000 a day); the target needs 200 000 a day.
    const swing = (d: string) => (Number(d.slice(8)) % 2 === 0 ? 100_000 : 300_000);
    const rows = month(SEP10, 20, 0, swing);
    const sofar = monthSoFar(rows, SEP10);
    // The target is set so that the month so far is `shortfall` short of what it needs by now (ten days of 30, the weights even).
    const t = (shortfall: number) => alertFor(rows, sofar, SEP10, Math.round(((sofar + shortfall) * 30) / 10));
    expect(t(300_000)).toBeUndefined(); // 15 % short, but within what the days so far could add up to by chance
    expect(t(2_000_000)).toBeDefined();
  });
});

/**
 * Simulated ordinary days: orders arrive as a Poisson process through an evening-weighted day (about a quarter of the
 * orders before noon, as a typical Nordic shop sees), a weekday pattern and orders of 60 to 140 % of an average basket.
 * Every rule is given a shop that is exactly at its own normal, so anything it says is noise.
 */
describe("false alarms on ordinary days (simulation)", () => {
  // A seeded generator, so the test is the same every run.
  const generator = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const HOURS = [0.5, 0.3, 0.2, 0.2, 0.2, 0.4, 1, 2, 3.5, 4.5, 5, 5.5, 5.5, 5.5, 5, 5, 5.5, 6, 7, 8, 7, 5.5, 3, 1.5];
  const WEIGHT_TOTAL = HOURS.reduce((a, b) => a + b, 0);
  const WEEKDAY = [0.9, 0.95, 1, 1, 1.2, 1.3, 0.8]; // Monday first
  const BASKET = 50_000;

  const poisson = (mean: number, rand: () => number): number => {
    // Knuth for a small mean; a day's total is built from hours, so it stays small.
    const limit = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rand();
    } while (p > limit);
    return k - 1;
  };
  /** One day: orders and revenue before each hour (0 to 24), so a day can be read at any hour. */
  const simDay = (perDay: number, rand: () => number) => {
    const ordersBefore: number[] = [0];
    const revenueBefore: number[] = [0];
    for (let h = 0; h < 24; h++) {
      const n = poisson((perDay * HOURS[h]) / WEIGHT_TOTAL, rand);
      let revenue = 0;
      for (let i = 0; i < n; i++) revenue += Math.round(BASKET * (0.6 + 0.8 * rand()));
      ordersBefore.push(ordersBefore[h] + n);
      revenueBefore.push(revenueBefore[h] + revenue);
    }
    return { ordersBefore, revenueBefore };
  };
  const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  const RUNS = 200;
  const LIMIT = 0.03;

  it("revenue against the weekday's usual: fires on under 3 % of 200 ordinary days, whatever the hour it is read at", () => {
    for (const perDay of [20, 30, 80]) {
      for (const hour of [12, 16, 20, 23]) {
        const rand = generator(1000 + perDay * 31 + hour);
        let fired = 0;
        for (let run = 0; run < RUNS; run++) {
          const today = addDays("2026-03-01", Math.floor(rand() * 300));
          const rows: DailyPoint[] = [];
          for (let k = 56; k >= 1; k--) {
            const day = addDays(today, -k);
            const sim = simDay(perDay * WEEKDAY[weekdayOf(day)], rand);
            rows.push({ day, orders: sim.ordersBefore[24], revenueMinor: sim.revenueBefore[24], sessions: null });
          }
          const sim = simDay(perDay * WEEKDAY[weekdayOf(today)], rand);
          rows.push({ day: today, orders: sim.ordersBefore[hour], revenueMinor: sim.revenueBefore[hour], sessions: null });
          if (only(alertsFor({ currency: "EUR", today, dayShare: hour / 24, daily: rows }), "revenue-weekday")) fired++;
        }
        expect(fired / RUNS, `${perDay} orders a day, read at ${hour}:00`).toBeLessThan(LIMIT);
      }
    }
  });

  it("a target that is exactly the shop's normal month: the alert fires on under 3 % of 200 ordinary days", () => {
    for (const perDay of [8, 15, 30]) {
      const rand = generator(5000 + perDay);
      let fired = 0;
      let urgent = 0;
      for (let run = 0; run < RUNS; run++) {
        const dayOfMonth = 4 + Math.floor(rand() * 25); // the 4th to the 28th
        const hour = Math.floor(rand() * 24);
        const month = 1 + Math.floor(rand() * 9);
        const today = `2026-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
        const monthStart = `${today.slice(0, 8)}01`;
        const daysInMonth = new Date(Date.UTC(2026, month, 0)).getUTCDate();
        const rows: DailyPoint[] = [];
        for (let k = 56; k >= 1; k--) {
          const day = addDays(today, -k);
          const sim = simDay(perDay * WEEKDAY[weekdayOf(day)], rand);
          rows.push({ day, orders: sim.ordersBefore[24], revenueMinor: sim.revenueBefore[24], sessions: null });
        }
        const sim = simDay(perDay * WEEKDAY[weekdayOf(today)], rand);
        rows.push({ day: today, orders: sim.ordersBefore[hour], revenueMinor: sim.revenueBefore[hour], sessions: null });
        // The target is what the month brings on average: every day's expected orders at the average basket.
        let target = 0;
        for (let d = 0; d < daysInMonth; d++) target += perDay * WEEKDAY[weekdayOf(addDays(monthStart, d))] * BASKET;
        const actual = rows.filter((d) => d.day >= monthStart).reduce((a, d) => a + d.revenueMinor, 0);
        const progress = targetProgress({
          targetMinor: Math.round(target),
          actualMinor: actual,
          monthStart,
          today,
          dailyActuals: rows.filter((d) => d.day < today).map((d) => ({ day: d.day, revenueMinor: d.revenueMinor })),
          todayShare: hour / 24,
        });
        const found = only(alertsFor({ currency: "EUR", today, dayShare: hour / 24, daily: rows, target: progress }), "target-behind");
        if (found) fired++;
        if (found?.severity === "urgent") urgent++;
      }
      expect(fired / RUNS, `${perDay} orders a day`).toBeLessThan(LIMIT);
      expect(urgent / RUNS, `${perDay} orders a day, urgent`).toBeLessThan(LIMIT);
    }
  });

  it("still speaks when the shop really is behind: half the orders all day, every day of the month so far", () => {
    const rand = generator(77);
    let fired = 0;
    for (let run = 0; run < 50; run++) {
      const today = "2026-09-20";
      const rows: DailyPoint[] = [];
      for (let k = 56; k >= 0; k--) {
        const day = addDays(today, -k);
        // The last 19 days (the month so far, to the 19th and today) sell half as much as the days before.
        const sim = simDay((k < 20 ? 15 : 30) * WEEKDAY[weekdayOf(day)], rand);
        rows.push({ day, orders: sim.ordersBefore[k === 0 ? 12 : 24], revenueMinor: sim.revenueBefore[k === 0 ? 12 : 24], sessions: null });
      }
      let target = 0;
      for (let d = 0; d < 30; d++) target += 30 * WEEKDAY[weekdayOf(addDays("2026-09-01", d))] * BASKET;
      const progress = targetProgress({
        targetMinor: Math.round(target),
        actualMinor: rows.filter((d) => d.day >= "2026-09-01").reduce((a, d) => a + d.revenueMinor, 0),
        monthStart: "2026-09-01",
        today,
        dailyActuals: rows.filter((d) => d.day < today).map((d) => ({ day: d.day, revenueMinor: d.revenueMinor })),
        todayShare: 0.5,
      });
      if (only(alertsFor({ currency: "EUR", today, dayShare: 0.5, daily: rows, target: progress }), "target-behind")) fired++;
    }
    expect(fired).toBeGreaterThan(40);
  });

  it("revenue against the weekday's usual: still speaks on a collapsed evening", () => {
    const rand = generator(91);
    let fired = 0;
    for (let run = 0; run < 50; run++) {
      const today = addDays("2026-03-01", Math.floor(rand() * 300));
      const rows: DailyPoint[] = [];
      for (let k = 56; k >= 1; k--) {
        const day = addDays(today, -k);
        const sim = simDay(40 * WEEKDAY[weekdayOf(day)], rand);
        rows.push({ day, orders: sim.ordersBefore[24], revenueMinor: sim.revenueBefore[24], sessions: null });
      }
      const sim = simDay(8 * WEEKDAY[weekdayOf(today)], rand); // a fifth of the usual
      rows.push({ day: today, orders: sim.ordersBefore[20], revenueMinor: sim.revenueBefore[20], sessions: null });
      if (only(alertsFor({ currency: "EUR", today, dayShare: 20 / 24, daily: rows }), "revenue-weekday")) fired++;
    }
    expect(fired).toBeGreaterThan(45);
  });
});

describe("costs missing", () => {
  const cost = (coverage: number | null, orders = 50) => only(alertsFor(snap({ costs: { coverage, orders } })), "cost-coverage");

  it("says none are entered as a warning that profit cannot be shown", () => {
    const a = cost(0)!;
    expect(a.severity).toBe("warning");
    expect(a.text).toMatch(/^No product costs are entered, so profit cannot be shown\./);
    expect(a.evidence[0].value).toBe("None");
    expect(a.href).toBe("/products");
  });

  it("says a low share as information, below 80 %", () => {
    const a = cost(0.79)!;
    expect(a.severity).toBe("info");
    expect(a.text).toBe("Product costs are known for 79 % of sales, so profit figures are estimated from that share. Enter the costs still missing to make them exact.");
    expect(cost(0.8)).toBeUndefined();
    expect(cost(0.95)).toBeUndefined();
    expect(cost(1)).toBeUndefined();
    expect(ALERT_RULES.costs.minCoverage).toBe(0.8);
  });

  it("says below 30 % that too little is known to estimate profit from, as a warning", () => {
    const a = cost(0.29)!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe("Product costs are known for only 29 % of sales, too few to estimate profit from, so it is not shown. Enter the costs still missing to see it.");
    expect(cost(0.3)!.severity).toBe("info");
    expect(cost(0.3)!.text).toContain("estimated from that share");
  });

  it("does not nag a shop with fewer than 10 orders, or when coverage is not known", () => {
    expect(cost(0, 9)).toBeUndefined();
    expect(cost(0, 10)).toBeDefined();
    expect(cost(null)).toBeUndefined();
  });
});

describe("good news: returning customers at a high", () => {
  /** Twelve months to September 2026, 100 000 each and 20 orders, the last with `latest`. */
  const months = (latest: Partial<ReturningMonth> = {}, drop: (i: number) => boolean = () => false): ReturningMonth[] => {
    const out: ReturningMonth[] = [];
    for (let i = 0; i < 12; i++) {
      if (drop(i)) continue;
      const total = 2025 * 12 + 10 + i; // October 2025 is month index 0
      const year = Math.floor((total - 1) / 12);
      const month = total - year * 12;
      out.push({ month: `${year}-${String(month).padStart(2, "0")}`, revenueMinor: 100_000, orders: 20, ...(i === 11 ? latest : {}) });
    }
    return out;
  };
  const high = (series: ReturningMonth[]) => only(alertsFor(snap({ returningMonthly: series })), "returning-high");

  it("fires when the month beats the best of the eleven before by 5 %", () => {
    expect(months()[0].month).toBe("2025-10");
    expect(months()[11].month).toBe("2026-09");
    const a = high(months({ revenueMinor: 105_000 }))!;
    expect(a.severity).toBe("good");
    expect(a.text).toBe(`Returning customers brought in ${m(105_000)} in September 2026, the most in any of the last 12 months (the best before was ${m(100_000)} in October 2025).`);
    expect(a.href).toBe("/analytics/customers");
  });

  it("is quiet under the margin, level with the best, or under it", () => {
    expect(high(months({ revenueMinor: 104_999 }))).toBeUndefined();
    expect(high(months({ revenueMinor: 100_000 }))).toBeUndefined();
    expect(high(months({ revenueMinor: 90_000 }))).toBeUndefined();
    expect(ALERT_RULES.returningHigh.minMargin).toBe(0.05);
  });

  it("needs 10 orders from returning customers in the month", () => {
    expect(high(months({ revenueMinor: 200_000, orders: 10 }))).toBeDefined();
    expect(high(months({ revenueMinor: 200_000, orders: 9 }))).toBeUndefined();
  });

  it("needs twelve calendar months running, none missing", () => {
    expect(high(months({ revenueMinor: 200_000 }).slice(1))).toBeUndefined(); // eleven
    expect(high([{ month: "2025-09", revenueMinor: 1, orders: 20 }, ...months({ revenueMinor: 200_000 }).filter((_, i) => i !== 5)])).toBeUndefined(); // twelve, but a gap
    expect(high(undefined as unknown as ReturningMonth[])).toBeUndefined();
  });

  it("sorts the months it is given, and uses the last twelve of more", () => {
    const more = [{ month: "2025-09", revenueMinor: 900_000, orders: 50 }, ...months({ revenueMinor: 105_000 })];
    expect(high(more)).toBeDefined(); // the old, bigger month is outside the twelve
    expect(high([...months({ revenueMinor: 105_000 })].reverse())).toBeDefined();
  });

  it("is quiet when the months before had no returning customers at all", () => {
    const none = months({ revenueMinor: 50_000 }).map((x, i) => (i < 11 ? { ...x, revenueMinor: 0 } : x));
    expect(high(none)).toBeUndefined();
  });
});

describe("good news: the best day in 90 days", () => {
  const best = (f: (k: number) => Partial<DailyPoint> | null) => only(alertsFor(snap({ daily: daily(f) })), "best-day");

  it("says yesterday beat every one of the 89 days before", () => {
    const a = best((k) => (k === 1 ? { revenueMinor: 250_000, orders: 25 } : {}))!;
    expect(a.severity).toBe("good");
    expect(a.text).toBe(`Yesterday was your best day in 90 days: ${m(250_000)} from 25 orders.`);
    expect(a.evidence[0].baseline).toBe(`${m(200_000)} the best day before`);
  });

  it("must be strictly the best: level with another day is not", () => {
    expect(best((k) => (k === 1 ? { revenueMinor: 250_000 } : k === 40 ? { revenueMinor: 250_000 } : {}))).toBeUndefined();
    expect(best((k) => (k === 1 ? { revenueMinor: 250_000 } : k === 40 ? { revenueMinor: 249_999 } : {}))).toBeDefined();
    expect(best((k) => (k === 1 ? { revenueMinor: 200_000 } : {}))).toBeUndefined();
  });

  it("looks no further back than 90 days", () => {
    expect(best((k) => (k === 1 ? { revenueMinor: 250_000 } : k === 91 ? { revenueMinor: 900_000 } : {}))).toBeDefined();
    expect(best((k) => (k === 1 ? { revenueMinor: 250_000 } : k === 90 ? { revenueMinor: 900_000 } : {}))).toBeUndefined();
  });

  it("needs five orders yesterday", () => {
    expect(best((k) => (k === 1 ? { revenueMinor: 250_000, orders: 5 } : {}))).toBeDefined();
    expect(best((k) => (k === 1 ? { revenueMinor: 250_000, orders: 4 } : {}))).toBeUndefined();
  });

  it("needs 80 of the 89 days before to be known", () => {
    const missing = (n: number) => (k: number) => (k === 1 ? { revenueMinor: 250_000 } : k >= 2 && k < 2 + n ? null : {});
    expect(best(missing(9))).toBeDefined(); // 80 known
    expect(best(missing(10))).toBeUndefined(); // 79 known
    expect(ALERT_RULES.bestDay.minKnownDays).toBe(80);
  });

  it("does not run on the 56 days the other rules need alone", () => {
    expect(only(alertsFor(snap({ daily: daily((k) => (k === 1 ? { revenueMinor: 250_000 } : {}), 56) })), "best-day")).toBeUndefined();
  });

  it("leaves out today: it is partial", () => {
    expect(best((k) => (k === 0 ? { revenueMinor: 900_000 } : {}))).toBeUndefined();
  });
});

describe("ordering and the cap", () => {
  const alert = (id: string, severity: Alert["severity"], size = 1): Alert => ({ id, severity, text: id, href: "/x", action: "Go", evidence: [], size });

  it("puts urgent before warning before info before good, larger first within each, then by id", () => {
    const sorted = orderAlerts([
      alert("g", "good", 9),
      alert("i2", "info", 1),
      alert("w-small", "warning", 1),
      alert("u-small", "urgent", 1),
      alert("i1", "info", 3),
      alert("w-big", "warning", 4),
      alert("u-big", "urgent", 2),
      alert("a-tie", "warning", 1),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["u-big", "u-small", "w-big", "a-tie", "w-small", "i1", "i2", "g"]);
  });

  it("keeps at most eight", () => {
    expect(MAX_ALERTS).toBe(8);
    const many = Array.from({ length: 12 }, (_, i) => alert(`w${String(i).padStart(2, "0")}`, "warning", 20 - i));
    const kept = orderAlerts(many);
    expect(kept).toHaveLength(8);
    expect(kept.map((a) => a.id)).toEqual(["w00", "w01", "w02", "w03", "w04", "w05", "w06", "w07"]);
  });

  it("drops the least severe first when over the cap", () => {
    const kept = orderAlerts([...Array.from({ length: 3 }, (_, i) => alert(`u${i}`, "urgent")), ...Array.from({ length: 4 }, (_, i) => alert(`w${i}`, "warning")), alert("i", "info"), alert("g", "good")]);
    expect(kept).toHaveLength(8);
    expect(kept.map((a) => a.id)).not.toContain("g");
    expect(kept.map((a) => a.id)).toContain("i");
  });

  it("never drops an urgent one for the cap", () => {
    const kept = orderAlerts([...Array.from({ length: 10 }, (_, i) => alert(`u${i}`, "urgent")), alert("w", "warning"), alert("g", "good")]);
    expect(kept).toHaveLength(10);
    expect(kept.every((a) => a.severity === "urgent")).toBe(true);
    // And with nine urgent and room for none.
    expect(orderAlerts([...Array.from({ length: 8 }, (_, i) => alert(`u${i}`, "urgent")), alert("w", "warning")])).toHaveLength(8);
  });

  it("does not change what it is given", () => {
    const input = [alert("b", "info"), alert("a", "urgent")];
    orderAlerts(input);
    expect(input.map((a) => a.id)).toEqual(["b", "a"]);
  });
});

describe("stock running out on backorder (D172)", () => {
  const backorder = (name: string, owed: number): StockoutAlert => ({
    kind: "out",
    days: 0,
    row: { variantId: name, productId: name, name, sku: null, tracked: true, onHand: -owed, stockPolicy: "continue", owed, sold7: 3, sold30: 12, soldPeriod: 12, lastSoldDaysAgo: 1, ageDays: 200, costMinor: null, lowStockThreshold: null },
  });
  const plain = (name: string): StockoutAlert => ({ ...backorder(name, 0), row: { ...backorder(name, 0).row, onHand: 0, stockPolicy: "deny" } });
  const stock = (...rows: StockoutAlert[]) => only(alertsFor(snap({ stockouts: rows })), "stockout");

  it("names the variant as on backorder with what is owed, and is a warning, not urgent: the store chose to sell past its stock", () => {
    const a = stock(backorder("Thermos", 4))!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe("On backorder: Thermos (on backorder).");
    expect(a.evidence).toEqual([{ label: "Thermos", value: "On backorder, 4 owed", baseline: "12 sold in 30 days" }]);
  });

  it("stays urgent when something that stops at zero is gone as well", () => {
    const a = stock(backorder("Thermos", 4), plain("Wool hat"))!;
    expect(a.severity).toBe("urgent");
    expect(a.text).toBe("Out of stock: Thermos (on backorder), Wool hat (out).");
  });
});

describe("alertsFor, everything at once", () => {
  const rows: ProductRefundRow[] = [{ productId: "p", name: "Wool hat", sold14: 20, refunded14: 2, soldBaseline: 100, refundedBaseline: 5 }];
  const stockout: StockoutAlert[] = [
    { kind: "out", days: 0, row: { variantId: "v", productId: "p", name: "Scarf", sku: null, tracked: true, onHand: 0, stockPolicy: "deny", owed: 0, sold7: 3, sold30: 12, soldPeriod: 12, lastSoldDaysAgo: 1, ageDays: 100, costMinor: null, lowStockThreshold: null } },
  ];
  const big = snap({
    daily: daily((k) => (k === 1 ? { revenueMinor: 250_000, orders: 25 } : k >= 2 && k <= 8 ? { orders: 12 } : {})),
    productRefunds: rows,
    stockouts: stockout,
    costs: { coverage: 0.5, orders: 40 },
    discountCreeping: { creeping: true, risingMonths: 3, rise: 0.1, from: "2026-06", to: "2026-09" },
    channelCac: [{ channel: "s", label: "Paid search", spend7Minor: 60_000, newCustomers7: 4, spendPrev28Minor: 160_000, newCustomersPrev28: 16 }],
    checkout: { recent: { started: 100, completed: 50 }, baseline: { started: 400, completed: 240 } },
    target: targetProgress({ targetMinor: 300_000, actualMinor: 20_000, monthStart: "2026-09-01", today: "2026-09-10" }),
  });

  it("orders them, urgent first, and keeps the cap by letting the good news go first", () => {
    const alerts = alertsFor(big);
    // Nine rules speak; eight fit, and the good news is what goes.
    expect(alerts).toHaveLength(8);
    expect(ids(alerts)).not.toContain("best-day");
    expect(alerts.map((a) => a.severity)).toEqual([...alerts.map((a) => a.severity)].sort((a, b) => ["urgent", "warning", "info", "good"].indexOf(a) - ["urgent", "warning", "info", "good"].indexOf(b)));
    expect(alerts[0].severity).toBe("urgent");
    expect(alerts[alerts.length - 1].severity).toBe("info");
    expect(ids(alerts)).toEqual(expect.arrayContaining(["stockout", "target-behind", "refund-rate", "cac-up", "checkout-abandonment", "conversion-drop", "cost-coverage", "discount-creep"]));
    expect(alerts.length).toBeLessThanOrEqual(MAX_ALERTS);
    // With room, good news comes last.
    const calm = alertsFor(snap({ daily: daily((k) => (k === 1 ? { revenueMinor: 250_000, orders: 25 } : {})), stockouts: stockout, costs: { coverage: 0.5, orders: 40 } }));
    expect(ids(calm)).toEqual(["stockout", "cost-coverage", "best-day"]);
    expect(new Set(ids(alerts)).size).toBe(alerts.length);
  });

  it("gives every alert a path, a link text and evidence, and keeps its words plain", () => {
    for (const a of alertsFor(big)) {
      expect(a.href.startsWith("/")).toBe(true);
      expect(a.href.startsWith("/admin")).toBe(false);
      expect(a.action.length).toBeGreaterThan(0);
      expect(a.evidence.length).toBeGreaterThan(0);
      expect(a.text.endsWith(".")).toBe(true);
      expect(a.text).not.toMatch(/!|plunge|crash|disaster|terrible|alarming|catastroph|you should have|your fault|failing/i);
    }
  });

  it("adds a repeated day up, as rows per currency arrive", () => {
    const split = daily().flatMap((d) => [
      { ...d, orders: 10, revenueMinor: 100_000, sessions: 400 },
      { ...d, orders: 10, revenueMinor: 100_000, sessions: 400 },
    ]);
    expect(alertsFor(snap({ daily: split }))).toEqual([]);
  });

  it("has everything a rule counts as 1 each: the thresholds are published", () => {
    expect(Object.keys(ALERT_RULES).sort()).toEqual(["abandonment", "bestDay", "cac", "conversion", "costs", "discounts", "refunds", "returningHigh", "stockout", "target", "weekdayRevenue"]);
  });
});
