import { describe, expect, it } from "vitest";

import { bundleStock, computedBundlePrice, type BundlePart } from "./bundles";

const part = (quantity: number, inStock: number, prices: Record<string, number>, usable = true): BundlePart => ({ quantity, inStock, prices, usable });

describe("a bundle's preview (D322)", () => {
  it("prices the parts less the percentage, half up, as the database does", () => {
    expect(computedBundlePrice([part(2, 7, { NO: 10000 }), part(1, 3, { NO: 5000 })], "NO", 15)).toEqual({ sumMinor: 25000, priceMinor: 21250 });
    expect(computedBundlePrice([part(2, 7, { NO: 10000 }), part(1, 3, { NO: 5001 })], "NO", 15)).toEqual({ sumMinor: 25001, priceMinor: 21251 });
    expect(computedBundlePrice([part(1, 1, { NO: 999 })], "NO", 0)).toEqual({ sumMinor: 999, priceMinor: 999 });
  });

  it("has no computed price where a part has none", () => {
    expect(computedBundlePrice([part(1, 1, { NO: 100 }), part(1, 1, {})], "NO", 10)).toBeNull();
    expect(computedBundlePrice([], "NO", 10)).toBeNull();
  });

  it("is in stock as far as every part allows, never below zero, and not at all with an unusable part or one unit", () => {
    expect(bundleStock([part(2, 7, {}), part(1, 3, {})])).toBe(3);
    expect(bundleStock([part(2, 7, {}), part(1, -2, {})])).toBe(0);
    expect(bundleStock([part(2, 7, {}), part(1, 3, {}, false)])).toBe(0);
    expect(bundleStock([part(1, 9, {})])).toBe(0);
    expect(bundleStock([part(2, 9, {})])).toBe(4);
  });
});
