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

/** The most bookings on a unit at any one moment of a span: counted where each one starts, or at the span's start. */
export function peakBusy(busy: Busy[], span: { startsAt: number; endsAt: number }): number {
  const overlapping = busy.filter((b) => b.from < span.endsAt && b.to > span.startsAt);
  const points = [span.startsAt, ...overlapping.map((b) => Math.max(b.from, span.startsAt))];
  return Math.max(0, ...points.map((point) => overlapping.filter((b) => b.from <= point && b.to > point).length));
}

/** The units with room for the whole span: at every moment, fewer bookings than their capacity. */
export function freeUnits(units: RangeUnit[], span: { startsAt: number; endsAt: number }): string[] {
  return units.filter((unit) => peakBusy(unit.busy, span) < unit.capacity).map((unit) => unit.id);
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

/** How a rental's variant is booked (D69): whole days, half days or hours. Stays are always by the night. */
export const RENTAL_PERIODS = ["day", "half_day", "hour"] as const;
export type RentalPeriod = (typeof RENTAL_PERIODS)[number];
export const parseRentalPeriod = (value: unknown): RentalPeriod =>
  RENTAL_PERIODS.find((p) => p === value) ?? "day";

const HOUR = 60 * MINUTE;
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

type Times = Pick<RangeRules, "checkInTime" | "checkOutTime">;

/**
 * A day's two halves between pick-up and return: the morning to the middle
 * (on a quarter hour) and the afternoon from it. None when the day is shorter
 * than an hour.
 */
export function halfDays(date: string, rules: Times, timeZone: string): { startsAt: number; endsAt: number }[] {
  const open = minutesOf(rules.checkInTime);
  const close = minutesOf(rules.checkOutTime);
  if (close - open < 60) return [];
  const middle = open + Math.floor((close - open) / 2 / 15) * 15;
  const at = (minutes: number) => zonedTime(date, timeOf(minutes), timeZone);
  return [
    { startsAt: at(open), endsAt: at(middle) },
    { startsAt: at(middle), endsAt: at(close) },
  ];
}

/** The whole hours from pick-up that an hour's rental can start at, the last an hour before return. */
export function hourStarts(date: string, rules: Times, timeZone: string): number[] {
  const open = minutesOf(rules.checkInTime);
  const close = minutesOf(rules.checkOutTime);
  const starts: number[] = [];
  for (let m = open; m + 60 <= close; m += 60) starts.push(zonedTime(date, timeOf(m), timeZone));
  return starts;
}

/**
 * The instants a rental of `count` periods from `startsAt` takes, or null
 * when that is not a time its variant can be booked: days from pick-up on
 * the first day, one half of a day, or whole hours from pick-up, ending by
 * return time.
 */
export function periodSpan(
  period: RentalPeriod,
  kind: RangeKind,
  startsAt: number,
  count: number,
  rules: Times,
  timeZone: string,
): { startsAt: number; endsAt: number } | null {
  if (!Number.isInteger(count) || count < 1) return null;
  const date = zonedDate(startsAt, timeZone);
  if (kind === "stay" || period === "day") {
    const span = rangeSpan(kind, date, count, rules, timeZone);
    return span.startsAt === startsAt ? { startsAt: span.startsAt, endsAt: span.endsAt } : null;
  }
  if (period === "half_day") {
    return count === 1 ? (halfDays(date, rules, timeZone).find((h) => h.startsAt === startsAt) ?? null) : null;
  }
  if (!hourStarts(date, rules, timeZone).includes(startsAt)) return null;
  const endsAt = startsAt + count * HOUR;
  return endsAt <= zonedTime(date, rules.checkOutTime, timeZone) ? { startsAt, endsAt } : null;
}

/**
 * Whether a booking of `count` periods from `startsAt` keeps to the rules:
 * whole days and nights as `rangeProblem()` says; half days and hours at a
 * time the variant offers, the notice ahead of now, and not beyond how far
 * ahead bookings are taken.
 */
export function periodProblem(
  period: RentalPeriod,
  startsAt: number,
  count: number,
  rules: RangeRules,
  timeZone: string,
  now: number,
): RangeProblem | null {
  const date = zonedDate(startsAt, timeZone);
  if (rules.kind === "stay" || period === "day") {
    const problem = rangeProblem(date, count, rules, timeZone, now);
    if (problem) return problem;
    return periodSpan(period, rules.kind, startsAt, count, rules, timeZone) ? null : "order";
  }
  if (!periodSpan(period, rules.kind, startsAt, count, rules, timeZone)) return "length";
  if (startsAt < now + rules.minNoticeMinutes * MINUTE) return "notice";
  if (date > addDays(zonedDate(now, timeZone), rules.maxDaysAhead)) return "ahead";
  return null;
}

/** The spans a date offers for one period: its night or day, its two halves, or each of its hours. */
function candidates(period: RentalPeriod, date: string, rules: RangeRules, timeZone: string) {
  if (rules.kind === "stay" || period === "day") {
    const span = rangeSpan(rules.kind, date, 1, rules, timeZone);
    return [{ startsAt: span.startsAt, endsAt: span.endsAt }];
  }
  if (period === "half_day") return halfDays(date, rules, timeZone);
  return hourStarts(date, rules, timeZone).map((startsAt) => ({ startsAt, endsAt: startsAt + HOUR }));
}

/**
 * For each date from `from`, whether some unit is free that night (a stay),
 * that day (a rental by the day), or for some half or hour of it: for the
 * calendar, which shows what is taken. Whether a whole booking is free is
 * checked when it is chosen.
 */
export function openDates(
  from: string,
  days: number,
  units: RangeUnit[],
  rules: RangeRules,
  timeZone: string,
  now: number,
  period: RentalPeriod = "day",
): { date: string; open: boolean }[] {
  const last = addDays(zonedDate(now, timeZone), rules.maxDaysAhead);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    const open =
      date <= last &&
      candidates(period, date, rules, timeZone).some(
        (span) => span.startsAt >= now + rules.minNoticeMinutes * MINUTE && freeUnits(units, span).length > 0,
      );
    return { date, open };
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

/** A stay's or rental's end from its start and length: check-out, return, or the end of its half day or hours. */
export function rangeEndsAt(
  kind: RangeKind,
  startsAt: string,
  count: number,
  rules: Pick<RangeRules, "checkInTime" | "checkOutTime">,
  timeZone: string,
  period: RentalPeriod = "day",
): string {
  const start = Date.parse(startsAt);
  const span = periodSpan(period, kind, start, count, rules, timeZone);
  if (span) return new Date(span.endsAt).toISOString();
  // Not a time the variant offers (the cart will say so): its days, as a guess.
  const startDate = zonedDate(start, timeZone);
  return new Date(rangeSpan(kind, startDate, Math.max(1, count), rules, timeZone).endsAt).toISOString();
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

/** An instant's time of day where the store is, as "13:00". */
export function formatClock(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
}
