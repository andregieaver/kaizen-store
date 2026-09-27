import { describe, expect, it } from "vitest";

import { calendarFile, foldLine, icsText, icsTime } from "./ics";

describe("calendar files", () => {
  it("writes an event in UTC with its texts escaped", () => {
    const file = calendarFile(
      [
        {
          uid: "b1@kaizen",
          startsAt: "2026-10-05T07:00:00.000Z",
          endsAt: "2026-10-05T08:00:00.000Z",
          summary: "Massasje, Karis Salong",
          description: "Hos Kari\nOrdre 1001",
          location: "Storgata 1; 0155 Oslo",
          organizer: { name: 'Karis "Salong"', email: "post@salong.no" },
        },
      ],
      { stamp: "2026-09-26T12:00:00.000Z" },
    );
    expect(file.split("\r\n")).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Kaizen//Bookings//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:b1@kaizen",
      "DTSTAMP:20260926T120000Z",
      "DTSTART:20261005T070000Z",
      "DTEND:20261005T080000Z",
      "SEQUENCE:0",
      "STATUS:CONFIRMED",
      "SUMMARY:Massasje\\, Karis Salong",
      "DESCRIPTION:Hos Kari\\nOrdre 1001",
      "LOCATION:Storgata 1\\; 0155 Oslo",
      'ORGANIZER;CN="Karis Salong":mailto:post@salong.no',
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ]);
  });

  it("cancels with the same uid and a higher sequence", () => {
    const file = calendarFile([
      { uid: "b1@kaizen", startsAt: "2026-10-05T07:00:00Z", endsAt: "2026-10-05T08:00:00Z", summary: "Massasje", cancelled: true },
    ]);
    expect(file).toContain("METHOD:CANCEL\r\n");
    expect(file).toContain("STATUS:CANCELLED\r\nSUMMARY");
    expect(file).toContain("SEQUENCE:1\r\n");
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"ø".repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n ");
    expect(parts.join("")).toBe(line);
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(icsTime("2026-10-05T07:00:00Z")).toBe("20261005T070000Z");
    expect(icsText("a\\b")).toBe("a\\\\b");
  });
});
