import { describe, expect, it } from "vitest";

import { cartSaving, freeShippingState, lineSaving, productSaving } from "./shop-notes";
import { drawsOn, noteRolesOf } from "./store-parts";

const rate = { amountMinor: 9900, freeOverMinor: 100_000 };

describe("free shipping (D557)", () => {
  it("says how much is left, with a bar short of full", () => {
    expect(freeShippingState(rate, 25_000, true, false)).toEqual({ kind: "short", thresholdMinor: 100_000, leftMinor: 75_000, percent: 25 });
    expect(freeShippingState(rate, 99_999, true, false)).toMatchObject({ kind: "short", leftMinor: 1, percent: 99 });
  });

  it("is reached at the threshold, as checkout's shippingCost() makes it free", () => {
    expect(freeShippingState(rate, 100_000, true, false)).toEqual({ kind: "reached", thresholdMinor: 100_000 });
  });

  it("offers the threshold to an empty cart and says nothing without one, or for downloads alone", () => {
    expect(freeShippingState(rate, 0, true, true)).toEqual({ kind: "empty", thresholdMinor: 100_000 });
    expect(freeShippingState({ amountMinor: 9900, freeOverMinor: null }, 0, true, false)).toBeNull();
    expect(freeShippingState({ amountMinor: 0, freeOverMinor: 50_000 }, 0, true, false)).toBeNull();
    expect(freeShippingState(rate, 10_000, false, false)).toBeNull();
    expect(freeShippingState(null, 0, true, true)).toBeNull();
  });
});

describe("what is saved (D557)", () => {
  it("counts only a genuine reduction against the 30-day lowest price", () => {
    expect(lineSaving({ unitPriceMinor: 24_900, quantity: 2, priorMinor: 29_900, ownPrice: false })).toBe(10_000);
    expect(lineSaving({ unitPriceMinor: 29_900, quantity: 2, priorMinor: 24_900, ownPrice: false })).toBe(0);
    expect(lineSaving({ unitPriceMinor: 24_900, quantity: 1, priorMinor: null, ownPrice: false })).toBe(0);
  });

  it("never calls a price list's, break's or subscription's price a reduction", () => {
    expect(lineSaving({ unitPriceMinor: 20_000, quantity: 1, priorMinor: 29_900, ownPrice: true })).toBe(0);
  });

  it("adds the cart's discounts", () => {
    const lines = [{ unitPriceMinor: 24_900, quantity: 1, priorMinor: 29_900, ownPrice: false }];
    expect(cartSaving(lines, 1_000)).toEqual({ reductionsMinor: 5_000, discountMinor: 1_000, totalMinor: 6_000 });
    expect(cartSaving([], -5).totalMinor).toBe(0);
  });

  it("is a product's reference less its price", () => {
    expect(productSaving({ amountMinor: 24_900, referenceMinor: 29_900 })).toBe(5_000);
    expect(productSaving({ amountMinor: 24_900, referenceMinor: null })).toBe(0);
  });
});

describe("where the notes draw and are offered", () => {
  it("draws on the cart, checkout, category and tag pages only", () => {
    for (const route of ["cart", "checkout", "category", "tag"] as const) expect(drawsOn("free_shipping", route)).toBe(true);
    expect(drawsOn("you_saved", "account")).toBe(false);
    expect(drawsOn("cart_lines", "cart")).toBe(true);
    expect(drawsOn("cart_lines", "checkout")).toBe(false);
  });

  it("is offered only on a page chosen for one of those roles", () => {
    expect(noteRolesOf(["category"])).toBe(true);
    expect(noteRolesOf(["blog"])).toBe(false);
    expect(noteRolesOf([])).toBe(false);
  });
});
