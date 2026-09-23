import { describe, expect, it } from "vitest";

import { MAX_LINE_QUANTITY, cartSubtotal, settleQuantity } from "./cart";

describe("settleQuantity", () => {
  it("gives the shopper what they asked for when stock allows", () => {
    expect(settleQuantity(2, 10)).toEqual({ quantity: 2, outcome: "added" });
  });

  it("caps at the stock available", () => {
    expect(settleQuantity(5, 3)).toEqual({ quantity: 3, outcome: "capped" });
  });

  it("caps at the per-line maximum", () => {
    expect(settleQuantity(50, 500)).toEqual({
      quantity: MAX_LINE_QUANTITY,
      outcome: "capped",
    });
  });

  it("refuses when nothing can be sold", () => {
    expect(settleQuantity(1, 0)).toEqual({ quantity: 0, outcome: "unavailable" });
    expect(settleQuantity(1, -2)).toEqual({ quantity: 0, outcome: "unavailable" });
  });
});

describe("cartSubtotal", () => {
  it("adds up unit price times quantity in minor units", () => {
    expect(
      cartSubtotal([
        { unitPriceMinor: 24900, quantity: 2 },
        { unitPriceMinor: 12900, quantity: 1 },
      ]),
    ).toBe(62700);
    expect(cartSubtotal([])).toBe(0);
  });
});
