import { describe, expect, it } from "vitest";

import { t } from "./i18n";
import { cleanShopTiles, DEFAULT_PRODUCT_SETTINGS, tileAsk, tileAskFor, tileShows, tileStockFact, tileStockText, type TileVariant } from "./shop-tiles";

const v = (over: Partial<TileVariant> = {}): TileVariant => ({ inStock: 10, canOffer: true, backorderDays: null, preorderUntil: null, unlimited: false, ...over });

describe("a grid's choices and the store's settings (D557)", () => {
  it("follows the store unless the grid says otherwise", () => {
    expect(tileAsk(undefined)).toEqual({ stock: "store", quantity: "store" });
    expect(tileShows(tileAsk(undefined)!, { tileStock: true, tileQuantity: false })).toEqual({ stock: true, quantity: false });
    expect(tileShows(tileAsk({ quantity: "show" })!, { tileStock: false, tileQuantity: false })).toEqual({ stock: false, quantity: true });
  });

  it("asks nothing for a grid that hides both", () => {
    expect(tileAsk({ stock: "hide", quantity: "hide" })).toBeNull();
    expect(tileShows(tileAsk({ stock: "hide" })!, { tileStock: true, tileQuantity: true })).toEqual({ stock: false, quantity: true });
  });

  it("keeps only show and hide", () => {
    expect(cleanShopTiles({ stock: "show", quantity: "maybe" })).toEqual({ stock: "show" });
    expect(cleanShopTiles({})).toBeUndefined();
    expect(cleanShopTiles("show")).toBeUndefined();
  });
});

describe("a tile's stock in words", () => {
  it("says nothing for what has no stock to count", () => {
    expect(tileStockFact([], 5)).toBeNull();
    expect(tileStockFact([v({ unlimited: true })], 5)).toBeNull();
  });

  it("counts a low sum across variants and calls the rest in stock", () => {
    expect(tileStockFact([v({ inStock: 2 }), v({ inStock: 1 })], 5)).toEqual({ kind: "low", left: 3 });
    expect(tileStockFact([v({ inStock: 20 })], 5)).toEqual({ kind: "in_stock" });
  });

  it("is sold out only when nothing can be offered, and never calls a backorder in stock", () => {
    expect(tileStockFact([v({ inStock: 0, canOffer: false })], 5)).toEqual({ kind: "out" });
    expect(tileStockFact([v({ inStock: 0, backorderDays: 7 })], 5)).toEqual({ kind: "backorder", days: 7 });
    expect(tileStockFact([v({ inStock: 4, preorderUntil: "2027-01-15" })], 5)).toEqual({ kind: "preorder", until: "2027-01-15" });
  });

  it("uses the product page's own sentences", () => {
    const m = t("en");
    expect(tileStockText({ kind: "low", left: 3 }, m, "en-GB")).toBe(m.lowStock(3));
    expect(tileStockText({ kind: "out" }, m, "en-GB")).toBe(m.outOfStock);
    expect(tileStockText({ kind: "backorder", days: 2 }, m, "en-GB")).toBe(m.backorder.page(2));
  });
});

describe("tileAskFor", () => {
  it("gives no ask for a grid that follows a store with both switches off", () => {
    expect(tileAskFor(undefined, DEFAULT_PRODUCT_SETTINGS)).toBeNull();
  });
  it("keeps a grid's own show, and nothing for the part that does not show", () => {
    expect(tileAskFor({ stock: "show" }, DEFAULT_PRODUCT_SETTINGS)).toEqual({ stock: "show", quantity: null });
  });
  it("keeps the store's word for a part the store switched on", () => {
    expect(tileAskFor(undefined, { tileStock: true, tileQuantity: false })).toEqual({ stock: "store", quantity: null });
  });
  it("lets the store never beat a grid's own hide", () => {
    expect(tileAskFor({ stock: "hide", quantity: "hide" }, { tileStock: true, tileQuantity: true })).toBeNull();
  });
});
