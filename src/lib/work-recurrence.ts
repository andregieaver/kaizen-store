import { addCalendarDays, addMonthsClamped, daysBetween, type Day, isDay, startOfMonth } from "./work-dates";

/**
 * Recurring invoices (docs/work.md 1.6, 4.2, 7.2 WP8): when a template's
 * periods fall, which of them still need a draft, and which drafts to issue
 * without anyone asking. Pure, so the five-minute job, "Generate now" and the
 * client page all decide the same way; the server only carries the plan out.
 *
 * Ported from Life's `recurring-expense-schedule.ts` (the schedule, unchanged
 * in behaviour), `recurring-invoice-generate.ts` and `recurring-invoice-autosend.ts`.
 * Dates are calendar days in the store's time zone (`work-dates.ts`), not the
 * UTC `Date` objects Life passed around. What Store changes: templates have
 * an end date, a period the owner deleted is skipped for good instead of being
 * regenerated (and sent) by the next run, and issuing is per template
 * (`autoIssue`, off by default), where Life sent every active template.
 */

export const RECURRENCE_PERIODS = ["week", "month", "year"] as const;
export type RecurrencePeriod = (typeof RECURRENCE_PERIODS)[number];
export const RECURRENCE_INTERVALS = [1, 2, 3, 4] as const;
export type RecurrenceInterval = (typeof RECURRENCE_INTERVALS)[number];

export type RecurrenceRule = {
  interval: RecurrenceInterval;
  period: RecurrencePeriod;
  /** The first occurrence; every other is counted from it, so nothing drifts. */
  startDate: Day;
};

/** Life's caps on how many occurrences are counted from the start, so a bad rule cannot loop for long. */
const MAX_MONTH_STEPS = 240;
const MAX_YEAR_STEPS = 40;

/**
 * The days a rule falls on within `[from, to]`, both inclusive, in order.
 *
 *  - week: the start plus a whole number of `7 * interval` days;
 *  - month: every `interval` months, keeping the start's day of the month and
 *    clamping to the month's last day (31 Jan, 28 Feb, 31 Mar; 29 Feb only in
 *    leap years), always counted from the start so a clamp does not carry on;
 *  - year: by the same rule, `interval` years apart (a 29 Feb start is 28 Feb
 *    in the years between leap years).
 *
 * At most 240 monthly and 40 yearly steps are counted from the start. An
 * invalid start date gives nothing.
 */
export function listOccurrenceDates(rule: RecurrenceRule, from: Day, to: Day): Day[] {
  if (!isDay(rule.startDate) || !isDay(from) || !isDay(to)) return [];
  const out: Day[] = [];
  const start = rule.startDate;
  if (rule.period === "week") {
    const step = 7 * rule.interval;
    const skipped = from > start ? Math.ceil(daysBetween(start, from) / step) : 0;
    for (let day = addCalendarDays(start, skipped * step); day <= to; day = addCalendarDays(day, step)) {
      if (day >= from) out.push(day);
    }
    return out;
  }
  const steps = rule.period === "month" ? MAX_MONTH_STEPS : MAX_YEAR_STEPS;
  const monthsPerStep = rule.period === "month" ? rule.interval : rule.interval * 12;
  for (let k = 0; k < steps; k += 1) {
    const day = addMonthsClamped(start, k * monthsPerStep);
    if (day > to) break;
    if (day >= from) out.push(day);
  }
  return out;
}

/** Whether a day is one of a rule's occurrences. */
export const isOccurrenceDay = (rule: RecurrenceRule, day: Day): boolean =>
  listOccurrenceDates(rule, day, day).length > 0;

/** How many months back the schedule is looked at (Life: 24 months before the current month). */
export const WINDOW_MONTHS_BACK = 24;

/** The range every plan looks at: from the first of the month 24 months ago, to today. */
export function recurrenceWindow(today: Day): { from: Day; to: Day } {
  return { from: startOfMonth(addMonthsClamped(startOfMonth(today), -WINDOW_MONTHS_BACK)), to: today };
}

/**
 * A period is only generated while it is at most this many days old, so a
 * template made long ago, or a job that was down for a while, does not bill
 * months at once (Life's `GENERATE_LOOKBACK_DAYS`).
 */
export const GENERATE_LOOKBACK_DAYS = 40;

export type RecurringTemplate = {
  id: string;
  isActive: boolean;
  /** Issue and email the invoice by itself. Off unless the owner switches it on (open question 2). */
  autoIssue: boolean;
  rule: RecurrenceRule;
  /** The last day a period may fall on; null for no end. */
  endDate: Day | null;
  /** Periods the owner deleted: never generated again. */
  skippedPeriods: readonly Day[];
};

/** An invoice that already exists for a template's period (`work_invoices.recurring_period`). */
export type ExistingInstance = {
  templateId: string;
  period: Day;
  status: "draft" | "sent" | "paid" | "void";
  invoiceId: string;
};

export type RecurringPlan = {
  /** Periods with no invoice yet, to make as drafts; `issueAfter` when the template issues by itself. */
  generate: { templateId: string; period: Day; issueAfter: boolean }[];
  /** Existing drafts to issue, whatever their age (Life's rule): only of templates with `autoIssue`. */
  issue: { templateId: string; period: Day; invoiceId: string }[];
  /**
   * The day to put on an issued invoice: today, never the period's own day, so
   * dates never go backwards with the numbers (4.4). The period itself is the
   * invoice's `recurring_period` and its `service_from`.
   */
  issueOn: Day;
};

/** The template's occurrences that are due: in the window, up to today and its end date, and not skipped. */
export function duePeriods(template: RecurringTemplate, today: Day): Day[] {
  const window = recurrenceWindow(today);
  const to = template.endDate && template.endDate < today ? template.endDate : today;
  const skipped = new Set(template.skippedPeriods);
  return listOccurrenceDates(template.rule, window.from, to).filter((d) => !skipped.has(d));
}

/**
 * What the recurring job does today, for every active template:
 *
 *  - a due period with no invoice is generated as a draft if it is within 40
 *    days (older ones are left alone, and shown to the owner instead);
 *  - a period whose invoice exists in any status is never generated again,
 *    and a period the owner skipped never is either;
 *  - on a template with `autoIssue`, each new draft is issued after it is
 *    made, and so is any existing draft of a due period.
 *
 * Idempotent: run again with the result applied and the plan is empty.
 */
export function planRecurring(args: {
  templates: readonly RecurringTemplate[];
  existing: readonly ExistingInstance[];
  today: Day;
}): RecurringPlan {
  const plan: RecurringPlan = { generate: [], issue: [], issueOn: args.today };
  const cutoff = addCalendarDays(args.today, -GENERATE_LOOKBACK_DAYS);
  const byKey = new Map(args.existing.map((e) => [`${e.templateId}:${e.period}`, e]));
  for (const template of args.templates) {
    if (!template.isActive) continue;
    for (const period of duePeriods(template, args.today)) {
      const instance = byKey.get(`${template.id}:${period}`);
      if (instance) {
        if (instance.status === "draft" && template.autoIssue) {
          plan.issue.push({ templateId: template.id, period, invoiceId: instance.invoiceId });
        }
      } else if (period >= cutoff) {
        plan.generate.push({ templateId: template.id, period, issueAfter: template.autoIssue });
      }
    }
  }
  return plan;
}

/**
 * The due periods with no invoice, or only a draft, oldest first: what
 * "Generate now" and "Issue now" on a template can act on. Unlike the job it
 * looks the whole window back, because the owner is asking for it.
 */
export function openPeriods(
  template: RecurringTemplate,
  existing: readonly ExistingInstance[],
  today: Day,
): { period: Day; invoiceId: string | null }[] {
  const byPeriod = new Map(existing.filter((e) => e.templateId === template.id).map((e) => [e.period, e]));
  const out: { period: Day; invoiceId: string | null }[] = [];
  for (const period of duePeriods(template, today)) {
    const instance = byPeriod.get(period);
    if (!instance) out.push({ period, invoiceId: null });
    else if (instance.status === "draft") out.push({ period, invoiceId: instance.invoiceId });
  }
  return out;
}

/** The next `count` occurrences after a day (up to the template's end), for showing "next: 30 Nov". */
export function nextOccurrences(rule: RecurrenceRule, after: Day, count: number, endDate: Day | null = null): Day[] {
  // Four years is the longest step a rule can take, so this always reaches the next one.
  const horizon = addCalendarDays(after, 366 * 4 * Math.max(1, count));
  const to = endDate && endDate < horizon ? endDate : horizon;
  return listOccurrenceDates(rule, addCalendarDays(after, 1), to).slice(0, count);
}

/** Skipping a period: the list with it added once, in order. */
export function withSkippedPeriod(skipped: readonly Day[], period: Day): Day[] {
  return [...new Set([...skipped, period])].sort();
}
