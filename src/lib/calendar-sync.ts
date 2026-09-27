/**
 * Calendar sync for rooms, homes and rental items (D67, B3b), worked out
 * without a database: reading the iCal files Airbnb, Booking.com and the
 * like publish, turning their events into blocked times, and writing a
 * room's own bookings as a file they can read. Both directions use whole
 * days, as those sites do: an event from the 1st to the 4th is the nights
 * of the 1st, 2nd and 3rd.
 */
import { addDays, zonedDate, zonedTime } from "./booking-slots";
import { foldLine, icsText, icsTime } from "./ics";

/** An event read from a calendar: whole days (`date`) or instants (`time`, in ms). */
export type FeedEvent = {
  uid: string;
  start: { date: string } | { time: number };
  end: { date: string } | { time: number };
  summary: string;
};

/** How many events one feed may bring, and how many characters it may be. */
export const MAX_FEED_EVENTS = 2000;
export const MAX_FEED_SIZE = 2_000_000;

/** The file's lines, with folded ones joined back (RFC 5545, 3.1). */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

/** `20261001` or `20261001T150000Z` / `20261001T150000` with its parameters, as a date or an instant. */
function readValue(params: string, value: string, fallbackZone: string): { date: string } | { time: number } | null {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) return { date: `${date[1]}-${date[2]}-${date[3]}` };
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!time) return null;
  const [, y, mo, d, h, mi, s, utc] = time;
  if (utc) return { time: Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) };
  // A local time: in the zone it names, if this runtime knows it, else the store's.
  const named = /(?:^|;)TZID=("?)([^";:]+)\1/i.exec(params)?.[2];
  const zone = named && validZone(named) ? named : fallbackZone;
  return { time: zonedTime(`${y}-${mo}-${d}`, `${h}:${mi}`, zone) + Number(s) * 1000 };
}

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** `P3D`, `PT2H`, `P1DT12H`: a duration's length in ms, or null. */
function durationMs(value: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return null;
  const [, w, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

const unescape = (text: string) => text.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/**
 * The events of an iCal file that take time: cancelled ones and ones
 * without a start are left out; one without an end lasts its day (a date)
 * or its duration.
 */
export function parseFeed(text: string, timeZone: string): FeedEvent[] {
  const events: FeedEvent[] = [];
  let current: Record<string, { params: string; value: string }> | null = null;
  for (const line of unfold(text.slice(0, MAX_FEED_SIZE))) {
    if (/^BEGIN:VEVENT$/i.test(line.trim())) {
      current = {};
      continue;
    }
    if (/^END:VEVENT$/i.test(line.trim())) {
      const event = current && toEvent(current, timeZone);
      if (event) events.push(event);
      current = null;
      if (events.length >= MAX_FEED_EVENTS) break;
      continue;
    }
    if (!current) continue;
    const m = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (m) current[m[1].toUpperCase()] = { params: m[2].slice(1), value: m[3].trim() };
  }
  return events;
}

function toEvent(props: Record<string, { params: string; value: string }>, timeZone: string): FeedEvent | null {
  if (props.STATUS?.value.toUpperCase() === "CANCELLED" || !props.DTSTART) return null;
  const start = readValue(props.DTSTART.params, props.DTSTART.value, timeZone);
  if (!start) return null;
  let end = props.DTEND ? readValue(props.DTEND.params, props.DTEND.value, timeZone) : null;
  if (!end) {
    const length = props.DURATION ? durationMs(props.DURATION.value) : null;
    if ("date" in start) end = { date: addDays(start.date, Math.max(1, Math.round((length ?? 86_400_000) / 86_400_000))) };
    else if (length) end = { time: start.time + length };
    else return null;
  }
  // Both ends the same kind: a date with a time is read as whole days.
  if ("date" in start && "time" in end) end = { date: addDays(zonedDate(end.time, timeZone), 1) };
  if ("time" in start && "date" in end) end = { time: zonedTime(end.date, "00:00", timeZone) };
  const summary = unescape(props.SUMMARY?.value ?? "").slice(0, 200);
  const uid =
    props.UID?.value.slice(0, 300) ||
    `${"date" in start ? start.date : start.time}-${"date" in end ? end.date : end.time}`;
  return { uid, start, end, summary };
}

/**
 * The instants an imported event closes a resource for. Whole days close a
 * room from noon to noon, so a guest leaving that morning or arriving that
 * afternoon still fits, and an item or a person from midnight to midnight.
 */
export function blockSpan(event: FeedEvent, kind: "unit" | "item" | "staff", timeZone: string): { startsAt: number; endsAt: number } | null {
  const at = kind === "unit" ? "12:00" : "00:00";
  const from = "date" in event.start ? zonedTime(event.start.date, at, timeZone) : event.start.time;
  const to = "date" in event.end ? zonedTime(event.end.date, at, timeZone) : event.end.time;
  return to > from ? { startsAt: from, endsAt: to } : null;
}

/** A block set by the store: the nights (a room) or days (anything else) from one date to another, both included. */
export function manualBlockSpan(kind: "unit" | "item" | "staff", from: string, to: string, timeZone: string) {
  const at = kind === "unit" ? "12:00" : "00:00";
  return { startsAt: zonedTime(from, at, timeZone), endsAt: zonedTime(addDays(to, 1), at, timeZone) };
}

/**
 * The whole days a time takes, as a calendar file writes them: from its
 * first day to the day after its last. A room's stay or block ends on the
 * day of check-out (not a night); anything else on the day it ends.
 */
export function exportDates(kind: "unit" | "item" | "staff", startsAt: number, endsAt: number, timeZone: string) {
  const start = zonedDate(startsAt, timeZone);
  const end = kind === "unit" ? zonedDate(endsAt, timeZone) : addDays(zonedDate(endsAt - 1, timeZone), 1);
  return { start, end: end > start ? end : addDays(start, 1) };
}

/**
 * A taken time in a calendar file: whole days (`start`, `end` as dates), or,
 * for an item rented by the half day or hour (D69), its times (`timed`,
 * `start` and `end` as moments), so other calendars see the rest of the day
 * as free.
 */
export type ExportEvent = { uid: string; start: string; end: string; summary: string; timed?: boolean };

/** A room's or item's taken days (and hours) as a calendar file other sites can read. */
export function exportFile(name: string, events: ExportEvent[], stamp = new Date().toISOString()): string {
  const day = (date: string) => date.replace(/-/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kaizen//Calendar sync//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`,
    ...events.flatMap((event) => [
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${icsTime(stamp)}`,
      ...(event.timed
        ? [`DTSTART:${icsTime(event.start)}`, `DTEND:${icsTime(event.end)}`]
        : [`DTSTART;VALUE=DATE:${day(event.start)}`, `DTEND;VALUE=DATE:${day(event.end)}`]),
      `SUMMARY:${icsText(event.summary)}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Whether an address may be read as a feed: https, and not a private or local host. */
export function feedUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Paste the calendar's full address, starting with https://.";
  }
  if (parsed.protocol !== "https:") return "The address must start with https://.";
  if (parsed.username || parsed.password) return "The address must not hold a user name or password.";
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host.includes(".") ||
    /\.(local|localhost|internal|lan|home|arpa)$/.test(host) ||
    /^[\d.]+$/.test(host) ||
    host.includes(":")
  ) {
    return "Use the calendar's web address, not a local one.";
  }
  if (parsed.port && parsed.port !== "443") return "Use the calendar's usual https address.";
  return null;
}
