import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { detectCreeping, discountSummary, type DiscountMonth } from "@/lib/analytics-discounts";
import type { CouponReportRow, DiscountKindRow, DiscountsReport, TrendMonth } from "@/server/analytics-discounts-data";

import { basketWords, codeKindText, couponColumns, DiscountsView, discountCards, monthText, trendSeries, type DiscountsViewProps } from "./discounts-view";
import { moneyWriter } from "./overview-view";

const text = (props: DiscountsViewProps) =>
  renderToString(h(DiscountsView, props))
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const money = (minor: number) => moneyWriter("NOK", "nb-NO")(minor).replace(/[  ]/g, " ");

// ---------- fixtures ----------

const month = (m: string, orders: number, discounted: number, partial = false): TrendMonth => ({ month: m, orders, discountedOrders: discounted, share: orders >= 10 ? discounted / orders : null, partial });

/** A report the way `discountsReport()` gives it, its summary worked out by the library's own `discountSummary()`. */
function report(over: Partial<DiscountsReport> = {}, trend: TrendMonth[] = [], rows: Parameters<typeof discountSummary>[0] = []): DiscountsReport {
  const base = discountSummary(rows);
  const complete: DiscountMonth[] = trend.filter((m) => !m.partial).map(({ month: mo, orders, discountedOrders, share }) => ({ month: mo, orders, discountedOrders, share }));
  const empty = rows.length === 0 && trend.length === 0;
  return {
    currency: "NOK",
    period: { from: "2026-09-03", to: "2026-10-03", days: 30 },
    summary: { ...base, trend, creeping: detectCreeping(complete) },
    trend,
    trendWindow: { from: "2025-11-01", to: "2026-10-03" },
    breakdown: { kinds: [], totalMinor: 0, roundingMinor: 0 },
    coupons: [],
    couponCount: 0,
    couponsTruncated: false,
    unconverted: 0,
    missingRates: [],
    notes: [],
    ...(empty ? {} : {}),
    ...over,
  };
}

const KINDS: DiscountKindRow[] = [
  { kind: "code", label: "Discount codes", orders: 30, discountMinor: 600_000, share: 0.6 },
  { kind: "campaign", label: "Campaigns", orders: 20, discountMinor: 300_000, share: 0.3 },
  { kind: "group", label: "Customer groups", orders: 5, discountMinor: 100_000, share: 0.1 },
  { kind: "referral", label: "Welcome discounts (referral)", orders: 0, discountMinor: 0, share: 0 },
  { kind: "credit", label: "Bonus credits", orders: 0, discountMinor: 0, share: 0 },
];

const COUPONS: CouponReportRow[] = [
  { code: "WELCOME10", orders: 25, revenueMinor: 2_500_000, grossGoodsMinor: 2_800_000, discountMinor: 280_000, discountPct: 0.1, aovMinor: 100_000, discountPerOrderMinor: 11_200, revenueShare: 0.8, codeKind: "percent", active: true },
  { code: "SHIPFREE", orders: 6, revenueMinor: 600_000, grossGoodsMinor: 600_000, discountMinor: 0, discountPct: null, aovMinor: 100_000, discountPerOrderMinor: null, revenueShare: 0.2, codeKind: "free_shipping", active: false },
  { code: "OLD", orders: 1, revenueMinor: 90_000, grossGoodsMinor: 100_000, discountMinor: 10_000, discountPct: 0.1, aovMinor: 90_000, discountPerOrderMinor: 10_000, revenueShare: 0.02, codeKind: null, active: null },
];

// Twelve months, rising for the last four: a creeping dependency.
const CREEPING: TrendMonth[] = [
  month("2025-11", 80, 20), month("2025-12", 120, 36), month("2026-01", 60, 12), month("2026-02", 70, 14), month("2026-03", 75, 15), month("2026-04", 80, 16),
  month("2026-05", 85, 17), month("2026-06", 270, 54), month("2026-07", 300, 63), month("2026-08", 300, 75), month("2026-09", 300, 93), month("2026-10", 30, 12, true),
];
const FLAT = CREEPING.map((m) => ({ ...m, discountedOrders: Math.round(m.orders * 0.2), share: m.orders >= 10 ? Math.round(m.orders * 0.2) / m.orders : null }));

const ROWS: Parameters<typeof discountSummary>[0] = [
  { month: "2026-09", discounted: true, orders: 40, revenueMinor: 3_600_000, grossGoodsMinor: 4_400_000, discountMinor: 1_000_000 },
  { month: "2026-09", discounted: false, orders: 60, revenueMinor: 7_200_000, grossGoodsMinor: 6_000_000, discountMinor: 0 },
];

const normal = (over: Partial<DiscountsReport> = {}, trend: TrendMonth[] = FLAT): DiscountsViewProps => ({
  currency: "NOK",
  locale: "nb-NO",
  report: report({ breakdown: { kinds: KINDS, totalMinor: 1_000_000, roundingMinor: 0 }, coupons: COUPONS, couponCount: 3, ...over }, trend, ROWS),
});

const empty = (over: Partial<DiscountsReport> = {}): DiscountsViewProps => ({ currency: "NOK", locale: "nb-NO", report: report(over) });

// ---------- the pieces ----------

describe("helpers", () => {
  it("writes a month, and what is not a month as it came", () => {
    expect(monthText("2026-10")).toBe("Oct 2026");
    expect(monthText("2026-10-03")).toBe("Oct 2026");
    expect(monthText("soon")).toBe("soon");
  });

  it("lays the trend out month after month, with a gap for a month with too few orders and none for a missing one", () => {
    const series = trendSeries({ trendWindow: { from: "2026-07-01", to: "2026-10-03" }, trend: [month("2026-07", 50, 10), month("2026-09", 4, 2), month("2026-10", 20, 8, true)] });
    expect(series.labels).toEqual(["Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026 (so far)"]);
    expect(series.values).toEqual([0.2, null, null, 0.4]);
    expect(series.partial).toBe(true);
  });

  it("says how much smaller or larger discounted baskets are", () => {
    expect(basketWords(0.8)).toBe("20 % smaller than a basket at full price.");
    expect(basketWords(1.25)).toBe("25 % larger than a basket at full price.");
    expect(basketWords(1.001)).toBe("About the same size as at full price.");
    expect(basketWords(null)).toBeNull();
    expect(basketWords(Number.NaN)).toBeNull();
  });

  it("words a code's type, and a deleted code", () => {
    expect(codeKindText("percent")).toBe("Percent off");
    expect(codeKindText("free_shipping")).toBe("Free shipping");
    expect(codeKindText(null)).toBe("Deleted code");
  });

  it("has the coupon columns, and no discount figure for a free-shipping code", () => {
    const cols = couponColumns(money);
    expect(cols.map((c) => c.label)).toEqual(["Code", "Type", "Status", "Orders", "Revenue", "Taken off", "Discount", "Per order", "Avg order", "Share of code revenue"]);
    const shipping = COUPONS[1];
    const taken = cols.find((c) => c.key === "discount")!.cell(shipping);
    expect(renderToString(h("span", null, taken))).toContain("–");
  });
});

describe("discountCards", () => {
  it("gives the dependency with its counts, the average discount and both baskets", () => {
    const cards = discountCards(normal().report, money);
    expect(cards.map((c) => c.label)).toEqual(["Orders with a discount", "Average discount", "Basket with a discount", "Basket at full price"]);
    expect(cards[0].value?.replace(/[  ]/g, " ")).toBe("40.0 %");
    expect(cards[0].hint).toContain("40 of 100 paid orders");
    expect(cards[1].value?.replace(/[  ]/g, " ")).toBe("22.7 %");
    expect(cards[2].value).toBe(money(90_000));
    expect(cards[3].value).toBe(money(120_000));
    expect(cards[2].hint).toContain("25 % smaller");
  });

  it("has no figure, and a calm reason, for a store with no orders", () => {
    const cards = discountCards(empty().report, money);
    for (const c of cards) {
      expect(c.state).toBe("missing");
      expect(c.value).toBeNull();
      expect(c.missing?.text).toBe("No paid orders in this period yet.");
    }
  });

  it("says when no order, or every order, had a discount", () => {
    const none = discountCards(report({}, [], [{ month: "2026-09", discounted: false, orders: 20, revenueMinor: 100, grossGoodsMinor: 100, discountMinor: 0 }]), money);
    expect(none[0].value?.replace(/[  ]/g, " ")).toBe("0.0 %");
    expect(none[1].missing?.text).toBe("No order used a discount in this period.");
    expect(none[2].missing?.text).toBe("No order had a discount in this period.");
    const all = discountCards(report({}, [], [{ month: "2026-09", discounted: true, orders: 20, revenueMinor: 100, grossGoodsMinor: 120, discountMinor: 20 }]), money);
    expect(all[3].missing?.text).toBe("Every order in this period had a discount.");
  });
});

// ---------- the view ----------

describe("DiscountsView", () => {
  it("shows a normal store: cards, trend, kinds and the coupon table", () => {
    const out = text(normal());
    expect(out).toContain("Discounts and coupons");
    expect(out).toContain("Orders with a discount");
    expect(out).toContain("40.0 %");
    expect(out).toContain("What was taken off, by kind");
    expect(out).toContain("Discount codes");
    expect(out).toContain("WELCOME10");
    expect(out).toContain("Percent off");
    expect(out).toContain("Deleted code");
    expect(out).toContain(`${money(1_000_000)} in all, without VAT.`);
    expect(out).not.toMatch(BAD);
  });

  it("warns when the share of discounted orders is creeping up, with the months and the rise", () => {
    const out = text(normal({}, CREEPING));
    expect(out).toContain("Discounts are creeping up");
    expect(out).toMatch(/risen 3 months in a row, from 20 % in Jun 2026 to 31 % in Sep 2026 \(\+11\.0 pts\)/);
    expect(out).toContain("The month in progress is shown but not counted.");
  });

  it("gives no warning when the share is steady, and says when one would come", () => {
    const out = text(normal({}, FLAT));
    expect(out).not.toContain("Discounts are creeping up");
    expect(out).toContain("You get a warning if the share rises 3 months in a row by 8 points or more, the first and last of those months each have at least 30 orders, and the rise is too big to be chance.");
  });

  it("explains free-shipping codes and shows no discount figure for them", () => {
    const out = text(normal());
    expect(out).toContain("A free-shipping code takes nothing off the goods");
    expect(out).toContain('title="A free-shipping code takes nothing off the goods"');
  });

  it("says when only the biggest codes are listed", () => {
    const out = text(normal({ couponCount: 80 }));
    expect(out).toContain("Showing the 3 codes with most revenue of 80 used.");
  });

  it("shows the empty store calmly, with no zeros and no broken figures", () => {
    const out = text(empty());
    expect(out).toContain("No paid orders in this period yet.");
    expect(out).toContain("No discount code was used in this period.");
    expect(out).toContain("Not enough orders yet to show a trend");
    expect(out).not.toMatch(BAD);
    expect(out).not.toMatch(/0,00 kr|0\.0 %/);
  });

  it("says no discounts were given when there were orders but no discount", () => {
    const out = text({ ...normal(), report: report({}, FLAT, [{ month: "2026-09", discounted: false, orders: 20, revenueMinor: 100_000, grossGoodsMinor: 100_000, discountMinor: 0 }]) });
    expect(out).toContain("No discounts were given in this period.");
  });

  it("carries the report's notes about currencies and about too many codes", () => {
    const out = text(normal({ notes: ["3 paid orders in SEK are left out: the store has no exchange rate for it.", "More than 1000 codes were used: the biggest by revenue are shown."] }));
    expect(out).toContain("3 paid orders in SEK are left out");
    expect(out).toContain("More than 1000 codes were used");
  });

  it("mentions rounding when the kinds do not add up to the total", () => {
    const out = text(normal({ breakdown: { kinds: KINDS, totalMinor: 1_000_100, roundingMinor: 100 } }));
    expect(out).toContain(`differ from the total by ${money(100)} because of rounding`);
  });

  it("names every chart and table", () => {
    const out = text(normal({}, CREEPING));
    const svgs = [...out.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]);
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg).toMatch(/role="img"[^>]*aria-label="[^"]+"|aria-label="[^"]+"[^>]*role="img"/);
    const lists = [...out.matchAll(/<ol\b[^>]*>/g)].map((m) => m[0]);
    expect(lists.length).toBeGreaterThan(0);
    for (const ol of lists) expect(ol).toMatch(/aria-label="[^"]+"/);
    for (const t of out.matchAll(/<table\b[\s\S]*?<\/table>/g)) expect(t[0]).toMatch(/<caption[^>]*>[^<]+<\/caption>/);
    // The empty chart is named too.
    const quiet = text(empty());
    for (const d of quiet.matchAll(/<div role="img"[^>]*>/g)) expect(d[0]).toMatch(/aria-label="[^"]+"/);
  });
});
