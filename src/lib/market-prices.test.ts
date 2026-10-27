import { describe, expect, it } from "vitest";

import { toRates } from "./currency";
import { derivedPrice, ruleProblem, type MarketPriceRule } from "./market-prices";

/** Market price rules (D335 A.2): the one sum of a derived price, and what a rule may be. */

const rates = toRates([
  { currency: "NOK", rate: 11.5, roundTo: 1 },
  { currency: "SEK", rate: 11.25, roundTo: 1 },
  { currency: "EUR", rate: 1, roundTo: 1 },
  { currency: "HUF", rate: 400, roundTo: 100 },
]);
const rule = (r: Partial<MarketPriceRule> = {}) => ({ percentBps: 0, basis: "net" as const, roundToMinor: 1, endingMinor: null, ...r });
const nokToEur = { baseMinor: 115_000, baseCurrency: "NOK", baseVatPercent: 25, currency: "EUR", vatPercent: 25, rates };

describe("a derived price", () => {
  it("converts at the store's rates through the euro, exactly, and rounds once", () => {
    // 1,150.00 kr at 11.5 kr a euro is 100.00 € with the same VAT.
    expect(derivedPrice(rule(), nokToEur)).toBe(10_000);
    expect(derivedPrice(rule(), { ...nokToEur, currency: "SEK" })).toBe(112_500);
    // The same currency is the same price.
    expect(derivedPrice(rule(), { ...nokToEur, currency: "NOK" })).toBe(115_000);
  });

  it("keeps the price before VAT the same (net) or the price with VAT (gross)", () => {
    // 25 % in Norway, 19 % in Germany: 100.00 € with 25 % is 80.00 € before VAT, 95.20 € with 19 %.
    expect(derivedPrice(rule(), { ...nokToEur, vatPercent: 19 })).toBe(9_520);
    expect(derivedPrice(rule({ basis: "gross" }), { ...nokToEur, vatPercent: 19 })).toBe(10_000);
    // A reduced rate on both sides (food, 15 % and 7 %).
    expect(derivedPrice(rule(), { ...nokToEur, baseVatPercent: 15, vatPercent: 7 })).toBe(Math.round((10_000 * 107) / 115));
  });

  it("changes by the percentage, up or down", () => {
    expect(derivedPrice(rule({ percentBps: 1_000 }), nokToEur)).toBe(11_000);
    expect(derivedPrice(rule({ percentBps: -1_250 }), nokToEur)).toBe(8_750);
  });

  it("rounds half up to the step, or up to the next price with the ending", () => {
    // 100.00 € + 0.37 % = 100.37 €.
    const odd = rule({ percentBps: 37 });
    expect(derivedPrice(odd, nokToEur)).toBe(10_037);
    expect(derivedPrice({ ...odd, roundToMinor: 100 }, nokToEur)).toBe(10_000);
    expect(derivedPrice({ ...odd, roundToMinor: 100, endingMinor: 95 }, nokToEur)).toBe(10_095);
    expect(derivedPrice({ ...odd, roundToMinor: 1_000, endingMinor: 900 }, nokToEur)).toBe(10_900);
    // An exact price that already ends so stays.
    expect(derivedPrice(rule({ roundToMinor: 100, endingMinor: 0 }), nokToEur)).toBe(10_000);
    // Half up at the step's middle.
    expect(derivedPrice(rule({ percentBps: 50, roundToMinor: 100 }), nokToEur)).toBe(10_100);
  });

  it("goes between currencies with different minor units", () => {
    // 100.00 € at 400 Ft a euro is 40,000 Ft, kept in hundredths of a forint.
    expect(derivedPrice(rule(), { baseMinor: 10_000, baseCurrency: "EUR", baseVatPercent: 25, currency: "HUF", vatPercent: 27, rates })).toBe(Math.round((4_000_000 * 127) / 125));
  });

  it("gives nothing without a rate, and never below zero", () => {
    expect(derivedPrice(rule(), { ...nokToEur, currency: "DKK" })).toBeNull();
    expect(derivedPrice(rule({ percentBps: -9_000 }), { ...nokToEur, baseMinor: 0 })).toBe(0);
  });
});

describe("a rule", () => {
  const markets = ["NO", "SE", "DE"];
  const base: MarketPriceRule = { market: "SE", base: "NO", percentBps: 0, basis: "net", roundToMinor: 100, endingMinor: null };
  it("takes two of the store's countries, never itself, and never chains", () => {
    expect(ruleProblem(base, markets, [])).toBeNull();
    expect(ruleProblem({ ...base, base: "SE" }, markets, [])).toMatch(/itself/);
    expect(ruleProblem({ ...base, base: "US" }, markets, [])).toMatch(/store's countries/);
    expect(ruleProblem({ ...base, market: "DE", base: "SE" }, markets, [base])).toMatch(/takes its own prices/);
    expect(ruleProblem({ ...base, market: "NO", base: "DE" }, markets, [base])).toMatch(/Another country takes its prices from this one/);
    // Changing a rule is not a chain with itself.
    expect(ruleProblem({ ...base, percentBps: 500 }, markets, [base])).toBeNull();
  });

  it("keeps the change, the step and the ending within their bounds", () => {
    expect(ruleProblem({ ...base, percentBps: -9_500 }, markets, [])).toMatch(/at most/);
    expect(ruleProblem({ ...base, endingMinor: 100 }, markets, [])).toMatch(/below the rounding step/);
    expect(ruleProblem({ ...base, roundToMinor: 0 }, markets, [])).toMatch(/rounded/);
  });
});
