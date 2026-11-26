import { describe, expect, it } from "vitest";

import { costSummary, countdown, dueTarget } from "./projects-views";

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
