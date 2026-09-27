import { describe, expect, it } from "vitest";

import { freeUnits, occupiedDates, openDates, rangeCount, rangeOpen, rangeProblem, rangeSpan, type RangeRules } from "./booking-ranges";

const OSLO = "Europe/Oslo";
const stay: RangeRules = {
  kind: "stay",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  minNights: 2,
  maxNights: 14,
  minNoticeMinutes: 0,
  maxDaysAhead: 365,
};
const rental: RangeRules = { ...stay, kind: "rental", checkInTime: "09:00", checkOutTime: "17:00", minNights: 1 };
const iso = (ms: number) => new Date(ms).toISOString();

describe("stays and rentals (D67)", () => {
  it("runs a stay from check-in to check-out nights later, and a rental from pick-up to return on its last day", () => {
    const three = rangeSpan("stay", "2026-10-05", 3, stay, OSLO);
    expect([iso(three.startsAt), iso(three.endsAt), three.endDate]).toEqual([
      "2026-10-05T13:00:00.000Z",
      "2026-10-08T09:00:00.000Z",
      "2026-10-08",
    ]);
    const day = rangeSpan("rental", "2026-10-05", 1, rental, OSLO);
    expect([iso(day.startsAt), iso(day.endsAt)]).toEqual(["2026-10-05T07:00:00.000Z", "2026-10-05T15:00:00.000Z"]);
    expect(rangeCount("stay", "2026-10-05", "2026-10-08")).toBe(3);
    expect(rangeCount("rental", "2026-10-05", "2026-10-06")).toBe(2);
  });

  it("keeps to the length, notice and how far ahead", () => {
    const now = Date.parse("2026-10-01T10:00:00Z");
    expect(rangeProblem("2026-10-05", 1, stay, OSLO, now)).toBe("length");
    expect(rangeProblem("2026-10-05", 15, stay, OSLO, now)).toBe("length");
    expect(rangeProblem("2026-10-05", 3, stay, OSLO, now)).toBeNull();
    expect(rangeProblem("2026-09-30", 3, stay, OSLO, now)).toBe("notice");
    expect(rangeProblem("2027-10-05", 3, stay, OSLO, now)).toBe("ahead");
    // A rental returned before it is picked up the same day.
    expect(rangeProblem("2026-10-05", 1, { ...rental, checkOutTime: "08:00" }, OSLO, now)).toBe("order");
  });

  it("lets back-to-back stays share the changeover day, and finds units with room", () => {
    const booked = rangeSpan("stay", "2026-10-05", 3, stay, OSLO);
    const unit = { id: "hytta", capacity: 1, busy: [{ from: booked.startsAt, to: booked.endsAt }] };
    // Arriving the day the others leave: check-out 11:00, check-in 15:00.
    expect(freeUnits([unit], rangeSpan("stay", "2026-10-08", 2, stay, OSLO))).toEqual(["hytta"]);
    expect(freeUnits([unit], rangeSpan("stay", "2026-10-07", 2, stay, OSLO))).toEqual([]);
    const bikes = { id: "bikes", capacity: 2, busy: [{ from: booked.startsAt, to: booked.endsAt }] };
    expect(freeUnits([unit, bikes], rangeSpan("stay", "2026-10-06", 1, stay, OSLO))).toEqual(["bikes"]);
    const now = Date.parse("2026-10-01T10:00:00Z");
    expect(openDates("2026-10-04", 5, [unit], stay, OSLO, now).map((d) => d.open)).toEqual([true, false, false, false, true]);
  });
});

describe("occupiedDates", () => {
  it("counts a stay's nights and a rental's days", () => {
    expect(occupiedDates("stay", "2026-10-01T13:00:00Z", "2026-10-03T09:00:00Z", "Europe/Oslo")).toEqual(["2026-10-01", "2026-10-02"]);
    expect(occupiedDates("rental", "2026-10-01T07:00:00Z", "2026-10-03T15:00:00Z", "Europe/Oslo")).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });
});

describe("rangeOpen", () => {
  const dates = [
    { date: "2026-10-01", open: true },
    { date: "2026-10-02", open: true },
    { date: "2026-10-03", open: false },
  ];
  it("lets a stay leave on a taken night, not stay through it", () => {
    expect(rangeOpen("stay", "2026-10-01", "2026-10-03", dates)).toBe(true);
    expect(rangeOpen("stay", "2026-10-01", "2026-10-04", dates)).toBe(false);
  });
  it("needs every day of a rental", () => {
    expect(rangeOpen("rental", "2026-10-01", "2026-10-02", dates)).toBe(true);
    expect(rangeOpen("rental", "2026-10-01", "2026-10-03", dates)).toBe(false);
  });
  it("leaves dates past the calendar to be checked when chosen", () => {
    expect(rangeOpen("stay", "2026-10-02", "2026-10-02", [])).toBe(true);
  });
});
