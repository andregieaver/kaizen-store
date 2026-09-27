import { describe, expect, it } from "vitest";

import {
  freeUnits,
  halfDays,
  hourStarts,
  occupiedDates,
  openDates,
  peakBusy,
  periodProblem,
  periodSpan,
  rangeCount,
  rangeEndsAt,
  rangeOpen,
  rangeProblem,
  rangeSpan,
  type RangeRules,
} from "./booking-ranges";
import { zonedTime } from "./booking-slots";

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

describe("renting by the half day or hour (D69)", () => {
  const at = (date: string, time: string) => zonedTime(date, time, OSLO);
  const now = Date.parse("2026-10-01T06:00:00Z");

  it("splits a day at its middle, and offers whole hours from pick-up that end by return", () => {
    expect(halfDays("2026-10-05", rental, OSLO)).toEqual([
      { startsAt: at("2026-10-05", "09:00"), endsAt: at("2026-10-05", "13:00") },
      { startsAt: at("2026-10-05", "13:00"), endsAt: at("2026-10-05", "17:00") },
    ]);
    expect(halfDays("2026-10-05", { checkInTime: "09:00", checkOutTime: "16:30" }, OSLO)[0].endsAt).toBe(at("2026-10-05", "12:45"));
    const starts = hourStarts("2026-10-05", rental, OSLO);
    expect(starts).toHaveLength(8);
    expect([starts[0], starts[7]]).toEqual([at("2026-10-05", "09:00"), at("2026-10-05", "16:00")]);
  });

  it("takes only times a variant offers, and hours that end by return", () => {
    expect(periodSpan("half_day", "rental", at("2026-10-05", "13:00"), 1, rental, OSLO)).toEqual({
      startsAt: at("2026-10-05", "13:00"),
      endsAt: at("2026-10-05", "17:00"),
    });
    expect(periodSpan("half_day", "rental", at("2026-10-05", "11:00"), 1, rental, OSLO)).toBeNull();
    expect(periodSpan("half_day", "rental", at("2026-10-05", "09:00"), 2, rental, OSLO)).toBeNull();
    expect(periodSpan("hour", "rental", at("2026-10-05", "14:00"), 3, rental, OSLO)).toEqual({
      startsAt: at("2026-10-05", "14:00"),
      endsAt: at("2026-10-05", "17:00"),
    });
    expect(periodSpan("hour", "rental", at("2026-10-05", "15:00"), 3, rental, OSLO)).toBeNull();
    expect(periodSpan("hour", "rental", at("2026-10-05", "14:30"), 1, rental, OSLO)).toBeNull();
    // Whole days start at pick-up.
    expect(periodSpan("day", "rental", at("2026-10-05", "09:00"), 2, rental, OSLO)?.endsAt).toBe(at("2026-10-06", "17:00"));
    expect(periodSpan("day", "rental", at("2026-10-05", "10:00"), 2, rental, OSLO)).toBeNull();
    expect(rangeEndsAt("rental", new Date(at("2026-10-05", "10:00")).toISOString(), 2, rental, OSLO, "hour")).toBe(
      new Date(at("2026-10-05", "12:00")).toISOString(),
    );
  });

  it("keeps an hour's rental to the notice and how far ahead, but not to the shortest whole days", () => {
    const rules = { ...rental, minNights: 2, minNoticeMinutes: 60, maxDaysAhead: 30 };
    expect(periodProblem("hour", at("2026-10-05", "10:00"), 1, rules, OSLO, now)).toBeNull();
    expect(periodProblem("day", at("2026-10-05", "09:00"), 1, rules, OSLO, now)).toBe("length");
    expect(periodProblem("hour", at("2026-10-01", "09:00"), 1, { ...rules, minNoticeMinutes: 90 }, OSLO, now)).toBe("notice");
    expect(periodProblem("hour", at("2026-11-15", "09:00"), 1, rules, OSLO, now)).toBe("ahead");
    expect(periodProblem("hour", at("2026-10-05", "10:15"), 1, rules, OSLO, now)).toBe("length");
  });

  it("counts a unit's bookings at their busiest moment, so ones after another do not add up", () => {
    const span = { startsAt: at("2026-10-05", "09:00"), endsAt: at("2026-10-05", "12:00") };
    const hourly = [
      { from: at("2026-10-05", "09:00"), to: at("2026-10-05", "10:00") },
      { from: at("2026-10-05", "10:00"), to: at("2026-10-05", "11:00") },
      { from: at("2026-10-05", "11:00"), to: at("2026-10-05", "12:00") },
    ];
    expect(peakBusy(hourly, span)).toBe(1);
    expect(freeUnits([{ id: "bikes", capacity: 2, busy: hourly }], span)).toEqual(["bikes"]);
    expect(peakBusy([...hourly, { from: at("2026-10-05", "10:30"), to: at("2026-10-05", "13:00") }], span)).toBe(2);
    expect(peakBusy([], span)).toBe(0);
  });

  it("opens a date when some hour of it is free", () => {
    const busyMorning = [{ from: at("2026-10-05", "09:00"), to: at("2026-10-05", "16:00") }];
    const bike = { id: "bike", capacity: 1, busy: busyMorning };
    expect(openDates("2026-10-05", 1, [bike], rental, OSLO, now, "day")[0].open).toBe(false);
    expect(openDates("2026-10-05", 1, [bike], rental, OSLO, now, "half_day")[0].open).toBe(false);
    expect(openDates("2026-10-05", 1, [bike], rental, OSLO, now, "hour")[0].open).toBe(true);
  });
});
