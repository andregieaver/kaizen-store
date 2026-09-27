import { describe, expect, it } from "vitest";

import { difference, erfc, keywordArm, MIN_PER_ARM, rate, sampleRatioP, verdict } from "./experiment-stats";

describe("search test statistics (D77)", () => {
  it("computes erfc closely", () => {
    expect(erfc(0)).toBeCloseTo(1, 6);
    expect(erfc(1)).toBeCloseTo(0.157299, 5);
    expect(erfc(2)).toBeCloseTo(0.004678, 5);
    expect(erfc(-1)).toBeCloseTo(1.842701, 5);
  });

  it("gives the difference in rates with a 95 % interval", () => {
    const d = difference({ hits: 300, of: 1000 }, { hits: 360, of: 1000 })!;
    expect(d.diff).toBeCloseTo(0.06, 6);
    // se = sqrt(.3*.7/1000 + .36*.64/1000) = sqrt(0.0004404) = 0.020986
    expect(d.low).toBeCloseTo(0.06 - 1.96 * 0.020986, 4);
    expect(d.high).toBeCloseTo(0.06 + 1.96 * 0.020986, 4);
    expect(difference({ hits: 0, of: 0 }, { hits: 1, of: 2 })).toBeNull();
    expect(rate({ hits: 0, of: 0 })).toBe(0);
  });

  it("flags a split that the assignment cannot explain", () => {
    expect(sampleRatioP(500, 500, 0.5)).toBeCloseTo(1, 6);
    // 520/480 is ordinary noise; 600/400 is not.
    expect(sampleRatioP(520, 480, 0.5)).toBeGreaterThan(0.2);
    expect(sampleRatioP(600, 400, 0.5)).toBeLessThan(0.001);
    // Checked against the share asked for, not an even split.
    expect(sampleRatioP(200, 800, 0.2)).toBeCloseTo(1, 6);
    expect(sampleRatioP(0, 0, 0.5)).toBe(1);
  });

  it("decides only with enough searches and a trustworthy split, by the rule fixed in advance", () => {
    const keyword = { hits: 300, of: 1000 };
    expect(verdict(keyword, { hits: 360, of: 1000 }, 0.5)).toBe("better");
    expect(verdict(keyword, { hits: 240, of: 1000 }, 0.5)).toBe("worse");
    expect(verdict(keyword, { hits: 310, of: 1000 }, 0.5)).toBe("even");
    expect(verdict({ hits: 30, of: MIN_PER_ARM - 1 }, { hits: 60, of: 1000 }, 0.5)).toBe("few");
    expect(verdict(keyword, { hits: 360, of: 1000 }, 0.0001)).toBe("broken");
    // Fewer searches finding nothing is better.
    expect(verdict({ hits: 200, of: 1000 }, { hits: 120, of: 1000 }, 0.5, true)).toBe("better");
  });

  it("gives keyword search to the share asked for", () => {
    expect(keywordArm(0.1, 0.5)).toBe(true);
    expect(keywordArm(0.5, 0.5)).toBe(false);
    const draws = Array.from({ length: 10_000 }, (_, i) => i / 10_000);
    expect(draws.filter((d) => keywordArm(d, 0.2)).length).toBe(2000);
  });
});
