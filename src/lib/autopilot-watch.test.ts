import { describe, expect, it } from "vitest";

import { baselineWindows, isRevertible, reading, verdictWords, watchVerdict } from "./autopilot-watch";

describe("watch and roll back (F4)", () => {
  it("knows which changes can be undone", () => {
    expect(isRevertible("set_prices")).toBe(true);
    expect(isRevertible("make_theme_live")).toBe(true);
    expect(isRevertible("publish_page")).toBe(false);
    expect(isRevertible("reply_to_support")).toBe(false);
  });

  it("reads a rate against the one expected, in standard errors", () => {
    const r = reading(0, 200, 40, 400);
    expect(r).toMatchObject({ observed: 0, expected: 0.1 });
    expect(r!.z).toBeCloseTo(-4.71, 1);
    expect(reading(5, 200, 0, 400)).toBeNull();
  });

  it("calls a fall clear only far below and far outside chance, conversion first", () => {
    // 10 % expected, none since: clear.
    expect(watchVerdict({ visitors: 200, carts: 30, orders: 0 }, { visitors: 400, carts: 60, orders: 40 })).toMatchObject({ kind: "fall", signal: "conversion" });
    // Orders hold, carts collapse: add-to-cart.
    expect(watchVerdict({ visitors: 200, carts: 2, orders: 20 }, { visitors: 400, carts: 60, orders: 40 })).toMatchObject({ kind: "fall", signal: "addToCart" });
    // 8 % against 10 %: within chance, fine.
    expect(watchVerdict({ visitors: 200, carts: 28, orders: 16 }, { visitors: 400, carts: 60, orders: 40 })).toMatchObject({ kind: "fine" });
  });

  it("says nothing on too little traffic", () => {
    expect(watchVerdict({ visitors: 40, carts: 0, orders: 0 }, { visitors: 400, carts: 60, orders: 40 })).toEqual({ kind: "too_little", visitorsAfter: 40, visitorsBefore: 400 });
    expect(watchVerdict({ visitors: 400, carts: 0, orders: 0 }, { visitors: 100, carts: 10, orders: 10 })).toMatchObject({ kind: "too_little" });
  });

  it("compares the same hours of the four weeks before", () => {
    const from = new Date("2027-01-20T10:00:00Z");
    const to = new Date("2027-01-20T18:00:00Z");
    const windows = baselineWindows(from, to);
    expect(windows).toHaveLength(4);
    expect(windows[0]).toEqual({ from: new Date("2027-01-13T10:00:00Z"), to: new Date("2027-01-13T18:00:00Z") });
    expect(windows[3].from.toISOString()).toBe("2026-12-23T10:00:00.000Z");
  });

  it("says the verdict in words", () => {
    expect(verdictWords(watchVerdict({ visitors: 200, carts: 30, orders: 0 }, { visitors: 400, carts: 60, orders: 40 }))).toBe(
      "A clear fall in conversion: conversion 0 % against 10 % expected; add-to-cart 15 % against 15 % expected.",
    );
    expect(verdictWords({ kind: "too_little", visitorsAfter: 3, visitorsBefore: 9 })).toContain("Too few visitors");
  });
});
