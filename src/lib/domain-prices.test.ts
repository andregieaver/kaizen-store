import { describe, expect, it } from "vitest";

import { billingCurrency, convertCost, domainPrice } from "./domain-prices";

// ECB rates as stored: units per 1 EUR.
const RATES = { USD: "1.0800", NOK: "11.6000", SEK: "11.2000", DKK: "7.4600" };
const NOK = { currency: "NOK", marginBps: 2500, minimumMinor: 15000, roundMinor: 1000 };
const EUR = { currency: "EUR", marginBps: 2500, minimumMinor: 1500, roundMinor: 100 };

describe("domain prices (D315 decision 3)", () => {
  it("converts the registrar's dollars at the ECB rate, rounding up", () => {
    // 11.25 USD / 1.08 * 11.6 = 120.8333… NOK → 12084 øre.
    expect(convertCost("11.25", "USD", "NOK", RATES)).toBe(BigInt(12084));
    // 11.25 USD / 1.08 = 10.41666… EUR → 1042 cents.
    expect(convertCost("11.25", "USD", "EUR", RATES)).toBe(BigInt(1042));
    expect(convertCost(11.25, "USD", "EUR", RATES)).toBe(BigInt(1042));
    expect(convertCost("11.25", "USD", "ISK", RATES)).toBeNull();
    expect(convertCost("x", "USD", "EUR", RATES)).toBeNull();
  });

  it("adds the margin, rounds up to the step, and keeps the floor a year", () => {
    // 120.84 NOK * 1.25 = 151.05 → rounded up to 160 kr.
    expect(domainPrice("11.25", "USD", 1, NOK, RATES)).toBe(16000);
    // A 2.99 USD introductory price is below the floor: 150 kr.
    expect(domainPrice("2.99", "USD", 1, NOK, RATES)).toBe(15000);
    // Two years: the floor is twice as high.
    expect(domainPrice("2.99", "USD", 2, NOK, RATES)).toBe(30000);
    // 38.39 USD renewal in euro: 35.546… * 1.25 = 44.43 → €45.
    expect(domainPrice("38.39", "USD", 1, EUR, RATES)).toBe(4500);
    expect(domainPrice("38.39", "USD", 1, { ...EUR, currency: "ISK" }, RATES)).toBeNull();
  });

  it("never prices under the registrar's cost converted", () => {
    for (const cost of ["0.01", "1", "9.99", "38.39", "120.5", "999.99"]) {
      for (const p of [NOK, EUR, { ...NOK, currency: "SEK" }, { ...NOK, currency: "DKK", minimumMinor: 10000 }]) {
        const price = domainPrice(cost, "USD", 1, { ...p, marginBps: 0, minimumMinor: 0 }, RATES)!;
        expect(price).toBeGreaterThanOrEqual(Number(convertCost(cost, "USD", p.currency, RATES)));
      }
    }
  });

  it("bills in the plan's currency, else the store's own, else euro", () => {
    expect(billingCurrency("NOK", "SEK", ["NOK", "SEK", "EUR"])).toBe("NOK");
    expect(billingCurrency(null, "SEK", ["NOK", "SEK", "EUR"])).toBe("SEK");
    expect(billingCurrency("GBP", "CHF", ["NOK", "EUR"])).toBe("EUR");
    expect(billingCurrency(null, null, [])).toBeNull();
  });
});
