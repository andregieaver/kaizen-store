import { describe, expect, it } from "vitest";

import { chunks, makerGroups } from "./shopify-makers";

describe("who makes the copied products", () => {
  it("groups the products still without a maker by their Shopify vendor, most first, and marks the drafts Shopify sold", () => {
    const groups = makerGroups(
      [
        { vendor: "Nordic Wool", handle: "hat", active: true },
        { vendor: "Nordic Wool", handle: "scarf", active: false },
        { vendor: "Nordic Wool", handle: "mitten", active: true },
        { vendor: "Fjell", handle: "boot", active: true },
        { vendor: "Fjell", handle: "named", active: true },
        { vendor: "", handle: "loose", active: true },
        { vendor: "Gone", handle: "not-here", active: true },
        { vendor: "Old", handle: "archived", active: true },
      ],
      [
        { id: "1", handle: "hat", manufacturerId: null, status: "draft" },
        { id: "2", handle: "scarf", manufacturerId: null, status: "draft" },
        { id: "3", handle: "mitten", manufacturerId: null, status: "active" },
        { id: "4", handle: "boot", manufacturerId: null, status: "draft" },
        { id: "5", handle: "named", manufacturerId: "m", status: "active" },
        { id: "6", handle: "loose", manufacturerId: null, status: "draft" },
        { id: "7", handle: "archived", manufacturerId: null, status: "archived" },
      ],
    );
    expect(groups).toEqual([
      { vendor: "Nordic Wool", productIds: ["1", "2", "3"], publishIds: ["1"] },
      { vendor: "", productIds: ["6"], publishIds: ["6"] },
      { vendor: "Fjell", productIds: ["4"], publishIds: ["4"] },
    ]);
  });

  it("cuts a list into pieces", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});
