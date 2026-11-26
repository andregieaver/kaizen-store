/**
 * What a checklist's views add up (D903 P4.8, Life's `lib/checklists/cost.ts` and `countdown.ts`): a list's costs and how long is left
 * until it is due. Pure, so the page and its tests decide the same.
 */

import { zonedTime } from "./booking-slots";
import { addCalendarDays, addMonthsClamped, daysBetween, dayIn, type Day } from "./work-dates";

export type CostLine = { currency: string; total: number; done: number; remaining: number; priced: number };

/**
 * A list's costs, one line a currency: every priced task, those done and those still open. A task without a price is unknown, not zero,
 * so it is left out rather than counted as free; a list with no priced task has no line.
 */
export function costSummary(tasks: readonly { cost: { minor: number; currency: string } | null; done: boolean }[]): CostLine[] {
  const lines = new Map<string, CostLine>();
  for (const task of tasks) {
    if (!task.cost) continue;
    const line = lines.get(task.cost.currency) ?? { currency: task.cost.currency, total: 0, done: 0, remaining: 0, priced: 0 };
    line.total += task.cost.minor;
    line.priced += 1;
    if (task.done) line.done += task.cost.minor;
    else line.remaining += task.cost.minor;
    lines.set(task.cost.currency, line);
  }
  return [...lines.values()].sort((a, b) => b.priced - a.priced || a.currency.localeCompare(b.currency));
}

/**
 * The instant a list's countdown runs to: its due time, or for a due day the end of that day in the store's zone (a list due on the 25th is
 * not late at noon on the 25th).
 */
export function dueTarget(dueAt: string, allDay: boolean | null, timeZone: string): number {
  if (!allDay) return Date.parse(dueAt);
  return zonedTime(addCalendarDays(dayIn(dueAt, timeZone), 1), "00:00", timeZone);
}

/** How far a target is, in whole days, hours and minutes (a minute short of the target rounds up), and whether it has passed. */
export function countdown(target: number, now: number): { late: boolean; days: number; hours: number; minutes: number } {
  const minutes = Math.ceil(Math.abs(target - now) / 60_000);
  return { late: now > target, days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}

/** A month as `YYYY-MM`, read from an address or today's; anything else is today's month. */
export const monthOrToday = (month: string | undefined, today: Day): string => (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7));

/** The month `by` months from `month`. */
export const shiftMonth = (month: string, by: number): string => addMonthsClamped(`${month}-01`, by).slice(0, 7);

/** A month's calendar (P4.13): whole weeks, Monday first, from the week of its first day to the week of its last, as day keys. */
export function monthWeeks(month: string): Day[][] {
  const first = `${month}-01`;
  const last = addCalendarDays(shiftMonth(month, 1) + "-01", -1);
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const weeks: Day[][] = [];
  for (let day = addCalendarDays(first, -weekday); day <= last; day = addCalendarDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addCalendarDays(day, i)));
  }
  return weeks;
}

/**
 * Where a task's bar sits on a month's timeline (P4.13), as shares of the month from its first day: from its start (or its due day when it
 * has none) to its due day, cut to the month; none when it does not touch the month.
 */
export function timelineBar(start: Day | null, due: Day, month: string): { left: number; width: number } | null {
  const first = `${month}-01`;
  const days = daysBetween(first, shiftMonth(month, 1) + "-01");
  const from = start && start < due ? start : due;
  const a = Math.max(0, daysBetween(first, from));
  const b = Math.min(days, daysBetween(first, due) + 1);
  if (b <= 0 || a >= days) return null;
  return { left: a / days, width: (b - a) / days };
}
