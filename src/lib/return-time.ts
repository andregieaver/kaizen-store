/**
 * How a withdrawal's date and time are written on the acknowledgement (D153, `docs/returns.md`): the store's calendar
 * and clock, in the shopper's language, with the offset from UTC and the zone's name, so the moment is unambiguous on a
 * durable medium. Pure.
 */

type Instant = Date | string | number;

/** The offset of a time zone at an instant, as `UTC+02:00` (`UTC+00:00` at zero). */
export function utcOffset(instant: Instant, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(instant));
  const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const offset = raw.replace("GMT", "").replace("−", "-");
  return `UTC${offset === "" ? "+00:00" : offset}`;
}

/** `2. oktober 2026 kl. 22:30 (UTC+02:00, Europe/Oslo)`: the declaration's moment in the store's time zone. */
export function formatDeclaration(instant: Instant, locale: string, timeZone: string): string {
  let tag = locale;
  try {
    Intl.DateTimeFormat.supportedLocalesOf(tag);
  } catch {
    tag = "en";
  }
  const when = new Intl.DateTimeFormat(tag, { dateStyle: "long", timeStyle: "short", timeZone }).format(new Date(instant));
  return `${when} (${utcOffset(instant, timeZone)}, ${timeZone})`;
}

/** A store day (`2026-10-16`) written long in the shopper's language, for the dates the acknowledgement promises. */
export function formatStoreDay(day: string, locale: string): string {
  const [year, month, date] = day.split("-").map(Number);
  let tag = locale;
  try {
    Intl.DateTimeFormat.supportedLocalesOf(tag);
  } catch {
    tag = "en";
  }
  return new Intl.DateTimeFormat(tag, { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, date)));
}
