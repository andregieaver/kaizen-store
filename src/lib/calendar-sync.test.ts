import { describe, expect, it } from "vitest";

import { blockSpan, exportDates, exportFile, feedUrlProblem, manualBlockSpan, parseFeed } from "./calendar-sync";
import { zonedTime } from "./booking-slots";

const OSLO = "Europe/Oslo";

/** As Airbnb writes it: folded lines, whole days, a reservation and a blocked stretch. */
const AIRBNB = [
  "BEGIN:VCALENDAR",
  "PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.0//EN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261004",
  "DTSTART;VALUE=DATE:20261001",
  "UID:1418fb94e984-0f4a5a7e2ba4bb2b4c3a8fcb1e5bd4f9@airbnb.com",
  "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HM",
  " ABCDEFGH\\nPhone Number (Last 4 Digits): 1234",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261012",
  "DTSTART;VALUE=DATE:20261010",
  "UID:7f2b1c-blocked@airbnb.com",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseFeed", () => {
  it("reads whole-day events, unfolding lines", () => {
    expect(parseFeed(AIRBNB, OSLO)).toEqual([
      {
        uid: "1418fb94e984-0f4a5a7e2ba4bb2b4c3a8fcb1e5bd4f9@airbnb.com",
        start: { date: "2026-10-01" },
        end: { date: "2026-10-04" },
        summary: "Reserved",
      },
      { uid: "7f2b1c-blocked@airbnb.com", start: { date: "2026-10-10" }, end: { date: "2026-10-12" }, summary: "Airbnb (Not available)" },
    ]);
  });

  it("reads times in UTC or a named zone, durations, and leaves out cancelled events", () => {
    const text = [
      "BEGIN:VEVENT",
      "UID:a",
      "DTSTART:20261001T130000Z",
      "DTEND:20261001T150000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:b",
      "DTSTART;TZID=Europe/Stockholm:20261002T090000",
      "DURATION:PT2H",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:c",
      "DTSTART;VALUE=DATE:20261003",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:d",
      "STATUS:CANCELLED",
      "DTSTART;VALUE=DATE:20261003",
      "END:VEVENT",
    ].join("\n");
    const events = parseFeed(text, OSLO);
    expect(events.map((e) => e.uid)).toEqual(["a", "b", "c"]);
    expect(events[0].start).toEqual({ time: Date.parse("2026-10-01T13:00:00Z") });
    expect(events[1]).toMatchObject({ start: { time: Date.parse("2026-10-02T07:00:00Z") }, end: { time: Date.parse("2026-10-02T09:00:00Z") } });
    expect(events[2].end).toEqual({ date: "2026-10-04" });
  });

  it("reads nothing from something that is not a calendar", () => {
    expect(parseFeed("<html>Not found</html>", OSLO)).toEqual([]);
  });
});

describe("blockSpan", () => {
  const [reserved] = parseFeed(AIRBNB, OSLO);
  it("closes a room from noon to noon, so the days around it can still turn over", () => {
    expect(blockSpan(reserved, "unit", OSLO)).toEqual({
      startsAt: zonedTime("2026-10-01", "12:00", OSLO),
      endsAt: zonedTime("2026-10-04", "12:00", OSLO),
    });
  });
  it("closes an item from midnight to midnight", () => {
    expect(blockSpan(reserved, "item", OSLO)).toEqual({
      startsAt: zonedTime("2026-10-01", "00:00", OSLO),
      endsAt: zonedTime("2026-10-04", "00:00", OSLO),
    });
  });
});

describe("exportDates", () => {
  it("writes a stay to its check-out day, and a rental to the day after its last", () => {
    const stay = exportDates("unit", zonedTime("2026-10-01", "15:00", OSLO), zonedTime("2026-10-04", "11:00", OSLO), OSLO);
    expect(stay).toEqual({ start: "2026-10-01", end: "2026-10-04" });
    const rental = exportDates("item", zonedTime("2026-10-01", "09:00", OSLO), zonedTime("2026-10-03", "17:00", OSLO), OSLO);
    expect(rental).toEqual({ start: "2026-10-01", end: "2026-10-04" });
  });
  it("gives back the days a block was made from", () => {
    const room = manualBlockSpan("unit", "2026-10-01", "2026-10-03", OSLO);
    expect(exportDates("unit", room.startsAt, room.endsAt, OSLO)).toEqual({ start: "2026-10-01", end: "2026-10-04" });
    const bike = manualBlockSpan("item", "2026-10-01", "2026-10-03", OSLO);
    expect(exportDates("item", bike.startsAt, bike.endsAt, OSLO)).toEqual({ start: "2026-10-01", end: "2026-10-04" });
  });
});

describe("exportFile", () => {
  it("writes whole days, which parseFeed reads back", () => {
    const file = exportFile("Hytta", [{ uid: "booking-1@kaizen", start: "2026-10-01", end: "2026-10-04", summary: "Booked" }], "2026-09-27T10:00:00Z");
    expect(file).toContain("DTSTART;VALUE=DATE:20261001\r\n");
    expect(parseFeed(file, OSLO)).toEqual([
      { uid: "booking-1@kaizen", start: { date: "2026-10-01" }, end: { date: "2026-10-04" }, summary: "Booked" },
    ]);
  });
});

describe("feedUrlProblem", () => {
  it("takes https addresses of other sites only", () => {
    expect(feedUrlProblem("https://www.airbnb.com/calendar/ical/123.ics?s=abc")).toBeNull();
    expect(feedUrlProblem("http://www.airbnb.com/calendar.ics")).toMatch(/https/);
    for (const url of ["https://localhost/x.ics", "https://127.0.0.1/x.ics", "https://[::1]/x.ics", "https://nas.local/x.ics", "https://intranet/x.ics"]) {
      expect(feedUrlProblem(url)).not.toBeNull();
    }
    expect(feedUrlProblem("not a url")).not.toBeNull();
  });
});
