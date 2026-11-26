import { describe, expect, it } from "vitest";

import { costSummary, countdown, dueTarget, monthOrToday, monthWeeks, shiftMonth, timelineBar } from "./projects-views";

const nok = (minor: number) => ({ minor, currency: "NOK" });

describe("a checklist's views (D903 P4.8)", () => {
  it("adds up the priced tasks a currency at a time, done and still open, and leaves the unpriced out", () => {
    expect(costSummary([{ cost: nok(10000), done: true }, { cost: nok(2550), done: false }, { cost: null, done: false }, { cost: { minor: 500, currency: "EUR" }, done: false }])).toEqual([
      { currency: "NOK", total: 12550, done: 10000, remaining: 2550, priced: 2 },
      { currency: "EUR", total: 500, done: 0, remaining: 500, priced: 1 },
    ]);
    expect(costSummary([{ cost: null, done: true }])).toEqual([]);
  });

  it("counts down to a due time, or to the end of a due day in the store's zone", () => {
    expect(dueTarget("2026-11-30T09:00:00.000Z", false, "Europe/Oslo")).toBe(Date.parse("2026-11-30T09:00:00.000Z"));
    // The 30th as a whole day in Oslo ends at midnight, 23:00 UTC.
    expect(dueTarget("2026-11-30T11:00:00.000Z", true, "Europe/Oslo")).toBe(Date.parse("2026-11-30T23:00:00.000Z"));
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(countdown(Date.parse("2026-11-29T16:30:00Z"), now)).toEqual({ late: false, days: 3, hours: 4, minutes: 30 });
    expect(countdown(Date.parse("2026-11-26T11:59:30Z"), now)).toEqual({ late: true, days: 0, hours: 0, minutes: 1 });
  });
});

describe("a project's calendar and timeline (D903 P4.13)", () => {
  it("lays a month out in whole weeks, Monday first", () => {
    const weeks = monthWeeks("2026-11");
    expect(weeks[0]?.[0]).toBe("2026-10-26");
    expect(weeks.at(-1)?.[6]).toBe("2026-12-06");
    expect(weeks).toHaveLength(6);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthOrToday("2027-13", "2026-11-26")).toBe("2026-11");
    expect(monthOrToday("2027-02", "2026-11-26")).toBe("2027-02");
  });

  it("puts a task's bar from its start to its due day, cut to the month", () => {
    expect(timelineBar("2026-11-01", "2026-11-15", "2026-11")).toEqual({ left: 0, width: 0.5 });
    expect(timelineBar(null, "2026-11-30", "2026-11")).toEqual({ left: 29 / 30, width: 1 / 30 });
    expect(timelineBar("2026-10-20", "2026-11-03", "2026-11")).toEqual({ left: 0, width: 0.1 });
    expect(timelineBar(null, "2026-12-01", "2026-11")).toBeNull();
  });
});
