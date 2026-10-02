import { addDays, addYears, isDay, isoWeekday } from "./analytics-period";

/**
 * A month's net revenue forecast (D152, docs/analytics.md, "Alerts, targets,
 * forecast, diagnosis"): what the month is likely to end at, with a range.
 * Pure and without a model; the page labels it an estimate.
 *
 * Method. The level is the daily net revenue of the last eight weeks
 * (`HISTORY_DAYS`), taken with a weekday profile: each weekday's mean over
 * the history against the overall mean, used only when every weekday has been
 * seen `MIN_WEEKDAY_OBSERVATIONS` times, else every day counts alike. Each
 * remaining day of the month is then `level x weekday factor`, times a
 * seasonal factor when last year's data allows (below). The range is an 80 %
 * range from the spread of the history's weekday-adjusted daily residuals: it
 * grows with the square root of the days left for the days' own spread, and
 * faster than that for the uncertainty of the level itself.
 *
 * Seasonal factor: last year's average (weekday-adjusted) daily revenue over
 * the days now left in the month, against last year's average over the same
 * eight weeks as the level uses, both shifted back a year. At the start of a
 * month that is "last year's month over the eight weeks before it". It is
 * applied only when last year's data is there for nearly all of both
 * windows and there was enough selling in them, and is clamped to
 * `SEASONAL_MIN` to `SEASONAL_MAX`.
 *
 * Amounts are net revenue per day without VAT in minor units of the main
 * currency, never negative in the forecast. Days are `YYYY-MM-DD` in the
 * store's time zone.
 */

/** Days of history the level, weekday profile and spread are taken from: eight weeks before today. */
export const HISTORY_DAYS = 56;

/** Fewer observed days than this in the history and there is no forecast (`too-little-data`). */
export const MIN_HISTORY_DAYS = 14;

/** Each weekday needs this many observations in the history, or the weekday profile is not used. */
export const MIN_WEEKDAY_OBSERVATIONS = 4;

/** The seasonal factor is clamped to this range. */
export const SEASONAL_MIN = 0.5;
export const SEASONAL_MAX = 2;

/** Last year's remaining-days window needs at least this many days (a shorter one is noise) and every one of them observed. */
export const SEASONAL_MIN_TARGET_DAYS = 5;

/** Last year's eight-week window needs at least this share of its days observed (49 of 56). */
export const SEASONAL_MIN_COVERAGE = 0.875;

/** And at least this many of those days with sales (selling at least half the window), the volume the factor needs. */
export const SEASONAL_MIN_SELLING_DAYS = 28;

/** The range's two-sided probability, 80 %, and its normal quantile. */
export const RANGE_PROBABILITY = 0.8;
export const RANGE_Z = 1.2815515655446004;

export type DailyValue = { day: string; value: number };

export type ForecastInput = {
  /** The first day (or any day) of the month forecast, `YYYY-MM-DD`. */
  monthStart: string;
  /** The store's today, `YYYY-MM-DD`. */
  today: string;
  /**
   * Net revenue per day for at least the last eight weeks, and the month so far. Every day present, zeros included: a
   * day that is not in the list is unknown, not quiet. Today's row (partial) counts towards the month so far and is not
   * used for the level. A repeated day is added up.
   */
  dailyHistory: readonly DailyValue[];
  /** The same month last year and the eight weeks before it, same shape; optional. */
  lastYear?: readonly DailyValue[];
  /** How much of today has passed, 0 to 1; 1 (the default) counts today as over and the rest of it as nothing. */
  todayShare?: number;
};

export type ForecastBasis = "weekday-run-rate" | "seasonal" | "too-little-data";

export type MonthForecast = {
  /** The month's expected net revenue; null with `too-little-data`. */
  expectedMinor: number | null;
  /** The 80 % range's low and high ends for the month's total; never below what has been banked, never negative. Null with `too-little-data`. */
  lowMinor: number | null;
  highMinor: number | null;
  /** How it was worked out. */
  basis: ForecastBasis;
  /** Net revenue so far in the month, today included. */
  soFarMinor: number;
  /** Whole days after today that are still in the month. */
  daysLeft: number;
  /** The seasonal factor applied (1 when none); null when none was. */
  seasonalFactor: number | null;
  /** Plain-language notes on what the figure rests on and what it leaves out, for the page. */
  notes: string[];
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Day string to a map of per-day totals; unreal days and non-numbers are skipped. */
function byDay(rows: readonly DailyValue[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows ?? []) {
    if (isDay(r.day) && finite(r.value)) map.set(r.day, (map.get(r.day) ?? 0) + r.value);
  }
  return map;
}

/** 0 (Monday) to 6 (Sunday). */
const weekdayIndex = (day: string) => isoWeekday(day) - 1;

const daysInMonthOf = (monthStart: string): number => {
  const y = Number(monthStart.slice(0, 4));
  const m = Number(monthStart.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** The days from `from` for `n` days. */
function span(from: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

/** The weekday profile of the observed days: factor per weekday (Monday first), or null when it cannot be used. */
export function weekdayProfile(observed: readonly { day: string; value: number }[]): number[] | null {
  if (observed.length === 0) return null;
  const sums = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);
  let total = 0;
  for (const o of observed) {
    const w = weekdayIndex(o.day);
    sums[w] += o.value;
    counts[w] += 1;
    total += o.value;
  }
  if (counts.some((n) => n < MIN_WEEKDAY_OBSERVATIONS)) return null;
  const mean = total / observed.length;
  if (!(mean > 0)) return null;
  // A weekday with a negative mean (refund-heavy) counts as nothing, not backwards.
  return sums.map((s, i) => Math.max(0, s / counts[i] / mean));
}

/** Sample standard deviation; 0 for fewer than two values. */
function sd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));
}

type SeasonalResult = { factor: number | null; note: string | null };

/**
 * Last year's seasonal factor for the fill days (`fillFrom`, `fillDays`), or null with a note when last year's data
 * does not support one. `wf` is the weekday profile in use (or null: every day alike). Each window's level is worked
 * out as the level is: its revenue over the weekday weights of its observed days.
 */
function seasonalFactor(
  lastYear: Map<string, number>,
  today: string,
  fillFrom: string,
  fillDays: number,
  wf: number[] | null,
): SeasonalResult {
  if (lastYear.size === 0 || fillDays === 0) return { factor: null, note: null };
  if (fillDays < SEASONAL_MIN_TARGET_DAYS) {
    return { factor: null, note: "Last year's pattern is not used: too few days are left in the month for it to say anything." };
  }
  const anchor = addYears(today, -1);
  const trailing = span(addDays(anchor, -HISTORY_DAYS), HISTORY_DAYS);
  const target = span(addYears(fillFrom, -1), fillDays);
  const weight = (day: string) => (wf ? wf[weekdayIndex(day)] : 1);
  const observedIn = (days: readonly string[]) => days.filter((d) => lastYear.has(d));
  const levelOf = (days: readonly string[]): number | null => {
    let sum = 0;
    let weights = 0;
    for (const d of days) {
      sum += lastYear.get(d) as number;
      weights += weight(d);
    }
    return weights > 0 ? sum / weights : null;
  };
  const targetSeen = observedIn(target);
  const trailingSeen = observedIn(trailing);
  if (targetSeen.length < fillDays * 0.9 || trailingSeen.length < HISTORY_DAYS * SEASONAL_MIN_COVERAGE) {
    return { factor: null, note: "Last year's pattern is not used: last year's data is not complete enough." };
  }
  if (trailingSeen.filter((d) => (lastYear.get(d) as number) > 0).length < SEASONAL_MIN_SELLING_DAYS) {
    return { factor: null, note: "Last year's pattern is not used: too little was sold in the weeks before to compare against." };
  }
  const targetLevel = levelOf(targetSeen);
  const trailingLevel = levelOf(trailingSeen);
  if (targetLevel === null || trailingLevel === null || !(trailingLevel > 0)) {
    return { factor: null, note: "Last year's pattern is not used: nothing was sold in the weeks before to compare against." };
  }
  return { factor: Math.min(SEASONAL_MAX, Math.max(SEASONAL_MIN, targetLevel / trailingLevel)), note: null };
}

/**
 * The month's expected net revenue and an 80 % range. See the module comment. With fewer than `MIN_HISTORY_DAYS`
 * observed days of history before today the answer is `too-little-data` with nulls for the figures (never zero).
 */
export function forecastMonth(input: ForecastInput): MonthForecast {
  if (!isDay(input.monthStart)) throw new RangeError(`monthStart is not a day: ${input.monthStart}`);
  if (!isDay(input.today)) throw new RangeError(`today is not a day: ${input.today}`);
  const first = `${input.monthStart.slice(0, 7)}-01`;
  const n = daysInMonthOf(first);
  const last = addDays(first, n - 1);
  const share = finite(input.todayShare) ? Math.min(1, Math.max(0, input.todayShare)) : 1;

  const history = byDay(input.dailyHistory);

  // What is banked: every known day of the month up to and including today.
  let soFar = 0;
  for (const [day, value] of history) if (day >= first && day <= last && day <= input.today) soFar += value;
  const banked = Math.max(0, soFar);
  const soFarMinor = Math.round(soFar);

  // Days still to fill: from tomorrow (or the month's first day, for a month not yet begun) to its end.
  const fillFrom = input.today < first ? first : addDays(input.today, 1);
  const fillDays = input.today >= last ? 0 : Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${fillFrom}T00:00:00Z`)) / 86_400_000) + 1;
  const daysLeft = fillDays;
  const notes: string[] = [];

  // The history: complete days before today, the last eight weeks.
  const windowStart = addDays(input.today, -HISTORY_DAYS);
  const observed: { day: string; value: number }[] = [];
  for (const day of span(windowStart, HISTORY_DAYS)) {
    const v = history.get(day);
    if (v !== undefined) observed.push({ day, value: v });
  }
  if (observed.length < MIN_HISTORY_DAYS) {
    return {
      expectedMinor: null,
      lowMinor: null,
      highMinor: null,
      basis: "too-little-data",
      soFarMinor,
      daysLeft,
      seasonalFactor: null,
      notes: [`Fewer than ${MIN_HISTORY_DAYS} days of sales before today, too little to forecast the month.`],
    };
  }

  const wf = weekdayProfile(observed);
  if (wf) notes.push(`Based on the last ${observed.length} days of sales and the usual pattern through the week; it assumes sales go on at that level (a steady rise or fall is not extended).`);
  else notes.push(`Based on the last ${observed.length} days of sales; every weekday counts alike because each has not been seen ${MIN_WEEKDAY_OBSERVATIONS} times yet; it assumes sales go on at that level.`);
  const factorOf = (day: string) => (wf ? wf[weekdayIndex(day)] : 1);

  // Level: observed revenue over the weekday weights it was observed on (a weekday that never sells counts for nothing either way).
  const weights = observed.reduce((a, o) => a + factorOf(o.day), 0);
  const level = weights > 0 ? Math.max(0, observed.reduce((a, o) => a + o.value, 0) / weights) : 0;
  const residuals = observed.map((o) => o.value - level * factorOf(o.day));
  const sigma = sd(residuals);

  const seasonal = seasonalFactor(byDay(input.lastYear), input.today, fillFrom, fillDays, wf);
  if (seasonal.note) notes.push(seasonal.note);
  const s = seasonal.factor ?? 1;
  if (seasonal.factor !== null) {
    notes.push(
      `Last year's pattern is applied: the rest of the month sold ${seasonal.factor.toFixed(2)} times as much per day as the weeks before it did last year${
        seasonal.factor === SEASONAL_MIN || seasonal.factor === SEASONAL_MAX ? " (limited to keep the estimate sensible)" : ""
      }.`,
    );
  }

  // The rest of today, then the days after it.
  let remaining = 0;
  let effectiveDays = 0;
  if (input.today >= first && input.today <= last && share < 1) {
    remaining += level * factorOf(input.today) * s * (1 - share);
    effectiveDays += 1 - share;
  }
  for (const day of span(fillFrom, fillDays)) remaining += level * factorOf(day) * s;
  effectiveDays += fillDays;

  const expected = Math.max(0, banked + remaining);
  // The days' own spread adds up as the root of their number; the uncertainty of the level itself adds up in full.
  const daySd = sigma * s;
  const spread = Math.sqrt(effectiveDays * daySd ** 2 + (effectiveDays * daySd) ** 2 / observed.length);
  const half = RANGE_Z * spread;
  const low = Math.min(expected, Math.max(banked, expected - half));
  const high = expected + half;

  return {
    expectedMinor: Math.round(expected),
    lowMinor: Math.round(low),
    highMinor: Math.round(high),
    basis: seasonal.factor !== null ? "seasonal" : "weekday-run-rate",
    soFarMinor,
    daysLeft,
    seasonalFactor: seasonal.factor,
    notes,
  };
}
