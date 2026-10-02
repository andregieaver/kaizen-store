import { describe, expect, it } from "vitest";

import {
  COVERAGE_WARN,
  coverageText,
  costCoverageOf,
  costModeOf,
  costsKnown,
  coveredMargin,
  derive,
  EMPTY_TOTALS,
  ESTIMATE_MIN_COVERAGE,
  estimateText,
  estimatedCogs,
  fixedCostsFor,
  formatKpi,
  KPI_BY_ID,
  KPI_CARDS,
  kpiChange,
  kpiMissing,
  kpiValue,
  type Totals,
} from "./analytics-kpi";

const totals = (over: Partial<Totals> = {}): Totals => ({
  ...EMPTY_TOTALS,
  orders: 100,
  grossSalesMinor: 1_100_000,
  discountsMinor: 100_000,
  shippingMinor: 50_000,
  vatMinor: 260_000,
  revenueMinor: 1_050_000,
  refundsMinor: 50_000,
  cogsMinor: 400_000,
  knownCostRevenueMinor: 1_050_000,
  paymentFeesMinor: 30_000,
  platformFeesMinor: 20_000,
  shippingCostsMinor: 40_000,
  marketingMinor: 100_000,
  sessions: 4000,
  newCustomers: 60,
  returningCustomers: 20,
  units: 180,
  ...over,
});

describe("costCoverageOf", () => {
  it("is the share of the lines' revenue whose cost is known; shipping income, which is no line, counts for nothing", () => {
    // 10 000 of lines and 4 000 of shipping income: with no cost entered the coverage is 0, never the shipping's 29 %.
    expect(costCoverageOf({ revenueMinor: 14_000, lineRevenueMinor: 10_000, knownCostRevenueMinor: 0 })).toBe(0);
    expect(costCoverageOf({ revenueMinor: 14_000, lineRevenueMinor: 10_000, knownCostRevenueMinor: 7_500 })).toBe(0.75);
    expect(costCoverageOf({ revenueMinor: 14_000, lineRevenueMinor: 10_000, knownCostRevenueMinor: 10_000 })).toBe(1);
  });

  it("is null with no revenue, and reads totals made without line revenue against revenue", () => {
    expect(costCoverageOf({ revenueMinor: 0, lineRevenueMinor: 0, knownCostRevenueMinor: 0 })).toBeNull();
    expect(costCoverageOf({ revenueMinor: 1_000, lineRevenueMinor: 0, knownCostRevenueMinor: 250 })).toBe(0.25);
  });

  it("gates profit in derive(): shipping income alone never makes profit known", () => {
    const d = derive(totals({ revenueMinor: 14_000, lineRevenueMinor: 10_000, knownCostRevenueMinor: 0, cogsMinor: 0, refundsMinor: 0 }), { fixedCostsMonthlyMinor: 0 }, 30);
    expect(d.costCoverage).toBe(0);
    expect(d.grossProfit).toBeNull();
    expect(d.grossMarginPct).toBeNull();
    expect(d.contributionProfit).toBeNull();
  });
});

describe("fixedCostsFor", () => {
  it("spreads twelve months over 365 days", () => {
    expect(fixedCostsFor({ fixedCostsMonthlyMinor: 36_500 }, 30)).toBe(36_000);
    expect(fixedCostsFor({ fixedCostsMonthlyMinor: 36_500 }, 365)).toBe(438_000);
    expect(fixedCostsFor({ fixedCostsMonthlyMinor: 36_500 }, 1)).toBe(1200);
  });

  it("is a day's cost the same in every month", () => {
    const f = { fixedCostsMonthlyMinor: 100_000 };
    expect(fixedCostsFor(f, 28)).toBe(Math.round((100_000 * 12 * 28) / 365));
    expect(fixedCostsFor(f, 31) / 31).toBeCloseTo(fixedCostsFor(f, 28) / 28, 0);
  });

  it("is nothing without costs or days", () => {
    expect(fixedCostsFor({ fixedCostsMonthlyMinor: 0 }, 30)).toBe(0);
    expect(fixedCostsFor({ fixedCostsMonthlyMinor: 100 }, 0)).toBe(0);
    expect(fixedCostsFor({ fixedCostsMonthlyMinor: -5 }, 30)).toBe(0);
  });
});

describe("derive", () => {
  const settings = { fixedCostsMonthlyMinor: 36_500 };

  it("works everything out from the totals", () => {
    const d = derive(totals(), settings, 30);
    expect(d.orders).toBe(100);
    expect(d.revenue).toBe(1_050_000);
    expect(d.netRevenue).toBe(1_000_000);
    expect(d.aov).toBe(10_500);
    expect(d.costCoverage).toBe(1);
    expect(d.grossProfit).toBe(600_000);
    expect(d.grossMarginPct).toBeCloseTo(0.6, 10);
    // 1,000,000 − 400,000 − 30,000 − 20,000 − 40,000 − 100,000
    expect(d.contributionProfit).toBe(410_000);
    expect(d.fixedCosts).toBe(36_000);
    expect(d.operatingProfit).toBe(374_000);
    expect(d.conversionRate).toBe(0.025);
    expect(d.revenuePerVisitor).toBe(250);
    expect(d.contributionPerVisitor).toBe(103);
    expect(d.refundRate).toBeCloseTo(50_000 / 1_050_000, 10);
  });

  it("does not show a profit without costs, nor call it zero", () => {
    const d = derive(totals({ cogsMinor: 0, knownCostRevenueMinor: 0 }), settings, 30);
    expect(d.costCoverage).toBe(0);
    expect(d.grossProfit).toBeNull();
    expect(d.grossMarginPct).toBeNull();
    expect(d.contributionProfit).toBeNull();
    expect(d.operatingProfit).toBeNull();
    expect(d.contributionPerVisitor).toBeNull();
    // What does not need costs is still known.
    expect(d.netRevenue).toBe(1_000_000);
    expect(d.revenuePerVisitor).toBe(250);
  });

  it("estimates profit on part of the sales by scaling the known cost to all of them, with the share it covers", () => {
    const d = derive(totals({ knownCostRevenueMinor: 871_500, cogsMinor: 300_000 }), settings, 30);
    expect(d.costCoverage).toBeCloseTo(0.83, 10);
    // COGS 300 000 known for 83 % of the sales is about 361 446 for all of them: 1 000 000 − 361 446.
    expect(d.grossProfit).toBe(638_554);
    expect(d.profitEstimated).toBe(true);
    expect(coverageText(d.costCoverage)).toBe("based on 83 % of sales");
    expect(estimateText(d.costCoverage)).toBe("estimated from the 83 % of sales whose cost is known");
    expect(d.costCoverage!).toBeGreaterThan(COVERAGE_WARN);
  });

  it("at 45 % coverage the profit is the estimate and the margin is on the covered sales: the viz-busy case", () => {
    // 450 000 of 1 000 000 net sales have a cost entered; those cost 100 000.
    const t = totals({ revenueMinor: 1_000_000, refundsMinor: 0, knownCostRevenueMinor: 450_000, cogsMinor: 100_000 });
    const d = derive(t, settings, 30);
    expect(d.costCoverage).toBe(0.45);
    expect(d.profitEstimated).toBe(true);
    // The known cost is not taken as the whole cost: 100 000 / 0.45 = 222 222, not 100 000 (which would give 900 000 and 90 %).
    expect(d.grossProfit).toBe(777_778);
    expect(d.grossMarginPct).toBeCloseTo(350_000 / 450_000, 10);
    // The margin on the covered sales is the same figure as the estimate's share of net revenue.
    expect(d.grossMarginPct).toBeCloseTo(777_778 / 1_000_000, 5);
    // 1 000 000 − 222 222 − 30 000 − 20 000 − 40 000 − 100 000, and less the fixed costs.
    expect(d.contributionProfit).toBe(587_778);
    expect(d.operatingProfit).toBe(551_778);
  });

  it("has exact profit at coverage 1 and an estimate from 30 % up to it", () => {
    expect(ESTIMATE_MIN_COVERAGE).toBe(0.3);
    const exact = derive(totals(), settings, 30);
    expect(exact.profitEstimated).toBe(false);
    expect(exact.grossProfit).toBe(600_000);
    // 30 % exactly is the least that is estimated.
    const edge = derive(totals({ revenueMinor: 1_000_000, refundsMinor: 0, knownCostRevenueMinor: 300_000, cogsMinor: 60_000 }), settings, 30);
    expect(edge.costCoverage).toBe(0.3);
    expect(edge.profitEstimated).toBe(true);
    expect(edge.grossProfit).toBe(800_000);
  });

  it("shows no profit under 30 % coverage, but still the margin on the covered sales", () => {
    const d = derive(totals({ revenueMinor: 1_000_000, refundsMinor: 0, knownCostRevenueMinor: 290_000, cogsMinor: 58_000 }), settings, 30);
    expect(d.costCoverage).toBe(0.29);
    expect(d.profitEstimated).toBe(false);
    expect(d.grossProfit).toBeNull();
    expect(d.contributionProfit).toBeNull();
    expect(d.operatingProfit).toBeNull();
    expect(d.contributionPerVisitor).toBeNull();
    // (290 000 − 58 000) / 290 000: 80 % of what is known.
    expect(d.grossMarginPct).toBeCloseTo(0.8, 10);
  });

  it("clamps a coverage that data would put over 1", () => {
    expect(derive(totals({ knownCostRevenueMinor: 2_000_000 }), settings, 30).costCoverage).toBe(1);
    expect(derive(totals({ knownCostRevenueMinor: -5 }), settings, 30).costCoverage).toBe(0);
  });

  it("has no ratios from nothing sold", () => {
    const d = derive({ ...EMPTY_TOTALS }, settings, 30);
    expect(d.aov).toBeNull();
    expect(d.costCoverage).toBeNull();
    expect(d.grossProfit).toBe(0);
    expect(d.grossMarginPct).toBeNull();
    expect(d.refundRate).toBeNull();
    expect(d.conversionRate).toBeNull();
    // Nothing sold, but the fixed costs still run.
    expect(d.contributionProfit).toBe(0);
    expect(d.operatingProfit).toBe(-36_000);
  });

  it("has no visit figures without visit counting", () => {
    const d = derive(totals({ sessions: null }), settings, 30);
    expect(d.sessions).toBeNull();
    expect(d.conversionRate).toBeNull();
    expect(d.revenuePerVisitor).toBeNull();
    expect(d.contributionPerVisitor).toBeNull();
  });

  it("has no visit figures from zero visits", () => {
    const d = derive(totals({ sessions: 0 }), settings, 30);
    expect(d.sessions).toBe(0);
    expect(d.conversionRate).toBeNull();
    expect(d.revenuePerVisitor).toBeNull();
  });

  it("can convert nothing: orders with visits but none paid is 0 %", () => {
    const d = derive(totals({ orders: 0, revenueMinor: 0, refundsMinor: 0, knownCostRevenueMinor: 0, cogsMinor: 0 }), settings, 30);
    expect(d.conversionRate).toBe(0);
    expect(d.aov).toBeNull();
  });

  it("takes visit figures from the days both are known when given", () => {
    const whole = totals({ sessions: 1000, orders: 100 });
    const counted = totals({ sessions: 1000, orders: 20, revenueMinor: 200_000, refundsMinor: 0, knownCostRevenueMinor: 200_000, cogsMinor: 80_000, paymentFeesMinor: 0, platformFeesMinor: 0, shippingCostsMinor: 0, marketingMinor: 0 });
    const d = derive(whole, settings, 30, counted);
    expect(d.conversionRate).toBe(0.02);
    expect(d.revenuePerVisitor).toBe(200);
    expect(d.contributionPerVisitor).toBe(120);
    // Everything else is the whole period's.
    expect(d.orders).toBe(100);
    expect(d.sessions).toBe(1000);
  });

  it("rounds money to whole minor units", () => {
    const d = derive(totals({ revenueMinor: 1000, orders: 3, refundsMinor: 0, sessions: 7 }), settings, 30);
    expect(d.aov).toBe(333);
    expect(Number.isInteger(d.revenuePerVisitor)).toBe(true);
  });

  it("can make a loss", () => {
    const d = derive(totals({ cogsMinor: 900_000 }), settings, 30);
    expect(d.grossProfit).toBe(100_000);
    expect(d.contributionProfit).toBe(-90_000);
    expect(d.operatingProfit).toBe(-126_000);
  });

  it("has no margin when net revenue is zero or negative", () => {
    const d = derive(totals({ refundsMinor: 1_050_000, cogsMinor: 0 }), settings, 30);
    expect(d.netRevenue).toBe(0);
    expect(d.grossMarginPct).toBeNull();
    const negative = derive(totals({ refundsMinor: 1_200_000, cogsMinor: 0 }), settings, 30);
    expect(negative.netRevenue).toBe(-150_000);
    expect(negative.grossMarginPct).toBeNull();
    expect(negative.refundRate).toBeGreaterThan(1);
  });

  it("knows when costs are known", () => {
    expect(costsKnown(null)).toBe(true);
    // Profit is shown from 30 % of sales with a known cost (an estimate until 100 %).
    expect(costsKnown(0.3)).toBe(true);
    expect(costsKnown(1)).toBe(true);
    expect(costsKnown(0.29)).toBe(false);
    expect(costsKnown(0.01)).toBe(false);
    expect(costsKnown(0)).toBe(false);
  });

  it("names how well the cost of goods is known", () => {
    expect(costModeOf(null)).toBe("exact");
    expect(costModeOf(1)).toBe("exact");
    expect(costModeOf(0.99)).toBe("estimated");
    expect(costModeOf(0.3)).toBe("estimated");
    expect(costModeOf(0.2999)).toBe("missing");
    expect(costModeOf(0)).toBe("missing");
  });

  it("scales the known cost of goods to all sales, and only from 30 %", () => {
    expect(estimatedCogs({ cogsMinor: 100_000 }, 1)).toBe(100_000);
    expect(estimatedCogs({ cogsMinor: 100_000 }, null)).toBe(100_000);
    expect(estimatedCogs({ cogsMinor: 100_000 }, 0.5)).toBe(200_000);
    expect(estimatedCogs({ cogsMinor: 100_000 }, 0.45)).toBe(222_222);
    expect(estimatedCogs({ cogsMinor: 100_000 }, 0.29)).toBeNull();
    expect(estimatedCogs({ cogsMinor: 0 }, 0)).toBeNull();
  });

  it("works the margin on the covered sales only, whenever any cost is known", () => {
    const t = { revenueMinor: 1_000_000, refundsMinor: 100_000, cogsMinor: 180_000 };
    // Covered net revenue: 900 000 × 0.5 = 450 000; (450 000 − 180 000) / 450 000.
    expect(coveredMargin(t, 0.5)).toBeCloseTo(0.6, 10);
    expect(coveredMargin(t, 0.1)).not.toBeNull();
    expect(coveredMargin(t, 0)).toBeNull();
    expect(coveredMargin(t, null)).toBeNull();
    // At full coverage it is gross profit over net revenue.
    expect(coveredMargin(t, 1)).toBeCloseTo((900_000 - 180_000) / 900_000, 10);
    expect(coveredMargin({ ...t, refundsMinor: 1_000_000 }, 0.5)).toBeNull();
  });

  it("says an estimate says so, and an exact figure does not", () => {
    expect(estimateText(0.45)).toBe("estimated from the 45 % of sales whose cost is known");
    expect(estimateText(1)).toBeNull();
    expect(estimateText(0.1)).toBeNull();
    expect(estimateText(null)).toBeNull();
  });
});

describe("KPI_CARDS", () => {
  it("has the twelve cards in order", () => {
    expect(KPI_CARDS.map((c) => c.id)).toEqual([
      "revenue",
      "netRevenue",
      "orders",
      "conversion",
      "aov",
      "grossProfit",
      "grossMargin",
      "newCustomers",
      "returningCustomers",
      "refundRate",
      "sessions",
      "revenuePerVisitor",
    ]);
    expect(new Set(KPI_CARDS.map((c) => c.id)).size).toBe(12);
  });

  it("is plain data a client component can be given", () => {
    expect(JSON.parse(JSON.stringify(KPI_CARDS))).toEqual(KPI_CARDS);
  });

  it("says which way is good", () => {
    expect(KPI_BY_ID.get("refundRate")!.good).toBe("down");
    expect(KPI_BY_ID.get("sessions")!.good).toBe("neutral");
    expect(KPI_BY_ID.get("revenue")!.good).toBe("up");
  });

  it("says what a figure needs, and tells the owner when it is missing", () => {
    for (const card of KPI_CARDS) {
      if (card.needs) {
        expect(card.missingText, card.id).toBeTruthy();
        expect(card.fixPage, card.id).toBeTruthy();
      } else {
        expect(card.missingText, card.id).toBeNull();
      }
      expect(card.help.length, card.id).toBeGreaterThan(10);
      expect(card.page).not.toBe("overview");
    }
    expect(KPI_BY_ID.get("grossProfit")!.needs).toBe("costs");
    expect(KPI_BY_ID.get("grossMargin")!.needs).toBe("costs");
    expect(KPI_BY_ID.get("sessions")!.needs).toBe("visits");
    expect(KPI_BY_ID.get("conversion")!.needs).toBe("visits");
    expect(KPI_BY_ID.get("revenuePerVisitor")!.needs).toBe("visits");
  });

  it("reads each card's figure", () => {
    const d = derive(totals(), { fixedCostsMonthlyMinor: 0 }, 30);
    const read = Object.fromEntries(KPI_CARDS.map((c) => [c.id, kpiValue(c, d)]));
    expect(read).toEqual({
      revenue: 1_050_000,
      netRevenue: 1_000_000,
      orders: 100,
      conversion: 0.025,
      aov: 10_500,
      grossProfit: 600_000,
      grossMargin: d.grossMarginPct,
      newCustomers: 60,
      returningCustomers: 20,
      refundRate: d.refundRate,
      sessions: 4000,
      revenuePerVisitor: 250,
    });
  });

  it("reports nothing missing when every figure exists", () => {
    const d = derive(totals(), { fixedCostsMonthlyMinor: 0 }, 30);
    expect(KPI_CARDS.map((c) => kpiMissing(c, d))).toEqual(KPI_CARDS.map(() => null));
  });

  it("says visits are missing when counting is off", () => {
    const d = derive(totals({ sessions: null }), { fixedCostsMonthlyMinor: 0 }, 30);
    for (const id of ["conversion", "sessions", "revenuePerVisitor"] as const) {
      expect(kpiMissing(KPI_BY_ID.get(id)!, d)).toMatchObject({ kind: "visits", fixPage: "settings" });
    }
    expect(kpiMissing(KPI_BY_ID.get("grossProfit")!, d)).toBeNull();
  });

  it("says costs are missing when nothing sold has one", () => {
    const d = derive(totals({ cogsMinor: 0, knownCostRevenueMinor: 0 }), { fixedCostsMonthlyMinor: 0 }, 30);
    expect(kpiMissing(KPI_BY_ID.get("grossProfit")!, d)).toMatchObject({ kind: "costs" });
    expect(kpiMissing(KPI_BY_ID.get("grossMargin")!, d)).toMatchObject({ kind: "costs" });
  });

  it("says too few costs are known when under 30 % of sales have one; the margin still has its figure", () => {
    const d = derive(totals({ revenueMinor: 1_000_000, refundsMinor: 0, knownCostRevenueMinor: 200_000, cogsMinor: 40_000 }), { fixedCostsMonthlyMinor: 0 }, 30);
    const profit = kpiMissing(KPI_BY_ID.get("grossProfit")!, d);
    expect(profit).toMatchObject({ kind: "costs" });
    expect(profit!.text).toBe("Product costs are known for only 20 % of sales, too few to estimate profit. Enter the rest in the product editor.");
    expect(kpiValue(KPI_BY_ID.get("grossMargin")!, d)).toBeCloseTo(0.8, 10);
    expect(kpiMissing(KPI_BY_ID.get("grossMargin")!, d)).toBeNull();
  });

  it("has the profit cards' figures when it is an estimate", () => {
    const d = derive(totals({ revenueMinor: 1_000_000, refundsMinor: 0, knownCostRevenueMinor: 450_000, cogsMinor: 100_000 }), { fixedCostsMonthlyMinor: 0 }, 30);
    expect(kpiMissing(KPI_BY_ID.get("grossProfit")!, d)).toBeNull();
    expect(kpiValue(KPI_BY_ID.get("grossProfit")!, d)).toBe(777_778);
  });

  it("says there is no data when a figure is absent for no setup reason", () => {
    const d = derive({ ...EMPTY_TOTALS, sessions: 0 }, { fixedCostsMonthlyMinor: 0 }, 30);
    expect(kpiMissing(KPI_BY_ID.get("aov")!, d)).toMatchObject({ kind: "no-data", fixPage: null });
    expect(kpiMissing(KPI_BY_ID.get("conversion")!, d)).toMatchObject({ kind: "no-data" });
    expect(kpiMissing(KPI_BY_ID.get("grossMargin")!, d)).toMatchObject({ kind: "no-data" });
  });
});

describe("writing a card", () => {
  it("formats by kind", () => {
    expect(formatKpi({ kind: "money" }, 123_456, "NOK", "en")).toMatch(/1,234\.56/);
    expect(formatKpi({ kind: "money" }, 123_456.4, "NOK", "en")).toMatch(/1,234\.56/);
    expect(formatKpi({ kind: "percent" }, 0.025, "NOK")).toBe("2.5 %");
    expect(formatKpi({ kind: "count" }, 12_345, "NOK")).toBe("12 345");
  });

  it("writes no figure for a missing one", () => {
    expect(formatKpi({ kind: "money" }, null, "NOK")).toBe("–");
    expect(formatKpi({ kind: "percent" }, null, "NOK")).toBe("–");
    expect(formatKpi({ kind: "count" }, NaN, "NOK")).toBe("–");
  });

  it("writes how a card changed", () => {
    expect(kpiChange({ kind: "money", good: "up" }, 112, 100)).toEqual({ text: "+12.0 %", verdict: "good", abs: 12 });
    expect(kpiChange({ kind: "money", good: "up" }, 80, 100)).toMatchObject({ text: "−20.0 %", verdict: "bad" });
    expect(kpiChange({ kind: "percent", good: "down" }, 0.05, 0.03)).toMatchObject({ text: "+2.0 pts", verdict: "bad" });
    expect(kpiChange({ kind: "percent", good: "down" }, 0.03, 0.05)).toMatchObject({ text: "−2.0 pts", verdict: "good" });
    expect(kpiChange({ kind: "count", good: "neutral" }, 120, 100)).toMatchObject({ verdict: "neutral" });
  });

  it("leaves a share's noise unpainted and says nothing for what is unknown", () => {
    expect(kpiChange({ kind: "percent", good: "up" }, 0.0302, 0.03)).toMatchObject({ verdict: "neutral" });
    expect(kpiChange({ kind: "money", good: "up" }, null, 100)).toEqual({ text: "–", verdict: "neutral", abs: null });
    expect(kpiChange({ kind: "percent", good: "up" }, 0.03, null)).toEqual({ text: "–", verdict: "neutral", abs: null });
    expect(kpiChange({ kind: "money", good: "up" }, 100, 0)).toMatchObject({ text: "new", verdict: "good" });
    expect(kpiChange({ kind: "money", good: "up" }, 0, 0)).toMatchObject({ text: "0.0 %", verdict: "neutral" });
  });

  it("words coverage", () => {
    expect(coverageText(1)).toBe("based on 100 % of sales");
    expect(coverageText(0.456)).toBe("based on 46 % of sales");
    expect(coverageText(null)).toBe("no sales yet");
  });
});
