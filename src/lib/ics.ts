/**
 * Calendar files (RFC 5545) for bookings (D65): attached to confirmation
 * and cancellation emails so the time goes into the shopper's and the
 * staff member's calendars. Times are written in UTC, which every calendar
 * shows in its own time zone.
 */

export type CalendarEvent = {
  /** Stays the same for the booking, so a cancellation replaces the event it cancels. */
  uid: string;
  startsAt: string;
  endsAt: string;
  summary: string;
  description?: string;
  location?: string;
  /** Who it is with: the store, which replies go to. */
  organizer?: { name: string; email: string } | null;
  cancelled?: boolean;
  /** Raised each time the event changes (0 when made, 1 when cancelled). */
  sequence?: number;
};

/** `20261005T070000Z`: an instant in UTC, as calendars take it. */
export function icsTime(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Text with the characters calendars treat specially escaped, and line breaks as `\n`. */
export function icsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** A property line folded at 75 octets, continuing lines with a space, never inside a character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // The first line takes 75 octets; each continuation 74 after its leading space.
    if (size + bytes > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** One or more events as a calendar file; `METHOD:CANCEL` when every event is cancelled. */
export function calendarFile(events: CalendarEvent[], { stamp = new Date().toISOString() } = {}): string {
  const cancel = events.length > 0 && events.every((e) => e.cancelled);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kaizen//Bookings//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancel ? "CANCEL" : "PUBLISH"}`,
    ...events.flatMap((event) => [
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${icsTime(stamp)}`,
      `DTSTART:${icsTime(event.startsAt)}`,
      `DTEND:${icsTime(event.endsAt)}`,
      `SEQUENCE:${event.sequence ?? (event.cancelled ? 1 : 0)}`,
      `STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      `SUMMARY:${icsText(event.summary)}`,
      ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
      ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
      ...(event.organizer
        ? [`ORGANIZER;CN="${event.organizer.name.replace(/["\r\n]/g, "")}":mailto:${event.organizer.email}`]
        : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
