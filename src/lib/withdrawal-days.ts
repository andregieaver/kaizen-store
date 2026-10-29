import { addCalendarDays } from "./work-dates";

/**
 * When the last day of the withdrawal period falls on a day the law moves it off (D407 step 5, `docs/legal/check-2026-10-29.md`). Pure: days
 * are the store's calendar days as `YYYY-MM-DD`.
 *
 * - In the EU, Regulation (EEC, Euratom) No 1182/71 Art. 3(4) applies to the Consumer Rights Directive's period (recital 41): a last day that is
 *   a public holiday, a Sunday or a Saturday moves to the next working day.
 * - Denmark (forbrugeraftaleloven § 19 stk. 6): a helligdag, a Saturday, Constitution Day (5 June), Christmas Eve or New Year's Eve moves it to
 *   the next weekday. The helligdage are Sundays and those of the Danish calendar (Store Bededag was abolished from 2024).
 * - Sweden (lag (1930:173) 2 §): a Sunday or other helgdag, a Saturday, Midsummer Eve, Christmas Eve or New Year's Eve moves it to the next
 *   vardag. The helgdagar are those of lag (1989:253) om allmänna helgdagar.
 * - Another EU country: Saturdays and Sundays only, as its own holidays are not read yet (they would move the day further, never back).
 * - Norway and any country outside the EU: unchanged, as no Norwegian rule was read (the period never ends earlier than day 14 either way).
 *
 * Nothing here is legal advice: the lists need review before real use.
 */

const EU = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"]);

/** Easter Sunday of a year in the Gregorian calendar (the anonymous Gregorian algorithm), as `YYYY-MM-DD`. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 0 for Sunday … 6 for Saturday. */
const weekday = (day: string): number => new Date(`${day}T12:00:00Z`).getUTCDay();

/** The day of the given weekday (0 Sunday … 6 Saturday) that falls on or after `from`. */
function weekdayFrom(from: string, wanted: number): string {
  return addCalendarDays(from, (wanted - weekday(from) + 7) % 7);
}

/** The days other than Saturdays and Sundays that move the last day in a country's year, or an empty set where none are read. */
export function closedDays(country: string, year: number): Set<string> {
  const easter = easterSunday(year);
  const at = (offset: number) => addCalendarDays(easter, offset);
  const date = (md: string) => `${year}-${md}`;
  if (country === "DK") {
    return new Set([date("01-01"), at(-3), at(-2), easter, at(1), at(39), at(49), at(50), date("06-05"), date("12-24"), date("12-25"), date("12-26"), date("12-31")]);
  }
  if (country === "SE") {
    // Midsummer Eve is the Friday between 19 and 25 June; Midsummer Day and All Saints' Day are Saturdays, already closed.
    return new Set([date("01-01"), date("01-06"), at(-2), easter, at(1), date("05-01"), at(39), at(49), date("06-06"), weekdayFrom(date("06-19"), 5), date("12-24"), date("12-25"), date("12-26"), date("12-31")]);
  }
  return new Set();
}

/** Whether the law of `country` moves a last day off `day`. */
export function movesOff(day: string, country: string | null | undefined): boolean {
  const code = (country ?? "").slice(0, 2).toUpperCase();
  if (!EU.has(code)) return false;
  const w = weekday(day);
  if (w === 0 || w === 6) return true;
  return closedDays(code, Number(day.slice(0, 4))).has(day);
}

/** The last day of a period that would end on `day`, moved to the next working day where the country's law says so. */
export function lastWorkingDay(day: string, country: string | null | undefined): string {
  let last = day;
  // A run of closed days is at most a few days long (Easter, Christmas); the bound only guards a mistake in a list.
  for (let i = 0; i < 10 && movesOff(last, country); i++) last = addCalendarDays(last, 1);
  return last;
}
