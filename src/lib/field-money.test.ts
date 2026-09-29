import { describe, expect, it } from "vitest";

import { toRates } from "./currency";
import { amountText, isMoney, majorOf, minorOf, moneyCurrencies, parseAmount, shownMoney } from "./field-money";

const rates = toRates([
  { currency: "NOK", rate: 11.5, roundTo: 1 },
  { currency: "SEK", rate: 11.2, roundTo: 100 },
  { currency: "DKK", rate: null, roundTo: 1 },
]);

describe("an amount typed for a money field", () => {
  it("is read as whole minor units, with a point or a comma and no floating point", () => {
    expect(parseAmount("12", "EUR")).toBe(1200);
    expect(parseAmount("12.5", "EUR")).toBe(1250);
    expect(parseAmount("12,50", "EUR")).toBe(1250);
    expect(parseAmount("0.07", "EUR")).toBe(7);
    expect(parseAmount(" 1234567.89 ", "NOK")).toBe(123456789);
    expect(parseAmount("12.", "EUR")).toBe(1200);
  });

  it("refuses what is not an amount of that currency", () => {
    for (const text of ["", "abc", "-5", "1.234", "1e3", "12 EUR", "1,000.50", "1.2.3", "99999999999999"]) {
      expect(parseAmount(text, "EUR"), text).toBeNull();
    }
    expect(parseAmount("12", "XYZ")).toBeNull();
  });

  it("is shown for editing with the currency's decimals", () => {
    expect(amountText(1250, "EUR")).toBe("12.50");
    expect(amountText(7, "EUR")).toBe("0.07");
    expect(amountText(0, "SEK")).toBe("0.00");
    expect(parseAmount(amountText(123456789, "NOK"), "NOK")).toBe(123456789);
  });

  it("goes between major and minor units", () => {
    expect(majorOf({ amountMinor: 1250, currency: "EUR" })).toBe(12.5);
    expect(majorOf({ amountMinor: 1250, currency: "XYZ" })).toBeNull();
    expect(minorOf(12.35, "EUR")).toBe(1235);
  });
});

describe("money as a shopper reads it", () => {
  const value = { amountMinor: 10000, currency: "EUR" };

  it("is the amount in the market's currency at the store's rates, in the shopper's language", () => {
    expect(shownMoney(value, "en", { currency: "NOK", rates })).toMatch(/NOK\s?1,150\.00|1,150\.00\s?NOK/);
    // The step of the currency shown rounds it: SEK is rounded to whole kronor here (100 öre).
    expect(shownMoney(value, "en", { currency: "SEK", rates })).toMatch(/SEK\s?1,120\.00|1,120\.00\s?SEK/);
  });

  it("is in its own currency when it is the market's, when no rate is known, or when there is no market", () => {
    expect(shownMoney(value, "en", { currency: "EUR", rates })).toMatch(/€\s?100\.00|100\.00\s?€/);
    expect(shownMoney(value, "en", { currency: "DKK", rates })).toMatch(/€\s?100\.00|100\.00\s?€/);
    expect(shownMoney(value, "en", { currency: "GBP", rates })).toMatch(/€\s?100\.00|100\.00\s?€/);
    expect(shownMoney(value, "en")).toMatch(/€\s?100\.00|100\.00\s?€/);
  });

  it("carries no VAT label and draws nothing for a value that is not money", () => {
    expect(shownMoney(value, "en", { currency: "NOK", rates })).not.toMatch(/vat|mva|moms/i);
    for (const bad of [
      null,
      "12",
      { amountMinor: "12", currency: "EUR" },
      { amountMinor: 1.5, currency: "EUR" },
      { amountMinor: -1, currency: "EUR" },
      { amountMinor: 5, currency: "XYZ" },
    ]) {
      expect(shownMoney(bad, "en"), JSON.stringify(bad)).toBe("");
    }
    expect(isMoney(value)).toBe(true);
    expect(isMoney({ value: 1, unit: "g" })).toBe(false);
  });
});

describe("the currencies money can be entered in", () => {
  it("are the store's, its main one first, once each and only those money knows", () => {
    const store = {
      markets: [{ nativeCurrency: "NOK" }, { nativeCurrency: "SEK" }],
      localization: {
        currencies: [{ currency: "EUR" }, { currency: "NOK" }, { currency: "SEK" }, { currency: "XYZ" }],
      },
    };
    expect(moneyCurrencies(store)).toEqual(["NOK", "EUR", "SEK"]);
  });
});
