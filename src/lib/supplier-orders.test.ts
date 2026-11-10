import { describe, expect, it } from "vitest";

import { isTrackingNumber, supplierLines, supplierWords } from "./supplier-orders";

describe("supplier orders' pure parts (D541)", () => {
  it("lays the units sold at a supplier over the order's lines of each variant, in order, never more than was bought", () => {
    const lines = [
      { id: "l1", variantId: "a", quantity: 2 },
      { id: "l2", variantId: "b", quantity: 1 },
      { id: "l3", variantId: "a", quantity: 3 },
      { id: "l4", variantId: null, quantity: 1 },
    ];
    expect(supplierLines([{ variantId: "a", units: 4 }], lines)).toEqual([
      { orderLineId: "l1", quantity: 2 },
      { orderLineId: "l3", quantity: 2 },
    ]);
    expect(supplierLines([{ variantId: "a", units: 99 }, { variantId: "b", units: 1 }], lines)).toEqual([
      { orderLineId: "l1", quantity: 2 },
      { orderLineId: "l2", quantity: 1 },
      { orderLineId: "l3", quantity: 3 },
    ]);
    expect(supplierLines([{ variantId: "c", units: 1 }], lines)).toEqual([]);
  });

  it("has every word in every language, and English for any other", () => {
    const keys = Object.keys(supplierWords("en")).sort();
    for (const lang of ["nb", "sv", "da"]) {
      const words = supplierWords(lang);
      expect(Object.keys(words).sort(), lang).toEqual(keys);
      for (const key of keys) expect(words[key as keyof typeof words], `${lang}.${key}`).not.toBe("");
    }
    expect(supplierWords("de")).toBe(supplierWords("en"));
  });

  it("keeps a tracking number of letters, digits, spaces and dashes", () => {
    expect(isTrackingNumber("00370712345678901234")).toBe(true);
    expect(isTrackingNumber("JJD 0001-2345")).toBe(true);
    expect(isTrackingNumber("ab")).toBe(false);
    expect(isTrackingNumber("<script>")).toBe(false);
  });
});
