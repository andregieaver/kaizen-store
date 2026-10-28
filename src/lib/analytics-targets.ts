import { safeRatio } from "./analytics-core";

/**
 * Progress against a month's net revenue target (D152, docs/analytics.md,
 * "Targets"). Pure: days are `YYYY-MM-DD` strings in the store's time zone and
 * all calendar arithmetic goes through UTC dates, which have no daylight saving,
 * so the time zone only matters to whoever says what `today` is.
 *
 * Figures are ratios (0.82 is 82 %) and minor units of the main currency, as
 * everywhere else in the analytics.
 */

/** How far from the expected figure still counts as on track: 3 % of what was expected. */
export const ON_TRACK_TOLERANCE = 0.03;

/** Days of history needed before the weekday pattern is trusted: four whole weeks. */
export const MIN_HISTORY_DAYS = 28;

/** Each weekday must be seen at least this often in the history, or the weekday weights are not used. */
export const MIN_WEEKDAY_SAMPLES = 4;

/** Before this many days of the month have passed, a projection or a status is noise: `tooEarly` says so. */
export const MIN_DAYS_FOR_VERDICT = 3;

export type TargetStatus = "ahead" | "on_track" | "behind" | "no_target";

/** Net revenue of one day, without VAT, in minor units of the main currency. Days with no sales must be given as 0. */
export type DailyActual = { day: string; revenueMinor: number };

export type TargetInput = {
  /** The month's target, or null / 0 / negative when there is none. */
  targetMinor: number | null;
  /** Net revenue so far in the month, today's part included. */
  actualMinor: number;
  /** Any day of the month (normally its first), `YYYY-MM-DD`. */
  monthStart: string;
  /** The store's today, `YYYY-MM-DD`. Before the month nothing has been expected, after it the whole target has. */
  today: string;
  /**
   * Net revenue per day, for weekday weighting. Only days before `today` are read (today is partial). Used only with
   * at least `MIN_HISTORY_DAYS` distinct days and `MIN_WEEKDAY_SAMPLES` of every weekday; otherwise the month is
   * counted evenly by day. Pass every day, zeros included: a missing day is not a quiet day.
   */
  dailyActuals?: readonly DailyActual[];
  /**
   * How much of today has passed, 0 to 1 (the hour in the store's time zone over 24). 1 counts today as a whole day,
   * which is the default; the server passes the real fraction so a quiet morning does not look like falling behind.
   */
  todayShare?: number;
};

export type TargetProgress = {
  status: TargetStatus;
  targetMinor: number | null;
  actualMinor: number;
  /** Actual over target; null without a target. */
  pct: number | null;
  /** What should have been sold by now: the target times the share of the month that has passed. Null without a target. */
  expectedByTodayMinor: number | null;
  /** Actual minus expected (negative is behind). */
  aheadByMinor: number | null;
  /** Ahead over expected; null when nothing was expected yet. */
  aheadByPct: number | null;
  /** The month's net revenue if the pace so far holds (an estimate, in the same weights as the expectation). Null before anything has passed. */
  projectedMinor: number | null;
  /** Projected over target. */
  projectedPct: number | null;
  /** The share of the month that has passed, 0 to 1, in the weights used. */
  shareElapsed: number;
  /** True when the weekday pattern was used; false when days were counted evenly. */
  weekdayWeighted: boolean;
  daysInMonth: number;
  /** Whole days after today that are still in the month. */
  daysLeft: number;
  /** Fewer than `MIN_DAYS_FOR_VERDICT` days have passed: show the figures, but raise no alert and give no verdict. */
  tooEarly: boolean;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** A `YYYY-MM-DD` as UTC milliseconds, or null when it is not a real day. */
function dayMs(day: string): number | null {
  const match = DAY.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? ms : null;
}

/** 0 (Monday) to 6 (Sunday). */
const weekdayOf = (ms: number): number => (new Date(ms).getUTCDay() + 6) % 7;

/**
 * The relative weight of each weekday (Monday first): the mean net revenue of that weekday over the history, or null
 * when the history is too short or too thin to trust, or has no sales at all.
 */
export function weekdayWeights(dailyActuals: readonly DailyActual[] | undefined, before: string): number[] | null {
  if (!dailyActuals || dailyActuals.length === 0) return null;
  const limit = dayMs(before);
  if (limit === null) return null;
  // One figure per day: a repeated day is added up, so a caller sending per-currency rows still gets the day right.
  const perDay = new Map<number, number>();
  for (const entry of dailyActuals) {
    const ms = dayMs(entry.day);
    if (ms === null || ms >= limit || !Number.isFinite(entry.revenueMinor)) continue;
    perDay.set(ms, (perDay.get(ms) ?? 0) + entry.revenueMinor);
  }
  if (perDay.size < MIN_HISTORY_DAYS) return null;
  const sums = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);
  for (const [ms, revenue] of perDay) {
    sums[weekdayOf(ms)] += revenue;
    counts[weekdayOf(ms)] += 1;
  }
  if (counts.some((n) => n < MIN_WEEKDAY_SAMPLES)) return null;
  const means = sums.map((sum, i) => sum / counts[i]);
  // A negative mean (refund-heavy days) must not make a weekday count backwards.
  const weights = means.map((mean) => Math.max(0, mean));
  return weights.reduce((a, b) => a + b, 0) > 0 ? weights : null;
}

/** Progress of a month's target. See `TargetInput` and `TargetProgress`; the status tolerance is `ON_TRACK_TOLERANCE`. */
export function targetProgress(input: TargetInput): TargetProgress {
  const start = dayMs(input.monthStart);
  const today = dayMs(input.today);
  if (start === null) throw new RangeError(`monthStart is not a day: ${input.monthStart}`);
  if (today === null) throw new RangeError(`today is not a day: ${input.today}`);
  const first = new Date(start);
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const monthFirst = Date.UTC(year, month, 1);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  // Whole days that have fully passed in the month, and how far through today is.
  const dayOfMonth = Math.floor((today - monthFirst) / DAY_MS) + 1; // 1-based; <= 0 before the month, > daysInMonth after
  const share = Number.isFinite(input.todayShare) ? Math.min(1, Math.max(0, input.todayShare as number)) : 1;
  const elapsed = dayOfMonth < 1 ? 0 : dayOfMonth > daysInMonth ? daysInMonth : dayOfMonth - 1 + share;
  const daysLeft = dayOfMonth < 1 ? daysInMonth : Math.max(0, daysInMonth - dayOfMonth);

  const weights = weekdayWeights(input.dailyActuals, input.today);
  let shareElapsed: number;
  if (weights) {
    // Each day of the month weighs what its weekday normally brings; today counts for its part.
    let done = 0;
    let all = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const weight = weights[weekdayOf(monthFirst + (d - 1) * DAY_MS)];
      all += weight;
      done += weight * Math.min(1, Math.max(0, elapsed - (d - 1)));
    }
    shareElapsed = all > 0 ? done / all : elapsed / daysInMonth;
  } else {
    shareElapsed = elapsed / daysInMonth;
  }

  const target = input.targetMinor !== null && Number.isFinite(input.targetMinor) && input.targetMinor > 0 ? input.targetMinor : null;
  const actual = input.actualMinor;
  const tooEarly = elapsed < MIN_DAYS_FOR_VERDICT && dayOfMonth <= daysInMonth;
  const projected = shareElapsed > 0 ? Math.round(actual / shareElapsed) : null;
  const base = {
    actualMinor: actual,
    shareElapsed,
    weekdayWeighted: weights !== null,
    daysInMonth,
    daysLeft,
    tooEarly,
    projectedMinor: projected,
  };
  if (target === null) {
    return { ...base, status: "no_target", targetMinor: null, pct: null, expectedByTodayMinor: null, aheadByMinor: null, aheadByPct: null, projectedPct: null };
  }
  const expected = Math.round(target * shareElapsed);
  const aheadBy = actual - expected;
  const aheadByPct = safeRatio(aheadBy, expected);
  let status: TargetStatus;
  if (actual >= target) status = "ahead";
  else if (aheadByPct === null) status = "on_track"; // nothing was expected yet
  else if (aheadByPct > ON_TRACK_TOLERANCE) status = "ahead";
  else if (aheadByPct < -ON_TRACK_TOLERANCE) status = "behind";
  else status = "on_track";
  return {
    ...base,
    status,
    targetMinor: target,
    pct: actual / target,
    expectedByTodayMinor: expected,
    aheadByMinor: aheadBy,
    aheadByPct,
    projectedPct: projected === null ? null : projected / target,
  };
}

// ---------------------------------------------------------------------------
// Targets for more than a month's revenue (wave 8 unit D, D348)
// ---------------------------------------------------------------------------

/** What a target can count. Net sales and AOV are minor units of the main currency without VAT, orders a count, conversion basis points (250 is 2.50 %). */
export const TARGET_METRICS = ["net_sales", "orders", "conversion", "aov"] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];
export const isTargetMetric = (value: unknown): value is TargetMetric => (TARGET_METRICS as readonly unknown[]).includes(value);

export const TARGET_PERIODS = ["week", "month", "quarter", "custom"] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];
export const isTargetPeriod = (value: unknown): value is TargetPeriod => (TARGET_PERIODS as readonly unknown[]).includes(value);

/** The longest custom period: two years (the last day at most 730 days after the first), as the database checks. */
export const CUSTOM_MAX_SPAN_DAYS = 730;

/** Sums are expected to grow over the period (weekday-weighted); levels are a figure to hold. */
export const isSumMetric = (metric: TargetMetric): boolean => metric === "net_sales" || metric === "orders";

/**
 * What a level needs before it gets a verdict: an average order value of fewer than 10 orders, or a conversion rate of fewer than 300 visits, is shown
 * with what is missing and judged neither ahead nor behind.
 */
export const LEVEL_MINIMUMS = { aov: { orders: 10 }, conversion: { sessions: 300 } } as const;

const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * A period's first and last day from its kind and any day in it (a custom period takes its own last day), or null when it is not a period the
 * database would keep: a week runs Monday to Sunday, a month and a quarter are whole, a custom period lasts at most two years.
 */
export function periodBounds(period: TargetPeriod, day: string, lastDay?: string): { startsOn: string; endsOn: string } | null {
  const ms = dayMs(day);
  if (ms === null) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (period === "week") {
    const start = ms - weekdayOf(ms) * DAY_MS;
    return { startsOn: isoOf(start), endsOn: isoOf(start + 6 * DAY_MS) };
  }
  if (period === "month") return { startsOn: isoOf(Date.UTC(y, m, 1)), endsOn: isoOf(Date.UTC(y, m + 1, 0)) };
  if (period === "quarter") {
    const q = Math.floor(m / 3) * 3;
    return { startsOn: isoOf(Date.UTC(y, q, 1)), endsOn: isoOf(Date.UTC(y, q + 3, 0)) };
  }
  const end = lastDay === undefined ? null : dayMs(lastDay);
  if (end === null || end < ms || (end - ms) / DAY_MS > CUSTOM_MAX_SPAN_DAYS) return null;
  return { startsOn: day, endsOn: isoOf(end) };
}

/** One day of the store, as the daily history gives it. Sessions are null on a day visits were not counted (never 0 for "not known"). */
export type PeriodDay = { day: string; orders: number; checkoutOrders: number; netRevenueMinor: number; sessions: number | null };

export type PeriodProgressInput = {
  metric: TargetMetric;
  /** In the metric's unit (see `TARGET_METRICS`). */
  targetValue: number;
  startsOn: string;
  endsOn: string;
  /** The store's today. */
  today: string;
  /** How much of today has passed, 0 to 1 (1 by default). */
  todayShare?: number;
  /** What the period has so far: its sums up to and including today (in the main currency; a currency with no rate left out by the caller). */
  sofar: { orders: number; checkoutOrders: number; netRevenueMinor: number; sessions: number | null };
  /** The days before today for the weekday pattern (sums only); every day present, zeros included. */
  history?: readonly PeriodDay[];
};

export type PeriodStatus = TargetStatus | "upcoming" | "not_known";

export type PeriodProgress = {
  metric: TargetMetric;
  status: PeriodStatus;
  targetValue: number;
  /** The figure so far in the metric's unit; null when it cannot be known (conversion without visits on every day, a level with nothing to divide). */
  actual: number | null;
  /** What should have been reached by now: a share of the target for a sum, the target itself for a level. Null before the period. */
  expected: number | null;
  /** A sum's end if the pace so far holds (an estimate); null for a level and before anything has passed. */
  projected: number | null;
  /** Actual over target. */
  pct: number | null;
  shareElapsed: number;
  weekdayWeighted: boolean;
  daysInPeriod: number;
  daysLeft: number;
  /** Too little has passed, or too little was counted, for a verdict: shown, but judged neither way. */
  tooEarly: boolean;
  /** Why the figure is not known or not judged: visits were not counted on every day, or too few orders or visits so far. */
  missing: "visits" | "orders" | "sessions" | null;
  ended: boolean;
};

function sumWeights(history: readonly PeriodDay[] | undefined, metric: TargetMetric, before: string): number[] | null {
  if (!history) return null;
  return weekdayWeights(
    history.map((d) => ({ day: d.day, revenueMinor: metric === "orders" ? d.orders : d.netRevenueMinor })),
    before,
  );
}

/**
 * Progress of a target over its period (D348). A sum (net sales, orders) is held against the weekday-weighted expectation over the period's own days, as
 * `targetProgress()` does for a month; a level (conversion, AOV) is the figure so far against the target, with `LEVEL_MINIMUMS` before any verdict.
 * Conversion counts checkout orders over visits and is not known while visits were not counted on every day of the period so far. Pure.
 */
export function periodProgress(input: PeriodProgressInput): PeriodProgress {
  const start = dayMs(input.startsOn);
  const end = dayMs(input.endsOn);
  const today = dayMs(input.today);
  if (start === null || end === null || end < start) throw new RangeError(`not a period: ${input.startsOn} to ${input.endsOn}`);
  if (today === null) throw new RangeError(`today is not a day: ${input.today}`);
  const days = Math.round((end - start) / DAY_MS) + 1;
  const dayOfPeriod = Math.floor((today - start) / DAY_MS) + 1;
  const share = Number.isFinite(input.todayShare) ? Math.min(1, Math.max(0, input.todayShare as number)) : 1;
  const elapsed = dayOfPeriod < 1 ? 0 : dayOfPeriod > days ? days : dayOfPeriod - 1 + share;
  const daysLeft = dayOfPeriod < 1 ? days : Math.max(0, days - dayOfPeriod);
  const ended = dayOfPeriod > days;
  const target = input.targetValue;
  const base = { metric: input.metric, targetValue: target, daysInPeriod: days, daysLeft, ended };

  if (dayOfPeriod < 1) {
    return { ...base, status: "upcoming", actual: null, expected: null, projected: null, pct: null, shareElapsed: 0, weekdayWeighted: false, tooEarly: true, missing: null };
  }

  if (isSumMetric(input.metric)) {
    const actual = input.metric === "orders" ? input.sofar.orders : input.sofar.netRevenueMinor;
    const weights = sumWeights(input.history, input.metric, input.today);
    let shareElapsed = elapsed / days;
    if (weights) {
      let done = 0;
      let all = 0;
      for (let d = 1; d <= days; d++) {
        const weight = weights[weekdayOf(start + (d - 1) * DAY_MS)];
        all += weight;
        done += weight * Math.min(1, Math.max(0, elapsed - (d - 1)));
      }
      if (all > 0) shareElapsed = done / all;
    }
    const expected = Math.round(target * shareElapsed);
    const aheadByPct = safeRatio(actual - expected, expected);
    const tooEarly = !ended && elapsed < MIN_DAYS_FOR_VERDICT;
    let status: PeriodStatus;
    if (actual >= target) status = "ahead";
    else if (aheadByPct === null) status = "on_track";
    else if (aheadByPct > ON_TRACK_TOLERANCE) status = "ahead";
    else if (aheadByPct < -ON_TRACK_TOLERANCE) status = "behind";
    else status = "on_track";
    return {
      ...base,
      status,
      actual,
      expected,
      projected: shareElapsed > 0 ? Math.round(actual / shareElapsed) : null,
      pct: actual / target,
      shareElapsed,
      weekdayWeighted: weights !== null,
      tooEarly,
      missing: null,
    };
  }

  // A level: the figure so far against the target itself.
  let actual: number | null = null;
  let missing: PeriodProgress["missing"] = null;
  let enough = false;
  if (input.metric === "aov") {
    const orders = input.sofar.orders;
    actual = orders > 0 ? Math.round(input.sofar.netRevenueMinor / orders) : null;
    enough = orders >= LEVEL_MINIMUMS.aov.orders;
    if (!enough) missing = "orders";
  } else {
    const sessions = input.sofar.sessions;
    if (sessions === null) {
      missing = "visits";
    } else {
      actual = sessions > 0 ? Math.round((input.sofar.checkoutOrders / sessions) * 10_000) : null;
      enough = sessions >= LEVEL_MINIMUMS.conversion.sessions;
      if (!enough) missing = "sessions";
    }
  }
  if (actual === null) {
    return { ...base, status: "not_known", actual: null, expected: target, projected: null, pct: null, shareElapsed: elapsed / days, weekdayWeighted: false, tooEarly: true, missing };
  }
  const by = (actual - target) / target;
  const status: PeriodStatus = actual >= target ? "ahead" : by < -ON_TRACK_TOLERANCE ? "behind" : "on_track";
  return { ...base, status, actual, expected: target, projected: null, pct: actual / target, shareElapsed: elapsed / days, weekdayWeighted: false, tooEarly: !enough, missing };
}
