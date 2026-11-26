import { describe, expect, it } from "vitest";

import { anchored, fallsOn, nextOccurrence, timesToWindows, windowsToTimes } from "./projects-recurrence";
import { parseRecurrence, recurrence, type Recurrence } from "./projects-recurrence-schema";

const OSLO = "Europe/Oslo";
const rule = (raw: unknown): Recurrence => recurrence.parse(raw);
const next = (r: Recurrence, after: string, zone = OSLO) => nextOccurrence(r, Date.parse(after), zone)?.toISOString() ?? null;

describe("a repeating task's rule (D903 P4.1)", () => {
  it("is kept sorted and without repeats, and refuses a weekly or monthly rule without a day", () => {
    expect(rule({ freq: "weekly", weekdays: [4, 1, 4], times: ["20:00", "08:00"] })).toMatchObject({ weekdays: [1, 4], times: ["08:00", "20:00"] });
    expect(recurrence.safeParse({ freq: "weekly", weekdays: [], times: ["09:00"] }).success).toBe(false);
    expect(recurrence.safeParse({ freq: "monthly", times: ["09:00"] }).success).toBe(false);
    expect(recurrence.safeParse({ freq: "daily", times: [] }).success).toBe(false);
    expect(recurrence.safeParse({ freq: "daily", times: ["25:00"] }).success).toBe(false);
    expect(parseRecurrence({ freq: "hourly", times: ["09:00"] })).toBeNull();
    expect(parseRecurrence(null)).toBeNull();
  });

  it("comes again every day at its times, in the store's zone", () => {
    const daily = rule({ freq: "daily", times: ["08:00", "20:00"] });
    // 07:30 in Oslo in winter is 06:30 UTC.
    expect(next(daily, "2026-11-26T06:30:00Z")).toBe("2026-11-26T07:00:00.000Z");
    expect(next(daily, "2026-11-26T07:00:00Z")).toBe("2026-11-26T19:00:00.000Z");
    expect(next(daily, "2026-11-26T19:30:00Z")).toBe("2026-11-27T07:00:00.000Z");
    // Summer time: 08:00 in Oslo is 06:00 UTC.
    expect(next(daily, "2026-07-01T00:00:00Z")).toBe("2026-07-01T06:00:00.000Z");
  });

  it("comes on the chosen weekdays only", () => {
    // 26 November 2026 is a Thursday.
    const monAndThu = rule({ freq: "weekly", weekdays: [1, 4], times: ["09:00"] });
    expect(next(monAndThu, "2026-11-26T09:00:00Z")).toBe("2026-11-30T08:00:00.000Z");
    expect(fallsOn(monAndThu, "2026-11-26")).toBe(true);
    expect(fallsOn(monAndThu, "2026-11-27")).toBe(false);
  });

  it("counts every so many days from the day it was set", () => {
    const fortnight = anchored(rule({ freq: "interval", intervalDays: 14, times: ["09:00"] }), Date.parse("2026-11-26T12:00:00Z"), OSLO);
    expect(fortnight.anchor).toBe("2026-11-26");
    expect(next(fortnight, "2026-11-26T12:00:00Z")).toBe("2026-12-10T08:00:00.000Z");
    expect(fallsOn(fortnight, "2026-11-25")).toBe(false);
    // A rule that knows its day keeps it.
    expect(anchored(fortnight, Date.parse("2027-01-01T00:00:00Z"), OSLO).anchor).toBe("2026-11-26");
    // Every day and weekly rules need none.
    expect(anchored(rule({ freq: "daily", times: ["09:00"] }), Date.now(), OSLO).anchor).toBeUndefined();
  });

  it("takes the 31st as the last day of a shorter month, and every second month counts from the month it was set", () => {
    const end = rule({ freq: "monthly", monthDays: [31], times: ["09:00"], anchor: "2027-01-10" });
    expect(next(end, "2027-02-01T00:00:00Z")).toBe("2027-02-28T08:00:00.000Z");
    expect(next(end, "2027-04-01T00:00:00Z")).toBe("2027-04-30T07:00:00.000Z");
    const everySecond = rule({ freq: "monthly", monthDays: [1, 15], intervalMonths: 2, times: ["09:00"], anchor: "2027-01-10" });
    expect(next(everySecond, "2027-01-16T00:00:00Z")).toBe("2027-03-01T08:00:00.000Z");
    expect(fallsOn(everySecond, "2027-02-15")).toBe(false);
    expect(fallsOn(everySecond, "2026-12-15")).toBe(false);
  });

  it("finds even the sparest rule, one day every 24 months", () => {
    const sparse = rule({ freq: "monthly", monthDays: [5], intervalMonths: 24, times: ["09:00"], anchor: "2026-11-26" });
    expect(next(sparse, "2026-11-26T12:00:00Z")).toBe("2028-11-05T08:00:00.000Z");
  });

  it("reads the editor's times of the day and back", () => {
    expect(windowsToTimes(["evening", "morning"])).toEqual(["08:00", "20:00"]);
    expect(windowsToTimes([])).toEqual(["09:00"]);
    expect(timesToWindows(["08:00", "13:00", "07:15"])).toEqual(["morning", "midday"]);
  });
});
