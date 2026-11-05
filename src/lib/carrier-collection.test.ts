import { describe, expect, it } from "vitest";

import { collectionFor, collectionHours } from "./carrier-collection";

describe("a carrier's collection (D459)", () => {
  it("reads the hours the owner gave, and nothing else", () => {
    expect(collectionHours("9:00-17:30")).toEqual({ from: "09:00", to: "17:30" });
    expect(collectionHours(" 10:00 – 16:00 ")).toEqual({ from: "10:00", to: "16:00" });
    expect(collectionHours("17:00-09:00")).toBeNull();
    expect(collectionHours("25:00-26:00")).toBeNull();
    expect(collectionHours("")).toBeNull();
  });

  it("asks for today from the next quarter hour while two hours of the window are left", () => {
    // 09:07 in Oslo on Thursday 5 November 2026 (UTC+1).
    expect(collectionFor("08:00-17:00", new Date("2026-11-05T08:07:00Z"), "Europe/Oslo")).toEqual({ date: "2026-11-05", readyTime: "09:15", closeTime: "17:00" });
    // Before the window opens, the window as given.
    expect(collectionFor("10:00-17:00", new Date("2026-11-05T06:00:00Z"), "Europe/Oslo")).toEqual({ date: "2026-11-05", readyTime: "10:00", closeTime: "17:00" });
  });

  it("asks for the next weekday when today's window is nearly over, or it is the weekend", () => {
    expect(collectionFor("10:00-17:00", new Date("2026-11-05T15:30:00Z"), "Europe/Oslo")).toEqual({ date: "2026-11-06", readyTime: "10:00", closeTime: "17:00" });
    expect(collectionFor("10:00-17:00", new Date("2026-11-06T15:30:00Z"), "Europe/Oslo")).toEqual({ date: "2026-11-09", readyTime: "10:00", closeTime: "17:00" });
    expect(collectionFor("10:00-17:00", new Date("2026-11-07T09:00:00Z"), "Europe/Oslo")).toEqual({ date: "2026-11-09", readyTime: "10:00", closeTime: "17:00" });
    expect(collectionFor(null, new Date(), "Europe/Oslo")).toBeNull();
  });
});
