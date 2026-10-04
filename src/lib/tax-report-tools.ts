/**
 * The periods the AI manager's two tax-report tools accept (D161, `docs/wave-1c-reports.md` 2.2): a named period or two typed days for the
 * VAT table, a quarter or a month key for a return. Pure: the caller passes the store's own `today`. A bad argument is a sentence the model
 * repeats to the owner, never an exception.
 */
import { addDays, addMonths, daysBetween, isDay, MAX_PERIOD_DAYS, startOfMonth } from "./analytics-period";
import { lastCompletedMonth, lastCompletedQuarter, longDate, parseMonthKey, parseQuarterKey, periodLabel, quarterOfDay, type TaxPeriod } from "./tax-periods";

export const VAT_REPORT_PERIODS = ["last_month", "month", "last_quarter", "quarter", "last_year", "year"] as const;
export type VatReportPeriod = (typeof VAT_REPORT_PERIODS)[number];

/** A range of store days, `to` exclusive. */
export type DayRange = { from: string; to: string };

export type RangeChoice = { ok: true; range: DayRange; label: string } | { ok: false; problem: string };

const dayWords = (range: DayRange) => `${longDate(range.from)} to ${longDate(addDays(range.to, -1))}`;

/** The days of a named period (the store's own days), or of two typed days (both included): `from` and `to` together replace the name. */
export function resolveVatRange(input: { period: VatReportPeriod; from?: string; to?: string }, today: string): RangeChoice {
  if (input.from || input.to) {
    if (!input.from || !input.to) return { ok: false, problem: "Give both `from` and `to`, or neither." };
    if (!isDay(input.from) || !isDay(input.to)) return { ok: false, problem: "A day is written 2026-10-01 and must be a real day." };
    if (input.to < input.from) return { ok: false, problem: "`from` is after `to`." };
    const range = { from: input.from, to: addDays(input.to, 1) };
    if (daysBetween(range.from, range.to) > MAX_PERIOD_DAYS) return { ok: false, problem: `A period is at most ${MAX_PERIOD_DAYS} days.` };
    return { ok: true, range, label: dayWords(range) };
  }
  const tomorrow = addDays(today, 1);
  const thisMonth = startOfMonth(today);
  switch (input.period) {
    case "last_month": {
      const range = { from: addMonths(thisMonth, -1), to: thisMonth };
      return { ok: true, range, label: `Last month, ${dayWords(range)}` };
    }
    case "month": {
      const range = { from: thisMonth, to: tomorrow };
      return { ok: true, range, label: `This month so far, ${dayWords(range)}` };
    }
    case "last_quarter": {
      const q = lastCompletedQuarter(today);
      return { ok: true, range: { from: q.from, to: q.to }, label: `${periodLabel(q)}, ${dayWords(q)}` };
    }
    case "quarter": {
      const q = quarterOfDay(today);
      const range = { from: q.from, to: tomorrow };
      return { ok: true, range, label: `${periodLabel(q)} so far, ${dayWords(range)}` };
    }
    case "last_year": {
      const year = Number(today.slice(0, 4)) - 1;
      const range = { from: `${year}-01-01`, to: `${year + 1}-01-01` };
      return { ok: true, range, label: `${year}, ${dayWords(range)}` };
    }
    case "year": {
      const range = { from: `${today.slice(0, 4)}-01-01`, to: tomorrow };
      return { ok: true, range, label: `This year so far, ${dayWords(range)}` };
    }
  }
}

export type ReturnChoice = { ok: true; period: TaxPeriod } | { ok: false; problem: string };

/** The quarter (OSS) or month (IOSS) asked for; none means the last one that has ended. */
export function resolveReturnPeriod(scheme: "oss" | "ioss", key: string | undefined, today: string): ReturnChoice {
  if (!key) return { ok: true, period: scheme === "oss" ? lastCompletedQuarter(today) : lastCompletedMonth(today) };
  const period = scheme === "oss" ? parseQuarterKey(key) : parseMonthKey(key);
  if (!period) return { ok: false, problem: scheme === "oss" ? "An OSS return is for a quarter, written 2026-Q3." : "An IOSS return is for a month, written 2026-09." };
  return { ok: true, period };
}

/** Said under every figure of the tools, so the model repeats it. */
export const NOT_A_RETURN = "These are the store's own figures, made from its invoices and credit notes, for the owner and the owner's accountant. They are not a tax return, Kaizen files nothing, and this is not tax or accounting advice.";
