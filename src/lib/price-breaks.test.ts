import { describe, expect, it } from "vitest";

import { breakSteps, priceBreakProblems, type PriceBreakInput } from "./price-breaks";

const parse = (_market: string, typed: string) => (/^\d+(,\d\d)?$/.test(typed) ? Math.round(Number(typed.replace(",", ".")) * 100) : null);
const step = (change: Partial<PriceBreakInput> = {}): PriceBreakInput => ({ variantSku: null, from: 10, percent: 10, prices: {}, ...change });

describe("a product's price breaks (D323)", () => {
  it("takes a percentage or prices, from 2 units, once per variant and quantity", () => {
    expect(priceBreakProblems([step(), step({ from: 50, percent: null, prices: { NO: "90,00" } })], ["MUG"], parse)).toEqual([]);
    expect(priceBreakProblems([step({ percent: null })], ["MUG"], parse)).toHaveLength(1);
    expect(priceBreakProblems([step({ prices: { NO: "90" } })], ["MUG"], parse)).toHaveLength(1);
    expect(priceBreakProblems([step({ percent: null, prices: { NO: "ninety" } })], ["MUG"], parse)).toHaveLength(1);
    expect(priceBreakProblems([step(), step()], ["MUG"], parse)).toHaveLength(1);
    expect(priceBreakProblems([step({ variantSku: "TEA" })], ["MUG"], parse)).toHaveLength(1);
    expect(priceBreakProblems([step({ from: 1 })], ["MUG"], parse)).toHaveLength(1);
    expect(priceBreakProblems(Array.from({ length: 11 }, (_, i) => step({ from: i + 2 })), ["MUG"], parse)).toHaveLength(1);
  });

  it("shows a row only where the price falls, and no table for one row", () => {
    expect(breakSteps([{ from: 1, amountMinor: 1000 }, { from: 10, amountMinor: 900 }, { from: 5, amountMinor: 950 }])).toEqual([
      { from: 1, amountMinor: 1000 },
      { from: 5, amountMinor: 950 },
      { from: 10, amountMinor: 900 },
    ]);
    // A break a lower one already beats (a list price lower than both) is left out.
    expect(breakSteps([{ from: 1, amountMinor: 800 }, { from: 10, amountMinor: 900 }])).toEqual([]);
    expect(breakSteps([{ from: 1, amountMinor: 1000 }, { from: 10, amountMinor: 900 }, { from: 20, amountMinor: 900 }])).toHaveLength(2);
  });
});
