import { formatCount, formatPercent } from "./analytics-core";
import { formatAmount } from "./analytics-format";
import type { CreepingResult } from "./analytics-discounts";
import type { StockoutAlert } from "./analytics-inventory";
import { STOCKOUT_ALERT_DAYS } from "./analytics-inventory";
import { ESTIMATE_MIN_COVERAGE } from "./analytics-kpi";
import { addDays, daysBetween, isDay, isoWeekday } from "./analytics-period";
import type { TargetProgress } from "./analytics-targets";

/**
 * What needs a look today (D152, docs/analytics.md, "Alerts"). `alertsFor()`
 * turns a snapshot of the store's reports into a short, ordered list: pure,
 * computed on read, never stored, no model. A server module assembles the
 * `AlertSnapshot` from the existing reports (daily series, product and channel
 * tables, stockout rows, funnel counts, target progress, cost coverage).
 *
 * Honesty rules that shape every rule below:
 * - each has a threshold and a minimum volume (`ALERT_RULES`); small numbers
 *   raise nothing;
 * - a figure that cannot be known (no visit counting, a missing day, a missing
 *   input) raises nothing and is never taken as zero; there is no alert about
 *   visit counting being off;
 * - the words state what the figures say, with the figures, and neither blame
 *   nor exaggerate.
 *
 * Amounts are minor units of the store's main currency, without VAT. Days are
 * `YYYY-MM-DD` in the store's time zone.
 */

/** The thresholds and minimum volumes of every rule, in one place; the tests hold each one at, below and above. */
export const ALERT_RULES = {
  /** Conversion rate down against the four weeks before. */
  conversion: {
    /** Relative drop (0.2 is 20 % lower) that raises a warning. */
    minDrop: 0.2,
    /** Relative drop that makes it urgent. */
    urgentDrop: 0.4,
    /** Sessions in the last 7 days and in today so far, with known visit counts. */
    minSessions7d: 700,
    minSessionsToday: 150,
    /** Sessions and orders in the four weeks it is compared with. */
    minBaselineSessions: 1500,
    minBaselineOrders: 30,
    /** Days with a visit count in the last 7 days, and in the four weeks before. */
    minKnownDays7d: 5,
    minKnownDaysBaseline: 14,
    /** Today so far is only judged once this much of the day has passed (noon). */
    minDayShare: 0.5,
  },
  /** Today's revenue far under the same weekday's usual. */
  weekdayRevenue: {
    /** Same weekdays compared with: the previous 8. */
    weeks: 8,
    /** Of those, at least this many must be known. */
    minObservations: 6,
    /**
     * Today is only judged late in the day, from 20:00. Sales are not spread evenly over the clock (a store that takes
     * a quarter of its day's orders before noon would look "50 % under" at noon on an ordinary day), and the snapshot
     * has no hourly profile, so the rule waits until the evening, when most of a usual day has been sold and the
     * clock's share is close to (and under) what has really passed: the expectation is then slightly low, never high.
     */
    minDayShare: 20 / 24,
    /** Orders a usual day of that weekday brings by this time of day (median orders x share of the day): the minimum baseline. */
    minExpectedOrders: 15,
    /** Revenue so far at least this much (0.5 is half) under what is expected by now raises a warning. */
    minDrop: 0.5,
    /** And this much makes it urgent. */
    urgentDrop: 0.8,
  },
  /** A product's refunds over its normal. */
  refunds: {
    /** The recent window in days, and the baseline window of the days before it. */
    recentDays: 14,
    baselineDays: 90,
    /** Recent refund rate at least this many times the baseline's. */
    minRatio: 2,
    /** Units sold in the recent window, and refunded in it. */
    minSold: 5,
    minRefunded: 2,
    /** Units sold in the baseline window for it to count as normal. */
    minBaselineSold: 20,
    /** A baseline refund rate under this counts as this, so a product that never had a refund can be compared. */
    baselineFloor: 0.02,
    /** A recent refund rate under this (5 %) is not worth a word, however it compares. */
    minRate: 0.05,
    /** Urgent from this many times normal and this many refunds. */
    urgentRatio: 4,
    urgentRefunded: 5,
  },
  /** Cost to win a new customer up in a channel. */
  cac: {
    /** Relative rise (0.25 is +25 %) of the last 7 days against the 28 days before. */
    minRise: 0.25,
    /** Spend in each window, minor units. */
    minSpend7d: 20_000,
    minSpend28d: 20_000,
    /** New customers in each window. */
    minNewCustomers7d: 3,
    minNewCustomers28d: 8,
  },
  /** Variants that sell and are out or nearly out. */
  stockout: {
    /** Days of stock at or under which a variant is named (`STOCKOUT_ALERT_DAYS`). */
    withinDays: STOCKOUT_ALERT_DAYS,
    /** Variants named in the words; the rest are counted. */
    named: 3,
  },
  /** Checkouts started and not completed, up. */
  abandonment: {
    /** Rise, in share points (0.1 is 10 points), of the last 7 days over the 28 days before. */
    minRisePoints: 0.1,
    /** Rise that makes it urgent. */
    urgentRisePoints: 0.25,
    /** Checkouts started in the last 7 days and in the 28 before. */
    minStarted7d: 50,
    minStarted28d: 200,
  },
  /** Orders with a discount: nothing but the creeping result's own rule (`detectCreeping()`). */
  discounts: {},
  /** A month's target at risk: `targetProgress()`'s own status, once there is enough of the month and of sales to tell it from chance. */
  target: {
    /** Urgent when the month is on course to end at this share of the target or less. */
    urgentProjectedShare: 0.7,
    /** Whole days of the month that must have passed (a few days of sales say little about a month). */
    minDaysElapsed: 7,
    /** Paid orders in the month so far. */
    minOrders: 30,
    /** Complete days of history, before today, to measure how much a day's revenue varies. */
    minHistoryDays: 14,
    /**
     * The shortfall must be more than this many standard deviations of what the days so far could add up to by chance
     * (the spread of a day's revenue in the last 56 days, over the square root of the days elapsed), so a store whose
     * target is exactly its normal month is not told it is behind by an ordinary run of quiet days.
     */
    sigmas: 2.5,
  },
  /** Product costs missing for profit. */
  costs: {
    /** Cost coverage under this (0.8) is low. */
    minCoverage: 0.8,
    /** Orders in the last 28 days for it to be worth saying. */
    minOrders: 10,
  },
  /** Returning customers' revenue at a high. */
  returningHigh: {
    /** Months compared, this one included. */
    months: 12,
    /** The month's orders from returning customers. */
    minOrders: 10,
    /** It must beat the best of the other months by this share (0.05 is 5 %). */
    minMargin: 0.05,
  },
  /** Best day in the last 90 days. */
  bestDay: {
    /** Days compared: yesterday and the 89 before. */
    days: 90,
    /** Days of those 89 that must be known. */
    minKnownDays: 80,
    /** Orders yesterday. */
    minOrders: 5,
  },
} as const;

/** The most alerts returned: urgent ones are never dropped for it. */
export const MAX_ALERTS = 8;

export type AlertSeverity = "urgent" | "warning" | "info" | "good";

/** One figure behind an alert, as the page shows it under the words. */
export type AlertEvidence = {
  label: string;
  /** The figure now, written. */
  value: string;
  /** What it is compared with, written; null when it is not a comparison. */
  baseline: string | null;
};

export type Alert = {
  /** Stable per rule, for keys and for a link to one alert. */
  id: string;
  severity: AlertSeverity;
  /** Plain English with the figures in it. */
  text: string;
  /** A path after the store's admin base, e.g. `/analytics/products?sort=refunds`. */
  href: string;
  /** The link's words. */
  action: string;
  evidence: AlertEvidence[];
  /** How far past its threshold the alert is (the measure over its threshold), for ordering within a severity: only comparable as an order. */
  size: number;
};

/** One day. Orders and revenue are always known (zeros included); sessions are null before visit counting was on. */
export type DailyPoint = {
  day: string;
  /** Paid orders. */
  orders: number;
  /** Net revenue without VAT, minor units. */
  revenueMinor: number;
  /** Visits; null when not counted that day (never 0 for "not known"). */
  sessions: number | null;
};

/**
 * A product's units over the last 14 days and over the 90 days before them (disjoint windows). Refunded units are
 * dated by their refund, sold units by their sale.
 */
export type ProductRefundRow = {
  productId: string;
  name: string;
  sold14: number;
  refunded14: number;
  soldBaseline: number;
  refundedBaseline: number;
};

/** A channel's marketing spend and new customers over the last 7 days and over the 28 days before them (disjoint windows). */
export type ChannelCacRow = {
  channel: string;
  label: string;
  spend7Minor: number;
  newCustomers7: number;
  spendPrev28Minor: number;
  newCustomersPrev28: number;
};

/** Checkouts started and completed (paid) in a window. */
export type CheckoutCounts = { started: number; completed: number };

/** One completed month of returning customers' revenue. */
export type ReturningMonth = { month: string; revenueMinor: number; orders: number };

/**
 * Everything `alertsFor()` reads. Only the first four fields are required; a rule whose input is missing or null raises
 * nothing.
 */
export type AlertSnapshot = {
  /** The store's main currency and the locale to write amounts in (default `en`). */
  currency: string;
  locale?: string;
  /** The store's today. */
  today: string;
  /** How much of today has passed in the store's time zone, 0 to 1 (the hour over 24). */
  dayShare: number;
  /**
   * Orders, revenue and sessions per day: at least the 56 complete days before today and today's own row (partial), 90
   * days where the best-day rule should run. Every day present, zeros included; a day that is missing is unknown.
   */
  daily: readonly DailyPoint[];
  /** Per-product refunds (`ProductRefundRow`); null or missing when not worked out. */
  productRefunds?: readonly ProductRefundRow[] | null;
  /** Per-channel CAC inputs; only channels with spend and attribution belong here. */
  channelCac?: readonly ChannelCacRow[] | null;
  /** From `stockoutAlerts()`, soonest first. */
  stockouts?: readonly StockoutAlert[] | null;
  /** Checkouts of the last 7 days and of the 28 days before them; null when visit counting is off. */
  checkout?: { recent: CheckoutCounts; baseline: CheckoutCounts } | null;
  /** From `detectCreeping()` over the months that are over. */
  discountCreeping?: CreepingResult | null;
  /** This month's `targetProgress()`. */
  target?: TargetProgress | null;
  /** Cost coverage (0 to 1) over the last 28 days and the paid orders in them; null coverage when not worked out. */
  costs?: { coverage: number | null; orders: number } | null;
  /** Returning customers' revenue by completed month, oldest first. */
  returningMonthly?: readonly ReturningMonth[] | null;
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { urgent: 0, warning: 1, info: 2, good: 3 };

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EPS = 1e-9;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** An amount written in the store's currency; whole numbers only reach formatMoney. */
function money(minor: number, snapshot: AlertSnapshot): string {
  try {
    return formatAmount(Math.round(minor), snapshot.currency, snapshot.locale ?? "en");
  } catch {
    return `${formatCount(minor / 100)} ${snapshot.currency}`;
  }
}

/** `2026-09` as "September 2026". */
function monthText(month: string): string {
  const m = Number(month.slice(5, 7));
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${month.slice(0, 4)}` : month;
}

/** A multiple as "2.5 times", "4 times", "12 times". */
function times(ratio: number): string {
  const text = ratio >= 10 ? String(Math.round(ratio)) : (Math.round(ratio * 10) / 10).toFixed(1).replace(/\.0$/, "");
  return `${text} times`;
}

/** "about 3 days", "about 1 day", "under a day". */
function daysText(days: number): string {
  if (days < 1) return "under a day";
  const n = Math.round(days);
  return `about ${n} ${n === 1 ? "day" : "days"}`;
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

type DayMap = Map<string, DailyPoint>;

function dayMap(daily: readonly DailyPoint[]): DayMap {
  const map: DayMap = new Map();
  for (const d of daily) {
    if (!isDay(d.day) || !finite(d.orders) || !finite(d.revenueMinor)) continue;
    const existing = map.get(d.day);
    if (!existing) {
      map.set(d.day, { ...d, sessions: finite(d.sessions) ? d.sessions : null });
    } else {
      // A repeated day (rows per currency) is added up; a visit count that is known in either row is kept.
      existing.orders += d.orders;
      existing.revenueMinor += d.revenueMinor;
      existing.sessions = finite(d.sessions) ? (existing.sessions ?? 0) + d.sessions : existing.sessions;
    }
  }
  return map;
}

type ConversionWindow = { sessions: number; orders: number; days: number; rate: number };

/** Orders over sessions across the days of `from..to` whose visit count is known (orders of the other days are left out too). */
function conversionOver(days: DayMap, from: string, to: string): ConversionWindow | null {
  let sessions = 0;
  let orders = 0;
  let known = 0;
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) {
    const d = days.get(addDays(from, i));
    if (!d || d.sessions === null) continue;
    sessions += d.sessions;
    orders += d.orders;
    known += 1;
  }
  return sessions > 0 ? { sessions, orders, days: known, rate: orders / sessions } : null;
}

// ---------- rules ----------

function conversionAlert(s: AlertSnapshot, days: DayMap): Alert | null {
  const r = ALERT_RULES.conversion;
  const today = s.today;
  const baseTrailing = conversionOver(days, addDays(today, -28), addDays(today, -1));
  const baseWeek = conversionOver(days, addDays(today, -35), addDays(today, -8));
  const week = conversionOver(days, addDays(today, -7), addDays(today, -1));
  const todayNow = finite(s.dayShare) && s.dayShare >= r.minDayShare ? conversionOver(days, today, today) : null;

  const baselineOk = (b: ConversionWindow | null): b is ConversionWindow =>
    b !== null && b.days >= r.minKnownDaysBaseline && b.sessions >= r.minBaselineSessions && b.orders >= r.minBaselineOrders;
  const drops = (w: ConversionWindow, b: ConversionWindow) => 1 - w.rate / b.rate;

  type Hit = { w: ConversionWindow; b: ConversionWindow; drop: number; label: string; when: string; against: string };
  const hits: Hit[] = [];
  if (week && week.days >= r.minKnownDays7d && week.sessions >= r.minSessions7d && baselineOk(baseWeek)) {
    const drop = drops(week, baseWeek);
    if (drop >= r.minDrop - EPS) hits.push({ w: week, b: baseWeek, drop, label: "the last 7 days", when: "over the last 7 days", against: "the four weeks before" });
  }
  if (todayNow && todayNow.sessions >= r.minSessionsToday && baselineOk(baseTrailing)) {
    const drop = drops(todayNow, baseTrailing);
    if (drop >= r.minDrop - EPS) hits.push({ w: todayNow, b: baseTrailing, drop, label: "today so far", when: "today", against: "the last four weeks" });
  }
  // The week is the steadier evidence: it speaks first when both do.
  const hit = hits[0];
  if (!hit) return null;
  return {
    id: "conversion-drop",
    severity: hit.drop >= r.urgentDrop - EPS ? "urgent" : "warning",
    text: `Conversion rate is ${formatPercent(hit.drop, 0)} lower ${hit.when} than ${hit.against} (${formatPercent(hit.w.rate)} against ${formatPercent(hit.b.rate)}).`,
    href: "/analytics/traffic",
    action: "See where it fell",
    evidence: [
      { label: `Conversion rate, ${hit.label}`, value: formatPercent(hit.w.rate), baseline: `${formatPercent(hit.b.rate)} over ${hit.against}` },
      { label: `Sessions, ${hit.label}`, value: formatCount(hit.w.sessions), baseline: `${formatCount(hit.b.sessions)} over ${hit.against}` },
      { label: `Orders, ${hit.label}`, value: formatCount(hit.w.orders), baseline: `${formatCount(hit.b.orders)} over ${hit.against}` },
    ],
    size: hit.drop / r.minDrop,
  };
}

/** The median of a list; the mean of the middle two for an even count. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function weekdayRevenueAlert(s: AlertSnapshot, days: DayMap): Alert | null {
  const r = ALERT_RULES.weekdayRevenue;
  if (!finite(s.dayShare) || s.dayShare < r.minDayShare) return null;
  const now = days.get(s.today);
  if (!now) return null;
  const same: DailyPoint[] = [];
  for (let k = 1; k <= r.weeks; k++) {
    const d = days.get(addDays(s.today, -7 * k));
    if (d) same.push(d);
  }
  if (same.length < r.minObservations) return null;
  const usualRevenue = median(same.map((d) => d.revenueMinor)) as number;
  const usualOrders = median(same.map((d) => d.orders)) as number;
  const share = Math.min(1, s.dayShare);
  const expectedRevenue = usualRevenue * share;
  if (usualOrders * share < r.minExpectedOrders - EPS || !(expectedRevenue > 0)) return null;
  const drop = 1 - now.revenueMinor / expectedRevenue;
  if (drop < r.minDrop - EPS) return null;
  const weekday = WEEKDAYS[isoWeekday(s.today) - 1];
  return {
    id: "revenue-weekday",
    severity: drop >= r.urgentDrop - EPS ? "urgent" : "warning",
    text: `Revenue so far today is ${money(Math.max(0, now.revenueMinor), s)}, ${formatPercent(Math.min(1, drop), 0)} under a usual ${weekday} by this time (${money(expectedRevenue, s)}).`,
    href: "/analytics",
    action: "See today",
    evidence: [
      { label: "Revenue so far today", value: money(now.revenueMinor, s), baseline: `${money(expectedRevenue, s)} expected by now` },
      { label: `A usual ${weekday}, all day`, value: money(usualRevenue, s), baseline: `median of the last ${same.length} ${weekday}s` },
      { label: "Orders so far today", value: formatCount(now.orders), baseline: `${formatCount(Math.round(usualOrders * share * 10) / 10)} expected by now` },
    ],
    size: drop / r.minDrop,
  };
}

function refundAlert(s: AlertSnapshot): Alert | null {
  const r = ALERT_RULES.refunds;
  type Hit = { row: ProductRefundRow; recent: number; usual: number; ratio: number };
  const hits: Hit[] = [];
  for (const row of s.productRefunds ?? []) {
    if (![row.sold14, row.refunded14, row.soldBaseline, row.refundedBaseline].every(finite)) continue;
    if (row.sold14 < r.minSold || row.refunded14 < r.minRefunded || row.soldBaseline < r.minBaselineSold) continue;
    const recent = row.refunded14 / row.sold14;
    const usual = row.refundedBaseline / row.soldBaseline;
    const ratio = recent / Math.max(usual, r.baselineFloor);
    if (ratio < r.minRatio - EPS || recent < r.minRate - EPS) continue;
    hits.push({ row, recent, usual, ratio });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.ratio - a.ratio || b.row.refunded14 - a.row.refunded14 || a.row.name.localeCompare(b.row.name, "en") || (a.row.productId < b.row.productId ? -1 : 1));
  const top = hits[0];
  const others = hits.length - 1;
  const urgent = top.ratio >= r.urgentRatio - EPS && top.row.refunded14 >= r.urgentRefunded;
  const sold = `${formatCount(top.row.refunded14)} of ${formatCount(top.row.sold14)} sold in the last ${r.recentDays} days (${formatPercent(top.recent, 0)}) against ${formatPercent(top.usual, 1)} before`;
  // A product that has hardly ever had a refund is compared with the floor, which would make a multiple look bigger than it is: say the figures instead.
  let text = top.usual < r.baselineFloor ? `Refunds on ${top.row.name} are well above what they usually are: ${sold}.` : `Refunds on ${top.row.name} are running at ${times(top.ratio)} their usual rate: ${sold}.`;
  if (others > 0) text += others === 1 ? " Another product is also over twice its usual rate." : ` ${formatCount(others)} other products are also over twice their usual rate.`;
  return {
    id: "refund-rate",
    severity: urgent ? "urgent" : "warning",
    text,
    href: "/analytics/products?sort=refunds",
    action: "See refunds by product",
    evidence: hits.slice(0, 3).map((h) => ({
      label: `Refunded units, ${h.row.name}, last ${r.recentDays} days`,
      value: `${formatCount(h.row.refunded14)} of ${formatCount(h.row.sold14)} (${formatPercent(h.recent, 1)})`,
      baseline: `${formatPercent(h.usual, 1)} over the ${r.baselineDays} days before`,
    })),
    size: top.ratio / r.minRatio,
  };
}

function cacAlert(s: AlertSnapshot): Alert | null {
  const r = ALERT_RULES.cac;
  type Hit = { row: ChannelCacRow; now: number; before: number; rise: number };
  const hits: Hit[] = [];
  for (const row of s.channelCac ?? []) {
    if (![row.spend7Minor, row.newCustomers7, row.spendPrev28Minor, row.newCustomersPrev28].every(finite)) continue;
    if (row.spend7Minor < r.minSpend7d || row.spendPrev28Minor < r.minSpend28d) continue;
    if (row.newCustomers7 < r.minNewCustomers7d || row.newCustomersPrev28 < r.minNewCustomers28d) continue;
    const now = row.spend7Minor / row.newCustomers7;
    // The previous four weeks' weekly average, as a ratio of their spend to their new customers.
    const before = row.spendPrev28Minor / row.newCustomersPrev28;
    const rise = now / before - 1;
    if (rise >= r.minRise - EPS) hits.push({ row, now, before, rise });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.rise - a.rise || a.row.label.localeCompare(b.row.label, "en") || (a.row.channel < b.row.channel ? -1 : 1));
  const top = hits[0];
  const others = hits.length - 1;
  let text = `A new customer from ${top.row.label} cost ${money(top.now, s)} over the last 7 days, ${formatPercent(top.rise, 0)} more than the ${money(top.before, s)} of the four weeks before.`;
  if (others > 0) text += ` ${others === 1 ? "Another channel is" : `${formatCount(others)} other channels are`} also up by a quarter or more.`;
  return {
    id: "cac-up",
    severity: "warning",
    text,
    href: "/analytics/marketing",
    action: "See channels",
    evidence: hits.slice(0, 3).map((h) => ({
      label: `Cost per new customer, ${h.row.label}`,
      value: money(h.now, s),
      baseline: `${money(h.before, s)} over the four weeks before`,
    })),
    size: top.rise / r.minRise,
  };
}

function stockoutAlert(s: AlertSnapshot): Alert | null {
  const r = ALERT_RULES.stockout;
  const rows = (s.stockouts ?? [])
    .filter((a) => (a.kind === "out" || (finite(a.days) && a.days <= r.withinDays + EPS)) && a.row)
    .sort((a, b) => (a.kind === "out" ? 0 : 1) - (b.kind === "out" ? 0 : 1) || a.days - b.days || a.row.name.localeCompare(b.row.name, "en") || (a.row.variantId < b.row.variantId ? -1 : 1));
  if (rows.length === 0) return null;
  const named = rows.slice(0, r.named);
  const rest = rows.length - named.length;
  const outCount = rows.filter((a) => a.kind === "out").length;
  const describe = (a: StockoutAlert) => `${a.row.name} (${a.kind === "out" ? "out" : daysText(a.days)})`;
  const lead = outCount === 0 ? "Running out within a week" : outCount === rows.length ? "Out of stock" : "Out of stock or running out within a week";
  const text = `${lead}: ${named.map(describe).join(", ")}${rest > 0 ? ` and ${formatCount(rest)} more` : ""}.`;
  return {
    id: "stockout",
    severity: outCount > 0 ? "urgent" : "warning",
    text,
    href: "/analytics/inventory",
    action: "See stock",
    evidence: named.map((a) => ({
      label: a.row.name,
      value: a.kind === "out" ? "Out of stock" : `${daysText(a.days)} of stock`,
      baseline: `${formatCount(a.row.sold30)} sold in 30 days`,
    })),
    size: rows.length,
  };
}

function abandonmentAlert(s: AlertSnapshot): Alert | null {
  const r = ALERT_RULES.abandonment;
  const c = s.checkout;
  if (!c) return null;
  const { recent, baseline } = c;
  if (![recent.started, recent.completed, baseline.started, baseline.completed].every(finite)) return null;
  if (recent.started < r.minStarted7d || baseline.started < r.minStarted28d) return null;
  const rate = (x: CheckoutCounts) => 1 - Math.min(x.started, Math.max(0, x.completed)) / x.started;
  const now = rate(recent);
  const before = rate(baseline);
  const rise = now - before;
  if (rise < r.minRisePoints - EPS) return null;
  return {
    id: "checkout-abandonment",
    severity: rise >= r.urgentRisePoints - EPS ? "urgent" : "warning",
    text: `${formatPercent(now, 0)} of the checkouts started in the last 7 days were not completed, against ${formatPercent(before, 0)} over the four weeks before.`,
    href: "/analytics/traffic",
    action: "See the funnel",
    evidence: [
      { label: "Checkouts not completed, last 7 days", value: formatPercent(now, 1), baseline: `${formatPercent(before, 1)} over the four weeks before` },
      { label: "Checkouts started, last 7 days", value: formatCount(recent.started), baseline: `${formatCount(baseline.started)} over the four weeks before` },
    ],
    size: rise / r.minRisePoints,
  };
}

function creepingAlert(s: AlertSnapshot): Alert | null {
  const c = s.discountCreeping;
  if (!c || !c.creeping || c.rise === null || !c.from || !c.to) return null;
  const points = Math.round(c.rise * 100);
  return {
    id: "discount-creep",
    severity: "info",
    text: `The share of orders with a discount has risen ${formatCount(c.risingMonths)} months in a row, by ${formatCount(points)} percentage points from ${monthText(c.from)} to ${monthText(c.to)}.`,
    href: "/analytics/marketing",
    action: "See discounts",
    evidence: [{ label: "Months of rise in a row", value: formatCount(c.risingMonths), baseline: null }, { label: "Rise in the share of discounted orders", value: `${formatCount(points)} points`, baseline: `${monthText(c.from)} to ${monthText(c.to)}` }],
    size: c.rise / 0.08,
  };
}

/** The standard deviation of one day's revenue over the complete days before today that are known; null with fewer than `min`. */
function dailyRevenueSpread(days: DayMap, today: string, window: number, min: number): number | null {
  const values: number[] = [];
  for (let k = 1; k <= window; k++) {
    const d = days.get(addDays(today, -k));
    if (d) values.push(d.revenueMinor);
  }
  if (values.length < min || values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
}

function targetAlert(s: AlertSnapshot, days: DayMap): Alert | null {
  const t = s.target;
  if (!t || t.status !== "behind" || t.tooEarly || t.targetMinor === null || t.expectedByTodayMinor === null || t.aheadByMinor === null) return null;
  const r = ALERT_RULES.target;
  // Enough of the month and enough sales to tell a pace from chance.
  const dayOfMonth = t.daysInMonth - t.daysLeft;
  if (dayOfMonth - 1 < r.minDaysElapsed) return null;
  const monthStart = `${s.today.slice(0, 8)}01`;
  let orders = 0;
  for (let d = monthStart; d <= s.today; d = addDays(d, 1)) orders += days.get(d)?.orders ?? 0;
  if (orders < r.minOrders) return null;
  const spread = dailyRevenueSpread(days, s.today, 56, r.minHistoryDays);
  if (spread === null || !finite(t.shareElapsed)) return null;
  const daysElapsed = t.shareElapsed * t.daysInMonth;
  if (!(-t.aheadByMinor > r.sigmas * spread * Math.sqrt(Math.max(daysElapsed, 1)))) return null;
  const monthName = MONTHS[Number(s.today.slice(5, 7)) - 1] ?? "this month";
  const behind = Math.abs(t.aheadByMinor);
  let text = `Net revenue is ${money(behind, s)} behind the pace the ${monthName} target needs: ${money(t.actualMinor, s)} so far against ${money(t.expectedByTodayMinor, s)} expected by now.`;
  if (t.projectedMinor !== null && t.projectedPct !== null) {
    text += ` At this pace the month ends near ${money(t.projectedMinor, s)}, ${formatPercent(t.projectedPct, 0)} of the ${money(t.targetMinor, s)} target (an estimate).`;
  }
  const urgent = t.projectedPct !== null && t.projectedPct <= ALERT_RULES.target.urgentProjectedShare + EPS;
  return {
    id: "target-behind",
    severity: urgent ? "urgent" : "warning",
    text,
    href: "/analytics",
    action: "See the target",
    evidence: [
      { label: "Net revenue so far this month", value: money(t.actualMinor, s), baseline: `${money(t.expectedByTodayMinor, s)} expected by now` },
      ...(t.projectedMinor !== null ? [{ label: "Where the month ends at this pace (estimate)", value: money(t.projectedMinor, s), baseline: `${money(t.targetMinor, s)} target` }] : []),
    ],
    size: t.aheadByPct !== null ? Math.abs(t.aheadByPct) : 0,
  };
}

function costAlert(s: AlertSnapshot): Alert | null {
  const r = ALERT_RULES.costs;
  const c = s.costs;
  if (!c || c.coverage === null || !finite(c.coverage) || !finite(c.orders) || c.orders < r.minOrders) return null;
  if (c.coverage >= r.minCoverage - EPS) return null;
  const none = c.coverage <= 0;
  // Below ESTIMATE_MIN_COVERAGE too little is known to estimate profit from; from there it is an estimate (docs/analytics.md).
  const tooFew = !none && c.coverage < ESTIMATE_MIN_COVERAGE;
  return {
    id: "cost-coverage",
    severity: none || tooFew ? "warning" : "info",
    text: none
      ? "No product costs are entered, so profit cannot be shown. Enter what each variant costs and gross profit and margin appear."
      : tooFew
        ? `Product costs are known for only ${formatPercent(c.coverage, 0)} of sales, too few to estimate profit from, so it is not shown. Enter the costs still missing to see it.`
        : `Product costs are known for ${formatPercent(c.coverage, 0)} of sales, so profit figures are estimated from that share. Enter the costs still missing to make them exact.`,
    href: "/products",
    action: "Enter costs",
    evidence: [{ label: "Sales with a known cost", value: none ? "None" : formatPercent(c.coverage, 0), baseline: `${formatPercent(r.minCoverage, 0)} or more is complete enough` }],
    size: (r.minCoverage - c.coverage) / r.minCoverage,
  };
}

function returningHighAlert(s: AlertSnapshot): Alert | null {
  const r = ALERT_RULES.returningHigh;
  const months = (s.returningMonthly ?? []).filter((m) => finite(m.revenueMinor) && finite(m.orders) && /^\d{4}-\d{2}$/.test(m.month));
  if (months.length < r.months) return null;
  const window = [...months].sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-r.months);
  // Twelve calendar months running, none missing.
  const index = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  if (index(window[window.length - 1].month) - index(window[0].month) !== r.months - 1) return null;
  const latest = window[window.length - 1];
  const rest = window.slice(0, -1);
  const best = rest.reduce((a, b) => (b.revenueMinor > a.revenueMinor ? b : a));
  if (latest.orders < r.minOrders || !(best.revenueMinor > 0) || latest.revenueMinor < best.revenueMinor * (1 + r.minMargin) - EPS) return null;
  return {
    id: "returning-high",
    severity: "good",
    text: `Returning customers brought in ${money(latest.revenueMinor, s)} in ${monthText(latest.month)}, the most in any of the last ${r.months} months (the best before was ${money(best.revenueMinor, s)} in ${monthText(best.month)}).`,
    href: "/analytics/customers",
    action: "See customers",
    evidence: [
      { label: `Returning customers' revenue, ${monthText(latest.month)}`, value: money(latest.revenueMinor, s), baseline: `${money(best.revenueMinor, s)} best before (${monthText(best.month)})` },
      { label: "Orders from returning customers", value: formatCount(latest.orders), baseline: null },
    ],
    size: latest.revenueMinor / best.revenueMinor - 1,
  };
}

function bestDayAlert(s: AlertSnapshot, days: DayMap): Alert | null {
  const r = ALERT_RULES.bestDay;
  const yesterday = addDays(s.today, -1);
  const y = days.get(yesterday);
  if (!y || y.orders < r.minOrders) return null;
  const others: DailyPoint[] = [];
  for (let k = 2; k <= r.days; k++) {
    const d = days.get(addDays(s.today, -k));
    if (d) others.push(d);
  }
  if (others.length < r.minKnownDays) return null;
  const best = others.reduce((a, b) => (b.revenueMinor > a.revenueMinor ? b : a));
  if (!(y.revenueMinor > best.revenueMinor) || !(y.revenueMinor > 0)) return null;
  return {
    id: "best-day",
    severity: "good",
    text: `Yesterday was your best day in ${r.days} days: ${money(y.revenueMinor, s)} from ${plural(y.orders, "order", "orders")}.`,
    href: "/analytics",
    action: "See the overview",
    evidence: [{ label: "Revenue yesterday", value: money(y.revenueMinor, s), baseline: `${money(best.revenueMinor, s)} the best day before` }],
    size: best.revenueMinor > 0 ? y.revenueMinor / best.revenueMinor - 1 : 0,
  };
}

/**
 * Sorts alerts: urgent, warning, info, then good; within a severity the larger first (then by id, so the order is
 * stable). Keeps at most `MAX_ALERTS`, and never drops an urgent one.
 */
export function orderAlerts(alerts: readonly Alert[], max = MAX_ALERTS): Alert[] {
  const sorted = [...alerts].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.size - a.size || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const urgent = sorted.filter((a) => a.severity === "urgent");
  const rest = sorted.filter((a) => a.severity !== "urgent");
  return [...urgent, ...rest.slice(0, Math.max(0, max - urgent.length))];
}

/**
 * What needs a look, most pressing first. Computed on read from the snapshot; each rule's threshold and minimum
 * volume is in `ALERT_RULES`. Never more than `MAX_ALERTS` unless that many are urgent. An empty list is an answer:
 * nothing needs a look.
 */
export function alertsFor(snapshot: AlertSnapshot): Alert[] {
  if (!isDay(snapshot.today)) throw new RangeError(`today is not a day: ${snapshot.today}`);
  const days = dayMap(snapshot.daily ?? []);
  const found = [
    conversionAlert(snapshot, days),
    weekdayRevenueAlert(snapshot, days),
    refundAlert(snapshot),
    cacAlert(snapshot),
    stockoutAlert(snapshot),
    abandonmentAlert(snapshot),
    creepingAlert(snapshot),
    targetAlert(snapshot, days),
    costAlert(snapshot),
    returningHighAlert(snapshot),
    bestDayAlert(snapshot, days),
  ].filter((a): a is Alert => a !== null);
  return orderAlerts(found);
}
