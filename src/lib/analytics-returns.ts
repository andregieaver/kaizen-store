import { formatCount, formatNumber, safeRatio } from "./analytics-core";
import { daysBetween } from "./analytics-period";
import { REASON_LABELS } from "./return-admin";
import { isReturnReason, type ReturnReason } from "./withdrawal";

/**
 * The pure parts of the Returns section of analytics (D153, docs/analytics.md "Returns"): the minimum volumes, what a rate says when it
 * cannot be given, medians of times, the reasons' rows and the note about orders that can still come back. The queries are in
 * `src/server/analytics-returns-data.ts`; nothing here knows a database. A figure that is not known is words, never a zero.
 */

/** Cohort orders needed before a return rate by orders is a number: one return then moves it by at most about 3 points. */
export const MIN_RATE_ORDERS = 30;
/** Units sold needed before a return rate by units is a number. */
export const MIN_RATE_UNITS = 30;
/** Units sold of one product before its own return rate is a number. */
export const MIN_PRODUCT_UNITS = 20;
/** Returns made in the period that must have a reason before the reasons get shares. */
export const MIN_REASON_SAMPLE = 10;
/** Refunded returns needed before a median time is shown. */
export const MIN_TIMING_SAMPLE = 5;

/** A ratio, or the plain reason there is none: never a zero that stands for "not known". */
export type Figure = { value: number | null; missing: string | null };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * A rate of `part` over `whole`. It has no value when nothing was recorded in the store at all (`tracked` false: the figure would be
 * a guess), when the volume is under `min`, or when there is nothing to divide by; `missing` says which, with the numbers.
 */
export function gatedRate(input: { part: number; whole: number; min: number; unit: "orders" | "units"; tracked: boolean }): Figure {
  const { part, whole, min, unit, tracked } = input;
  const singular = unit === "orders" ? "order" : "unit";
  if (!tracked) {
    return { value: null, missing: "No return has been recorded in Kaizen yet, so there is nothing to rate. Returns made through the withdrawal function or a return request appear here." };
  }
  if (whole <= 0) return { value: null, missing: `No goods ${unit === "orders" ? "orders were" : "units were"} sold in this period.` };
  if (whole < min) {
    return {
      value: null,
      missing: `Only ${formatCount(whole)} ${plural(whole, singular, unit)} in this period: a rate needs at least ${formatCount(min)}, or one return would swing it.`,
    };
  }
  return { value: safeRatio(part, whole), missing: null };
}

/** The middle value of the numbers (the mean of the two middle ones for an even count); null for none. Not changed by the order given. */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Whole and fractional days between two instants (milliseconds), never negative: null when either is missing or the later is earlier. */
export function daysSince(fromMs: number | null | undefined, toMs: number | null | undefined): number | null {
  if (fromMs == null || toMs == null || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  if (toMs < fromMs) return null;
  return (toMs - fromMs) / 86_400_000;
}

export type Timing = {
  /** Returns the figure is made of. */
  n: number;
  medianDays: number | null;
  slowestDays: number | null;
  /** Why there is no median: too few, or none. */
  missing: string | null;
};

/** A time to refund: median and slowest in days, but only from `MIN_TIMING_SAMPLE` returns; fewer says how many there were. */
export function timingOf(days: readonly (number | null)[], what: string, min = MIN_TIMING_SAMPLE): Timing {
  const known = days.filter((d): d is number => d !== null && Number.isFinite(d) && d >= 0);
  if (known.length === 0) return { n: 0, medianDays: null, slowestDays: null, missing: `No return was refunded in this period that has ${what}.` };
  if (known.length < min) {
    return {
      n: known.length,
      medianDays: null,
      slowestDays: null,
      missing: `Only ${formatCount(known.length)} ${plural(known.length, "return", "returns")} refunded with ${what}: a typical time needs at least ${formatCount(min)}.`,
    };
  }
  return { n: known.length, medianDays: median(known), slowestDays: Math.max(...known), missing: null };
}

/** Days as written on the page: "under a day", "1 day", "2.5 days". */
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return "–";
  if (days < 0.5) return "under a day";
  const rounded = Math.round(days * 10) / 10;
  return `${formatNumber(rounded, Number.isInteger(rounded) ? 0 : 1)} ${rounded === 1 ? "day" : "days"}`;
}

export type ReasonInput = { reason: string | null; returns: number; units: number };
export type ReasonRow = {
  /** The reason from the list, or "" for no reason given. */
  reason: ReturnReason | "";
  label: string;
  returns: number;
  units: number;
  /** Of the returns that have a reason; null for "no reason given" and when there are too few to say. */
  share: number | null;
};

export type ReasonBreakdown = {
  rows: ReasonRow[];
  /** Returns made in the period, and how many of them have a reason. */
  total: number;
  given: number;
  /** Shares are only shown from `MIN_REASON_SAMPLE` returns with a reason. */
  sharesShown: boolean;
  note: string | null;
};

/**
 * The reasons of the returns made in the period: the named reasons by count (largest first), then "No reason given" last, never
 * spread over the others. A text that is not on the list (an old row) is counted as "Other". Shares are of the returns with a reason.
 */
export function reasonBreakdown(inputs: readonly ReasonInput[], min = MIN_REASON_SAMPLE): ReasonBreakdown {
  const named = new Map<ReturnReason, { returns: number; units: number }>();
  let none = { returns: 0, units: 0 };
  for (const i of inputs) {
    if (i.reason === null || i.reason === "") {
      none = { returns: none.returns + i.returns, units: none.units + i.units };
      continue;
    }
    const key: ReturnReason = isReturnReason(i.reason) ? i.reason : "other";
    const have = named.get(key) ?? { returns: 0, units: 0 };
    named.set(key, { returns: have.returns + i.returns, units: have.units + i.units });
  }
  const given = [...named.values()].reduce((a, v) => a + v.returns, 0);
  const total = given + none.returns;
  const sharesShown = given >= min;
  const rows: ReasonRow[] = [...named.entries()]
    .map(([reason, v]) => ({ reason, label: REASON_LABELS[reason], returns: v.returns, units: v.units, share: sharesShown ? safeRatio(v.returns, given) : null }))
    .sort((a, b) => b.returns - a.returns || b.units - a.units || (a.reason < b.reason ? -1 : 1));
  if (none.returns > 0) rows.push({ reason: "", label: "No reason given", returns: none.returns, units: none.units, share: null });
  let note: string | null = null;
  if (total === 0) note = null;
  else if (given === 0) note = "None of the returns in this period has a reason. A withdrawal asks for none, and a shopper is never asked first.";
  else if (!sharesShown) note = `Only ${formatCount(given)} ${plural(given, "return has", "returns have")} a reason: shares need at least ${formatCount(min)}, so only counts are shown.`;
  else if (none.returns > 0) note = `${formatCount(given)} of ${formatCount(total)} returns have a reason; shares are of those. A withdrawal asks for none.`;
  return { rows, total, given, sharesShown, note };
}

/**
 * Orders placed in the last days before `today` can still come back. When the period reaches into the store's return window, the rates
 * are low for that reason and this says so; null when the period is settled. Days are 'YYYY-MM-DD'; `to` is the day after the period's last.
 */
export function maturityNote(period: { to: string }, today: string, windowDays: number): string | null {
  const sinceEnd = daysBetween(period.to, today); // days from the period's end to today: <= 0 while the period is still running
  const open = Math.max(1, Math.floor(windowDays));
  // Settled once a whole return window has passed since the period ended.
  if (sinceEnd >= open) return null;
  return `Orders from the last ${formatCount(open)} days can still be returned, so the rates for this period are still rising and are not final.`;
}
