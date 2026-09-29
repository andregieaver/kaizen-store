import { parseDecimal } from "./work-calc";
import { dayIn, type Day } from "./work-dates";

/**
 * Time entries and timers (docs/work.md 1.7, 4.2), from Life's
 * `time-entries.ts` and its timer code: reading what a person types ("1h30",
 * "1:30", "90m"), the limits an entry must keep, how a stopped timer becomes
 * minutes, and finding entries again. Pure, so the log-time form, the timer
 * button, the server action and the SQL functions' tests share the rules.
 *
 * Time is integer minutes everywhere; only the invoice line turns it into
 * hundredths of an hour (`work-calc.ts`).
 */

/** An entry is 1 minute to 24 hours (`work_time_entries.minutes` check). */
export const MIN_ENTRY_MINUTES = 1;
export const MAX_ENTRY_MINUTES = 1440;
/** The comment on an entry, the only field editable after logging. */
export const TIME_NOTE_MAX = 500;
/** An estimate may be up to 100 000 hours, as a line's quantity may. */
export const MAX_ESTIMATE_MINUTES = 6_000_000;

export const isValidEntryMinutes = (minutes: number): boolean =>
  Number.isInteger(minutes) && minutes >= MIN_ENTRY_MINUTES && minutes <= MAX_ENTRY_MINUTES;

export type DurationResult =
  | { ok: true; minutes: number }
  | { ok: false; reason: "empty" | "unrecognised" | "zero" | "too_long" };

const HOUR = "(?:h|hrs?|hours?|t|tim|timer?|timme|timmar)";
const MINUTE = "(?:m|mins?|minutes?|minutt(?:er)?|minuter?)";
const NUMBER = "(?:\\d+(?:\\.\\d+)?|\\.\\d+)";

/** Hours as decimal text ("1.25") to whole minutes, exactly and rounded half up (0.33 h is 20 min). */
function hoursTextToMinutes(text: string): number | null {
  const scaled = parseDecimal(text, 6);
  if (scaled === null) return null;
  const minutes = (BigInt(scaled) * BigInt(60) + BigInt(500_000)) / BigInt(1_000_000);
  return minutes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minutes) : null;
}

/**
 * What a person typed as minutes. Understands, in English, Norwegian, Swedish
 * and Danish, with a comma or a dot as the decimal mark:
 *
 *  - `1h30`, `1h 30m`, `1 t 30 min`, `2 timer`: hours, then minutes;
 *  - `1.5h`, `1,5 t`: decimal hours;
 *  - `1:30`: hours and minutes (the minutes take two digits, 00 to 59);
 *  - `90m`, `90 min`, `90 minutes`: minutes;
 *  - a bare `90` is minutes, or hours where `bare: "hours"` (an estimate field).
 *
 * The result is refused when it is zero or above `max` (a day, unless told).
 */
export function parseDuration(
  text: string,
  options: { bare?: "minutes" | "hours"; max?: number } = {},
): DurationResult {
  const input = text.trim().toLowerCase().replace(/,/g, ".").replace(/\s+/g, " ");
  if (input === "") return { ok: false, reason: "empty" };
  const bare = options.bare ?? "minutes";
  const max = options.max ?? MAX_ENTRY_MINUTES;

  let minutes: number | null = null;
  let match: RegExpExecArray | null;
  if ((match = /^(\d+):([0-5]\d)$/.exec(input))) {
    minutes = Number(match[1]) * 60 + Number(match[2]);
  } else if ((match = new RegExp(`^(${NUMBER}) ?${HOUR}(?: ?(\\d+) ?${MINUTE}?)?$`).exec(input))) {
    // "1h30" is 1 h 30 min, but "1.5h30" says two things about the hours.
    const extra = match[2] === undefined ? 0 : Number(match[2]);
    if (match[2] === undefined || /^\d+$/.test(match[1])) {
      const hours = hoursTextToMinutes(match[1]);
      minutes = hours === null ? null : hours + extra;
    }
  } else if ((match = new RegExp(`^(\\d+) ?${MINUTE}$`).exec(input))) {
    minutes = Number(match[1]);
  } else if ((match = new RegExp(`^${NUMBER}$`).exec(input))) {
    if (bare === "hours") minutes = hoursTextToMinutes(match[0]);
    else if (/^\d+$/.test(match[0])) minutes = Number(match[0]);
  }

  if (minutes === null || !Number.isSafeInteger(minutes)) return { ok: false, reason: "unrecognised" };
  if (minutes === 0) return { ok: false, reason: "zero" };
  if (minutes > max) return { ok: false, reason: "too_long" };
  return { ok: true, minutes };
}

/** Minutes for people: "45m", "2h", "1h 30m". */
export function formatDuration(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) throw new RangeError(`Minutes must be a whole number: ${minutes}`);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Minutes as `1:30`, the form that is also accepted back by `parseDuration`. */
export function formatClockMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) throw new RangeError(`Minutes must be a whole number: ${minutes}`);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A running clock's seconds as `h:mm:ss`. */
export function formatTimerClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  return `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// --- Timers ------------------------------------------------------------------

const asMs = (at: Date | number): number => (typeof at === "number" ? at : at.getTime());

/** Whole seconds a timer has run (never negative, even if the clocks of two devices disagree). */
export const elapsedSeconds = (startedAt: Date | number, now: Date | number): number =>
  Math.max(0, Math.floor((asMs(now) - asMs(startedAt)) / 1000));

/**
 * The entry a stopped timer becomes: every started minute counts, and never
 * less than one (`max(1, ceil(elapsed / 60 s))`, Life's rule and the SQL
 * function's). An entry is at most 24 hours, so a clock left running for days
 * gives 1440 with `capped` set, and the person is told to correct it rather
 * than the time being lost silently.
 */
export function timerMinutes(
  startedAt: Date | number,
  stoppedAt: Date | number,
): { minutes: number; elapsedMinutes: number; capped: boolean } {
  const elapsedMs = Math.max(0, asMs(stoppedAt) - asMs(startedAt));
  const elapsedMinutes = Math.max(MIN_ENTRY_MINUTES, Math.ceil(elapsedMs / 60_000));
  return {
    minutes: Math.min(MAX_ENTRY_MINUTES, elapsedMinutes),
    elapsedMinutes,
    capped: elapsedMinutes > MAX_ENTRY_MINUTES,
  };
}

/** The work date of a stopped timer: the day it started, where the store is (Life used the UTC day). */
export const timerWorkDate = (startedAt: Date | number, timeZone: string): Day => dayIn(startedAt, timeZone);

// --- Totals over entries -----------------------------------------------------

export type TimeEntryLike = {
  minutes: number;
  billable: boolean;
  /** Minutes covered by the client's prepaid hours (6.2); they are not invoiced. */
  prepaidMinutes?: number;
  /** Set once a draft line includes the entry (`work_time_entries.invoice_line_id`). */
  invoiceLineId?: string | null;
};

const sum = (values: Iterable<number>): number => {
  let total = 0;
  for (const v of values) total += v;
  return total;
};

/** All logged minutes, billable or not. */
export const totalMinutes = (entries: readonly TimeEntryLike[]): number => sum(entries.map((e) => e.minutes));

/** Billable minutes, prepaid or not: what a report calls billable and a task's line shows as its hours. */
export const billableMinutes = (entries: readonly TimeEntryLike[]): number =>
  sum(entries.filter((e) => e.billable).map((e) => e.minutes));

/**
 * The minutes an invoice takes from entries: billable, less what prepaid
 * hours covered (an entry of 90 minutes with 60 prepaid is 30 to invoice), and
 * with `onlyUnbilled` just those no draft line has taken yet, so nothing is
 * billed twice.
 */
export function invoiceableMinutes(
  entries: readonly TimeEntryLike[],
  options: { onlyUnbilled?: boolean } = {},
): number {
  return sum(
    entries
      .filter((e) => e.billable && (!options.onlyUnbilled || !e.invoiceLineId))
      .map((e) => Math.max(0, e.minutes - (e.prepaidMinutes ?? 0))),
  );
}

// --- Finding entries again ---------------------------------------------------

/** The filter's value for entries logged on the assignment itself, not on a task. */
export const NO_TASK_FILTER = "__none__";

/**
 * Which entries match a task filter and a search. Search looks at the task's
 * title and the comment, case-insensitively: the two things a person
 * remembers about an entry ("the meeting", "that bug"). The filter is exact:
 * one task, or the entries with no task at all. A null filter and a blank
 * query are "everything".
 */
export function filterTimeEntries<T extends { taskId: string | null; taskTitle: string | null; note: string | null }>(
  entries: readonly T[],
  args: { taskId: string | null; query: string },
): T[] {
  const q = args.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (args.taskId === NO_TASK_FILTER && e.taskId) return false;
    if (args.taskId && args.taskId !== NO_TASK_FILTER && e.taskId !== args.taskId) return false;
    if (!q) return true;
    return (e.taskTitle ?? "").toLowerCase().includes(q) || (e.note ?? "").toLowerCase().includes(q);
  });
}
