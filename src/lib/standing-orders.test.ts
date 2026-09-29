import { describe, expect, it } from "vitest";

import { currentRound, cutoffFor, cutoffWeekday, formatDeliveryDate, isoWeekday, nextRound, upcomingDates, weekdayName } from "./standing-orders";

const OSLO = "Europe/Oslo";
/** Thursday deliveries, cutoff Tuesday 23:59 in Oslo. */
const thursday = { deliveryWeekday: 4, cutoffDays: 2, cutoffTime: "23:59" };
const at = (iso: string) => Date.parse(iso);

describe("weekly delivery rounds (D102)", () => {
  it("knows weekdays and cutoff days", () => {
    expect(isoWeekday("2026-10-01")).toBe(4); // a Thursday
    expect(isoWeekday("2026-10-04")).toBe(7);
    expect(cutoffWeekday(thursday)).toBe(2);
    expect(cutoffWeekday({ deliveryWeekday: 1, cutoffDays: 2 })).toBe(6);
    expect(cutoffWeekday({ deliveryWeekday: 4, cutoffDays: 7 })).toBe(4);
    expect(weekdayName(4, "en-GB")).toBe("Thursday");
    expect(formatDeliveryDate("2026-10-01", "en-GB")).toBe("Thursday 1 October");
  });

  it("puts a change before the cutoff into this week's delivery, and after it into next week's", () => {
    // Monday 28 September, noon in Oslo (summer time, UTC+2).
    const monday = at("2026-09-28T10:00:00Z");
    expect(nextRound(thursday, monday, OSLO)).toEqual({ date: "2026-10-01", cutoffAt: at("2026-09-29T21:59:00Z") });
    expect(currentRound(thursday, monday, OSLO)).toBeNull();

    // Just after the cutoff: the Thursday delivery is being packed, changes go to the next.
    const wednesday = at("2026-09-29T22:00:00Z");
    expect(nextRound(thursday, wednesday, OSLO).date).toBe("2026-10-08");
    expect(currentRound(thursday, wednesday, OSLO)).toEqual({ date: "2026-10-01", cutoffAt: at("2026-09-29T21:59:00Z") });

    // On the delivery day it is still the current round; the day after, none.
    expect(currentRound(thursday, at("2026-10-01T15:00:00Z"), OSLO)?.date).toBe("2026-10-01");
    expect(currentRound(thursday, at("2026-10-02T08:00:00Z"), OSLO)).toBeNull();
  });

  it("follows the store's clock across a change to winter time", () => {
    // Clocks go back on Sunday 25 October 2026: the cutoff is 23:59 local, now UTC+1.
    expect(cutoffFor(thursday, "2026-10-29", OSLO)).toBe(at("2026-10-27T22:59:00Z"));
    expect(nextRound(thursday, at("2026-10-26T12:00:00Z"), OSLO).date).toBe("2026-10-29");
  });

  it("handles a cutoff a whole week before, and deliveries on the day it is now", () => {
    const weekBefore = { deliveryWeekday: 4, cutoffDays: 7, cutoffTime: "12:00" };
    // Thursday 1 October at 11:00 Oslo: next week's cutoff is at noon today.
    const morning = at("2026-10-01T09:00:00Z");
    expect(nextRound(weekBefore, morning, OSLO)).toEqual({ date: "2026-10-08", cutoffAt: at("2026-10-01T10:00:00Z") });
    expect(currentRound(weekBefore, morning, OSLO)?.date).toBe("2026-10-01");
    expect(nextRound(weekBefore, at("2026-10-01T10:30:00Z"), OSLO).date).toBe("2026-10-15");
    expect(upcomingDates(thursday, at("2026-09-28T10:00:00Z"), OSLO, 3)).toEqual(["2026-10-01", "2026-10-08", "2026-10-15"]);
  });
});
