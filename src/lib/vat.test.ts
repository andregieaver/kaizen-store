import { describe, expect, it } from "vitest";

import {
  BUILT_IN_VAT_CATEGORIES,
  VAT_CATEGORY_CODE,
  categoriesFor,
  describeRate,
  isBuiltInVatCategory,
  parseVatCategory,
  ratePercent,
  type VatCategoryRow,
} from "./vat";

const row = (code: string, over: Partial<VatCategoryRow> = {}): VatCategoryRow => ({
  code, nameEn: code, description: "", sort: 0, active: true, builtIn: false, ...over,
});

describe("categories", () => {
  it("has three built in", () => {
    expect([...BUILT_IN_VAT_CATEGORIES]).toEqual(["standard", "accommodation", "exempt"]);
    expect(isBuiltInVatCategory("exempt")).toBe(true);
    expect(isBuiltInVatCategory("food")).toBe(false);
  });

  it("has codes of one shape", () => {
    for (const ok of ["food", "culture_events", "children_goods", "a1"]) expect(VAT_CATEGORY_CODE.test(ok)).toBe(true);
    for (const bad of ["", "a", "Food", "1food", "food-and-drink", "a".repeat(32), "fo od", "food;"]) expect(VAT_CATEGORY_CODE.test(bad)).toBe(false);
  });

  it("reads a code from the outside, standard when it is not one", () => {
    expect(parseVatCategory("food")).toBe("food");
    expect(parseVatCategory("Food")).toBe("standard");
    expect(parseVatCategory(undefined)).toBe("standard");
    expect(parseVatCategory(7)).toBe("standard");
    expect(parseVatCategory("food", ["standard"])).toBe("standard");
    expect(parseVatCategory("food", ["standard", "food"])).toBe("food");
  });
});

describe("describing a rate", () => {
  it("shows a percentage", () => {
    expect(ratePercent(0.255)).toBe("25.5 %");
    expect(ratePercent(0.07)).toBe("7 %");
    expect(ratePercent(0)).toBe("0 %");
  });

  it("says the standard rate applies where no reduced rate is known, never silently another number", () => {
    expect(describeRate({ category: "food", rate: 0.25, standardRate: 0.25, hasRow: false })).toEqual({
      text: "no reduced rate known here: the standard rate (25 %) applies",
      fallback: true,
    });
    expect(describeRate({ category: "food", rate: 0.15, standardRate: 0.25, hasRow: true })).toEqual({ text: "15 %", fallback: false });
    expect(describeRate({ category: "standard", rate: 0.25, standardRate: 0.25, hasRow: true })).toEqual({ text: "25 %", fallback: false });
    expect(describeRate({ category: "exempt", rate: 0, standardRate: 0.25, hasRow: false })).toEqual({ text: "no VAT", fallback: false });
  });
});

describe("the categories an owner can choose", () => {
  const all = [
    row("standard", { sort: 0, builtIn: true }),
    row("accommodation", { sort: 10, builtIn: true }),
    row("food", { sort: 20 }),
    row("old", { sort: 25, active: false }),
    row("books", { sort: 30 }),
  ];

  it("lists the active ones in order, accommodation only for stays and rentals", () => {
    expect(categoriesFor(all, { kind: "goods", current: "standard" }).map((c) => c.code)).toEqual(["standard", "food", "books"]);
    expect(categoriesFor(all, { kind: "stay", current: "standard" }).map((c) => c.code)).toEqual(["standard", "accommodation", "food", "books"]);
    expect(categoriesFor(all, { kind: "rental", current: "standard" }).map((c) => c.code)).toContain("accommodation");
  });

  it("keeps a category the product already has, marked inactive when it was switched off", () => {
    const list = categoriesFor(all, { kind: "goods", current: "old" });
    expect(list.find((c) => c.code === "old")).toMatchObject({ inactive: true });
    expect(list.find((c) => c.code === "food")).toMatchObject({ inactive: false });
  });

  it("keeps accommodation on a product that has it even if it is not a stay", () => {
    expect(categoriesFor(all, { kind: "goods", current: "accommodation" }).map((c) => c.code)).toContain("accommodation");
  });
});
