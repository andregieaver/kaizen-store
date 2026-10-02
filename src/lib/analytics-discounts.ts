import { safeRatio } from "./analytics-core";

/**
 * Discounts and coupons for the marketing page (D152, docs/analytics.md): how
 * much of the business is sold at a discount, whether that is creeping up,
 * and what each code did. Amounts are minor units of the main currency
 * without VAT.
 */

/**
 * Paid orders in one month, split by whether they had any discount. SQL groups
 * by month (`YYYY-MM`, in the store's time zone) and `discounted`; a row per
 * order is the same with `orders` 1.
 */
export type DiscountOrderRow = {
  month: string;
  /** Whether these orders had any discount (campaign, group, referral, bonus credit or code). */
  discounted: boolean;
  /** Number of paid orders in the group. */
  orders: number;
  /** Their revenue (goods after discounts, with shipping income). */
  revenueMinor: number;
  /** Their goods before discounts. */
  grossGoodsMinor: number;
  /** Their discounts, positive. */
  discountMinor: number;
};

export type DiscountMonth = {
  month: string;
  orders: number;
  discountedOrders: number;
  /** Discounted / all orders; null when the month has too few orders to say. */
  share: number | null;
};

export type DiscountSummary = {
  orders: number;
  discountedOrders: number;
  /** Discounted orders / paid orders (the discount dependency). */
  dependency: number | null;
  /** Revenue of discounted orders. */
  discountedRevenueMinor: number;
  /** Their discounts. */
  discountMinor: number;
  /** Discounts / goods before discounts, over discounted orders (weighted by size, so one big order counts as one big order). */
  averageDiscountPct: number | null;
  /** Revenue / orders of orders with a discount, and of those at full price. */
  aovDiscountedMinor: number | null;
  aovFullPriceMinor: number | null;
  /** Discounted AOV / full-price AOV: below 1 means discounted baskets are smaller. */
  aovRatio: number | null;
  /** Share by month, oldest first, with months that had no orders skipped. */
  trend: DiscountMonth[];
  creeping: CreepingResult;
};

/** A month with fewer orders says nothing about a share. */
export const MIN_MONTH_ORDERS = 10;
/** Months that must rise one after the other for the dependency to be called creeping. */
export const CREEP_MONTHS = 3;
/** And by how many percentage points, over those months, as a ratio (0.08 is 8 points). */
export const CREEP_RISE = 0.08;
/** Paid orders the first and the last month of the run each need: a share of a handful of orders moves by chance. */
export const CREEP_MIN_ORDERS = 30;
/** The z of a two-proportion test of the first month against the last that the rise must reach (2.58 is p < 0.01, two-sided). */
export const CREEP_Z = 2.58;

export type CreepingResult = {
  creeping: boolean;
  /** How many months in a row, ending with the last month, the share rose; 0 when it did not. */
  risingMonths: number;
  /** The rise over those months as a ratio; null when there were none. */
  rise: number | null;
  /** The first and last month of the run, for the words; null without one. */
  from: string | null;
  to: string | null;
  /** The two-proportion z of the first month's share against the last's (pooled); null without a run or when it cannot be worked out. */
  z?: number | null;
};

/**
 * z of the difference between two shares, `a` of `na` against `b` of `nb`, with the pooled share's standard error. Null when either
 * side has no orders or the pooled share is 0 or 1 (no spread to measure against).
 */
export function twoProportionZ(a: number, na: number, b: number, nb: number): number | null {
  if (!(na > 0) || !(nb > 0)) return null;
  const pooled = (a + b) / (na + nb);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / na + 1 / nb));
  return se > 0 && Number.isFinite(se) ? (b / nb - a / na) / se : null;
}

const monthIndex = (m: string): number => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));

/**
 * Whether the share of discounted orders has risen for `CREEP_MONTHS` months
 * in a row, calendar month after calendar month, by at least `CREEP_RISE` in
 * all, and that rise is not chance: the first and the last month of the run
 * each have at least `CREEP_MIN_ORDERS` paid orders and a two-proportion
 * z-test of the first month against the last reaches `CREEP_Z`. The run is the
 * one ending with the last month given: an old rise that stopped is history.
 * A month without enough orders (share null) or a missing month ends a run.
 * Pass months that are over: a month in progress is partial.
 */
export function detectCreeping(trend: readonly DiscountMonth[]): CreepingResult {
  const none: CreepingResult = { creeping: false, risingMonths: 0, rise: null, from: null, to: null };
  let run = 0;
  for (let i = trend.length - 1; i > 0; i--) {
    const cur = trend[i];
    const prev = trend[i - 1];
    if (cur.share === null || prev.share === null) break;
    if (monthIndex(cur.month) - monthIndex(prev.month) !== 1) break;
    if (!(cur.share > prev.share)) break;
    run += 1;
  }
  if (run === 0) return none;
  const last = trend[trend.length - 1];
  const start = trend[trend.length - 1 - run];
  const rise = last.share! - start.share!;
  const z = twoProportionZ(start.discountedOrders, start.orders, last.discountedOrders, last.orders);
  const enough = start.orders >= CREEP_MIN_ORDERS && last.orders >= CREEP_MIN_ORDERS;
  const creeping = run >= CREEP_MONTHS && rise >= CREEP_RISE - 1e-9 && enough && z !== null && z >= CREEP_Z;
  return { creeping, risingMonths: run, rise, from: start.month, to: last.month, z };
}

/**
 * How much is sold at a discount, from rows per month and whether discounted.
 * Rows with the same month and flag are added together, so SQL need not be
 * perfectly grouped.
 */
export function discountSummary(rows: readonly DiscountOrderRow[]): DiscountSummary {
  let orders = 0;
  let discountedOrders = 0;
  let discountedRevenue = 0;
  let fullRevenue = 0;
  let discountedGross = 0;
  let discountTotal = 0;
  const months = new Map<string, { orders: number; discounted: number }>();

  for (const r of rows) {
    if (r.orders <= 0) continue;
    orders += r.orders;
    const m = months.get(r.month) ?? { orders: 0, discounted: 0 };
    m.orders += r.orders;
    if (r.discounted) {
      discountedOrders += r.orders;
      discountedRevenue += r.revenueMinor;
      discountedGross += r.grossGoodsMinor;
      discountTotal += r.discountMinor;
      m.discounted += r.orders;
    } else {
      fullRevenue += r.revenueMinor;
    }
    months.set(r.month, m);
  }

  const trend: DiscountMonth[] = [...months.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, m]) => ({
      month,
      orders: m.orders,
      discountedOrders: m.discounted,
      share: m.orders >= MIN_MONTH_ORDERS ? m.discounted / m.orders : null,
    }));

  const fullOrders = orders - discountedOrders;
  const aovDiscounted = safeRatio(discountedRevenue, discountedOrders);
  const aovFull = safeRatio(fullRevenue, fullOrders);

  return {
    orders,
    discountedOrders,
    dependency: safeRatio(discountedOrders, orders),
    discountedRevenueMinor: discountedRevenue,
    discountMinor: discountTotal,
    averageDiscountPct: safeRatio(discountTotal, discountedGross > 0 ? discountedGross : null),
    aovDiscountedMinor: aovDiscounted === null ? null : Math.round(aovDiscounted),
    aovFullPriceMinor: aovFull === null ? null : Math.round(aovFull),
    aovRatio: safeRatio(aovDiscounted, aovFull),
    trend,
    creeping: detectCreeping(trend),
  };
}

/** One discount code over the period. */
export type CouponRow = {
  code: string;
  /** Paid orders that used it. */
  orders: number;
  /** Their revenue. */
  revenueMinor: number;
  /** Their goods before discounts. */
  grossGoodsMinor: number;
  /** What the code took off, positive. */
  discountMinor: number;
};

export type CouponStat = CouponRow & {
  /** Discount / goods before discounts. */
  discountPct: number | null;
  /** Revenue / orders. */
  aovMinor: number | null;
  /** Discount per order. */
  discountPerOrderMinor: number | null;
  /** Share of the codes' revenue. */
  revenueShare: number | null;
};

/**
 * The codes ranked by revenue, with the code's own figures. Rows for the same
 * code (compared without regard to case) are added together; the first
 * spelling is kept.
 */
export function couponTable(rows: readonly CouponRow[]): CouponStat[] {
  const merged = new Map<string, CouponRow>();
  for (const r of rows) {
    const key = r.code.trim().toLowerCase();
    const have = merged.get(key);
    if (have) {
      have.orders += r.orders;
      have.revenueMinor += r.revenueMinor;
      have.grossGoodsMinor += r.grossGoodsMinor;
      have.discountMinor += r.discountMinor;
    } else {
      merged.set(key, { ...r, code: r.code.trim() });
    }
  }
  const list = [...merged.values()];
  const total = list.reduce((sum, r) => sum + r.revenueMinor, 0);
  return list
    .sort((a, b) => b.revenueMinor - a.revenueMinor || b.orders - a.orders || a.code.localeCompare(b.code, "en"))
    .map((r) => {
      const aov = safeRatio(r.revenueMinor, r.orders);
      const per = safeRatio(r.discountMinor, r.orders);
      return {
        ...r,
        discountPct: safeRatio(r.discountMinor, r.grossGoodsMinor > 0 ? r.grossGoodsMinor : null),
        aovMinor: aov === null ? null : Math.round(aov),
        discountPerOrderMinor: per === null ? null : Math.round(per),
        revenueShare: safeRatio(r.revenueMinor, total > 0 ? total : null),
      };
    });
}
