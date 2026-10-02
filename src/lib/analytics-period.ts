/**
 * Periods and comparisons for the store analytics (D152, docs/analytics.md).
 *
 * A day is a `YYYY-MM-DD` string in the store's time zone and a period is
 * `[from, to)` in whole days. All calendar arithmetic is on those strings
 * (through UTC dates, which have no daylight saving), so a day that is 23 or
 * 25 hours long never changes a count; the time zone matters in exactly one
 * place, `todayIn()`, which says what day it is there. Nothing here reads the
 * clock: callers pass `now`.
 */

import { MONTH_SHORT } from "./analytics-core";

export type AnalyticsPreset = "today" | "yesterday" | "7d" | "30d" | "month" | "last_month" | "year" | "custom";

export type CompareMode = "previous" | "year" | "none";

/** A span of whole days in the store's time zone. */
export type AnalyticsPeriod = {
  /** First day, `YYYY-MM-DD`. */
  from: string;
  /** The day after the last one (exclusive), `YYYY-MM-DD`. */
  to: string;
  /** Number of days in `[from, to)`. */
  days: number;
  /** What the owner chose; a comparison period is always `custom`. */
  preset: AnalyticsPreset;
  /** Words for it: "Last 30 days", or the dates for a custom or comparison span. */
  label: string;
};

/**
 * What the address asked for. `previous` is set only for mode `previous` and
 * `lastYear` only for mode `year`; `previousPeriodOf()` and `lastYearOf()` give
 * either one for any period (the overview shows both).
 */
export type AnalyticsComparison = {
  mode: CompareMode;
  previous: AnalyticsPeriod | null;
  lastYear: AnalyticsPeriod | null;
};

export type AnalyticsParams = {
  period: AnalyticsPeriod;
  compare: AnalyticsComparison;
  /** Words when the address was changed to something allowed (a future end, too long a span), else null. */
  notice: string | null;
};

export const DEFAULT_PRESET: AnalyticsPreset = "30d";
export const DEFAULT_COMPARE: CompareMode = "previous";
/** The longest custom span. */
export const MAX_PERIOD_DAYS = 800;

export const PRESETS: readonly { id: AnalyticsPreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "month", label: "This month" },
  { id: "last_month", label: "Previous month" },
  { id: "year", label: "This year" },
  { id: "custom", label: "Custom range" },
];

export const COMPARE_MODES: readonly { id: CompareMode; label: string }[] = [
  { id: "previous", label: "Previous period" },
  { id: "year", label: "Same period last year" },
  { id: "none", label: "No comparison" },
];

const MONTHS = MONTH_SHORT;
const DAY_MS = 86_400_000;

// ---------- calendar arithmetic on day strings ----------

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A day string as a UTC date at midnight; null when it is not a real calendar day. */
function parseDay(day: string): Date | null {
  const m = DAY_PATTERN.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2999) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

const formatDay = (date: Date) => date.toISOString().slice(0, 10);

/** Whether the text is a real `YYYY-MM-DD` day. */
export function isDay(day: unknown): day is string {
  return typeof day === "string" && parseDay(day) !== null;
}

function mustParse(day: string): Date {
  const date = parseDay(day);
  if (!date) throw new RangeError(`Not a day: ${day}`);
  return date;
}

export function addDays(day: string, n: number): string {
  return formatDay(new Date(mustParse(day).getTime() + n * DAY_MS));
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((mustParse(b).getTime() - mustParse(a).getTime()) / DAY_MS);
}

const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

/** Moves by calendar months, keeping the day of the month where it exists and else the month's last day. */
export function addMonths(day: string, n: number): string {
  const d = mustParse(day);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const year = Math.floor(total / 12);
  const month0 = total - year * 12;
  return formatDay(new Date(Date.UTC(year, month0, Math.min(d.getUTCDate(), daysInMonth(year, month0)))));
}

/** One year earlier or later; 29 February becomes 28 February in a year without one. */
export function addYears(day: string, n: number): string {
  return addMonths(day, n * 12);
}

export const startOfMonth = (day: string) => `${day.slice(0, 7)}-01`;

/** 1 (Monday) to 7 (Sunday), the ISO weekday. */
export function isoWeekday(day: string): number {
  const w = mustParse(day).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The Monday on or before the day. */
export const startOfWeek = (day: string) => addDays(day, 1 - isoWeekday(day));

/** What day it is in a time zone (an IANA name such as `Europe/Oslo`). */
export function todayIn(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

// ---------- periods ----------

const shortDay = (day: string) => {
  const d = mustParse(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

const longDay = (day: string) => `${shortDay(day)} ${day.slice(0, 4)}`;

/** "3 Mar – 9 Mar 2026", or both years when they differ; one day alone for a one-day span. */
export function rangeLabel(from: string, to: string): string {
  const last = addDays(to, -1);
  if (last === from) return longDay(from);
  return from.slice(0, 4) === last.slice(0, 4) ? `${shortDay(from)} – ${longDay(last)}` : `${longDay(from)} – ${longDay(last)}`;
}

function make(from: string, to: string, preset: AnalyticsPreset, label?: string): AnalyticsPeriod {
  return { from, to, days: daysBetween(from, to), preset, label: label ?? rangeLabel(from, to) };
}

const labelOf = (preset: AnalyticsPreset) => PRESETS.find((p) => p.id === preset)!.label;

/** A preset's period as of `today` (a day string in the store's zone). */
export function presetPeriod(preset: Exclude<AnalyticsPreset, "custom">, today: string): AnalyticsPeriod {
  const tomorrow = addDays(today, 1);
  const label = labelOf(preset);
  switch (preset) {
    case "today":
      return make(today, tomorrow, preset, label);
    case "yesterday":
      return make(addDays(today, -1), today, preset, label);
    case "7d":
      return make(addDays(today, -6), tomorrow, preset, label);
    case "30d":
      return make(addDays(today, -29), tomorrow, preset, label);
    case "month":
      return make(startOfMonth(today), tomorrow, preset, label);
    case "last_month": {
      const first = startOfMonth(today);
      return make(addMonths(first, -1), first, preset, label);
    }
    case "year":
      return make(`${today.slice(0, 4)}-01-01`, tomorrow, preset, label);
  }
}

/** A custom span from days typed in the address; the end is inclusive there. */
export function customPeriod(from: string, lastDay: string): AnalyticsPeriod {
  return make(from, addDays(lastDay, 1), "custom");
}

/**
 * The span to compare with: immediately before and as long, except that "this
 * month" is set against the same number of elapsed days of the month before
 * (cut at its end), "previous month" against the month before it, and "this
 * year" against the same elapsed days of the year before, so a part of a
 * period is never held against a whole one.
 */
export function previousPeriodOf(period: AnalyticsPeriod): AnalyticsPeriod {
  const { from, days } = period;
  if (period.preset === "month") {
    const start = addMonths(from, -1);
    const monthEnd = from; // the first of this month: the previous month ends the day before
    const end = addDays(start, days);
    return make(start, end > monthEnd ? monthEnd : end, "custom");
  }
  if (period.preset === "last_month") return make(addMonths(from, -1), from, "custom");
  if (period.preset === "year") return lastYearOf(period);
  return make(addDays(from, -days), from, "custom");
}

/**
 * The same period one year earlier: it starts on the same date (29 February becomes 28 February) and is exactly as
 * many days long, so a total is never held against one with a day more or less (around a leap day a span's two ends
 * shifted separately would differ in length).
 */
export function lastYearOf(period: AnalyticsPeriod): AnalyticsPeriod {
  const from = addYears(period.from, -1);
  return make(from, addDays(from, period.days), "custom");
}

type Query = Record<string, string | string[] | undefined> | URLSearchParams;

const first = (query: Query, key: string): string | undefined => {
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined;
  const v = query[key];
  return (Array.isArray(v) ? v[0] : v) ?? undefined;
};

const isPreset = (v: string | undefined): v is AnalyticsPreset => !!v && PRESETS.some((p) => p.id === v);
const isMode = (v: string | undefined): v is CompareMode => v === "previous" || v === "year" || v === "none";

/**
 * Reads `?period=&from=&to=&compare=`. Anything unknown or unusable falls back
 * to the default (30 days against the previous period) rather than failing. A
 * custom span (the end inclusive) is swapped when reversed, never reaches past
 * today and is cut to the latest `MAX_PERIOD_DAYS`; `notice` says so.
 */
export function parseAnalyticsParams(query: Query, ctx: { now: Date; timeZone: string }): AnalyticsParams {
  const today = todayIn(ctx.now, ctx.timeZone);
  const rawPeriod = first(query, "period");
  const rawFrom = first(query, "from");
  const rawTo = first(query, "to");
  const mode = first(query, "compare");
  const compareMode: CompareMode = isMode(mode) ? mode : DEFAULT_COMPARE;

  let period: AnalyticsPeriod | null = null;
  let notice: string | null = null;
  const wantsCustom = rawPeriod === "custom" || (rawPeriod === undefined && (rawFrom !== undefined || rawTo !== undefined));
  if (wantsCustom && isDay(rawFrom) && isDay(rawTo)) {
    let [from, to] = rawFrom <= rawTo ? [rawFrom, rawTo] : [rawTo, rawFrom];
    if (from !== rawFrom) notice = "The dates were the wrong way round, so they were swapped.";
    if (to > today) {
      to = today;
      notice = "The period cannot reach past today, so it ends today.";
    }
    if (from > to) from = to;
    if (daysBetween(from, to) + 1 > MAX_PERIOD_DAYS) {
      from = addDays(to, -(MAX_PERIOD_DAYS - 1));
      notice = `A period is at most ${MAX_PERIOD_DAYS} days, so the latest ${MAX_PERIOD_DAYS} are shown.`;
    }
    period = customPeriod(from, to);
  } else if (isPreset(rawPeriod) && rawPeriod !== "custom") {
    period = presetPeriod(rawPeriod, today);
  }
  if (!period) period = presetPeriod(DEFAULT_PRESET as Exclude<AnalyticsPreset, "custom">, today);

  return {
    period,
    compare: {
      mode: compareMode,
      previous: compareMode === "previous" ? previousPeriodOf(period) : null,
      lastYear: compareMode === "year" ? lastYearOf(period) : null,
    },
    notice,
  };
}

/**
 * The query string (without `?`) that gives the same view back, for links.
 * Defaults are left out, so the default view is an empty string.
 */
export function periodQuery(state: {
  period: Pick<AnalyticsPeriod, "preset" | "from" | "to">;
  compare: { mode: CompareMode };
}): string {
  const q = new URLSearchParams();
  const { period, compare } = state;
  if (period.preset === "custom") {
    q.set("period", "custom");
    q.set("from", period.from);
    q.set("to", addDays(period.to, -1));
  } else if (period.preset !== DEFAULT_PRESET) {
    q.set("period", period.preset);
  }
  if (compare.mode !== DEFAULT_COMPARE) q.set("compare", compare.mode);
  return q.toString();
}

/** A path with the view's query and any extra parameters added. */
export function periodHref(path: string, state: Parameters<typeof periodQuery>[0], extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(periodQuery(state));
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const text = q.toString();
  return text ? `${path}?${text}` : path;
}

// ---------- buckets for charts ----------

export type Bucket = "day" | "week" | "month";

/** One step of a chart. */
export type BucketSpan = {
  /** The bucket's own start (a Monday for weeks, the first for months): what SQL's `date_trunc` gives, so rows join on it. */
  key: string;
  /** Start and end (exclusive) cut to the period, as the first and last buckets may be partial. */
  from: string;
  to: string;
  label: string;
};

/** Days up to 45 are shown by day, up to 200 by week, longer by month. */
export function bucketFor(period: Pick<AnalyticsPeriod, "days">): Bucket {
  return period.days <= 45 ? "day" : period.days <= 200 ? "week" : "month";
}

/** The bucket a day falls in, by its key. */
export function bucketKey(day: string, bucket: Bucket): string {
  return bucket === "day" ? day : bucket === "week" ? startOfWeek(day) : startOfMonth(day);
}

function bucketLabel(key: string, bucket: Bucket): string {
  if (bucket === "day") return shortDay(key);
  if (bucket === "week") return `Week of ${shortDay(key)}`;
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/** Every bucket the period touches, in order, even those with no sales. */
export function enumerateBuckets(period: Pick<AnalyticsPeriod, "from" | "to">, bucket: Bucket): BucketSpan[] {
  const out: BucketSpan[] = [];
  let key = bucketKey(period.from, bucket);
  while (key < period.to) {
    const next = bucket === "day" ? addDays(key, 1) : bucket === "week" ? addDays(key, 7) : addMonths(key, 1);
    out.push({
      key,
      from: key < period.from ? period.from : key,
      to: next > period.to ? period.to : next,
      label: bucketLabel(key, bucket),
    });
    key = next;
  }
  return out;
}
