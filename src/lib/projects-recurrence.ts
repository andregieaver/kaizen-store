/**
 * When a repeating task is due again (D903 P4.1, ported from Kaizen Life's `lib/checklists/recurrence.ts`): the rule kept on an item as
 * `recurrence`, read in the store's zone. Pure, for the editor in the browser and the server alike.
 *
 * The rule keeps Life's shape, so a Kaizen Life account linked later reads it as it is: every day, on chosen weekdays, every so many days
 * counted from the day it was set, or on chosen days of the month every so many months, at one or more times of the day. The 31st is the
 * last day of a shorter month rather than skipped: a rule set for it would otherwise never come in February, and nobody would notice until
 * it had not.
 */

import { zonedTime } from "./booking-slots";
import type { Recurrence } from "./projects-recurrence-schema";
import { addCalendarDays, daysBetween, dayIn, parseDay, type Day } from "./work-dates";

export type { Recurrence };

export const REPEATS = ["daily", "weekly", "interval", "monthly"] as const;
export type Repeat = (typeof REPEATS)[number];

/** The editor's three times of the day; none chosen is any time, kept as nine in the morning. */
export const TIME_WINDOWS = { morning: "08:00", midday: "13:00", evening: "20:00" } as const;
export type TimeWindow = keyof typeof TIME_WINDOWS;
export const TIME_WINDOW_ORDER: readonly TimeWindow[] = ["morning", "midday", "evening"];
export const ANY_TIME = "09:00";

/** Weekdays as `Date#getUTCDay` counts them (0 is Sunday), shown Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** An every-so-many rule counts from the day it is set: one without its day gets today's, in the store's zone. */
export function anchored(rule: Recurrence, now: number, timeZone: string): Recurrence {
  if (rule.anchor || (rule.freq !== "interval" && rule.freq !== "monthly")) return rule;
  return { ...rule, anchor: dayIn(now, timeZone) };
}

const weekdayOf = (day: Day): number => new Date(`${day}T00:00:00Z`).getUTCDay();

function monthsBetween(from: Day, to: Day): number {
  const a = parseDay(from);
  const b = parseDay(to);
  return a && b ? (b.year - a.year) * 12 + (b.month - a.month) : -1;
}

/** Whether the rule comes on a day. */
export function fallsOn(rule: Recurrence, day: Day): boolean {
  switch (rule.freq) {
    case "daily":
      return true;
    case "weekly":
      return (rule.weekdays ?? []).includes(weekdayOf(day));
    case "interval": {
      const diff = daysBetween(rule.anchor ?? day, day);
      return diff >= 0 && diff % (rule.intervalDays ?? 1) === 0;
    }
    case "monthly": {
      const diff = monthsBetween(rule.anchor ?? day, day);
      if (diff < 0 || diff % (rule.intervalMonths ?? 1) !== 0) return false;
      const parts = parseDay(day);
      if (!parts) return false;
      const last = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
      return (rule.monthDays ?? []).some((d) => Math.min(d, last) === parts.day);
    }
  }
}

/** Enough days for the sparest rule there is: one day every 24 months. */
const HORIZON_DAYS = 800;

/** The first time the rule comes strictly after `after` (milliseconds), in the store's zone; null for a rule that never comes. */
export function nextOccurrence(rule: Recurrence, after: number, timeZone: string): Date | null {
  let day = dayIn(after, timeZone);
  for (let i = 0; i < HORIZON_DAYS; i += 1, day = addCalendarDays(day, 1)) {
    if (!fallsOn(rule, day)) continue;
    for (const time of rule.times) {
      const at = zonedTime(day, time, timeZone);
      if (at > after) return new Date(at);
    }
  }
  return null;
}

/** The editor's times of the day as the rule keeps them; none is any time. */
export function windowsToTimes(windows: readonly TimeWindow[]): string[] {
  const picked = TIME_WINDOW_ORDER.filter((w) => windows.includes(w)).map((w) => TIME_WINDOWS[w]);
  return picked.length > 0 ? picked : [ANY_TIME];
}

/** A rule's times as the editor's windows (a time of its own, such as Life's or the AI's, is none of them). */
export function timesToWindows(times: readonly string[]): TimeWindow[] {
  return TIME_WINDOW_ORDER.filter((w) => times.includes(TIME_WINDOWS[w]));
}
