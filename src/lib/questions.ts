/**
 * The answer rules a checkout question (D357) and a form's question (D705) share: a whole number within its bounds, a day of the calendar
 * within its earliest and latest day counted from today. Pure and free of zod, so the cart (a pay route) and the storefront's forms import
 * them (D211). `checkout-rules.ts` and `forms.ts` both check answers with these, so the browser and the server agree.
 */

/** A form's kinds answered from their options (D705 F3): a dropdown and radio buttons by one, a tick list by any number. */
export const OPTION_FIELD_KINDS: readonly string[] = ["select", "radio", "checklist"];

/** A number's lowest and highest value, or a date's earliest and latest day counted from today (0 is today), each optional. */
export type AnswerBounds = { min?: number; max?: number };

/** The largest number a number question takes, either way. */
export const NUMBER_LIMIT = 1_000_000_000;
/** The furthest day, in days from today, a date question's bounds may name. */
export const DATE_DAYS_MAX = 730;

/** A day `n` days after `day` (`YYYY-MM-DD`), counted on the calendar. */
export function daysAfter(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Today's day (`YYYY-MM-DD`) in a time zone. */
export const todayInZone = (timeZone: string, now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(now);

/** A real day of the calendar written `YYYY-MM-DD`. */
export const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && daysAfter(s, 0) === s;

/** A number's or a date's bounds as an input takes them (`min`, `max`): a number's values, a date's days from `today` (none without a today). */
export function boundsAsInput(kind: string, bounds: AnswerBounds | undefined, today?: string): [string | null, string | null] {
  const b = bounds ?? {};
  if (kind === "number") return [b.min === undefined ? null : String(b.min), b.max === undefined ? null : String(b.max)];
  if (kind === "date" && today) return [b.min === undefined ? null : daysAfter(today, b.min), b.max === undefined ? null : daysAfter(today, b.max)];
  return [null, null];
}

/** A typed whole number within its bounds, as kept, or null. */
export function numberAnswer(typed: string, bounds: AnswerBounds | undefined): string | null {
  const [min, max] = boundsAsInput("number", bounds);
  if (!/^-?\d{1,10}$/.test(typed)) return null;
  const n = Number(typed);
  if (Math.abs(n) > NUMBER_LIMIT || (min !== null && n < Number(min)) || (max !== null && n > Number(max))) return null;
  return String(n);
}

/** A typed day within its earliest and latest day from `today` (no bounds without a today), as kept, or null. */
export function dateAnswer(typed: string, bounds: AnswerBounds | undefined, today?: string): string | null {
  const [min, max] = boundsAsInput("date", bounds, today);
  if (!isDay(typed) || (min !== null && typed < min) || (max !== null && typed > max)) return null;
  return typed;
}
