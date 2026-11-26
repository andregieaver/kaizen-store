/**
 * What a checklist's views add up (D903 P4.8, Life's `lib/checklists/cost.ts` and `countdown.ts`): a list's costs and how long is left
 * until it is due. Pure, so the page and its tests decide the same.
 */

import { zonedTime } from "./booking-slots";
import { addCalendarDays, dayIn } from "./work-dates";

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
