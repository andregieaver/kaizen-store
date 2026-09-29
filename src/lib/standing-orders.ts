import { addDays, zonedDate, zonedTime } from "./booking-slots";

/**
 * Weekly deliveries (D102): a store delivers on one day of the week, and
 * each shopper's standing list becomes that delivery's order at the cutoff,
 * a number of days before at a time in the store's time zone. Changes made
 * before a cutoff go into that delivery; later ones into the next.
 */

export type DeliverySchedule = {
  /** ISO weekday: 1 Monday … 7 Sunday. */
  deliveryWeekday: number;
  /** Days before the delivery day, 1–7. */
  cutoffDays: number;
  /** HH:MM, in the store's time zone. */
  cutoffTime: string;
};

export type DeliveryRound = {
  /** The delivery day, YYYY-MM-DD in the store's time zone. */
  date: string;
  /** The cutoff, ms since 1970. */
  cutoffAt: number;
};

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** The ISO weekday of a date: 1 Monday … 7 Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** When the list for a delivery day becomes its order. */
export function cutoffFor(schedule: DeliverySchedule, date: string, timeZone: string): number {
  return zonedTime(addDays(date, -schedule.cutoffDays), schedule.cutoffTime, timeZone);
}

/** The next delivery whose cutoff has not passed: where a change made now goes. */
export function nextRound(schedule: DeliverySchedule, now: number, timeZone: string): DeliveryRound {
  const today = zonedDate(now, timeZone);
  let date = addDays(today, (schedule.deliveryWeekday - isoWeekday(today) + 7) % 7);
  for (;;) {
    const cutoffAt = cutoffFor(schedule, date, timeZone);
    if (cutoffAt > now) return { date, cutoffAt };
    date = addDays(date, 7);
  }
}

/**
 * The delivery whose cutoff has passed but whose day has not: the one
 * being packed now, which lists become orders for. Null between a delivery
 * day and the next cutoff.
 */
export function currentRound(schedule: DeliverySchedule, now: number, timeZone: string): DeliveryRound | null {
  const next = nextRound(schedule, now, timeZone);
  const date = addDays(next.date, -7);
  if (date < zonedDate(now, timeZone)) return null;
  return { date, cutoffAt: cutoffFor(schedule, date, timeZone) };
}

/** The next `count` delivery days whose cutoffs have not passed, for choosing ones to skip. */
export function upcomingDates(schedule: DeliverySchedule, now: number, timeZone: string, count: number): string[] {
  const first = nextRound(schedule, now, timeZone).date;
  return Array.from({ length: count }, (_, i) => addDays(first, 7 * i));
}

/** The weekday the cutoff falls on, for the admin's choice ("Tuesday, 2 days before"). */
export function cutoffWeekday(schedule: Pick<DeliverySchedule, "deliveryWeekday" | "cutoffDays">): number {
  return ((schedule.deliveryWeekday - schedule.cutoffDays - 1 + 14) % 7) + 1;
}

/** A delivery day as shoppers read it: "Thursday 2 October". */
export function formatDeliveryDate(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** A cutoff as shoppers read it: "Tuesday 30 September, 23:59". */
export function formatCutoff(at: number, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(at));
}

/** A weekday's name in a language (1 Monday … 7 Sunday). */
export function weekdayName(weekday: number, locale: string): string {
  // 2024-01-01 was a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, weekday)));
}

/** The most a list holds: kinds of items, and of each. */
export const LIST_MAX_LINES = 100;
export const LINE_MAX_QUANTITY = 99;

export type StandingStatus = "setup" | "active" | "paused" | "cancelled";
