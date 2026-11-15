import { describe, expect, it } from "vitest";

import { challengeSchema } from "./autopilot-challenge";
import { budgetShare, challengeRatios, phaseOf, scoredPeriod, scoredUntil, shownDay, waitedHours } from "./challenge-console";

const c = challengeSchema.parse({ startsOn: "2026-12-14", dayOne: "2027-01-04", endsOn: "2027-05-13" });

describe("the challenge console (H2)", () => {
  it("knows the challenge's phase", () => {
    expect(phaseOf(c, "2026-12-01")).toBe("upcoming");
    expect(phaseOf(c, "2026-12-14")).toBe("rehearsal");
    expect(phaseOf(c, "2027-01-04")).toBe("on");
    expect(phaseOf(c, "2027-05-13")).toBe("on");
    expect(phaseOf(c, "2027-05-14")).toBe("ended");
  });

  it("scores Day 1 to Day 100, even when challenge mode lasts the 30 days after", () => {
    expect(scoredUntil(c)).toBe("2027-04-13");
    expect(scoredPeriod(c, "2027-01-03")).toBeNull();
    expect(scoredPeriod(c, "2027-01-10")).toEqual({ from: "2027-01-04", to: "2027-01-10", days: 7 });
    expect(scoredPeriod(c, "2027-05-01")).toEqual({ from: "2027-01-04", to: "2027-04-13", days: 100 });
    expect(shownDay(c, "2026-12-20")).toBeNull();
    expect(shownDay(c, "2027-01-04")).toBe(1);
    expect(shownDay(c, "2027-05-01")).toBe(100);
    // A challenge that ends before Day 100 is scored to its end.
    expect(scoredUntil(challengeSchema.parse({ startsOn: "2027-01-04", dayOne: "2027-01-04", endsOn: "2027-02-01" }))).toBe("2027-02-01");
  });

  it("works out the three ratios, and none it cannot measure", () => {
    expect(challengeRatios({ netRevenueMinor: 100_000, contributionMinor: 25_000, marketingMinor: 10_000, revenuePerVisitorMinor: 450 })).toEqual({
      margin: 0.25,
      perKrone: 3.5,
      perVisitorMinor: 450,
    });
    expect(challengeRatios({ netRevenueMinor: 0, contributionMinor: null, marketingMinor: 0, revenuePerVisitorMinor: null })).toEqual({
      margin: null,
      perKrone: null,
      perVisitorMinor: null,
    });
  });

  it("says how long a queue waited and how much of the AI budget is used", () => {
    const now = new Date("2027-01-10T12:00:00Z");
    expect(waitedHours(null, now)).toBeNull();
    expect(waitedHours("2027-01-10T11:30:00Z", now)).toBe(0);
    expect(waitedHours("2027-01-09T09:00:00Z", now)).toBe(27);
    expect(budgetShare(150_000_000, 300)).toBe(0.5);
    expect(budgetShare(1, null)).toBeNull();
    expect(budgetShare(1, 0)).toBe(1);
  });
});
