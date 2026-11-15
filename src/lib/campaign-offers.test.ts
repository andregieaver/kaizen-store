import { describe, expect, it } from "vitest";

import { isSaleKey, nextWeekend } from "./campaign-offers";

describe("ready sales", () => {
  it("knows its keys", () => {
    expect(isSaleKey("weekend")).toBe(true);
    expect(isSaleKey("x")).toBe(false);
  });
  it("finds the coming weekend in Oslo time", () => {
    // Sunday 15 November 2026: the next weekend is 20 to 22 November.
    expect(nextWeekend(new Date("2026-11-15T12:00:00Z"))).toEqual({ startsAt: "2026-11-20T00:00", endsAt: "2026-11-22T23:59" });
    // A Wednesday.
    expect(nextWeekend(new Date("2026-11-18T09:00:00Z"))).toEqual({ startsAt: "2026-11-20T00:00", endsAt: "2026-11-22T23:59" });
    // A Friday is this weekend.
    expect(nextWeekend(new Date("2026-11-20T09:00:00Z"))).toEqual({ startsAt: "2026-11-20T00:00", endsAt: "2026-11-22T23:59" });
  });
});
