import { addDays, zonedDate, zonedTime } from "./booking-slots";

/**
 * Calendar days for Work (docs/work.md 4.5, 4.6): an issue date, a due date, a
 * work date or a recurring period is a day in the store's time zone, kept as
 * `YYYY-MM-DD` text and never as an instant, so "today" for an invoice
 * issued at 00:30 in Oslo is the Oslo day and not yesterday's UTC day (Life
 * used the UTC day throughout). Time zones come from `Intl` only, through the
 * helpers appointments already use.
 */

export { addDays, zonedDate };

/** A calendar day, `YYYY-MM-DD`. */
export type Day = string;

const DAY_MS = 86_400_000;

/** A day's parts, or null when the text is not a real calendar day (no 2026-02-30). */
export function parseDay(text: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

export const isDay = (text: string): boolean => parseDay(text) !== null;

function assertDay(text: string): { year: number; month: number; day: number } {
  const parts = parseDay(text);
  if (!parts) throw new RangeError(`Not a calendar day (YYYY-MM-DD): ${text}`);
  return parts;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: Day, to: Day): number {
  const a = assertDay(from);
  const b = assertDay(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS);
}

/** The day `days` after a day (before, if negative). Calendar arithmetic, so daylight saving cannot shift it. */
export function addCalendarDays(day: Day, days: number): Day {
  assertDay(day);
  if (!Number.isSafeInteger(days)) throw new RangeError(`Days must be a whole number: ${days}`);
  return addDays(day, days);
}

/**
 * A day `months` later (earlier, if negative), keeping the day of the month
 * and clamping to the month's last day: 31 Jan plus one month is 28 Feb (29 in
 * a leap year). Always counted from the anchor, never from a clamped result,
 * so a schedule does not drift (31 Jan, 28 Feb, 31 Mar).
 */
export function addMonthsClamped(anchor: Day, months: number): Day {
  const { year, month, day } = assertDay(anchor);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12; // 0..11
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** The first day of a day's month. */
export function startOfMonth(day: Day): Day {
  assertDay(day);
  return `${day.slice(0, 7)}-01`;
}

/** `YYYY-MM` of a day. */
export function monthOf(day: Day): string {
  assertDay(day);
  return day.slice(0, 7);
}

// --- The store's time zone ---------------------------------------------------

/** Whether the runtime knows a time zone name. */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day an instant falls on in a time zone: 23:30 UTC on 30 Mar is already 31 Mar in Oslo. */
export function dayIn(instant: Date | number | string, timeZone: string): Day {
  const ms = typeof instant === "number" ? instant : new Date(instant).getTime();
  if (!Number.isFinite(ms)) throw new RangeError("Not a valid moment");
  return zonedDate(ms, timeZone);
}

/** Today where the store is. */
export const todayIn = (timeZone: string, now: Date | number = new Date()): Day => dayIn(now, timeZone);

/** Local midnight at the start of a day in a time zone, as an instant (a day may be 23 or 25 hours long). */
export function startOfDay(day: Day, timeZone: string): Date {
  assertDay(day);
  return new Date(zonedTime(day, "00:00", timeZone));
}

/**
 * The half-open range `[from, to)` of instants that fall on a day in a time
 * zone, to query timestamps by day: `to` is the next local midnight, not
 * `from` plus 24 hours.
 */
export function dayRange(day: Day, timeZone: string): { from: Date; to: Date } {
  return { from: startOfDay(day, timeZone), to: startOfDay(addCalendarDays(day, 1), timeZone) };
}

/**
 * Noon on a day in a time zone, as an instant: what `paid_at` is for a payment
 * received on a given day, so the day survives being shown in any zone near
 * the store's (as Life stored 12:00 UTC for the same reason).
 */
export function noonOf(day: Day, timeZone: string): Date {
  assertDay(day);
  return new Date(zonedTime(day, "12:00", timeZone));
}

// --- Payment terms and due dates ---------------------------------------------

/** The payment terms used when nothing else says (Life's default). */
export const DEFAULT_PAYMENT_DAYS = 14;
export const MIN_PAYMENT_DAYS = 1;
export const MAX_PAYMENT_DAYS = 90;

export function clampPaymentDays(days: number): number {
  return Math.min(MAX_PAYMENT_DAYS, Math.max(MIN_PAYMENT_DAYS, Math.round(days)));
}

const usable = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);

/**
 * The payment terms in days: the invoice's own, else the client's, else the
 * store's default, else 14, clamped to 1-90. (Life had no store level; Work
 * settings add one, `work_settings.default_payment_days`.)
 */
export function resolvePaymentDays(source: {
  invoice?: number | null;
  client?: number | null;
  store?: number | null;
}): number {
  for (const days of [source.invoice, source.client, source.store]) {
    if (usable(days)) return clampPaymentDays(days);
  }
  return DEFAULT_PAYMENT_DAYS;
}

/**
 * The due date: the issue date plus the terms, in calendar days. In Work
 * issuing is sending (4.6), so it counts from the day the invoice is issued,
 * as Life counted from the day it was sent, "otherwise an invoice sent late is
 * already overdue". (2026-04-02 plus 14 days is 2026-04-16.)
 */
export function dueOn(issuedOn: Day, paymentDays: number): Day {
  assertDay(issuedOn);
  return addCalendarDays(issuedOn, clampPaymentDays(paymentDays));
}

/**
 * When a draft would fall due if it were issued today: an estimate that
 * moves every day until the invoice is issued, never stored on the draft.
 */
export const tentativeDueOn = (today: Day, paymentDays: number): Day => dueOn(today, paymentDays);

// --- Overdue -----------------------------------------------------------------

export type DueState = "overdue" | "due_soon" | "not_due";

/** How many days ahead counts as "due soon" on the overview (6.5). */
export const DUE_SOON_DAYS = 7;

/**
 * Overdue is derived, never stored (4.5 10): an invoice that is sent and not
 * yet paid whose due date is before today in the store's time zone. Due today
 * is not overdue. Drafts, paid and voided invoices never are.
 */
export function isOverdue(invoice: { status: string; dueOn: Day | null }, today: Day): boolean {
  return invoice.status === "sent" && invoice.dueOn !== null && invoice.dueOn < today;
}

/** Whole days past the due date (0 when not overdue). */
export function daysOverdue(invoice: { status: string; dueOn: Day | null }, today: Day): number {
  return isOverdue(invoice, today) && invoice.dueOn ? daysBetween(invoice.dueOn, today) : 0;
}

/** The overview's buckets for a sent, unpaid invoice: overdue, due within 7 days (today included), or later. */
export function dueState(dueDay: Day, today: Day): DueState {
  if (dueDay < today) return "overdue";
  return daysBetween(today, dueDay) <= DUE_SOON_DAYS ? "due_soon" : "not_due";
}

// --- The issue date ----------------------------------------------------------

export type IssueDateProblem = "invalid" | "future" | "too_old" | "before_previous";

/**
 * Whether an issue date may be used (4.4): a real day; not after today; not
 * older than the few days of backdating the settings allow (a paper invoice
 * written up later); and not earlier than the previous document's date in
 * the series, since some countries expect dates to grow with the numbers. The
 * last is a problem the owner may confirm past, the others are not. Null when
 * the date is fine.
 */
export function issueDateProblem(args: {
  issuedOn: Day;
  today: Day;
  /** Days back the store allows; 0 means only today. */
  backdateDays: number;
  /** The latest issue date already used in this series. */
  previousDocumentDate: Day | null;
}): IssueDateProblem | null {
  if (!isDay(args.issuedOn)) return "invalid";
  if (args.issuedOn > args.today) return "future";
  if (args.issuedOn < addCalendarDays(args.today, -Math.max(0, args.backdateDays))) return "too_old";
  if (args.previousDocumentDate && args.issuedOn < args.previousDocumentDate) return "before_previous";
  return null;
}

// --- Showing days ------------------------------------------------------------

/** A day for people in a locale ("28.09.2026" in nb-NO), the same wherever the viewer is. */
export function formatDay(day: Day, locale: string): string {
  const { year, month, day: d } = assertDay(day);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.UTC(year, month - 1, d)),
  );
}
