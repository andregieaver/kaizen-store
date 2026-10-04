/**
 * Return periods and deadlines for the OSS and IOSS reports (D161, `docs/wave-1c-reports.md` 4.4). Pure: nothing reads the clock,
 * callers pass `today` (a store day, `YYYY-MM-DD`).
 *
 * NOTHING HERE IS LEGAL OR TAX ADVICE; needs review by an accountant. Sources, read 2026-10-04:
 * - European Commission, One Stop Shop Guidelines (30 July 2021), Part 2: the tax period of the non-Union and the Union scheme is the
 *   calendar quarter and of the import scheme the calendar month; the return and the payment are due by the end of the month after the
 *   period (30 April, 31 July, 31 October, 31 January for the quarters); the deadline does not move for weekends or holidays; a return
 *   cannot be submitted before the period ends.
 */
import { addDays, addMonths, isDay } from "./analytics-period";

export type TaxPeriodKind = "quarter" | "month";

export type TaxPeriod = {
  kind: TaxPeriodKind;
  /** `2026-Q3` or `2026-09`. */
  key: string;
  /** First day, `YYYY-MM-DD`. */
  from: string;
  /** The day after the last one (exclusive). */
  to: string;
  /** The last day of the period (the day before `to`): the day whose ECB rate the return uses. */
  lastDay: string;
  year: number;
  /** 1 to 4 for a quarter, 1 to 12 for a month. */
  index: number;
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function quarterPeriod(year: number, quarter: number): TaxPeriod {
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new RangeError(`Not a quarter: ${year} Q${quarter}`);
  }
  const from = `${pad(year, 4)}-${pad((quarter - 1) * 3 + 1)}-01`;
  const to = addMonths(from, 3);
  return { kind: "quarter", key: `${year}-Q${quarter}`, from, to, lastDay: addDays(to, -1), year, index: quarter };
}

export function monthPeriod(year: number, month: number): TaxPeriod {
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Not a month: ${year}-${month}`);
  }
  const from = `${pad(year, 4)}-${pad(month)}-01`;
  const to = addMonths(from, 1);
  return { kind: "month", key: `${pad(year, 4)}-${pad(month)}`, from, to, lastDay: addDays(to, -1), year, index: month };
}

/** `2026-Q3` as a period, or null when it is not one. */
export function parseQuarterKey(key: unknown): TaxPeriod | null {
  const m = typeof key === "string" ? /^(\d{4})-Q([1-4])$/.exec(key.trim().toUpperCase()) : null;
  return m ? quarterPeriod(Number(m[1]), Number(m[2])) : null;
}

/** `2026-09` as a period, or null when it is not one. */
export function parseMonthKey(key: unknown): TaxPeriod | null {
  const m = typeof key === "string" ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key.trim()) : null;
  return m ? monthPeriod(Number(m[1]), Number(m[2])) : null;
}

/** The quarter a day falls in. */
export function quarterOfDay(day: string): TaxPeriod {
  if (!isDay(day)) throw new RangeError(`Not a day: ${day}`);
  return quarterPeriod(Number(day.slice(0, 4)), Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1);
}

/** The month a day falls in. */
export function monthOfDay(day: string): TaxPeriod {
  if (!isDay(day)) throw new RangeError(`Not a day: ${day}`);
  return monthPeriod(Number(day.slice(0, 4)), Number(day.slice(5, 7)));
}

/** The period of the same kind before or after this one. */
export function shiftPeriod(period: TaxPeriod, n: number): TaxPeriod {
  const start = addMonths(period.from, (period.kind === "quarter" ? 3 : 1) * n);
  return period.kind === "quarter" ? quarterOfDay(start) : monthOfDay(start);
}

/** The last quarter that has ended by `today` (the day it ends is over only the day after). */
export function lastCompletedQuarter(today: string): TaxPeriod {
  return shiftPeriod(quarterOfDay(today), -1);
}

/** The last month that has ended by `today`. */
export function lastCompletedMonth(today: string): TaxPeriod {
  return shiftPeriod(monthOfDay(today), -1);
}

/** Whether a return for the period cannot be made yet: its last day is not over (the guide: not before the period ends). */
export const isOpenPeriod = (period: TaxPeriod, today: string): boolean => today < period.to;

/** The last day of the month a day falls in. */
function endOfMonth(day: string): string {
  return addDays(addMonths(`${day.slice(0, 7)}-01`, 1), -1);
}

/**
 * The day the return and the payment are due: the end of the month after the period (guide Part 2, read). It does not move for a
 * weekend or a holiday. Q1 30 April, Q2 31 July, Q3 31 October, Q4 31 January; a month the end of the next one.
 */
export function deadlineOf(period: TaxPeriod): string {
  return endOfMonth(addMonths(`${period.lastDay.slice(0, 7)}-01`, 1));
}

export type DeadlineState = "in_progress" | "upcoming" | "due_soon" | "passed";

/** Days before the deadline from which a return is "due soon" (the attention item's window). */
export const DUE_SOON_DAYS = 14;

/** Where a period stands against its deadline on `today`: still open, upcoming, within 14 days of the deadline, or past it. */
export function deadlineState(period: TaxPeriod, today: string): DeadlineState {
  if (isOpenPeriod(period, today)) return "in_progress";
  const deadline = deadlineOf(period);
  if (today > deadline) return "passed";
  return today >= addDays(deadline, -DUE_SOON_DAYS) ? "due_soon" : "upcoming";
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `31 October 2026`. */
export function longDate(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTH_NAMES[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}

/** The period in words: `Q3 2026` or `September 2026`. */
export const periodLabel = (period: TaxPeriod): string =>
  period.kind === "quarter" ? `Q${period.index} ${period.year}` : `${MONTH_NAMES[period.index - 1]} ${period.year}`;

/** The sentence under a return: when it is due, and that this is not a statement of what was filed. Needs review by an accountant. */
export function deadlineSentence(period: TaxPeriod, today: string): string {
  const label = periodLabel(period);
  const due = longDate(deadlineOf(period));
  switch (deadlineState(period, today)) {
    case "in_progress":
      return `${label} is still in progress: a return cannot be submitted before the period ends. It is then due by ${due}.`;
    case "passed":
      return `${label}: submit and pay by ${due}. That day has passed; Kaizen does not know what was filed.`;
    default:
      return `${label}: submit and pay by ${due}.`;
  }
}

/** A custom range of the VAT view as a key: `2026-09-01..2026-09-30` (both ends inclusive). */
export const rangeKey = (from: string, toExclusive: string): string => `${from}..${addDays(toExclusive, -1)}`;

/** The key of a period for the export log: a quarter or month key, or a range. */
export const periodKeyOf = (period: TaxPeriod): string => period.key;
