import { describe, expect, it } from "vitest";

import { erfc, keywordArm, rate } from "./experiment-stats";

describe("the statistics' primitives (D77, D148)", () => {
  it("computes erfc closely", () => {
    expect(erfc(0)).toBeCloseTo(1, 6);
    expect(erfc(1)).toBeCloseTo(0.157299, 5);
    expect(erfc(2)).toBeCloseTo(0.004678, 5);
    expect(erfc(-1)).toBeCloseTo(1.842701, 5);
  });

  it("has a rate of nothing when there is nothing", () => {
    expect(rate({ hits: 0, of: 0 })).toBe(0);
    expect(rate({ hits: 1, of: 4 })).toBe(0.25);
  });

  it("gives keyword search to the share asked for", () => {
    expect(keywordArm(0.1, 0.5)).toBe(true);
    expect(keywordArm(0.5, 0.5)).toBe(false);
    const draws = Array.from({ length: 10_000 }, (_, i) => i / 10_000);
    expect(draws.filter((d) => keywordArm(d, 0.2)).length).toBe(2000);
  });
});
