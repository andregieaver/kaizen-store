import { describe, expect, it } from "vitest";

import { financeStatement, paymentFees, shippingCostsFor, type FinanceStatement } from "./analytics-finance";
import { DEFAULT_ANALYTICS_SETTINGS, derive, EMPTY_TOTALS, type AnalyticsSettings, type Totals } from "./analytics-kpi";

const settings: AnalyticsSettings = {
  paymentFeeBps: 140,
  paymentFeeFixedMinor: 25,
  shippingCostMinor: 4000,
  fixedCostsMonthlyMinor: 36_500,
  ltvLifespanYears: 3,
};

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
  ...over,
});

const line = (s: FinanceStatement, key: string) => s.lines.find((l) => l.key === key)!;

describe("paymentFees", () => {
  it("is a share of each order's total plus a fixed amount", () => {
    // 1.4 % of 10 000 is 140, plus 25.
    expect(paymentFees([10_000], settings)).toBe(165);
    expect(paymentFees([10_000, 20_000], settings)).toBe(165 + 305);
  });

  it("rounds each order, not the sum", () => {
    // 1.4 % of 1 000 is 14; of 1 036 it is 14.5 → 15 (half up) per order.
    expect(paymentFees([1036, 1036], { paymentFeeBps: 140, paymentFeeFixedMinor: 0 })).toBe(30);
    expect(paymentFees([1], { paymentFeeBps: 140, paymentFeeFixedMinor: 0 })).toBe(0);
  });

  it("is nothing without orders or settings", () => {
    expect(paymentFees([], settings)).toBe(0);
    expect(paymentFees([10_000], { paymentFeeBps: 0, paymentFeeFixedMinor: 0 })).toBe(0);
  });

  it("takes the fixed part alone, or the share alone", () => {
    expect(paymentFees([500, 700], { paymentFeeBps: 0, paymentFeeFixedMinor: 200 })).toBe(400);
    expect(paymentFees([10_000], { paymentFeeBps: 290, paymentFeeFixedMinor: 0 })).toBe(290);
  });

  it("charges no fee on an order that was not charged", () => {
    expect(paymentFees([0, -500, NaN, 10_000], settings)).toBe(165);
  });

  it("handles fractional basis points", () => {
    expect(paymentFees([10_000], { paymentFeeBps: 145.5, paymentFeeFixedMinor: 0 })).toBe(146);
  });
});

describe("shippingCostsFor", () => {
  it("is the cost per order with a physical line", () => {
    expect(shippingCostsFor(10, settings)).toBe(40_000);
    expect(shippingCostsFor(0, settings)).toBe(0);
    expect(shippingCostsFor(-3, settings)).toBe(0);
    expect(shippingCostsFor(5, { shippingCostMinor: -1 })).toBe(0);
  });
});

describe("financeStatement", () => {
  it("lists the bridge in order", () => {
    const s = financeStatement(totals(), settings, 30);
    expect(s.lines.map((l) => l.key)).toEqual([
      "grossSales",
      "discounts",
      "shippingIncome",
      "revenue",
      "refunds",
      "netRevenue",
      "cogs",
      "grossProfit",
      "paymentFees",
      "platformFees",
      "shippingCosts",
      "marketing",
      "contributionProfit",
      "fixedCosts",
      "operatingProfit",
    ]);
  });

  it("signs the lines so they add up", () => {
    const s = financeStatement(totals(), settings, 30);
    const amounts = Object.fromEntries(s.lines.map((l) => [l.key, l.amountMinor]));
    expect(amounts).toEqual({
      grossSales: 1_100_000,
      discounts: -100_000,
      shippingIncome: 50_000,
      revenue: 1_050_000,
      refunds: -50_000,
      netRevenue: 1_000_000,
      cogs: -400_000,
      grossProfit: 600_000,
      paymentFees: -30_000,
      platformFees: -20_000,
      shippingCosts: -40_000,
      marketing: -100_000,
      contributionProfit: 410_000,
      fixedCosts: -36_000,
      operatingProfit: 374_000,
    });
    expect(s.reconciles).toBe(true);
  });

  it("agrees with derive()", () => {
    const t = totals();
    const s = financeStatement(t, settings, 30);
    const d = derive(t, settings, 30);
    expect(line(s, "netRevenue").amountMinor).toBe(d.netRevenue);
    expect(line(s, "grossProfit").amountMinor).toBe(d.grossProfit);
    expect(line(s, "contributionProfit").amountMinor).toBe(d.contributionProfit);
    expect(line(s, "operatingProfit").amountMinor).toBe(d.operatingProfit);
    expect(line(s, "fixedCosts").amountMinor).toBe(-d.fixedCosts);
  });

  it("shows rounding between the parts and revenue when they differ", () => {
    const s = financeStatement(totals({ revenueMinor: 1_050_003 }), settings, 30);
    expect(line(s, "rounding").amountMinor).toBe(3);
    expect(s.lines.map((l) => l.key).indexOf("rounding")).toBe(3);
    expect(s.reconciles).toBe(true);
    const down = financeStatement(totals({ revenueMinor: 1_049_998 }), settings, 30);
    expect(line(down, "rounding").amountMinor).toBe(-2);
    expect(down.reconciles).toBe(true);
    expect(financeStatement(totals(), settings, 30).lines.some((l) => l.key === "rounding")).toBe(false);
  });

  it("holds a free-shipping code's discount in discounts and the shipping before it in shipping income, with no rounding to bridge it", () => {
    // 10 000 of goods and 3 920 of shipping, the code taking all 3 920 off: revenue is 10 000.
    const s = financeStatement(totals({ grossSalesMinor: 10_000, discountsMinor: 3_920, shippingMinor: 3_920, revenueMinor: 10_000, knownCostRevenueMinor: 10_000, lineRevenueMinor: 10_000 }), settings, 30);
    expect(line(s, "discounts").amountMinor).toBe(-3_920);
    expect(line(s, "shippingIncome").amountMinor).toBe(3_920);
    expect(s.lines.some((l) => l.key === "rounding")).toBe(false);
    expect(s.reconciles).toBe(true);
  });

  it("has no profit while no cost is known, though shipping income is charged", () => {
    const s = financeStatement(totals({ revenueMinor: 14_000, lineRevenueMinor: 10_000, knownCostRevenueMinor: 0, cogsMinor: 0, refundsMinor: 0 }), settings, 30);
    expect(s.costCoverage).toBe(0);
    expect(s.hasCosts).toBe(false);
    expect(line(s, "grossProfit").amountMinor).toBeNull();
    expect(line(s, "contributionProfit").amountMinor).toBeNull();
  });

  it("gives each line its share of net revenue", () => {
    const s = financeStatement(totals(), settings, 30);
    expect(line(s, "netRevenue").shareOfNet).toBe(1);
    expect(line(s, "cogs").shareOfNet).toBeCloseTo(-0.4, 10);
    expect(line(s, "grossProfit").shareOfNet).toBeCloseTo(0.6, 10);
    expect(line(s, "operatingProfit").shareOfNet).toBeCloseTo(0.374, 10);
  });

  it("has no shares when net revenue is not above zero", () => {
    const s = financeStatement(totals({ refundsMinor: 1_050_000 }), settings, 30);
    expect(s.lines.every((l) => l.shareOfNet === null)).toBe(true);
    const empty = financeStatement({ ...EMPTY_TOTALS }, settings, 30);
    expect(empty.lines.every((l) => l.shareOfNet === null)).toBe(true);
  });

  it("marks what is estimated", () => {
    const s = financeStatement(totals(), settings, 30);
    const estimated = s.lines.filter((l) => l.estimated).map((l) => l.key);
    expect(estimated).toEqual(["paymentFees", "shippingCosts", "contributionProfit", "fixedCosts", "operatingProfit"]);
    expect(line(s, "paymentFees").label).toMatch(/estimated/);
    expect(line(s, "shippingCosts").label).toMatch(/estimated/);
    expect(line(s, "platformFees").estimated).toBe(false);
    expect(line(s, "marketing").estimated).toBe(false);
  });

  it("marks the subtotals", () => {
    const s = financeStatement(totals(), settings, 30);
    expect(s.lines.filter((l) => l.subtotal).map((l) => l.key)).toEqual(["revenue", "netRevenue", "grossProfit", "contributionProfit", "operatingProfit"]);
  });

  it("gives profit no amount, not zero, without product costs", () => {
    const s = financeStatement(totals({ cogsMinor: 0, knownCostRevenueMinor: 0 }), settings, 30);
    expect(s.hasCosts).toBe(false);
    expect(s.costCoverage).toBe(0);
    for (const key of ["cogs", "grossProfit", "contributionProfit", "operatingProfit"]) {
      expect(line(s, key).amountMinor, key).toBeNull();
      expect(line(s, key).missing, key).toBe(true);
      expect(line(s, key).note, key).toMatch(/product editor/);
    }
    // What is known stays known.
    expect(line(s, "netRevenue").amountMinor).toBe(1_000_000);
    expect(line(s, "paymentFees").amountMinor).toBe(-30_000);
    expect(s.reconciles).toBe(true);
  });

  it("estimates profit when costs are known for part of the sales, marks the lines and says from how much", () => {
    const s = financeStatement(totals({ knownCostRevenueMinor: 525_000, cogsMinor: 200_000 }), settings, 30);
    expect(s.hasCosts).toBe(true);
    expect(s.mode).toBe("estimated");
    expect(s.estimated).toBe(true);
    expect(s.costCoverage).toBe(0.5);
    // 200 000 known for half of the sales is 400 000 for all of them.
    expect(line(s, "cogs").amountMinor).toBe(-400_000);
    expect(line(s, "cogs").missing).toBe(false);
    expect(line(s, "cogs").estimated).toBe(true);
    expect(line(s, "cogs").note).toMatch(/50 %/);
    expect(line(s, "grossProfit").amountMinor).toBe(600_000);
    expect(line(s, "grossProfit").estimated).toBe(true);
    expect(line(s, "grossProfit").note).toBe("Estimated from the 50 % of sales whose cost is known.");
    expect(line(s, "contributionProfit").note).toContain("Estimated from the 50 % of sales whose cost is known");
    expect(line(s, "operatingProfit").note).toBe("Estimated from the 50 % of sales whose cost is known.");
    // 1 000 000 − 400 000 on all sales, the margin on the covered half: (500 000 − 200 000) / 500 000.
    expect(s.grossMargin).toBeCloseTo(0.6, 10);
    expect(s.reconciles).toBe(true);
  });

  it("gives the same profit as derive(), whatever the coverage", () => {
    for (const known of [0, 0.1, 0.29, 0.3, 0.45, 0.8, 1]) {
      const t = totals({ knownCostRevenueMinor: Math.round(1_050_000 * known), cogsMinor: Math.round(400_000 * known) });
      const d = derive(t, settings, 30);
      const s = financeStatement(t, settings, 30);
      expect(line(s, "grossProfit").amountMinor, `gross at ${known}`).toBe(d.grossProfit);
      expect(line(s, "contributionProfit").amountMinor, `contribution at ${known}`).toBe(d.contributionProfit);
      expect(line(s, "operatingProfit").amountMinor, `operating at ${known}`).toBe(d.operatingProfit);
      expect(s.grossMargin, `margin at ${known}`).toBe(d.grossMarginPct);
    }
  });

  it("is exact at full coverage and gives no profit but the margin under 30 %", () => {
    const exact = financeStatement(totals(), settings, 30);
    expect(exact.mode).toBe("exact");
    expect(exact.estimated).toBe(false);
    expect(line(exact, "cogs").estimated).toBe(false);
    const low = financeStatement(totals({ knownCostRevenueMinor: 210_000, cogsMinor: 40_000 }), settings, 30);
    expect(low.mode).toBe("missing");
    expect(low.hasCosts).toBe(false);
    expect(low.costCoverage).toBe(0.2);
    for (const key of ["cogs", "grossProfit", "contributionProfit", "operatingProfit"]) expect(line(low, key).amountMinor, key).toBeNull();
    expect(line(low, "cogs").note).toContain("only 20 % of sales, too few to estimate from");
    // The margin on the sales with a cost: (190 000 − 40 000) / 190 000 of a net 1 000 000 × 0.2 = 200 000.
    expect(low.grossMargin).toBeCloseTo((200_000 - 40_000) / 200_000, 10);
  });

  it("flags settings that were never entered, and counts them as zero", () => {
    const s = financeStatement(totals({ paymentFeesMinor: 0, shippingCostsMinor: 0, marketingMinor: 0 }), DEFAULT_ANALYTICS_SETTINGS, 30);
    for (const key of ["paymentFees", "shippingCosts", "marketing", "fixedCosts"]) {
      expect(line(s, key).missing, key).toBe(true);
      expect(line(s, key).amountMinor, key).toBe(0);
      expect(line(s, key).note, key).toMatch(/not set|No /);
    }
    // The rest of the bridge is still worked out.
    expect(line(s, "contributionProfit").amountMinor).toBe(600_000 - 20_000);
    expect(s.reconciles).toBe(true);
  });

  it("does not call a setting missing when there were no orders to need it", () => {
    const s = financeStatement({ ...EMPTY_TOTALS }, DEFAULT_ANALYTICS_SETTINGS, 30);
    expect(line(s, "paymentFees").missing).toBe(false);
    expect(line(s, "shippingCosts").missing).toBe(false);
    expect(line(s, "marketing").missing).toBe(false);
    // Fixed costs are not tied to orders.
    expect(line(s, "fixedCosts").missing).toBe(true);
  });

  it("with nothing sold, shows the fixed costs as a loss", () => {
    const s = financeStatement({ ...EMPTY_TOTALS }, settings, 30);
    expect(s.hasCosts).toBe(true);
    expect(s.costCoverage).toBeNull();
    expect(line(s, "operatingProfit").amountMinor).toBe(-36_000);
    expect(s.reconciles).toBe(true);
  });

  it("shows a loss", () => {
    const s = financeStatement(totals({ cogsMinor: 900_000 }), settings, 30);
    expect(line(s, "contributionProfit").amountMinor).toBe(-90_000);
    expect(line(s, "operatingProfit").amountMinor).toBe(-126_000);
    expect(s.reconciles).toBe(true);
  });

  it("spreads fixed costs over the days of the period", () => {
    expect(line(financeStatement(totals(), settings, 7), "fixedCosts").amountMinor).toBe(-Math.round((36_500 * 12 * 7) / 365));
    expect(line(financeStatement(totals(), settings, 0), "fixedCosts").amountMinor).toBe(0);
  });

  it("keeps the bridge adding up across many shapes of totals", () => {
    for (const revenueMinor of [0, 1, 999, 1_050_000]) {
      for (const refundsMinor of [0, 1, 500_000, 2_000_000]) {
        for (const known of [0, 0.5, 1]) {
          const t = totals({
            revenueMinor,
            grossSalesMinor: revenueMinor + 7,
            discountsMinor: 3,
            shippingMinor: -4,
            refundsMinor,
            knownCostRevenueMinor: Math.round(revenueMinor * known),
          });
          expect(financeStatement(t, settings, 30).reconciles, JSON.stringify([revenueMinor, refundsMinor, known])).toBe(true);
        }
      }
    }
  });
});
