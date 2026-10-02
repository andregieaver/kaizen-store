import { costCoverageOf, costModeOf, coveredMargin, estimatedCogs, fixedCostsFor, type AnalyticsSettings, type CostMode, type Totals } from "./analytics-kpi";
import { formatPercent, safeRatio } from "./analytics-core";

/**
 * The finance page's statement (D152, docs/analytics.md): gross sales down to
 * operating profit as one bridge whose lines add up. Each line says whether it
 * is an estimate and whether something it needs has not been entered; a line
 * that cannot be known has no amount rather than a zero.
 */

/** Payment fees per paid order: its share of the total with VAT plus a fixed amount, as Stripe's price list is written. */
export function paymentFees(orderTotalsMinor: readonly number[], settings: Pick<AnalyticsSettings, "paymentFeeBps" | "paymentFeeFixedMinor">): number {
  let fees = 0;
  for (const total of orderTotalsMinor) {
    // A total of nothing was not charged, so it has no fee.
    if (!Number.isFinite(total) || total <= 0) continue;
    fees += Math.round((total * settings.paymentFeeBps) / 10_000) + settings.paymentFeeFixedMinor;
  }
  return fees;
}

/** Shipping costs: every paid order with a physical line costs the same to send. */
export function shippingCostsFor(physicalOrders: number, settings: Pick<AnalyticsSettings, "shippingCostMinor">): number {
  return Math.max(0, physicalOrders) * Math.max(0, settings.shippingCostMinor);
}

export type FinanceLineKey =
  | "grossSales"
  | "discounts"
  | "shippingIncome"
  | "rounding"
  | "revenue"
  | "refunds"
  | "netRevenue"
  | "cogs"
  | "grossProfit"
  | "paymentFees"
  | "platformFees"
  | "shippingCosts"
  | "marketing"
  | "contributionProfit"
  | "fixedCosts"
  | "operatingProfit";

export type FinanceLine = {
  key: FinanceLineKey;
  label: string;
  /**
   * Signed so the bridge adds up: income positive, deductions negative. A
   * subtotal is the running sum of every line above it, so adding down always
   * reaches it. Null when it cannot be known.
   */
  amountMinor: number | null;
  /** A subtotal rather than a line that adds or takes away. */
  subtotal: boolean;
  /** Worked out from settings rather than recorded (or built on a line that is). */
  estimated: boolean;
  /** Something needed to work the line out has not been entered; see `note`. */
  missing: boolean;
  /** Share of net revenue (1 for net revenue itself); null when that is not above 0 or the amount is unknown. */
  shareOfNet: number | null;
  /** Where the number comes from, or what to enter. */
  note: string | null;
};

export type FinanceStatement = {
  lines: FinanceLine[];
  /** Revenue share of lines with a known cost; null with no revenue. */
  costCoverage: number | null;
  /** Whether profit lines have an amount: exact (every cost known) or estimated (30 % of sales or more known), or nothing was sold. */
  hasCosts: boolean;
  /** How well the cost of goods is known: exact, estimated (0.3 <= coverage < 1) or missing (below 0.3, no profit figure). */
  mode: CostMode;
  /** Whether the profit lines are estimates scaled from the sales whose cost is known. */
  estimated: boolean;
  /** Gross margin on the covered sales only (`coveredMargin()`): shown whenever coverage is above 0, even where profit has no figure. */
  grossMargin: number | null;
  /** Whether the lines from net revenue down add up to operating profit exactly (a self-check; false means a bug). */
  reconciles: boolean;
};

/** Revenue without VAT is summed per order and the parts per line, so a few minor units can differ; the bridge shows them. */
const ROUNDING_LABEL = "Rounding";

/**
 * The statement for a period: gross sales − discounts + shipping income =
 * revenue; − refunds = net revenue; − COGS = gross profit; − payment fees,
 * platform fees, shipping costs, marketing = contribution profit; − fixed
 * costs (pro rata by day) = operating profit.
 *
 * Cost of goods follows docs/analytics.md ("Gross profit"): exact at coverage 1;
 * ESTIMATED from 30 % coverage (the known cost scaled to all the sales, so the COGS
 * line is marked estimated and says from how much of sales); below 30 % COGS, gross
 * profit and everything after it have no amount. Without the settings a fee or cost
 * comes from, the line counts as 0 and says so; it does not make the rest
 * unknown, as the owner may truly have none.
 */
export function financeStatement(totals: Totals, settings: AnalyticsSettings, days: number): FinanceStatement {
  const orders = totals.orders;
  const coverage = costCoverageOf(totals);
  const mode = costModeOf(coverage);
  const hasCosts = mode !== "missing";
  const estimated = mode === "estimated";
  const netRevenue = totals.revenueMinor - totals.refundsMinor;
  const share = (amount: number | null) => (amount === null ? null : safeRatio(amount, netRevenue > 0 ? netRevenue : null));

  const lines: FinanceLine[] = [];
  const push = (
    key: FinanceLineKey,
    label: string,
    amountMinor: number | null,
    opts: { subtotal?: boolean; estimated?: boolean; missing?: boolean; note?: string | null } = {},
  ) =>
    lines.push({
      key,
      label,
      // A deduction of nothing is 0, not -0, which would print as "-0" and compare unequal.
      amountMinor: amountMinor === 0 ? 0 : amountMinor,
      subtotal: opts.subtotal ?? false,
      estimated: opts.estimated ?? false,
      missing: opts.missing ?? false,
      shareOfNet: share(amountMinor),
      note: opts.note ?? null,
    });

  push("grossSales", "Gross sales", totals.grossSalesMinor, { note: "Goods before discounts, without VAT." });
  push("discounts", "Discounts", -totals.discountsMinor, { note: "Campaigns, customer groups, codes (a free-shipping code takes its discount off shipping income), referral and bonus credit." });
  push("shippingIncome", "Shipping income", totals.shippingMinor, { note: "What shipping was charged before discounts, without VAT." });
  const rounding = totals.revenueMinor - (totals.grossSalesMinor - totals.discountsMinor + totals.shippingMinor);
  if (rounding !== 0) push("rounding", ROUNDING_LABEL, rounding, { note: "VAT is taken off each line and each order, which differ by a few minor units." });
  push("revenue", "Revenue", totals.revenueMinor, { subtotal: true });
  push("refunds", "Refunds", -totals.refundsMinor, { note: "Made in the period. Refunds made only in Stripe's dashboard are not seen." });
  push("netRevenue", "Net revenue", netRevenue, { subtotal: true });

  const known = coverage === null ? "" : formatPercent(coverage, 0);
  // "Estimated from the 45 % of sales whose cost is known" on every profit line that rests on the scaling.
  const basis = estimated ? `Estimated from the ${known} of sales whose cost is known` : null;
  const costsNote = estimated
    ? `${basis}: its cost of goods is scaled up to all sales.`
    : hasCosts
      ? null
      : coverage !== null && coverage > 0
        ? `Product costs are known for only ${known} of sales, too few to estimate from. Enter the rest in the product editor.`
        : "No product cost is entered for what was sold. Enter costs in the product editor.";
  const cogs = estimatedCogs(totals, coverage);
  push("cogs", "Cost of goods sold", cogs === null ? null : -cogs, { estimated, missing: !hasCosts, note: costsNote });
  const grossProfit = cogs === null ? null : netRevenue - cogs;
  push("grossProfit", "Gross profit", grossProfit, {
    subtotal: true,
    estimated,
    missing: !hasCosts,
    note: estimated ? `${basis}.` : hasCosts ? null : costsNote,
  });

  const feesUnset = orders > 0 && settings.paymentFeeBps === 0 && settings.paymentFeeFixedMinor === 0;
  push("paymentFees", "Payment fees (estimated)", -totals.paymentFeesMinor, {
    estimated: true,
    missing: feesUnset,
    note: feesUnset ? "No payment fee is set in Analytics settings, so it counts as 0." : "Estimated from the fee in Analytics settings and each order's total with VAT.",
  });
  push("platformFees", "Platform fees", -totals.platformFeesMinor, { note: "What Kaizen took on the period's payments." });
  const shippingUnset = orders > 0 && settings.shippingCostMinor === 0;
  push("shippingCosts", "Shipping costs (estimated)", -totals.shippingCostsMinor, {
    estimated: true,
    missing: shippingUnset,
    note: shippingUnset ? "No shipping cost is set in Analytics settings, so it counts as 0." : "Estimated from the cost per order in Analytics settings.",
  });
  const noSpend = orders > 0 && totals.marketingMinor === 0;
  push("marketing", "Marketing", -totals.marketingMinor, { missing: noSpend, note: noSpend ? "No marketing spend is entered for the period." : "Spend entered under Marketing." });

  const contribution = grossProfit === null ? null : grossProfit - totals.paymentFeesMinor - totals.platformFeesMinor - totals.shippingCostsMinor - totals.marketingMinor;
  push("contributionProfit", "Contribution profit", contribution, {
    subtotal: true,
    estimated: true,
    missing: !hasCosts,
    note: !hasCosts ? costsNote : estimated ? `After the costs that follow each order, before fixed costs. ${basis}.` : "After the costs that follow each order, before fixed costs.",
  });

  const fixed = fixedCostsFor(settings, days);
  const fixedUnset = settings.fixedCostsMonthlyMinor === 0;
  push("fixedCosts", "Fixed costs (pro rata)", -fixed, {
    estimated: true,
    missing: fixedUnset,
    note: fixedUnset ? "No fixed costs are set in Analytics settings, so they count as 0." : "The monthly amount spread over the days of the period.",
  });
  const operating = contribution === null ? null : contribution - fixed;
  push("operatingProfit", "Operating profit (estimate)", operating, {
    subtotal: true,
    estimated: true,
    missing: !hasCosts,
    note: !hasCosts ? costsNote : estimated ? `${basis}.` : null,
  });

  return { lines, costCoverage: coverage, hasCosts, mode, estimated, grossMargin: coveredMargin(totals, coverage), reconciles: reconciled(lines) };
}

/**
 * Whether every subtotal equals the amounts that lead to it: revenue the
 * lines above it, net revenue revenue and refunds, and so on down. Unknown
 * amounts are skipped, as they cannot add up to anything.
 */
function reconciled(lines: readonly FinanceLine[]): boolean {
  let running = 0;
  for (const line of lines) {
    if (line.amountMinor === null) return true;
    if (line.subtotal) {
      if (line.amountMinor !== running) return false;
    } else {
      running += line.amountMinor;
    }
  }
  return true;
}
