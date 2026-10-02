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
