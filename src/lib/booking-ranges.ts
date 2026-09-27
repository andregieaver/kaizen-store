/**
 * Stays and rentals (D67): bookings of whole nights or days of a unit (a
 * room, a home) or an item, worked out without a database. A stay of N
 * nights from a date runs from check-in that day to check-out N days
 * later; a rental of N days runs from pick-up on the first day to return on
 * the last. `commerce.hold_booking` checks the same again under a lock.
 */
import { addDays, zonedDate, zonedTime, type Busy } from "./booking-slots";

export type RangeKind = "stay" | "rental";

export type RangeRules = {
  kind: RangeKind;
  /** Check-in (or pick-up) and check-out (or return), `HH:MM` in the store's time zone. */
  checkInTime: string;
  checkOutTime: string;
  /** Nights for a stay, days for a rental. */
  minNights: number;
  maxNights: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
};

export type RangeUnit = { id: string; capacity: number; busy: Busy[] };

const MINUTE = 60_000;

/** The instants a booking of `count` nights (or days) from a date takes. */
export function rangeSpan(kind: RangeKind, startDate: string, count: number, rules: Pick<RangeRules, "checkInTime" | "checkOutTime">, timeZone: string) {
  const startsAt = zonedTime(startDate, rules.checkInTime, timeZone);
  const endDate = kind === "stay" ? addDays(startDate, count) : addDays(startDate, count - 1);
  const endsAt = zonedTime(endDate, rules.checkOutTime, timeZone);
  return { startsAt, endsAt, endDate };
}

/** The units with room for the whole span: fewer overlapping bookings than their capacity. */
export function freeUnits(units: RangeUnit[], span: { startsAt: number; endsAt: number }): string[] {
  return units
    .filter((unit) => unit.busy.filter((b) => b.from < span.endsAt && b.to > span.startsAt).length < unit.capacity)
    .map((unit) => unit.id);
}

export type RangeProblem = "length" | "notice" | "ahead" | "order";

/**
 * Whether a booking of `count` from a date keeps to the rules: its length,
 * starting at least the notice ahead of now, and not beyond how far ahead
 * bookings are taken.
 */
export function rangeProblem(startDate: string, count: number, rules: RangeRules, timeZone: string, now: number): RangeProblem | null {
  if (!Number.isInteger(count) || count < rules.minNights || count > rules.maxNights) return "length";
  const span = rangeSpan(rules.kind, startDate, count, rules, timeZone);
  if (span.endsAt <= span.startsAt) return "order";
  if (span.startsAt < now + rules.minNoticeMinutes * MINUTE) return "notice";
  if (startDate > addDays(zonedDate(now, timeZone), rules.maxDaysAhead)) return "ahead";
  return null;
}

/**
 * For each date from `from`, whether some unit is free that night (a
 * stay) or day (a rental): for the calendar, which shows what is taken.
 * Whether a whole range is free is checked when it is chosen.
 */
export function openDates(
  from: string,
  days: number,
  units: RangeUnit[],
  rules: RangeRules,
  timeZone: string,
  now: number,
): { date: string; open: boolean }[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    const span = rangeSpan(rules.kind, date, 1, rules, timeZone);
    const tooSoon = span.startsAt < now + rules.minNoticeMinutes * MINUTE;
    const tooFar = date > addDays(zonedDate(now, timeZone), rules.maxDaysAhead);
    return { date, open: !tooSoon && !tooFar && freeUnits(units, span).length > 0 };
  });
}

/** The number of nights between two dates (a stay), or days from the first to the last inclusive (a rental). */
export function rangeCount(kind: RangeKind, startDate: string, endDate: string): number {
  const days = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86_400_000);
  return kind === "stay" ? days : days + 1;
}

/** The nights (a stay: arrival to the night before departure) or days (a rental: first to last) a booking takes. */
export function occupiedDates(kind: RangeKind, startsAt: string, endsAt: string, timeZone: string): string[] {
  const first = zonedDate(Date.parse(startsAt), timeZone);
  const last = zonedDate(Date.parse(endsAt), timeZone);
  const count = Math.max(1, rangeCount(kind, first, last));
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

/** The longest stay or rental a product may allow, in nights or days. */
export const MAX_RANGE_LENGTH = 365;

/** A stay's or rental's dates, as "12.–15. okt. 2026", in the store's time zone. */
export function formatRangeDates(startsAt: string, endsAt: string, locale: string, timeZone: string): string {
  const format = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone });
  return format.formatRange(new Date(startsAt), new Date(endsAt));
}

/** A stay's or rental's end from its check-in instant and length: check-out, or return. */
export function rangeEndsAt(
  kind: RangeKind,
  startsAt: string,
  count: number,
  rules: Pick<RangeRules, "checkInTime" | "checkOutTime">,
  timeZone: string,
): string {
  const startDate = zonedDate(Date.parse(startsAt), timeZone);
  return new Date(rangeSpan(kind, startDate, count, rules, timeZone).endsAt).toISOString();
}

/** Four weeks of dates for the product page's calendar, labelled in the shopper's language. */
export type RangeCalendar = {
  from: string;
  today: string;
  last: string;
  /** Monday first, as short names. */
  weekdays: string[];
  dates: { date: string; open: boolean; day: string; label: string }[];
  /** "October 2026", or "October – November 2026" when the weeks span two months. */
  title: string;
};

export function rangeCalendar(
  month: { from: string; today: string; last: string; dates: { date: string; open: boolean }[] },
  locale: string,
): RangeCalendar {
  const noon = (date: string) => new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const monthYear = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const first = month.dates[0]?.date ?? month.from;
  const last = month.dates.at(-1)?.date ?? month.from;
  return {
    from: month.from,
    today: month.today,
    last: month.last,
    weekdays: Array.from({ length: 7 }, (_, i) => weekday.format(noon(addDays(month.from, i)))),
    dates: month.dates.map((d) => ({ ...d, day: String(Number(d.date.slice(8))), label: long.format(noon(d.date)) })),
    title: monthYear.formatRange(noon(first), noon(last)),
  };
}

/**
 * Whether every night (a stay: arrival to the night before departure) or
 * day (a rental: first to last) between two dates is open, as far as the
 * calendar knows: dates it does not show are checked when chosen.
 */
export function rangeOpen(kind: RangeKind, startDate: string, endDate: string, dates: { date: string; open: boolean }[]): boolean {
  const known = new Map(dates.map((d) => [d.date, d.open]));
  const count = rangeCount(kind, startDate, endDate);
  for (let i = 0; i < count; i++) if (known.get(addDays(startDate, i)) === false) return false;
  return true;
}
