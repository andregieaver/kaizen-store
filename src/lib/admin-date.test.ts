import { describe, expect, it } from "vitest";

import { adminDate, adminDay, NORWAY_TIME_ZONE, PLATFORM_TIME_ZONE, zoneOf } from "./admin-date";

/** Code review 1.14 (FS5, D786): one admin date formatter, an instant in a zone and a calendar day never moved. */
describe("adminDate", () => {
  it("shows an evening order on the store's own day, not on UTC's or Oslo's", () => {
    // 23:30 in New York on 3 October is 03:30 UTC on 4 October, 05:30 in Oslo.
    const at = "2026-10-04T03:30:00.000Z";
    expect(adminDate("America/New_York", at, "day", "en")).toBe("3 Oct 2026");
    expect(adminDate("America/New_York", at, "iso", "en")).toBe("2026-10-03");
    expect(adminDate("America/New_York", at, "dayTime", "en")).toBe("3 Oct 2026, 23:30");
    expect(adminDate("Europe/Oslo", at, "day", "en")).toBe("4 Oct 2026");
    // Far east: the same moment is already the afternoon of 4 October in Auckland.
    expect(adminDate("Pacific/Auckland", at, "dayTime", "en")).toBe("4 Oct 2026, 16:30");
  });

  it("takes the zone from what carries it: a store, a control center row", () => {
    const at = "2026-10-04T03:30:00.000Z";
    expect(adminDate({ timeZone: "America/Los_Angeles" }, at, "iso", "en")).toBe("2026-10-03");
    expect(adminDate({ timeZone: "Asia/Tokyo" }, at, "time", "en")).toBe("12:30");
  });

  it("follows the clock change in spring and in autumn", () => {
    // Europe moves to summer time at 01:00 UTC on 29 March 2026.
    expect(adminDate("Europe/Berlin", "2026-03-29T00:30:00Z", "time", "en")).toBe("01:30");
    expect(adminDate("Europe/Berlin", "2026-03-29T01:30:00Z", "time", "en")).toBe("03:30");
    // And back at 01:00 UTC on 25 October 2026.
    expect(adminDate("Europe/Lisbon", "2026-10-25T00:30:00Z", "time", "en")).toBe("01:30");
    expect(adminDate("Europe/Lisbon", "2026-10-25T01:30:00Z", "time", "en")).toBe("01:30");
    // The United States moves on 8 March 2026 (07:00 UTC in New York) and back on 1 November 2026 (06:00 UTC).
    expect(adminDate("America/New_York", "2026-03-08T06:30:00Z", "dayTime", "en")).toBe("8 Mar 2026, 01:30");
    expect(adminDate("America/New_York", "2026-03-08T07:30:00Z", "dayTime", "en")).toBe("8 Mar 2026, 03:30");
    expect(adminDate("America/New_York", "2026-11-01T04:30:00Z", "iso", "en")).toBe("2026-11-01");
    expect(adminDate("America/New_York", "2026-11-01T03:30:00Z", "iso", "en")).toBe("2026-10-31");
    // A day near midnight in the southern summer: Auckland is 13 hours ahead in January.
    expect(adminDate("Pacific/Auckland", "2026-01-15T11:30:00Z", "iso", "en")).toBe("2026-01-16");
    expect(adminDate("Pacific/Auckland", "2026-07-15T11:30:00Z", "iso", "en")).toBe("2026-07-15");
  });

  it("writes the admin's language: English, Norwegian, or a locale handed as it is", () => {
    const at = new Date("2026-10-04T10:05:00Z");
    expect(adminDate("Europe/Oslo", at, "day", "nb")).toBe("4. okt. 2026");
    expect(adminDate("Europe/Oslo", at, "long", "nb")).toBe("4. oktober 2026");
    expect(adminDate("Europe/Oslo", at, "long", "en")).toBe("4 October 2026");
    expect(adminDate("Europe/Oslo", at, "short", "en")).toBe("4 Oct");
    expect(adminDate("Europe/Oslo", at, "dayMonth", "nb-NO")).toBe("4. oktober");
    expect(adminDate("Europe/Oslo", at, "dayTime", "nb")).toBe("4. okt. 2026, 12:05");
    expect(adminDate("Europe/Oslo", at.getTime(), "day", "en-GB")).toBe("4 Oct 2026");
    expect(adminDate("Europe/Oslo", at, "day", "not a locale!")).toBe("4 Oct 2026");
  });

  it("never moves a bare day: it is a calendar day, not an instant", () => {
    expect(adminDate("America/Los_Angeles", "2026-10-03", "day", "en")).toBe("3 Oct 2026");
    expect(adminDate("Pacific/Auckland", "2026-10-03", "iso", "en")).toBe("2026-10-03");
    expect(adminDate("Pacific/Honolulu", "2026-10-03", "dayTime", "en")).toBe("3 Oct 2026");
  });

  it("gives nothing for nothing and the text back for text that is no moment", () => {
    expect(adminDate("Europe/Oslo", null, "day", "en")).toBe("");
    expect(adminDate("Europe/Oslo", undefined, "day", "en")).toBe("");
    expect(adminDate("Europe/Oslo", "", "day", "en")).toBe("");
    expect(adminDate("Europe/Oslo", "soon", "day", "en")).toBe("soon");
    expect(adminDate("Europe/Oslo", new Date(Number.NaN), "day", "en")).toBe("");
  });

  it("falls back to the platform's zone for a store that names none or one the runtime does not know", () => {
    expect(zoneOf(null)).toBe(PLATFORM_TIME_ZONE);
    expect(zoneOf({ timeZone: "" })).toBe(PLATFORM_TIME_ZONE);
    expect(zoneOf("Mars/Olympus_Mons")).toBe(PLATFORM_TIME_ZONE);
    expect(zoneOf({ timeZone: "America/Chicago" })).toBe("America/Chicago");
    expect(adminDate("Mars/Olympus_Mons", "2026-10-04T03:30:00Z", "iso", "en")).toBe("2026-10-04");
  });

  it("names Kaizena Flow's zone and Norway's legal time apart, though both are Oslo today", () => {
    expect(PLATFORM_TIME_ZONE).toBe("Europe/Oslo");
    expect(NORWAY_TIME_ZONE).toBe("Europe/Oslo");
  });
});

describe("adminDay", () => {
  it("shows a calendar day as it is, in any zone the process runs in", () => {
    expect(adminDay("2026-10-03", "day", "en")).toBe("3 Oct 2026");
    expect(adminDay("2026-10-03", "long", "nb")).toBe("3. oktober 2026");
    expect(adminDay("2026-10-03", "short", "en")).toBe("3 Oct");
    expect(adminDay("2026-10-03", "dayMonth", "en")).toBe("3 October");
    expect(adminDay("2026-10-03", "iso", "en")).toBe("2026-10-03");
    // The first and last days of a year, where a shift by a zone would change the year too.
    expect(adminDay("2026-01-01", "day", "en")).toBe("1 Jan 2026");
    expect(adminDay("2026-12-31", "day", "en")).toBe("31 Dec 2026");
  });

  it("returns what is not a real day as it came", () => {
    expect(adminDay(null, "day", "en")).toBe("");
    expect(adminDay("", "day", "en")).toBe("");
    expect(adminDay("2026-02-30", "day", "en")).toBe("2026-02-30");
    expect(adminDay("next week", "day", "en")).toBe("next week");
    expect(adminDay("2026-10-03T10:00:00Z", "day", "en")).toBe("2026-10-03T10:00:00Z");
  });
});
