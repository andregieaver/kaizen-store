import { formatPercent, safeRatio } from "./analytics-core";

/**
 * The products table (D152, docs/analytics.md): revenue, units, margin,
 * refunds and each product's share, ranked, with the cumulative share the
 * Pareto view draws. Also the one way a refund is split over the lines of
 * its order.
 */

/**
 * One product over the period, as SQL adds up its lines of paid orders. All
 * amounts are minor units of the main currency without VAT.
 */
export type ProductRow = {
  /** The product's id, or the line's name for goods with no product (sign-up fees and the like). */
  productId: string;
  name: string;
  /** Σ line price after discounts and without VAT. Refunds are not taken off. */
  revenueMinor: number;
  /** Units sold. */
  units: number;
  /** Paid orders with a line of this product. */
  orders: number;
  /** Σ unit cost × quantity of the lines whose cost was known; null when none of them had one. */
  cogsMinor: number | null;
  /** The part of `revenueMinor` on lines whose cost was known (0 when `cogsMinor` is null). */
  knownCostRevenueMinor: number;
  /** Refunds in the period allocated to this product by `allocateRefund()`, positive. */
  refundsMinor: number;
};

export type ProductStat = ProductRow & {
  /** Revenue less refunds. */
  netRevenueMinor: number;
  /** Net revenue − COGS; null without a known cost. Costs known for only some lines make it an overstatement: see `costCoverage`. */
  profitMinor: number | null;
  /** Profit / net revenue; null without profit or net revenue above 0. */
  margin: number | null;
  /** Share of this product's revenue on lines with a known cost; null when it had no revenue. */
  costCoverage: number | null;
  /** Refunds / revenue. */
  refundRate: number | null;
  /** Share of all the products' revenue. */
  revenueShare: number | null;
  /** Share of all the products' known profit; null without profit, or when the total is not above 0. */
  profitShare: number | null;
  /** 1 is the highest revenue; ties are broken by name, then id, so the order is stable. */
  rank: number;
  /** Revenue share of this product and all above it: the Pareto curve. */
  cumulativeShare: number | null;
};

export type ProductTable = {
  rows: ProductStat[];
  totals: {
    revenueMinor: number;
    refundsMinor: number;
    units: number;
    cogsMinor: number;
    /** Sum of the known profits; null when no product has one. */
    profitMinor: number | null;
  };
  /** The products' revenue as a share of the period's revenue: what is left is shipping income and lines with no product. Null without revenue. */
  shareOfRevenue: number | null;
};

const coverageOf = (r: ProductRow): number | null =>
  r.revenueMinor <= 0 ? null : r.cogsMinor === null ? 0 : Math.min(1, Math.max(0, r.knownCostRevenueMinor / r.revenueMinor));

const byRevenue = (a: ProductRow, b: ProductRow) =>
  b.revenueMinor - a.revenueMinor || a.name.localeCompare(b.name, "en") || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);

/**
 * Ranks the products by revenue and works out each one's figures. Shares are of
 * the table's own total, so they add up to 1; `totals.revenueMinor` of the
 * period is only used to say how much of revenue the table covers.
 */
export function productTable(rows: readonly ProductRow[], totals: { revenueMinor: number }): ProductTable {
  const sorted = [...rows].sort(byRevenue);
  const revenue = sorted.reduce((sum, r) => sum + r.revenueMinor, 0);
  const refunds = sorted.reduce((sum, r) => sum + r.refundsMinor, 0);
  const profits = sorted.map((r) => (r.cogsMinor === null ? null : r.revenueMinor - r.refundsMinor - r.cogsMinor));
  const known = profits.filter((p): p is number => p !== null);
  const profitTotal = known.length ? known.reduce((a, b) => a + b, 0) : null;

  let running = 0;
  const stats = sorted.map((r, i): ProductStat => {
    running += r.revenueMinor;
    const net = r.revenueMinor - r.refundsMinor;
    const profit = profits[i];
    return {
      ...r,
      netRevenueMinor: net,
      profitMinor: profit,
      margin: profit === null ? null : safeRatio(profit, net > 0 ? net : null),
      costCoverage: coverageOf(r),
      refundRate: safeRatio(r.refundsMinor, r.revenueMinor > 0 ? r.revenueMinor : null),
      revenueShare: safeRatio(r.revenueMinor, revenue > 0 ? revenue : null),
      profitShare: profit === null ? null : safeRatio(profit, profitTotal !== null && profitTotal > 0 ? profitTotal : null),
      rank: i + 1,
      cumulativeShare: safeRatio(running, revenue > 0 ? revenue : null),
    };
  });

  return {
    rows: stats,
    totals: {
      revenueMinor: revenue,
      refundsMinor: refunds,
      units: sorted.reduce((sum, r) => sum + r.units, 0),
      cogsMinor: sorted.reduce((sum, r) => sum + (r.cogsMinor ?? 0), 0),
      profitMinor: profitTotal,
    },
    shareOfRevenue: safeRatio(revenue, totals.revenueMinor > 0 ? totals.revenueMinor : null),
  };
}

/** Fewer products than this say nothing about concentration. */
export const PARETO_MIN_PRODUCTS = 5;

export type ParetoSummary = {
  /** Products with revenue. */
  products: number;
  /** The fewest products, best first, whose revenue reaches the threshold. */
  topCount: number;
  /** `topCount / products`. */
  topShareOfProducts: number;
  /** The share of revenue those products actually make (at least the threshold). */
  revenueShare: number;
  threshold: number;
  /** "18 % of products make 81 % of revenue"; null with too few products to say. */
  text: string | null;
};

/**
 * The smallest set of products, best first, that reaches `threshold` (80 %) of
 * revenue. Only products with revenue count. Null when there is no revenue.
 */
export function paretoSummary(table: Pick<ProductTable, "rows"> | readonly ProductStat[], threshold = 0.8): ParetoSummary | null {
  const rows = ("rows" in table ? table.rows : table).filter((r) => r.revenueMinor > 0);
  const total = rows.reduce((sum, r) => sum + r.revenueMinor, 0);
  if (rows.length === 0 || total <= 0) return null;
  const ordered = [...rows].sort(byRevenue);
  const target = total * threshold;
  let running = 0;
  let topCount = 0;
  for (const r of ordered) {
    running += r.revenueMinor;
    topCount += 1;
    // Compared with a hair of slack so 80 of 100 is reached by exactly 80.
    if (running >= target - 1e-9) break;
  }
  const revenueShare = running / total;
  const topShareOfProducts = topCount / ordered.length;
  return {
    products: ordered.length,
    topCount,
    topShareOfProducts,
    revenueShare,
    threshold,
    text: ordered.length < PARETO_MIN_PRODUCTS ? null : `${formatPercent(topShareOfProducts, 0)} of products make ${formatPercent(revenueShare, 0)} of revenue`,
  };
}

const ZERO = BigInt(0);
const ONE = BigInt(1);

/** A line of an order, to share a refund by: the amount it was sold for. */
export type RefundLine = { amountMinor: number };

/**
 * Splits a refund over an order's lines by what each was sold for, in whole
 * minor units that add up to exactly the refund (largest remainder: the lines
 * with the biggest fractions get the extra units, the earlier line on a tie).
 * Lines with no amount (gifts) get nothing unless every line is free, when the
 * refund is spread evenly rather than lost. A negative refund is split the
 * same way and stays negative. No lines: nothing to allocate to, `[]`.
 */
export function allocateRefund(refundMinor: number, lines: readonly RefundLine[]): number[] {
  if (lines.length === 0) return [];
  if (!Number.isSafeInteger(refundMinor)) throw new RangeError(`A refund is a whole number of minor units: ${refundMinor}`);
  const sign = refundMinor < 0 ? -ONE : ONE;
  const refund = BigInt(Math.abs(refundMinor));
  let weights = lines.map((l) => (Number.isFinite(l.amountMinor) && l.amountMinor > 0 ? BigInt(Math.round(l.amountMinor)) : ZERO));
  let total = weights.reduce((a, b) => a + b, ZERO);
  if (total === ZERO) {
    weights = lines.map(() => ONE);
    total = BigInt(lines.length);
  }
  // BigInt keeps refund × weight exact however large the amounts are.
  const shares = weights.map((w) => (refund * w) / total);
  const remainders = weights.map((w, i) => ({ i, rem: (refund * w) % total }));
  let left = refund - shares.reduce((a, b) => a + b, ZERO);
  remainders.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const { i } of remainders) {
    if (left === ZERO) break;
    shares[i] += ONE;
    left -= ONE;
  }
  return shares.map((s) => Number(s * sign));
}
