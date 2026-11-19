import { ADMIN_LANG_FACTS, isAdminLang, type AdminLang } from "./admin-lang";
import { dayIn, isTimeZone, parseDay } from "./work-dates";

/**
 * Dates in the admin (code review 1.14, FS5, D786): one formatter, so a store's evening order falls on the store's own day on every
 * screen, and one order never carries two dates. Pure, for server pages and client parts alike.
 *
 * Two kinds of date, kept apart by name:
 * - an instant (a `timestamptz`: when an order was placed, a page published) is shown in a time zone with `adminDate(zone, at, style,
 *   lang)`: the store's own zone for a store's screens (`store`, or `store.timeZone`), each row's own store on a screen that spans stores
 *   (the control center), and `PLATFORM_TIME_ZONE` for Kaizena Flow's own figures;
 * - a calendar day (a `date` column or a `YYYY-MM-DD` value: a due date, a booking day, a day already worked out in the right zone) is
 *   never shifted by a zone: `adminDay(day, style, lang)`. Handed to `adminDate`, a bare day is shown as that day too, never moved.
 *
 * Never cut a date from a UTC string (`.slice(0, 10)`) or write a zone out in admin code: `admin-dates.scan.test.ts` holds both.
 */

/** Kaizena Flow's own zone (the company is in Norway): the platform admin's figures, platform billing and the morning briefing. */
export const PLATFORM_TIME_ZONE = "Europe/Oslo";

/**
 * Norway's legal time, for features that exist only for Norway and whose days the law or the partner sets in it: the Norwegian VAT
 * return, SAF-T, A-melding, Tripletex, Fiken and Peppol in Norway. A store's own screens use the store's zone, never this.
 */
export const NORWAY_TIME_ZONE = "Europe/Oslo";

/** A moment on the clock: a `timestamptz` read as an ISO string, a `Date`, or milliseconds since the epoch. */
export type Instant = Date | string | number;

/** A day on the calendar with no time and no zone, `YYYY-MM-DD`. */
export type CalendarDay = string;

/** Where an instant is read: an IANA zone name, or anything that carries one (a `Store`, a control center row). */
export type ZoneOf = string | { readonly timeZone?: string | null } | null | undefined;

/**
 * - `day`: 3 Oct 2026 (nb: 3. okt. 2026)
 * - `long`: 3 October 2026
 * - `short`: 3 Oct, without the year (a phone's column)
 * - `dayMonth`: 3 October, without the year
 * - `iso`: 2026-10-03, the day as data (an input's value, a file name, a key)
 */
export type AdminDayStyle = "day" | "long" | "short" | "dayMonth" | "iso";

/** A day's styles, and an instant's own: `dayTime` (3 Oct 2026, 14:05) and `time` (14:05). */
export type AdminDateStyle = AdminDayStyle | "dayTime" | "time";

const OPTIONS: Record<Exclude<AdminDateStyle, "iso">, Intl.DateTimeFormatOptions> = {
  day: { dateStyle: "medium" },
  long: { dateStyle: "long" },
  short: { day: "numeric", month: "short" },
  dayMonth: { day: "numeric", month: "long" },
  dayTime: { dateStyle: "medium", timeStyle: "short" },
  time: { timeStyle: "short" },
};

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

const knownLocales = new Map<string, string>();

/** The admin's locale for a language (`en`, `nb`) or a BCP 47 locale handed as it is; the English admin's when it is not one. */
function localeOf(lang: AdminLang | string): string {
  if (isAdminLang(lang)) return ADMIN_LANG_FACTS[lang].locale;
  let locale = knownLocales.get(lang);
  if (locale === undefined) {
    try {
      locale = Intl.DateTimeFormat.supportedLocalesOf(lang).length > 0 ? lang : ADMIN_LANG_FACTS.en.locale;
    } catch {
      locale = ADMIN_LANG_FACTS.en.locale;
    }
    knownLocales.set(lang, locale);
  }
  return locale;
}

const knownZones = new Map<string, boolean>();

/**
 * The zone to read an instant in: the name given, or the one its holder carries. A store that names none, or one the runtime does not
 * know, has the column's default, the platform's (`commerce.stores.time_zone`), so a page never fails over a zone.
 */
export function zoneOf(where: ZoneOf): string {
  const name = typeof where === "string" ? where : where?.timeZone;
  if (!name) return PLATFORM_TIME_ZONE;
  let known = knownZones.get(name);
  if (known === undefined) {
    known = isTimeZone(name);
    knownZones.set(name, known);
  }
  return known ? name : PLATFORM_TIME_ZONE;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, timeZone: string, style: Exclude<AdminDateStyle, "iso">): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${style}`;
  let made = formats.get(key);
  if (!made) {
    made = new Intl.DateTimeFormat(locale, { ...OPTIONS[style], timeZone });
    formats.set(key, made);
  }
  return made;
}

/** A day's style for a value that has no time: a time style shows the day. */
const dayStyle = (style: AdminDateStyle): AdminDayStyle => (style === "dayTime" || style === "time" ? "day" : style);

/**
 * A calendar day for people, as it is: never moved by a zone, so a due date of 3 October reads 3 October in Oslo and in New York. A value
 * that is not a real day (`2026-02-30`, free text) is returned as it came; nothing gives an empty string.
 */
export function adminDay(day: CalendarDay | null | undefined, style: AdminDayStyle, lang: AdminLang | string): string {
  if (!day) return "";
  const parts = BARE_DAY.test(day) ? parseDay(day) : null;
  if (!parts) return day;
  if (style === "iso") return day;
  return formatter(localeOf(lang), "UTC", style).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}

/**
 * An instant for people, in a time zone (`zoneOf(where)`) and the admin's language: an order placed at 23:30 in New York reads on the
 * New York day, whatever the server's clock or UTC say. A bare `YYYY-MM-DD` is a calendar day and is shown by `adminDay()`, never
 * shifted. Nothing gives an empty string; text that is not a moment is returned as it came.
 */
export function adminDate(where: ZoneOf, instant: Instant | null | undefined, style: AdminDateStyle, lang: AdminLang | string): string {
  if (instant === null || instant === undefined || instant === "") return "";
  if (typeof instant === "string" && BARE_DAY.test(instant)) return adminDay(instant, dayStyle(style), lang);
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return typeof instant === "string" ? instant : "";
  const zone = zoneOf(where);
  if (style === "iso") return dayIn(at, zone);
  return formatter(localeOf(lang), zone, style).format(at);
}
