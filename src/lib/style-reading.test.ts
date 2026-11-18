import { describe, expect, it } from "vitest";

import { styleOver, styleSummary, type StyleRow } from "./style-reading";

const row = (cssBytes: number, pages = 0, motionPages = 0): StyleRow => ({ storeId: null, slug: null, name: null, cssBytes, pages, motionPages });

describe("style reading", () => {
  it("takes the median and counts the stores over the line", () => {
    const summary = styleSummary([row(1_000), row(12_000), row(25_600)]);
    expect(summary.medianBytes).toBe(12_000);
    expect(summary.over).toBe(1);
    expect(summary.triggers).toEqual(expect.arrayContaining(["median", "store"]));
  });

  it("marks a store only above 20,000 bytes", () => {
    expect(styleOver(row(20_000))).toBe(false);
    expect(styleOver(row(20_001))).toBe(true);
  });

  it("triggers on motion only when under half of published pages use it", () => {
    const four = styleSummary([row(0, 10, 4)]);
    expect(four.motionShare).toBe(0.4);
    expect(four.triggers).toContain("motion");
    expect(styleSummary([row(0, 10, 5)]).triggers).not.toContain("motion");
  });

  it("reads no rows as nothing", () => {
    const none = styleSummary([]);
    expect(none.medianBytes).toBe(0);
    expect(none.motionShare).toBeNull();
    expect(none.triggers).toEqual([]);
  });
});
