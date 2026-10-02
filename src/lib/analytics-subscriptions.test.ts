import { describe, expect, it } from "vitest";

import { arr, churnRate, monthlyMinor, mrrMovements } from "./analytics-subscriptions";

describe("monthlyMinor", () => {
  it("keeps a monthly renewal as it is", () => {
    expect(monthlyMinor(9900, "month", 1)).toBe(9900);
  });

  it("divides a longer wait between renewals", () => {
    expect(monthlyMinor(9900, "month", 3)).toBe(3300);
    expect(monthlyMinor(9900, "month", 2)).toBe(4950);
    expect(monthlyMinor(10_000, "month", 3)).toBe(3333);
  });

  it("takes a week as 52/12 of a month's renewals", () => {
    // 1200 a week is 1200 × 52 / 12 = 5200 a month.
    expect(monthlyMinor(1200, "week", 1)).toBe(5200);
    expect(monthlyMinor(1200, "week", 2)).toBe(2600);
    expect(monthlyMinor(1000, "week", 1)).toBe(4333);
  });

  it("takes a year as a twelfth", () => {
    expect(monthlyMinor(120_000, "year", 1)).toBe(10_000);
    expect(monthlyMinor(120_000, "year", 2)).toBe(5000);
    expect(monthlyMinor(100_000, "year", 1)).toBe(8333);
  });

  it("is 0 for nothing", () => {
    expect(monthlyMinor(0, "month", 1)).toBe(0);
  });

  it("is none for what makes no sense, not 0", () => {
    expect(monthlyMinor(100, "month", 0)).toBeNull();
    expect(monthlyMinor(100, "month", -1)).toBeNull();
    expect(monthlyMinor(100, "month", 1.5)).toBeNull();
    expect(monthlyMinor(100, "fortnight", 1)).toBeNull();
    expect(monthlyMinor(100, "day", 1)).toBeNull();
    expect(monthlyMinor(NaN, "month", 1)).toBeNull();
    expect(monthlyMinor(Infinity, "year", 1)).toBeNull();
  });

  it("agrees across intervals for the same yearly amount", () => {
    // 52 weekly renewals of 100 and 12 monthly renewals of 433.33 are the same year.
    const weekly = monthlyMinor(100, "week", 1)!;
    const yearly = monthlyMinor(5200, "year", 1)!;
    expect(Math.abs(weekly - yearly)).toBeLessThanOrEqual(1);
  });
});

describe("arr", () => {
  it("is twelve months", () => {
    expect(arr(10_000)).toBe(120_000);
    expect(arr(0)).toBe(0);
  });
});

describe("churnRate", () => {
  it("is cancelled over active at the start", () => {
    expect(churnRate(5, 100)).toBe(0.05);
    expect(churnRate(0, 100)).toBe(0);
    expect(churnRate(100, 100)).toBe(1);
  });

  it("has no rate without a base", () => {
    expect(churnRate(0, 0)).toBeNull();
    expect(churnRate(3, 0)).toBeNull();
    expect(churnRate(3, -1)).toBeNull();
  });

  it("is never negative", () => {
    expect(churnRate(-2, 10)).toBe(0);
  });
});

describe("mrrMovements", () => {
  it("lays out start, movements and end", () => {
    const m = mrrMovements({ startMrr: 100_000, newMrr: 20_000, churnedMrr: 5000, endMrr: 115_000 });
    expect(m).toMatchObject({ start: 100_000, new: 20_000, churned: 5000, end: 115_000, netNew: 15_000, otherMinor: 0, reconciles: true });
    expect(m.growth).toBeCloseTo(0.15, 10);
  });

  it("says what is not tracked with explicit nulls, never zero", () => {
    const m = mrrMovements({ startMrr: 1, newMrr: 0, churnedMrr: 0, endMrr: 1 });
    expect(m.expansion).toBeNull();
    expect(m.contraction).toBeNull();
    expect(m.reactivation).toBeNull();
    expect(Object.keys(m)).toEqual(expect.arrayContaining(["expansion", "contraction", "reactivation"]));
  });

  it("shows what the tracked movements do not explain", () => {
    const m = mrrMovements({ startMrr: 100_000, newMrr: 20_000, churnedMrr: 5000, endMrr: 118_000 });
    expect(m.otherMinor).toBe(3000);
    expect(m.reconciles).toBe(false);
    const down = mrrMovements({ startMrr: 100_000, newMrr: 0, churnedMrr: 0, endMrr: 99_000 });
    expect(down.otherMinor).toBe(-1000);
    expect(down.reconciles).toBe(false);
  });

  it("allows a tolerance for rounding", () => {
    const input = { startMrr: 100_000, newMrr: 20_000, churnedMrr: 5000, endMrr: 115_002 };
    expect(mrrMovements(input).reconciles).toBe(false);
    expect(mrrMovements(input, 2).reconciles).toBe(true);
    expect(mrrMovements({ ...input, endMrr: 114_997 }, 2).reconciles).toBe(false);
    expect(mrrMovements({ ...input, endMrr: 114_998 }, 2).reconciles).toBe(true);
    expect(mrrMovements(input, -5).reconciles).toBe(false);
  });

  it("has no growth from nothing", () => {
    const m = mrrMovements({ startMrr: 0, newMrr: 5000, churnedMrr: 0, endMrr: 5000 });
    expect(m.growth).toBeNull();
    expect(m.reconciles).toBe(true);
  });

  it("can shrink", () => {
    const m = mrrMovements({ startMrr: 100_000, newMrr: 0, churnedMrr: 10_000, endMrr: 90_000 });
    expect(m.netNew).toBe(-10_000);
    expect(m.growth).toBeCloseTo(-0.1, 10);
  });

  it("is all zero for a store with no subscriptions", () => {
    const m = mrrMovements({ startMrr: 0, newMrr: 0, churnedMrr: 0, endMrr: 0 });
    expect(m).toMatchObject({ netNew: 0, otherMinor: 0, reconciles: true, growth: null });
  });
});
