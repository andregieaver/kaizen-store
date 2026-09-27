import { describe, expect, it } from "vitest";

import { layoutDay, minuteOfDay, weekStart } from "./booking-calendar";

describe("the bookings calendar", () => {
  it("starts weeks on Monday, and reads times in the store's time zone", () => {
    expect(weekStart("2026-10-07")).toBe("2026-10-05");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
    expect(minuteOfDay("2026-10-05T07:30:00Z", "Europe/Oslo")).toBe(570);
    expect(minuteOfDay("2026-12-07T07:30:00Z", "Europe/Oslo")).toBe(510);
  });

  it("puts overlapping bookings side by side, and others at full width", () => {
    const placed = layoutDay([
      { id: "a", start: 540, end: 600 },
      { id: "b", start: 570, end: 630 },
      { id: "c", start: 600, end: 660 },
      { id: "d", start: 720, end: 780 },
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.id, [p.lane, p.lanes]]));
    // a and b overlap; c starts when a ends, so it takes a's lane.
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });
});
