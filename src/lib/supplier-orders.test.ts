import { describe, expect, it } from "vitest";

import { isTrackingNumber, supplierLines, supplierWords } from "./supplier-orders";

describe("supplier orders' pure parts (D551)", () => {
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

describe("a late supplier and the shopper's promise (D553)", () => {
  it("counts weekends and a day's grace into the days before a supplier is late", async () => {
    const { lateAfterDays } = await import("./supplier-orders");
    expect(lateAfterDays(1)).toBe(3);
    expect(lateAfterDays(2)).toBe(4);
    expect(lateAfterDays(5)).toBe(8);
    expect(lateAfterDays(0)).toBe(3);
  });

  it("says the supplier's days beside in stock, in every language", async () => {
    const { stockNote } = await import("./stock-words");
    const { t } = await import("./i18n");
    const stock = { inStock: 25, rawAvailable: 25, stockPolicy: "deny" as const, backorderDays: null, canBuy: true, preorderUntil: null, supplierDays: 3 };
    expect(stockNote(stock, t("en"))).toBe("In stock: sent within 3 working days");
    expect(stockNote(stock, t("nb"))).toBe("På lager: sendes innen 3 virkedager");
    expect(stockNote({ ...stock, supplierDays: 1 }, t("sv"))).toBe("I lager: skickas inom 1 arbetsdag");
    expect(stockNote({ ...stock, supplierDays: null }, t("da"))).toBe(t("da").inStock);
  });
});
