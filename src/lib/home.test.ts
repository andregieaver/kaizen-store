import { describe, expect, it } from "vitest";

import { homeEn } from "./admin-messages/home.en";
import { barHeights, firstName, homeSummary, milestoneTrack, partOfDay, weekChange, weekChip, whenWords, withoutStoreName } from "./home";

const w = homeEn.today;

describe("the store's Home (round 1)", () => {
  it("greets by the part of the day at the store", () => {
    expect(partOfDay(new Date("2026-11-14T07:30:00Z"), "Europe/Oslo")).toBe("morning");
    expect(partOfDay(new Date("2026-11-14T13:00:00Z"), "Europe/Oslo")).toBe("afternoon");
    expect(partOfDay(new Date("2026-11-14T19:00:00Z"), "Europe/Oslo")).toBe("evening");
    expect(firstName("Eva Owner")).toBe("Eva");
    expect(firstName("  ")).toBeNull();
  });

  it("says the week against the last in plain words", () => {
    expect(weekChange(864300, 312000)).toEqual({ kind: "times", times: "2.7" });
    expect(weekChange(110, 100)).toEqual({ kind: "up", n: 10 });
    expect(weekChange(80, 100)).toEqual({ kind: "down", n: 20 });
    expect(weekChange(101, 100)).toEqual({ kind: "same" });
    expect(weekChange(100, 0)).toEqual({ kind: "first" });
    expect(weekChip(80, 100, w).good).toBe(false);
  });

  it("puts the orders to send first in its one sentence", () => {
    expect(homeSummary({ toSend: 4, week: 2000, prior: 1000, amount: "NOK 20" }, w)).toEqual({
      lead: "4 orders are waiting to be sent.",
      rest: "Sales this week are NOK 20, 2 times last week.",
    });
    expect(homeSummary({ toSend: 0, week: 0, prior: 0, amount: null }, w)).toEqual({ lead: null, rest: w.noSalesYet });
  });

  it("draws both weeks on one scale, a day with sales always visible", () => {
    expect(barHeights([0, 10, 100], [50], 160)).toEqual({ days: [0, 16, 160], prior: [80] });
    expect(barHeights([1, 1000], [], 100).days[0]).toBe(3);
  });

  it("tracks milestones by segment, the next one named", () => {
    const t = milestoneTrack(16);
    expect(t.next).toBe(25);
    expect(t.marks.map((m) => m.at)).toEqual([1, 10, 25, 50, 100]);
    expect(t.share).toBeCloseTo(1.4 / 4);
    expect(milestoneTrack(0).share).toBe(0);
    expect(milestoneTrack(20000).next).toBeNull();
  });

  it("counts days in the store's calendar", () => {
    const now = new Date("2026-11-14T10:00:00Z");
    expect(whenWords("2026-11-14T06:00:00Z", now, "Europe/Oslo", w.when)).toBe("today");
    expect(whenWords("2026-11-13T23:30:00Z", now, "Europe/Oslo", w.when)).toBe("today");
    expect(whenWords("2026-11-13T10:00:00Z", now, "Europe/Oslo", w.when)).toBe("yesterday");
    expect(whenWords("2026-11-10T10:00:00Z", now, "Europe/Oslo", w.when)).toBe("4 days ago");
  });

  it("drops the store's own name in front of an attention line", () => {
    expect(withoutStoreName("E2E Shop: 2 products are out of stock.", "E2E Shop")).toBe("2 products are out of stock.");
    expect(withoutStoreName("E2E Shop has no plan yet.", "E2E Shop")).toBe("E2E Shop has no plan yet.");
  });
});
