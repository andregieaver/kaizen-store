/**
 * What a stay or rental costs (D70), worked out without a database: each
 * night's or day's price, changed by the seasons it falls in, plus a fee
 * once per booking. Prices are VAT-inclusive minor units, as everywhere.
 */
import type { RangeKind, RentalPeriod } from "./booking-ranges";
import { addDays } from "./booking-slots";
import { minorUnitDigits } from "./money";

export type Season = {
  name: string;
  /** `MM-DD`, every year; both null for all year. The span crosses the new year when `toDay` comes first. */
  fromDay: string | null;
  toDay: string | null;
  /** 1 Monday … 7 Sunday. */
  weekdays: number[];
  /** −90 to +500. */
  percent: number;
};

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** Whether a season covers a date (`YYYY-MM-DD`): its days of the year and its weekdays. */
export function seasonCovers(season: Season, date: string): boolean {
  const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  if (!season.weekdays.includes(weekday)) return false;
  if (!season.fromDay || !season.toDay) return true;
  const day = date.slice(5);
  return season.fromDay <= season.toDay
    ? day >= season.fromDay && day <= season.toDay
    : day >= season.fromDay || day <= season.toDay;
}

/** A date's price from the base: each covering season's percentage, one on top of another, rounded to whole units. */
export function datePrice(baseMinor: number, date: string, seasons: Season[], minorPerUnit = 100): number {
  const factor = seasons.filter((s) => seasonCovers(s, date)).reduce((f, s) => f * (1 + s.percent / 100), 1);
  if (factor === 1) return baseMinor;
  return Math.max(0, Math.round((baseMinor * factor) / minorPerUnit) * minorPerUnit);
}

/** A price with one season's percentage, in whole units: what the season's nights cost alone. */
export function seasonPrice(baseMinor: number, percent: number, currency: string): number {
  const unit = 10 ** minorUnitDigits(currency);
  return Math.max(0, Math.round((baseMinor * (1 + percent / 100)) / unit) * unit);
}

/** The dates a booking is priced by: a stay's nights, a rental's days, or the one date of a half day or hours. */
export function pricedDates(kind: RangeKind, period: RentalPeriod, startDate: string, count: number): string[] {
  if (kind === "rental" && period !== "day") return [startDate];
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(startDate, i));
}

export type BookingPrice = {
  /** The nights, days, half day or hours. */
  itemsMinor: number;
  feeMinor: number;
  totalMinor: number;
  /** Whether any season changed a date's price. */
  seasonal: boolean;
};

/**
 * A booking's price: each priced date at its season's price (hours count
 * each hour at the date's price), plus the fee.
 */
export function bookingPrice(
  {
    kind,
    period,
    startDate,
    count,
    baseMinor,
    seasons,
    feeMinor,
  }: {
    kind: RangeKind;
    period: RentalPeriod;
    startDate: string;
    count: number;
    baseMinor: number;
    seasons: Season[];
    feeMinor: number;
  },
  minorPerUnit = 100,
): BookingPrice {
  const dates = pricedDates(kind, period, startDate, count);
  const each = dates.map((date) => datePrice(baseMinor, date, seasons, minorPerUnit));
  const perDate = kind === "rental" && period === "hour" ? count : 1;
  const itemsMinor = each.reduce((sum, amount) => sum + amount * perDate, 0);
  return {
    itemsMinor,
    feeMinor,
    totalMinor: itemsMinor + feeMinor,
    seasonal: each.some((amount) => amount !== baseMinor),
  };
}

/** A market's fee from the stored `{ "NO": 50000 }`, or 0. */
export function feeFor(fees: unknown, marketCode: string): number {
  const value = fees && typeof fees === "object" ? (fees as Record<string, unknown>)[marketCode] : undefined;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/** Seasons as stored, read back. */
export function parseSeason(row: Record<string, unknown>): Season {
  return {
    name: String(row.name ?? ""),
    fromDay: row.from_day ? String(row.from_day) : null,
    toDay: row.to_day ? String(row.to_day) : null,
    weekdays: Array.isArray(row.weekdays) ? row.weekdays.map(Number) : ALL_WEEKDAYS,
    percent: Number(row.percent ?? 0),
  };
}
