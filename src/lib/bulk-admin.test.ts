import { describe, expect, it } from "vitest";

import { BULK_GRID_MAX_PRODUCTS, BULK_MAX_PRODUCTS } from "./data-limits";
import { buildBulkRequest, cappedNote, changedCellCount, changedEdits, emptyPanel, figureText, fieldWords, gridSelectionProblem, type GridCells } from "./bulk-admin";

const terms = [
  { id: "c1", kind: "category" as const },
  { id: "t1", kind: "tag" as const },
];

describe("buildBulkRequest", () => {
  const ids = ["p1", "p2"];
  it("makes each action's request", () => {
    const form = emptyPanel("NO");
    expect(buildBulkRequest("status", { ...form, to: "draft" }, ids, terms)).toEqual({ ok: true, request: { action: "status", productIds: ids, to: "draft" } });
    expect(buildBulkRequest("archive", form, ids, terms)).toEqual({ ok: true, request: { action: "archive", productIds: ids } });
    expect(buildBulkRequest("unarchive", form, ids, terms)).toEqual({ ok: true, request: { action: "unarchive", productIds: ids } });
    expect(buildBulkRequest("stock", { ...form, stock: " +5 " }, ids, terms)).toEqual({ ok: true, request: { action: "stock", productIds: ids, change: "+5" } });
  });

  it("splits chosen terms into categories and tags", () => {
    const r = buildBulkRequest("terms_add", { ...emptyPanel("NO"), termIds: ["c1", "t1"] }, ["p1"], terms);
    expect(r).toEqual({ ok: true, request: { action: "terms_add", productIds: ["p1"], categoryIds: ["c1"], tagIds: ["t1"] } });
    expect(buildBulkRequest("terms_remove", emptyPanel("NO"), ["p1"], terms)).toEqual({ ok: false, problem: "Choose at least one category or tag." });
  });

  it("needs a percentage, or an amount for every chosen market, never one amount across currencies", () => {
    const base = emptyPanel("NO");
    expect(buildBulkRequest("price", base, ["p1"], terms)).toEqual({ ok: false, problem: "Write a percentage, such as -10 or 5.5." });
    expect(buildBulkRequest("price", { ...base, percent: "-10" }, ["p1"], terms)).toEqual({ ok: true, request: { action: "price", productIds: ["p1"], markets: ["NO"], percent: "-10" } });
    const amount = { ...base, mode: "amount" as const, markets: ["NO", "SE"], amounts: { NO: "5" } };
    expect(buildBulkRequest("price", amount, ["p1"], terms)).toEqual({ ok: false, problem: "Write an amount for SE: an amount is never applied across currencies." });
    expect(buildBulkRequest("price", { ...amount, amounts: { NO: "5", SE: " 50 " } }, ["p1"], terms)).toEqual({
      ok: true,
      request: { action: "price", productIds: ["p1"], markets: ["NO", "SE"], amounts: { NO: "5", SE: "50" } },
    });
    expect(buildBulkRequest("price", { ...base, markets: [] }, ["p1"], terms)).toEqual({ ok: false, problem: "Choose at least one market." });
  });

  it("asks for a stock figure", () => {
    expect(buildBulkRequest("stock", emptyPanel("NO"), ["p1"], terms).ok).toBe(false);
  });
});

describe("limits in words", () => {
  it("names the grid's and the list's limits", () => {
    expect(gridSelectionProblem(0)).toMatch(/at least one/);
    expect(gridSelectionProblem(BULK_GRID_MAX_PRODUCTS)).toBeNull();
    expect(gridSelectionProblem(BULK_GRID_MAX_PRODUCTS + 1)).toContain(String(BULK_GRID_MAX_PRODUCTS));
    expect(cappedNote(BULK_MAX_PRODUCTS)).toBeNull();
    expect(cappedNote(BULK_MAX_PRODUCTS + 1)).toContain(String(BULK_MAX_PRODUCTS));
  });
});

describe("the grid's changed rows", () => {
  const cells = (over: Partial<GridCells> = {}): GridCells => ({ sku: "A", stock: "3", cost: "", prices: { NO: "100,00" }, ...over });
  const rows = [
    { productId: "p1", variantId: "v1", loaded: cells() },
    { productId: "p1", variantId: "v2", loaded: cells({ sku: "B" }) },
  ];

  it("sends only the rows that differ from what was loaded, with the loaded values", () => {
    const edits = changedEdits(rows, { v1: cells(), v2: cells({ sku: "B", prices: { NO: "120,00" } }) });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ variantId: "v2", loaded: rows[1].loaded });
    expect(changedCellCount(edits)).toBe(1);
  });

  it("counts every changed cell", () => {
    const edits = changedEdits(rows, { v1: cells({ sku: "Z", stock: "9", cost: "5", prices: { NO: "1,00" } }) });
    expect(changedCellCount(edits)).toBe(4);
  });

  it("treats a missing price as blank", () => {
    expect(changedEdits(rows, { v1: cells({ prices: {} }) })).toHaveLength(1);
    expect(changedEdits([{ productId: "p", variantId: "v", loaded: cells({ prices: {} }) }], { v: cells({ prices: { NO: "" } }) })).toHaveLength(0);
  });
});

describe("figures", () => {
  const currencyOf = (field: string) => (field === "price:NO" ? "NOK" : field === "cost" ? "NOK" : null);
  it("shows prices as money, stock and SKU as they are", () => {
    expect(figureText("price:NO", 12500, currencyOf, "en-GB")).toContain("125");
    expect(figureText("stock", 7, currencyOf, "en-GB")).toBe("7");
    expect(figureText("sku", "A-1", currencyOf, "en-GB")).toBe("A-1");
    expect(figureText("price:NO", null, currencyOf, "en-GB")).toBe("none");
    expect(figureText("archived", true, currencyOf, "en-GB")).toBe("archived");
    expect(figureText("terms", { categories: ["a"], tags: [] }, currencyOf, "en-GB")).toBe("1 category, 0 tags");
  });
  it("names fields", () => {
    expect(fieldWords("price:SE")).toBe("Price (SE)");
    expect(fieldWords("sku")).toBe("SKU");
  });
});
