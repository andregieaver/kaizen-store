import { describe, expect, it } from "vitest";

import { DAYS, defaultHours, defaultWeek, hoursOn, openingHoursInput, weekSummary, type OpeningHours, type WeekHours } from "./opening-hours";

describe("opening hours (D40)", () => {
  it("sums up the week, running days with the same hours together", () => {
    expect(weekSummary(defaultWeek())).toBe("Mon–Fri 09:00–17:00");
    const week = { ...defaultWeek(), fri: { open: "09:00", close: "15:00" }, sat: { open: "10:00", close: "14:00" } };
    expect(weekSummary(week)).toBe("Mon–Thu 09:00–17:00, Fri 09:00–15:00, Sat 10:00–14:00");
    const closed = Object.fromEntries(DAYS.map((d) => [d, null])) as WeekHours;
    expect(weekSummary(closed)).toBe("Closed");
  });

  it("finds the hours of a date: a single date, then a season, then the usual week", () => {
    const hours: OpeningHours = {
      week: defaultWeek(),
      exceptions: [
        { kind: "season", label: "Summer", from: "2026-07-01", to: "2026-08-15", week: { ...defaultWeek(), mon: { open: "10:00", close: "15:00" } } },
        { kind: "date", label: "Christmas Eve", date: "2026-12-24", hours: null },
      ],
    };
    expect(hoursOn(hours, "2026-07-06")).toEqual({ open: "10:00", close: "15:00" }); // a Monday in summer
    expect(hoursOn(hours, "2026-09-07")).toEqual({ open: "09:00", close: "17:00" }); // a Monday after
    expect(hoursOn(hours, "2026-12-24")).toBeNull();
    expect(hoursOn(hours, "2026-09-12")).toBeNull(); // a Saturday
  });

  it("refuses times out of order, bad times and seasons that end before they start", () => {
    expect(openingHoursInput.safeParse(defaultHours()).success).toBe(true);
    const badDay = { ...defaultHours(), week: { ...defaultWeek(), mon: { open: "17:00", close: "09:00" } } };
    expect(openingHoursInput.safeParse(badDay).error?.issues[0].message).toBe("A day must close after it opens.");
    expect(openingHoursInput.safeParse({ ...defaultHours(), week: { ...defaultWeek(), tue: { open: "9", close: "17:00" } } }).success).toBe(false);
    const backwards = {
      week: defaultWeek(),
      exceptions: [{ kind: "season", label: "", from: "2026-08-01", to: "2026-07-01", week: defaultWeek() }],
    };
    expect(openingHoursInput.safeParse(backwards).error?.issues[0].message).toBe("A season must end on or after the day it starts.");
  });
});
