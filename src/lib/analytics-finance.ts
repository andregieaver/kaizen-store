import { costCoverageOf, costModeOf, coveredMargin, estimatedCogs, fixedCostsFor, type AnalyticsSettings, type CostMode, type Totals } from "./analytics-kpi";
import { fillWords } from "./admin-fill";
import { financeEn, type FinanceMessages } from "./admin-messages/finance.en";
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
  | "lostDisputes"
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


/**
 * The statement for a period: gross sales − discounts + shipping income =
 * revenue; − refunds = net revenue; − COGS = gross profit; − payment fees,
 * platform fees, shipping costs, marketing, lost disputes (D288) = contribution profit; − fixed
 * costs (pro rata by day) = operating profit.
 *
 * Cost of goods follows docs/analytics.md ("Gross profit"): exact at coverage 1;
 * ESTIMATED from 30 % coverage (the known cost scaled to all the sales, so the COGS
 * line is marked estimated and says from how much of sales); below 30 % COGS, gross
 * profit and everything after it have no amount. Without the settings a fee or cost
 * comes from, the line counts as 0 and says so; it does not make the rest
 * unknown, as the owner may truly have none.
 */
/**
 * `words` are the bridge's labels and notes in the admin's language (D312 A9); without them the statement says what it always said, in
 * English, as the AI manager and the CSV export read it. No amount depends on them.
 */
export function financeStatement(totals: Totals, settings: AnalyticsSettings, days: number, words: FinanceMessages["statement"] = financeEn.statement): FinanceStatement {
  const L = words.labels;
  const N = words.notes;
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

  push("grossSales", L.grossSales, totals.grossSalesMinor, { note: N.grossSales });
  push("discounts", L.discounts, -totals.discountsMinor, { note: N.discounts });
  push("shippingIncome", L.shippingIncome, totals.shippingMinor, { note: N.shippingIncome });
  const rounding = totals.revenueMinor - (totals.grossSalesMinor - totals.discountsMinor + totals.shippingMinor);
  if (rounding !== 0) push("rounding", L.rounding, rounding, { note: N.rounding });
  push("revenue", L.revenue, totals.revenueMinor, { subtotal: true });
  push("refunds", L.refunds, -totals.refundsMinor, { note: N.refunds });
  push("netRevenue", L.netRevenue, netRevenue, { subtotal: true });

  const known = coverage === null ? "" : formatPercent(coverage, 0);
  // "Estimated from the 45 % of sales whose cost is known" on every profit line that rests on the scaling.
  const basis = estimated ? fillWords(N.basis, { known }) : null;
  const costsNote = estimated
    ? fillWords(N.costsScaled, { basis: basis ?? "" })
    : hasCosts
      ? null
      : coverage !== null && coverage > 0
        ? fillWords(N.costsTooFew, { known })
        : N.costsNone;
  const basisSentence = fillWords(N.basisSentence, { basis: basis ?? "" });
  const cogs = estimatedCogs(totals, coverage);
  push("cogs", L.cogs, cogs === null ? null : -cogs, { estimated, missing: !hasCosts, note: costsNote });
  const grossProfit = cogs === null ? null : netRevenue - cogs;
  push("grossProfit", L.grossProfit, grossProfit, {
    subtotal: true,
    estimated,
    missing: !hasCosts,
    note: estimated ? basisSentence : hasCosts ? null : costsNote,
  });

  // Stripe's real fees where every Stripe payment of an order has one (D290), the estimate for the rest: estimated unless every order's is real.
  const realOrders = Math.min(totals.realFeeOrders ?? 0, orders);
  const allReal = orders > 0 && realOrders === orders;
  const feesUnset = orders > realOrders && settings.paymentFeeBps === 0 && settings.paymentFeeFixedMinor === 0;
  push("paymentFees", allReal ? L.paymentFees : L.paymentFeesEstimated, -totals.paymentFeesMinor, {
    estimated: !allReal,
    missing: feesUnset,
    note: allReal
      ? N.feesReal
      : realOrders > 0
        ? fillWords(N.feesPart, { real: String(realOrders), orders: String(orders), rest: feesUnset ? N.feesPartUnset : N.feesPartEstimated })
        : feesUnset
          ? N.feesUnset
          : N.feesEstimated,
  });
  push("platformFees", L.platformFees, -totals.platformFeesMinor, { note: N.platformFees });
  const shippingUnset = orders > 0 && settings.shippingCostMinor === 0;
  push("shippingCosts", L.shippingCosts, -totals.shippingCostsMinor, {
    estimated: true,
    missing: shippingUnset,
    note: shippingUnset ? N.shippingUnset : N.shippingEstimated,
  });
  const noSpend = orders > 0 && totals.marketingMinor === 0;
  push("marketing", L.marketing, -totals.marketingMinor, { missing: noSpend, note: noSpend ? N.marketingNone : N.marketing });

  // Lost disputes (D288): money the bank took back, with the provider's fee where known, in the period the dispute closed; shown only when there is one.
  const lostDisputes = totals.lostDisputesMinor ?? 0;
  if (lostDisputes !== 0) {
    push("lostDisputes", L.lostDisputes, -lostDisputes, { note: N.lostDisputes });
  }
  const contribution = grossProfit === null ? null : grossProfit - totals.paymentFeesMinor - totals.platformFeesMinor - totals.shippingCostsMinor - totals.marketingMinor - lostDisputes;
  push("contributionProfit", L.contributionProfit, contribution, {
    subtotal: true,
    estimated: true,
    missing: !hasCosts,
    note: !hasCosts ? costsNote : estimated ? fillWords(N.contributionEstimated, { basis: basis ?? "" }) : N.contribution,
  });

  const fixed = fixedCostsFor(settings, days);
  const fixedUnset = settings.fixedCostsMonthlyMinor === 0;
  push("fixedCosts", L.fixedCosts, -fixed, {
    estimated: true,
    missing: fixedUnset,
    note: fixedUnset ? N.fixedUnset : N.fixed,
  });
  const operating = contribution === null ? null : contribution - fixed;
  push("operatingProfit", L.operatingProfit, operating, {
    subtotal: true,
    estimated: true,
    missing: !hasCosts,
    note: !hasCosts ? costsNote : estimated ? basisSentence : null,
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
