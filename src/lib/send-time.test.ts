import { describe, expect, it } from "vitest";

import { bestHour, nextAtHour, sendHour } from "./send-time";

describe("send time per person (M4.4)", () => {
  it("finds the hour most presses fell in, once there are enough", () => {
    expect(bestHour([19, 19, 8], 3)).toBe(19);
    expect(bestHour([19, 8], 3)).toBeNull();
    expect(bestHour([10, 14, 10, 14], 3)).toBe(10);
  });

  it("sends at the reader's hour, else the store's, never at night", () => {
    expect(sendHour(19, 12)).toBe(19);
    expect(sendHour(null, 12)).toBe(12);
    expect(sendHour(null, null)).toBeNull();
    expect(sendHour(23, null)).toBe(19);
    expect(sendHour(3, null)).toBe(9);
  });

  it("goes now during that hour, later today, or tomorrow, in the store's own clock", () => {
    const now = new Date("2026-11-23T12:30:00Z"); // 13:30 in Oslo
    expect(nextAtHour(now, 13, "Europe/Oslo")).toEqual(now);
    expect(nextAtHour(now, 19, "Europe/Oslo").toISOString()).toBe("2026-11-23T18:00:00.000Z");
    expect(nextAtHour(now, 9, "Europe/Oslo").toISOString()).toBe("2026-11-24T08:00:00.000Z");
  });
});
