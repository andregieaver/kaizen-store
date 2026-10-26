import { describe, expect, it } from "vitest";

import { filterVariants, setForShown, skuFromPattern, skuPatternProblem, skuWord, visibleRange, type GridVariant } from "./variant-grid";

const variant = (colour: string, size: string, extra: Partial<GridVariant> = {}): GridVariant => ({
  options: { Farge: colour, Størrelse: size },
  sku: `G-${colour}-${size}`,
  prices: { NO: "499,00", SE: "549,00" },
  stock: 2,
  weightGrams: null,
  active: true,
  delivery: "physical",
  ...extra,
});

const grid = ["Rød", "Blå", "Grønn"].flatMap((c) => ["S", "M", "L"].map((s) => variant(c, s)));

describe("the variant grid's filter", () => {
  it("shows the variants with every value chosen, all of them with none", () => {
    expect(filterVariants(grid, {})).toHaveLength(9);
    expect(filterVariants(grid, { Farge: "Blå" })).toEqual([3, 4, 5]);
    expect(filterVariants(grid, { Farge: "Blå", Størrelse: "L" })).toEqual([5]);
    expect(filterVariants(grid, { Farge: "", Størrelse: "M" })).toEqual([1, 4, 7]);
    expect(filterVariants(grid, { Farge: "Gul" })).toEqual([]);
  });
});

describe("a SKU pattern", () => {
  it("fills the handle, the place and each option's value as SKU words, in any case of the name", () => {
    expect(skuWord("Lys blå / ekstra")).toBe("LYS-BLA-EKSTRA");
    expect(skuWord("Grønn")).toBe("GRØNN");
    expect(skuFromPattern("{handle}-{farge}-{STØRRELSE}", "ull-genser", { Farge: "Rød", Størrelse: "XL" }, 3)).toBe("ULL-GENSER-RØD-XL");
    expect(skuFromPattern("G{n}", "x", {}, 12)).toBe("G12");
    // A token that is no option stays as typed, and a SKU is at most 64 characters.
    expect(skuFromPattern("{Passform}-{Farge}", "x", { Farge: "Rød" }, 1)).toBe("{Passform}-RØD");
    expect(skuFromPattern("A".repeat(80), "x", {}, 1)).toHaveLength(64);
  });

  it("says when a token is no option, or two variants would share a SKU, counting those not shown as they are", () => {
    const all = filterVariants(grid, {});
    expect(skuPatternProblem("{handle}-{Farge}-{Størrelse}", "genser", grid, all)).toBeNull();
    expect(skuPatternProblem("{handle}-{Farge}", "genser", grid, all)).toEqual({ kind: "repeats", sku: "genser-rød" });
    expect(skuPatternProblem("{Passform}", "genser", grid, all)).toEqual({ kind: "unknown", token: "Passform" });
    // Only the blue ones from the pattern: "G-{Størrelse}" gives G-S, which no other variant has (they are G-Rød-S, …).
    expect(skuPatternProblem("G-{Størrelse}", "genser", grid, filterVariants(grid, { Farge: "Blå" }))).toBeNull();
    // A pattern that makes a blue variant's SKU the same as a red one's as it is.
    expect(skuPatternProblem("G-Rød-{Størrelse}", "genser", grid, filterVariants(grid, { Farge: "Blå" }))).toEqual({ kind: "repeats", sku: "g-rød-s" });
  });
});

describe("Set for all shown", () => {
  it("writes only what was filled in, only on the variants shown, and leaves the others as they were", () => {
    const shown = filterVariants(grid, { Størrelse: "L" });
    const next = setForShown(grid, shown, { prices: { NO: "599,00", SE: " " }, stock: 7, active: false }, "genser");
    for (const i of shown) expect(next[i]).toMatchObject({ prices: { NO: "599,00", SE: "549,00" }, stock: 7, active: false, sku: grid[i].sku });
    for (const i of [0, 1, 3, 4, 6, 7]) expect(next[i]).toBe(grid[i]);
  });

  it("gives stock and weight only to variants that are shipped, and SKUs from the pattern", () => {
    const mixed = [variant("Rød", "S"), variant("Rød", "M", { delivery: "digital", stock: 0 })];
    const next = setForShown(mixed, [0, 1], { stock: 5, weightGrams: 300, skuPattern: "{Farge}-{Størrelse}" }, "genser");
    expect(next[0]).toMatchObject({ stock: 5, weightGrams: 300, sku: "RØD-S" });
    expect(next[1]).toMatchObject({ stock: 0, weightGrams: null, sku: "RØD-M" });
  });
});

describe("the rows on screen", () => {
  const heights = Array.from({ length: 100 }, () => 50);

  it("draws the rows between the top and the bottom, widened by the overscan, with the height of the rest above and below", () => {
    expect(visibleRange(heights, 0, 500, 0)).toEqual({ start: 0, end: 10, before: 0, after: 4500 });
    expect(visibleRange(heights, 1000, 1500, 100)).toEqual({ start: 18, end: 32, before: 900, after: 3400 });
    expect(visibleRange(heights, 4900, 6000, 0)).toEqual({ start: 98, end: 100, before: 4900, after: 0 });
  });

  it("takes each row's own height, and nothing when the list is above or below the screen", () => {
    expect(visibleRange([100, 20, 20, 300, 20], 110, 150, 0)).toEqual({ start: 1, end: 4, before: 100, after: 20 });
    expect(visibleRange(heights, 9000, 9500, 0)).toEqual({ start: 100, end: 100, before: 5000, after: 0 });
    expect(visibleRange(heights, -800, -100, 0)).toEqual({ start: 0, end: 0, before: 0, after: 5000 });
    expect(visibleRange([], 0, 500, 100)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
  });
});
