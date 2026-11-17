import { formatCount, formatPercent } from "./analytics-core";
import type { FindingCode, Severity as DomainSeverity } from "./domain-health";
import { rateMetric, SPEED_KINDS, SPEED_SCREENS, SPEED_THRESHOLDS, speedValueText, type SpeedKind, type SpeedMetric, type SpeedScreen } from "./speed";
import { formatAmount } from "./analytics-format";
import type { CreepingResult } from "./analytics-discounts";
import { onBackorder, type StockoutAlert } from "./analytics-inventory";
import { STOCKOUT_ALERT_DAYS } from "./analytics-inventory";
import { ESTIMATE_MIN_COVERAGE } from "./analytics-kpi";
import { addDays, daysBetween, isDay, isoWeekday } from "./analytics-period";
import type { TargetProgress } from "./analytics-targets";
import type { AnalyticsMessages } from "./admin-messages/analytics.en";
import { fillWords } from "./admin-fill";
import { analyticsWords, countText } from "./analytics-words";

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
  /**
   * A page where visitors get stuck more often (E4.2, heatmaps D656): its share of page views with a rage or dead click
   * (`frustrated_views`) over the last 7 complete days against its own 28 days before them.
   */
  frustration: {
    /** Rise, in share points (0.1 is 10 points), that raises a warning. */
    minRisePoints: 0.1,
    /** And at least this many times the share before, so a page that was always hard to use is not news (none before passes). */
    minRatio: 1.5,
    /** Rise that makes it urgent: a part that has stopped working. */
    urgentRisePoints: 0.25,
    /** Page views in the last 7 days and in the 28 days before: at both, a 10-point rise is about three standard errors. */
    minViews7d: 100,
    minViewsBefore: 200,
  },
  /**
   * A kind of page that turned slow (E4.2, speed D336): its 75th percentile of a Core Web Vital on one screen is poor on Google's line over
   * the last 7 days, today included, and was not poor over the 21 days before them (the speed report's 28 days).
   */
  slowPage: {
    recentDays: 7,
    beforeDays: 21,
    /** Measurements of the figure in each window (the speed report shows a figure from 20 in 28 days). */
    minSamples7d: 50,
    minSamplesBefore: 100,
    /** Urgent from this many times Google's poor line (a main content shown after 8 s). */
    urgentRatio: 2,
  },
  /**
   * A store domain whose health check fails (E4.2, domains D315: `domainHealth()`): it no longer reaches the store, its certificate fails,
   * it lapsed or lapses without renewing, its registrant is not confirmed, or one added days ago still does not reach the store.
   */
  domain: {
    /** A domain still waiting this many whole days after it was added is stuck; before that it is being set up. */
    minPendingDays: 2,
    /** A lapsed domain is said for this many days after its expiry; after that the Domains page keeps it. */
    lapsedDays: 30,
  },
} as const;

/** The Core Web Vitals the slow-page rule reads (the first answer, TTFB, is the server's and is on the Speed page only). */
export const SLOW_PAGE_METRICS = ["lcp", "inp", "cls"] as const satisfies readonly SpeedMetric[];
/** The health findings the domain rule speaks of, the most serious first; the email records and advice stay on the Domains page. */
export const DOMAIN_ALERT_CODES = ["points_away", "certificate_failing", "expired", "expires_soon", "contact_unverified", "not_pointed", "proof_missing"] as const satisfies readonly FindingCode[];

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
  /** Plain words with the figures in it (English unless other words are given). */
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
  /** Of them, the orders from a shopper's checkout (a staff-made order, D173, was not a visit); absent = all of them. Only conversion reads it. */
  checkoutOrders?: number;
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

/** A page's heat totals (D656, every visitor's) over the last 7 complete days and the 28 before them: page views, and those with a dead or rage click. */
export type PageFrustrationRow = { page: string; views7: number; frustrated7: number; viewsBefore: number; frustratedBefore: number };

/** One window's measurements of a figure and their 75th percentile (null for none). */
export type SpeedWindow = { n: number; p75: number | null };

/** A kind of page's figure on one screen over the last 7 days and the 21 before them (`ALERT_RULES.slowPage`). */
export type SpeedWindowRow = { kind: SpeedKind; screen: SpeedScreen; metric: SpeedMetric; recent: SpeedWindow; before: SpeedWindow };

/** One of the store's domains and what its health check found (`domainHealth()`), from the store's own rows and the daily domain watch. */
export type DomainAlertRow = {
  hostname: string;
  /** Its connection to the store; null for a domain the store holds and has not connected. */
  status: "pending" | "active" | null;
  primary: boolean;
  /** Whole days since it was added; null when not known. */
  ageDays: number | null;
  findings: readonly { code: FindingCode; severity: DomainSeverity; values: Readonly<Record<string, string | number>> }[];
};

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
  /** Per page, its heat totals in the two windows (`PageFrustrationRow`); null when they could not be read. */
  pageFrustration?: readonly PageFrustrationRow[] | null;
  /** Per kind of page, screen and Core Web Vital, the two windows' 75th percentiles (`SpeedWindowRow`). */
  speed?: readonly SpeedWindowRow[] | null;
  /** The store's domains and their findings (`DomainAlertRow`). */
  domains?: readonly DomainAlertRow[] | null;
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { urgent: 0, warning: 1, info: 2, good: 3 };

/** The words of the alerts (`alertText` of the analytics catalogue); English unless given. */
type Words = AnalyticsMessages["alertText"];
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
function monthText(month: string, w: Words): string {
  const m = Number(month.slice(5, 7));
  return m >= 1 && m <= 12 ? fillWords(w.month, { month: w.monthsLong[m - 1], year: month.slice(0, 4) }) : month;
}

/** A multiple as "2.5 times", "4 times", "12 times". */
function times(ratio: number, w: Words): string {
  const text = ratio >= 10 ? String(Math.round(ratio)) : (Math.round(ratio * 10) / 10).toFixed(1).replace(/\.0$/, "");
  return fillWords(w.times, { n: text.replace(".", analyticsWords().numbers.decimal) });
}

/** "about 3 days", "about 1 day", "under a day". */
function daysText(days: number, w: Words): string {
  if (days < 1) return w.underADay;
  const n = Math.round(days);
  return countText(w.aboutDays, n);
}

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
      if (existing.checkoutOrders !== undefined || d.checkoutOrders !== undefined) existing.checkoutOrders = (existing.checkoutOrders ?? existing.orders - d.orders) + (d.checkoutOrders ?? d.orders);
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
    orders += d.checkoutOrders ?? d.orders;
    known += 1;
  }
  return sessions > 0 ? { sessions, orders, days: known, rate: orders / sessions } : null;
}

// ---------- rules ----------

function conversionAlert(s: AlertSnapshot, days: DayMap, words: Words): Alert | null {
  const w = words.conversion;
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
    if (drop >= r.minDrop - EPS) hits.push({ w: week, b: baseWeek, drop, label: w.last7, when: w.over7, against: w.weeksBefore });
  }
  if (todayNow && todayNow.sessions >= r.minSessionsToday && baselineOk(baseTrailing)) {
    const drop = drops(todayNow, baseTrailing);
    if (drop >= r.minDrop - EPS) hits.push({ w: todayNow, b: baseTrailing, drop, label: w.todaySoFar, when: w.today, against: w.lastWeeks });
  }
  // The week is the steadier evidence: it speaks first when both do.
  const hit = hits[0];
  if (!hit) return null;
  return {
    id: "conversion-drop",
    severity: hit.drop >= r.urgentDrop - EPS ? "urgent" : "warning",
    text: fillWords(w.text, { drop: formatPercent(hit.drop, 0), when: hit.when, against: hit.against, now: formatPercent(hit.w.rate), before: formatPercent(hit.b.rate) }),
    href: "/analytics/traffic",
    action: w.action,
    evidence: [
      { label: fillWords(w.rate, { label: hit.label }), value: formatPercent(hit.w.rate), baseline: fillWords(w.over, { value: formatPercent(hit.b.rate), against: hit.against }) },
      { label: fillWords(w.sessions, { label: hit.label }), value: formatCount(hit.w.sessions), baseline: fillWords(w.over, { value: formatCount(hit.b.sessions), against: hit.against }) },
      { label: fillWords(w.orders, { label: hit.label }), value: formatCount(hit.w.orders), baseline: fillWords(w.over, { value: formatCount(hit.b.orders), against: hit.against }) },
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

function weekdayRevenueAlert(s: AlertSnapshot, days: DayMap, words: Words): Alert | null {
  const w = words.weekday;
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
  const weekday = words.weekdays[isoWeekday(s.today) - 1];
  const weekdays = words.weekdaysPlural[isoWeekday(s.today) - 1];
  return {
    id: "revenue-weekday",
    severity: drop >= r.urgentDrop - EPS ? "urgent" : "warning",
    text: fillWords(w.text, { now: money(Math.max(0, now.revenueMinor), s), drop: formatPercent(Math.min(1, drop), 0), weekday, expected: money(expectedRevenue, s) }),
    href: "/analytics",
    action: w.action,
    evidence: [
      { label: w.soFar, value: money(now.revenueMinor, s), baseline: fillWords(words.expectedByNow, { amount: money(expectedRevenue, s) }) },
      { label: fillWords(w.usual, { weekday }), value: money(usualRevenue, s), baseline: fillWords(w.median, { n: same.length, weekdays }) },
      { label: w.orders, value: formatCount(now.orders), baseline: fillWords(words.expectedByNow, { amount: formatCount(Math.round(usualOrders * share * 10) / 10) }) },
    ],
    size: drop / r.minDrop,
  };
}

function refundAlert(s: AlertSnapshot, words: Words): Alert | null {
  const w = words.refunds;
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
  const sold = fillWords(w.sold, { refunded: formatCount(top.row.refunded14), sold: formatCount(top.row.sold14), days: r.recentDays, recent: formatPercent(top.recent, 0), usual: formatPercent(top.usual, 1) });
  // A product that has hardly ever had a refund is compared with the floor, which would make a multiple look bigger than it is: say the figures instead.
  let text = top.usual < r.baselineFloor ? fillWords(w.wellAbove, { name: top.row.name, sold }) : fillWords(w.running, { name: top.row.name, times: times(top.ratio, words), sold });
  if (others > 0) text += countText(w.others, others, {}, formatCount(others));
  return {
    id: "refund-rate",
    severity: urgent ? "urgent" : "warning",
    text,
    href: "/analytics/products?sort=refunds",
    action: w.action,
    evidence: hits.slice(0, 3).map((h) => ({
      label: fillWords(w.label, { name: h.row.name, days: r.recentDays }),
      value: fillWords(w.value, { refunded: formatCount(h.row.refunded14), sold: formatCount(h.row.sold14), rate: formatPercent(h.recent, 1) }),
      baseline: fillWords(w.baseline, { rate: formatPercent(h.usual, 1), days: r.baselineDays }),
    })),
    size: top.ratio / r.minRatio,
  };
}

function cacAlert(s: AlertSnapshot, words: Words): Alert | null {
  const w = words.cac;
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
  let text = fillWords(w.text, { channel: top.row.label, now: money(top.now, s), rise: formatPercent(top.rise, 0), before: money(top.before, s) });
  if (others > 0) text += countText(w.others, others, {}, formatCount(others));
  return {
    id: "cac-up",
    severity: "warning",
    text,
    href: "/analytics/marketing",
    action: w.action,
    evidence: hits.slice(0, 3).map((h) => ({
      label: fillWords(w.label, { channel: h.row.label }),
      value: money(h.now, s),
      baseline: fillWords(words.overWeeksBefore, { value: money(h.before, s) }),
    })),
    size: top.rise / r.minRise,
  };
}

function stockoutAlert(s: AlertSnapshot, words: Words): Alert | null {
  const w = words.stockout;
  const r = ALERT_RULES.stockout;
  const rows = (s.stockouts ?? [])
    .filter((a) => (a.kind === "out" || (finite(a.days) && a.days <= r.withinDays + EPS)) && a.row)
    .sort((a, b) => (a.kind === "out" ? 0 : 1) - (b.kind === "out" ? 0 : 1) || a.days - b.days || a.row.name.localeCompare(b.row.name, "en") || (a.row.variantId < b.row.variantId ? -1 : 1));
  if (rows.length === 0) return null;
  const named = rows.slice(0, r.named);
  const rest = rows.length - named.length;
  const outCount = rows.filter((a) => a.kind === "out").length;
  // A variant that keeps selling with nothing on hand (D172) is out, but the store chose that: it is named as on backorder and is not urgent by itself.
  const backordered = (a: StockoutAlert) => a.kind === "out" && onBackorder(a.row);
  const soldOut = rows.filter((a) => a.kind === "out" && !backordered(a)).length;
  const describe = (a: StockoutAlert) => fillWords(w.named, { name: a.row.name, state: backordered(a) ? w.backorder : a.kind === "out" ? w.out : daysText(a.days, words) });
  const lead = outCount === 0 ? w.leadWeek : outCount === rows.length ? (soldOut === 0 ? w.leadBackorder : w.leadOut) : w.leadMixed;
  const text = fillWords(w.text, { lead, names: named.map(describe).join(", "), more: rest > 0 ? fillWords(w.more, { n: formatCount(rest) }) : "" });
  return {
    id: "stockout",
    severity: soldOut > 0 ? "urgent" : "warning",
    text,
    href: "/analytics/inventory",
    action: w.action,
    evidence: named.map((a) => ({
      label: a.row.name,
      value: backordered(a)
        ? `${w.onBackorder}${a.row.owed > 0 ? fillWords(w.owed, { n: formatCount(a.row.owed) }) : ""}`
        : a.kind === "out"
          ? w.outOfStock
          : fillWords(w.ofStock, { days: daysText(a.days, words) }),
      baseline: fillWords(w.sold30, { n: formatCount(a.row.sold30) }),
    })),
    size: rows.length,
  };
}

function abandonmentAlert(s: AlertSnapshot, words: Words): Alert | null {
  const w = words.abandonment;
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
    text: fillWords(w.text, { now: formatPercent(now, 0), before: formatPercent(before, 0) }),
    href: "/analytics/traffic",
    action: w.action,
    evidence: [
      { label: w.notCompleted, value: formatPercent(now, 1), baseline: fillWords(words.overWeeksBefore, { value: formatPercent(before, 1) }) },
      { label: w.started, value: formatCount(recent.started), baseline: fillWords(words.overWeeksBefore, { value: formatCount(baseline.started) }) },
    ],
    size: rise / r.minRisePoints,
  };
}

function creepingAlert(s: AlertSnapshot, words: Words): Alert | null {
  const w = words.creep;
  const c = s.discountCreeping;
  if (!c || !c.creeping || c.rise === null || !c.from || !c.to) return null;
  const points = Math.round(c.rise * 100);
  return {
    id: "discount-creep",
    severity: "info",
    text: fillWords(w.text, { n: formatCount(c.risingMonths), points: formatCount(points), from: monthText(c.from, words), to: monthText(c.to, words) }),
    href: "/analytics/marketing",
    action: w.action,
    evidence: [
      { label: w.months, value: formatCount(c.risingMonths), baseline: null },
      { label: w.rise, value: fillWords(w.points, { n: formatCount(points) }), baseline: fillWords(w.range, { from: monthText(c.from, words), to: monthText(c.to, words) }) },
    ],
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

function targetAlert(s: AlertSnapshot, days: DayMap, words: Words): Alert | null {
  const w = words.target;
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
  const monthName = words.monthsLong[Number(s.today.slice(5, 7)) - 1] ?? w.thisMonth;
  const behind = Math.abs(t.aheadByMinor);
  let text = fillWords(w.text, { behind: money(behind, s), month: monthName, actual: money(t.actualMinor, s), expected: money(t.expectedByTodayMinor, s) });
  if (t.projectedMinor !== null && t.projectedPct !== null) {
    text += fillWords(w.pace, { projected: money(t.projectedMinor, s), share: formatPercent(t.projectedPct, 0), target: money(t.targetMinor, s) });
  }
  const urgent = t.projectedPct !== null && t.projectedPct <= ALERT_RULES.target.urgentProjectedShare + EPS;
  return {
    id: "target-behind",
    severity: urgent ? "urgent" : "warning",
    text,
    href: "/analytics",
    action: w.action,
    evidence: [
      { label: w.soFar, value: money(t.actualMinor, s), baseline: fillWords(words.expectedByNow, { amount: money(t.expectedByTodayMinor, s) }) },
      ...(t.projectedMinor !== null ? [{ label: w.ends, value: money(t.projectedMinor, s), baseline: fillWords(w.targetOf, { amount: money(t.targetMinor, s) }) }] : []),
    ],
    size: t.aheadByPct !== null ? Math.abs(t.aheadByPct) : 0,
  };
}

function costAlert(s: AlertSnapshot, words: Words): Alert | null {
  const w = words.costs;
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
    text: none ? w.none : fillWords(tooFew ? w.tooFew : w.estimated, { share: formatPercent(c.coverage, 0) }),
    href: "/products",
    action: w.action,
    evidence: [{ label: w.label, value: none ? w.noneValue : formatPercent(c.coverage, 0), baseline: fillWords(w.baseline, { share: formatPercent(r.minCoverage, 0) }) }],
    size: (r.minCoverage - c.coverage) / r.minCoverage,
  };
}

function returningHighAlert(s: AlertSnapshot, words: Words): Alert | null {
  const w = words.returning;
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
    text: fillWords(w.text, { amount: money(latest.revenueMinor, s), month: monthText(latest.month, words), months: r.months, best: money(best.revenueMinor, s), bestMonth: monthText(best.month, words) }),
    href: "/analytics/customers",
    action: w.action,
    evidence: [
      { label: fillWords(w.label, { month: monthText(latest.month, words) }), value: money(latest.revenueMinor, s), baseline: fillWords(w.baseline, { amount: money(best.revenueMinor, s), month: monthText(best.month, words) }) },
      { label: w.orders, value: formatCount(latest.orders), baseline: null },
    ],
    size: latest.revenueMinor / best.revenueMinor - 1,
  };
}

function bestDayAlert(s: AlertSnapshot, days: DayMap, words: Words): Alert | null {
  const w = words.bestDay;
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
    text: fillWords(w.text, { days: r.days, amount: money(y.revenueMinor, s), orders: countText(w.orders, y.orders, {}, formatCount(y.orders)) }),
    href: "/analytics",
    action: w.action,
    evidence: [{ label: w.label, value: money(y.revenueMinor, s), baseline: fillWords(w.baseline, { amount: money(best.revenueMinor, s) }) }],
    size: best.revenueMinor > 0 ? y.revenueMinor / best.revenueMinor - 1 : 0,
  };
}

function frustrationAlert(s: AlertSnapshot, words: Words): Alert | null {
  const w = words.frustration;
  const r = ALERT_RULES.frustration;
  type Hit = { row: PageFrustrationRow; now: number; before: number; rise: number };
  const hits: Hit[] = [];
  for (const row of s.pageFrustration ?? []) {
    if (typeof row.page !== "string" || ![row.views7, row.frustrated7, row.viewsBefore, row.frustratedBefore].every(finite)) continue;
    if (row.views7 < r.minViews7d || row.viewsBefore < r.minViewsBefore) continue;
    const now = Math.min(row.views7, Math.max(0, row.frustrated7)) / row.views7;
    const before = Math.min(row.viewsBefore, Math.max(0, row.frustratedBefore)) / row.viewsBefore;
    const rise = now - before;
    if (rise < r.minRisePoints - EPS) continue;
    if (before > 0 && now / before < r.minRatio - EPS) continue;
    hits.push({ row, now, before, rise });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.rise - a.rise || b.row.views7 - a.row.views7 || (a.row.page < b.row.page ? -1 : a.row.page > b.row.page ? 1 : 0));
  const top = hits[0];
  const others = hits.length - 1;
  let text = fillWords(w.text, { page: top.row.page, now: formatPercent(top.now, 0), before: formatPercent(top.before, 0) });
  if (others > 0) text += countText(w.others, others, {}, formatCount(others));
  return {
    id: "page-frustration",
    severity: top.rise >= r.urgentRisePoints - EPS ? "urgent" : "warning",
    text,
    // Its heatmap, where the parts visitors click in vain are drawn.
    href: `/analytics/heatmaps?${new URLSearchParams({ page: top.row.page }).toString()}`,
    action: w.action,
    evidence: hits.slice(0, 3).map((h) => ({
      label: fillWords(w.label, { page: h.row.page }),
      value: fillWords(w.value, { frustrated: formatCount(h.row.frustrated7), views: formatCount(h.row.views7), share: formatPercent(h.now, 1) }),
      baseline: fillWords(w.baseline, { share: formatPercent(h.before, 1) }),
    })),
    size: top.rise / r.minRisePoints,
  };
}

function slowPageAlert(s: AlertSnapshot, words: Words): Alert | null {
  const w = words.slowPage;
  const r = ALERT_RULES.slowPage;
  const locale = s.locale ?? "en";
  type Hit = { row: SpeedWindowRow; now: number; before: number; poor: number; ratio: number };
  const hits: Hit[] = [];
  for (const row of s.speed ?? []) {
    if (!(SLOW_PAGE_METRICS as readonly string[]).includes(row.metric) || !SPEED_KINDS.includes(row.kind) || !SPEED_SCREENS.includes(row.screen)) continue;
    const { recent, before } = row;
    if (!finite(recent.n) || !finite(before.n) || !finite(recent.p75) || !finite(before.p75)) continue;
    if (recent.n < r.minSamples7d || before.n < r.minSamplesBefore) continue;
    // Turned poor: poor now, and not poor before (a page that was always slow is the Speed page's to say, not news).
    if (rateMetric(row.metric, recent.p75) !== "poor" || rateMetric(row.metric, before.p75) === "poor") continue;
    const poor = SPEED_THRESHOLDS[row.metric][1];
    hits.push({ row, now: recent.p75, before: before.p75, poor, ratio: recent.p75 / poor });
  }
  if (hits.length === 0) return null;
  // The furthest past the line first; then in the Speed page's order (kind, screen, figure), so the order is stable.
  const rank = (h: Hit) => (SPEED_KINDS.indexOf(h.row.kind) * 10 + SPEED_SCREENS.indexOf(h.row.screen)) * 10 + SLOW_PAGE_METRICS.indexOf(h.row.metric as (typeof SLOW_PAGE_METRICS)[number]);
  hits.sort((a, b) => b.ratio - a.ratio || rank(a) - rank(b));
  const top = hits[0];
  const others = hits.length - 1;
  const value = (h: Hit, v: number) => speedValueText(h.row.metric, v, locale);
  let text = fillWords(w.text, {
    page: w.kinds[top.row.kind],
    screen: w.screens[top.row.screen],
    metric: w.metrics[top.row.metric as (typeof SLOW_PAGE_METRICS)[number]],
    now: value(top, top.now),
    before: value(top, top.before),
    poor: value(top, top.poor),
  });
  if (others > 0) text += countText(w.others, others, {}, formatCount(others));
  return {
    id: "page-slow",
    severity: top.ratio >= r.urgentRatio - EPS ? "urgent" : "warning",
    text,
    href: "/analytics/speed",
    action: w.action,
    evidence: hits.slice(0, 3).map((h) => ({
      label: fillWords(w.label, { metric: w.metrics[h.row.metric as (typeof SLOW_PAGE_METRICS)[number]], page: w.kinds[h.row.kind], screen: w.screens[h.row.screen] }),
      value: value(h, h.now),
      baseline: fillWords(w.baseline, { value: value(h, h.before), n: formatCount(h.row.before.n) }),
    })),
    size: top.ratio,
  };
}

/** A domain's own setup findings: while it is waiting they are the owner's work in hand, said only once it has waited `minPendingDays`. */
const SETUP_FINDINGS: ReadonlySet<string> = new Set(["not_pointed", "proof_missing"]);

function domainAlert(s: AlertSnapshot, words: Words): Alert | null {
  const w = words.domain;
  const r = ALERT_RULES.domain;
  type Hit = { row: DomainAlertRow; code: (typeof DOMAIN_ALERT_CODES)[number]; values: Readonly<Record<string, string | number>>; urgent: boolean };
  const hits: Hit[] = [];
  for (const row of s.domains ?? []) {
    if (typeof row.hostname !== "string" || row.hostname === "") continue;
    for (const f of row.findings ?? []) {
      const code = (DOMAIN_ALERT_CODES as readonly string[]).includes(f.code) ? (f.code as Hit["code"]) : null;
      if (!code || (f.severity !== "error" && f.severity !== "warning")) continue;
      const setup = SETUP_FINDINGS.has(code);
      // A connection still being set up speaks once it has waited; a lapsed domain for its first days, while it can still come back.
      if (setup && (row.status !== "pending" || !finite(row.ageDays) || row.ageDays < r.minPendingDays)) continue;
      if (code === "expired") {
        const date = String(f.values.date ?? "");
        if (!isDay(date) || daysBetween(date, s.today) > r.lapsedDays) continue;
      }
      hits.push({ row, code, values: f.values, urgent: f.severity === "error" && !setup });
    }
  }
  if (hits.length === 0) return null;
  hits.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      Number(b.row.primary) - Number(a.row.primary) ||
      DOMAIN_ALERT_CODES.indexOf(a.code) - DOMAIN_ALERT_CODES.indexOf(b.code) ||
      (a.row.hostname < b.row.hostname ? -1 : a.row.hostname > b.row.hostname ? 1 : 0),
  );
  // One line per domain: its most serious finding.
  const seen = new Set<string>();
  const domains = hits.filter((h) => (seen.has(h.row.hostname) ? false : (seen.add(h.row.hostname), true)));
  const top = domains[0];
  const fill = (h: Hit, template: string) =>
    fillWords(template, {
      domain: h.row.hostname,
      date: String(h.values.date ?? ""),
      days: h.code === "expires_soon" ? formatCount(Number(h.values.days ?? 0)) : formatCount(h.row.ageDays ?? 0),
      registrar: String(h.values.registrar || w.theirRegistrar),
    });
  const textOf = (h: Hit) => (h.code === "expires_soon" && h.values.registrar && h.values.registrar !== "Kaizena Flow" ? w.text.expiresElsewhere : w.text[h.code]);
  let text = fill(top, textOf(top));
  const others = domains.length - 1;
  if (others > 0) text += countText(w.others, others, {}, formatCount(others));
  return {
    id: "domain-problem",
    severity: top.urgent ? "urgent" : "warning",
    text,
    href: "/settings/domains",
    action: w.action,
    evidence: domains.slice(0, 3).map((h) => ({ label: h.row.hostname, value: fill(h, w.short[h.code]), baseline: null })),
    size: domains.filter((h) => h.urgent).length + domains.length / 10,
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
export function alertsFor(snapshot: AlertSnapshot, words: Words = analyticsWords().alertText): Alert[] {
  if (!isDay(snapshot.today)) throw new RangeError(`today is not a day: ${snapshot.today}`);
  const days = dayMap(snapshot.daily ?? []);
  const found = [
    conversionAlert(snapshot, days, words),
    weekdayRevenueAlert(snapshot, days, words),
    refundAlert(snapshot, words),
    cacAlert(snapshot, words),
    stockoutAlert(snapshot, words),
    abandonmentAlert(snapshot, words),
    creepingAlert(snapshot, words),
    targetAlert(snapshot, days, words),
    costAlert(snapshot, words),
    returningHighAlert(snapshot, words),
    bestDayAlert(snapshot, days, words),
    frustrationAlert(snapshot, words),
    slowPageAlert(snapshot, words),
    domainAlert(snapshot, words),
  ].filter((a): a is Alert => a !== null);
  return orderAlerts(found);
}
