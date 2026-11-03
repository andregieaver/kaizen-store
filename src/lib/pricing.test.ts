import { describe, expect, it } from "vitest";

import { priceView, stockLevel, styledPrice, WITH_VAT } from "./pricing";

describe("priceView", () => {
  it("shows the 30-day reference only for a genuine reduction", () => {
    expect(priceView(24900, "NOK", 29900).referenceMinor).toBe(29900);
  });

  it("hides the reference when the price is not lower", () => {
    expect(priceView(24900, "NOK", 24900).referenceMinor).toBeNull();
    expect(priceView(24900, "NOK", 19900).referenceMinor).toBeNull();
  });

  it("hides the reference for a first price with no history", () => {
    expect(priceView(24900, "NOK", null).referenceMinor).toBeNull();
  });
});

describe("priceView and the unit price's measure (D160)", () => {
  it("carries no measure unless one is given", () => {
    expect(priceView(24900, "NOK", null).measure).toBeNull();
  });

  it("carries the measure the market shows, beside the price and never in the reference", () => {
    const measure = { amount: "250", unit: "g" as const, base: "kg" as const };
    const view = priceView(24900, "NOK", 29900, WITH_VAT, measure);
    expect(view.measure).toEqual(measure);
    expect(view.referenceMinor).toBe(29900);
    expect(view.amountMinor).toBe(24900);
  });
});

describe("stockLevel", () => {
  it("reports out, low and in stock", () => {
    expect(stockLevel(0)).toBe("out");
    expect(stockLevel(-2)).toBe("out");
    expect(stockLevel(3)).toBe("low");
    expect(stockLevel(5)).toBe("low");
    expect(stockLevel(6)).toBe("in_stock");
  });
});

// D429: a product's price as its market shows it.
describe("styledPrice", () => {
  const view = priceView(49900, "NOK", 59900);
  const style = { decimals: "hide_whole" as const, words: { byLocale: { "nb-NO": { prefix: "Kun", suffix: ",-" } }, main: "nb-NO" } };

  it("carries the market's decimals and the store's words in the shopper's language", () => {
    expect(styledPrice(view, style, { mode: "inherit" }, "nb-NO")).toEqual({ ...view, decimals: "hide_whole", words: { prefix: "Kun", suffix: ",-" } });
  });

  it("leaves both out where the market keeps its decimals and the product shows no words", () => {
    expect(styledPrice(view, { decimals: "always" }, { mode: "none" }, "nb-NO")).toEqual(view);
    expect(styledPrice(view, undefined, { mode: "inherit" }, "nb-NO")).toEqual(view);
  });

  it("takes the product's own words over the store's", () => {
    expect(styledPrice(view, style, { mode: "own", words: { "nb-NO": { prefix: "", suffix: "/stk" } } }, "nb-NO").words).toEqual({ prefix: "", suffix: "/stk" });
  });
});
