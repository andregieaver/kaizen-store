import { describe, expect, it } from "vitest";

import { FRUSTRATED_Z, frustratedVersion, proportionZ } from "./heat-read";
import { FLAG_VERSION_VIEWS } from "./page-heat";

/** The A/B flag on rage and dead clicks (D656 step 12). */

const row = (version: string, views: number, rageViews = 0, deadViews = 0) => ({ version, views, rageViews, deadViews });

describe("frustratedVersion (D656)", () => {
  it("is the two-proportion z, pooled", () => {
    // 5 % against 7 % of 2,000: (0.07 − 0.05) / sqrt(0.06 × 0.94 × (2 / 2000)) ≈ 2.663.
    expect(proportionZ(100, 2000, 140, 2000)).toBeCloseTo(2.663, 2);
    expect(proportionZ(0, 0, 5, 10)).toBe(0);
  });

  it("flags a version just above 3.29 and not just below, and nothing at 1,999 page views", () => {
    let x = 100;
    while (proportionZ(100, 2000, x, 2000) < FRUSTRATED_Z) x++;
    expect(proportionZ(100, 2000, x - 1, 2000)).toBeLessThan(FRUSTRATED_Z);
    expect(frustratedVersion([row("a", 2000, 100), row("b", 2000, x)], FLAG_VERSION_VIEWS)).toBe("b");
    expect(frustratedVersion([row("a", 2000, 100), row("b", 2000, x - 1)], FLAG_VERSION_VIEWS)).toBeNull();
    // Dead clicks count the same way; one page view short of 2,000 is never a flag, however clear.
    expect(frustratedVersion([row("a", 2000, 0, 100), row("b", 2000, 0, x)], FLAG_VERSION_VIEWS)).toBe("b");
    expect(frustratedVersion([row("a", 2000, 100), row("b", 1999, 1999)], FLAG_VERSION_VIEWS)).toBeNull();
  });

  it("never flags fewer frustrated clicks, too few page views, or the original", () => {
    expect(frustratedVersion([row("a", 2000, 300), row("b", 2000, 50)], FLAG_VERSION_VIEWS)).toBeNull();
    expect(frustratedVersion([row("a", 1999, 10), row("b", 5000, 900)], FLAG_VERSION_VIEWS)).toBeNull();
    expect(frustratedVersion([row("a", 5000, 10), row("b", 1999, 900)], FLAG_VERSION_VIEWS)).toBeNull();
    expect(frustratedVersion([row("b", 5000, 900)], FLAG_VERSION_VIEWS)).toBeNull();
  });

  it("names the first clearly worse version in order", () => {
    expect(frustratedVersion([row("c", 3000, 600), row("a", 3000, 100), row("b", 3000, 110)], FLAG_VERSION_VIEWS)).toBe("c");
    expect(frustratedVersion([row("c", 3000, 600), row("a", 3000, 100), row("b", 3000, 400)], FLAG_VERSION_VIEWS)).toBe("b");
  });
});
