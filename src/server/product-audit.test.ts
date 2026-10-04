import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { priceChanges } = await import("./product-audit");

const price = (sku: string, market: string, amountMinor: number, currency = "NOK") => ({ sku, market, currency, amountMinor });

describe("the price entries between two reads of a product's current prices", () => {
  it("is empty when nothing changed", () => {
    expect(priceChanges([price("A", "NO", 24900)], [price("A", "NO", 24900)])).toEqual([]);
    expect(priceChanges([], [])).toEqual([]);
  });

  it("gives one entry for each variant and market whose price changed, in minor units with the currency", () => {
    expect(priceChanges([price("A", "NO", 24900), price("A", "SE", 26900, "SEK"), price("B", "NO", 1000)], [price("A", "NO", 19900), price("A", "SE", 26900, "SEK"), price("B", "NO", 1000)])).toEqual([
      { sku: "A", market: "NO", currency: "NOK", from: 24900, to: 19900 },
    ]);
  });

  it("writes a first price from null and an ended price to null", () => {
    expect(priceChanges([price("A", "NO", 24900)], [price("A", "NO", 24900), price("A", "SE", 26900, "SEK")])).toEqual([{ sku: "A", market: "SE", currency: "SEK", from: null, to: 26900 }]);
    expect(priceChanges([price("A", "NO", 24900), price("A", "SE", 26900, "SEK")], [price("A", "NO", 24900)])).toEqual([{ sku: "A", market: "SE", currency: "SEK", from: 26900, to: null }]);
  });

  it("tells a SKU in two markets apart, and two SKUs in one", () => {
    const changes = priceChanges([price("A", "NO", 1), price("B", "NO", 2)], [price("A", "NO", 3), price("B", "NO", 4)]);
    expect(changes.map((c) => [c.sku, c.from, c.to])).toEqual([["A", 1, 3], ["B", 2, 4]]);
  });
});
