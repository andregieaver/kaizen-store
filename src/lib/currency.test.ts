import { describe, expect, it } from "vitest";

import { canConvert, convertMinor, converter, defaultRoundTo, parseRate, stepMinor, toRates } from "./currency";
import { marketSlug, parseMarketSlug } from "./market-slug";

describe("showing a store in more currencies (D109)", () => {
  const rates = toRates([
    { currency: "NOK", rate: 11.5, roundTo: 1 },
    { currency: "SEK", rate: 11, roundTo: 100 },
    { currency: "USD", rate: null, roundTo: 1 },
  ]);

  it("converts through the euro at the store's rates and rounds to the target's step", () => {
    // 115.00 NOK is 10.00 EUR.
    expect(convertMinor(11_500, "NOK", "EUR", rates)).toBe(1_000);
    expect(convertMinor(1_000, "EUR", "NOK", rates)).toBe(11_500);
    // NOK to SEK: 115 NOK = 10 EUR = 110 SEK, whole crowns.
    expect(convertMinor(11_500, "NOK", "SEK", rates)).toBe(11_000);
    expect(convertMinor(1_234, "EUR", "SEK", rates)).toBe(13_600);
    expect(convertMinor(1_999, "NOK", "NOK", rates)).toBe(1_999);
  });

  it("does not convert into or out of a currency without a rate", () => {
    expect(canConvert("NOK", "USD", rates)).toBe(false);
    expect(convertMinor(1_000, "NOK", "USD", rates)).toBeNull();
    expect(canConvert("NOK", "NOK", rates)).toBe(true);
    expect(canConvert("NOK", "GBP", rates)).toBe(false);
    expect(() => converter("NOK", "USD", rates)(1)).toThrow();
    expect(converter("NOK", "NOK", rates)(123)).toBe(123);
  });

  it("knows steps and reads rates", () => {
    expect(stepMinor("EUR", 0.05)).toBe(5);
    expect(stepMinor("EUR", 0)).toBe(1);
    expect(stepMinor("NOK", 1)).toBe(100);
    expect(defaultRoundTo("HUF")).toBe(100);
    expect(defaultRoundTo("EUR")).toBe(1);
    expect(parseRate("11,5")).toBe(11.5);
    expect(parseRate("0")).toBeNull();
    expect(parseRate("abc")).toBeNull();
    expect(parseRate("-3")).toBeNull();
  });

  it("puts a country's language and currency in its address, leaving out what is its own", () => {
    const own = { lang: "nb", currency: "NOK" };
    expect(marketSlug("NO", own, own)).toBe("no");
    expect(marketSlug("NO", { lang: "en", currency: "NOK" }, own)).toBe("no-en");
    expect(marketSlug("NO", { lang: "nb", currency: "EUR" }, own)).toBe("no-eur");
    expect(marketSlug("NO", { lang: "en", currency: "EUR" }, own)).toBe("no-en-eur");
    expect(parseMarketSlug("no")).toEqual({ country: "NO", lang: null, currency: null });
    expect(parseMarketSlug("no-en")).toEqual({ country: "NO", lang: "en", currency: null });
    expect(parseMarketSlug("no-eur")).toEqual({ country: "NO", lang: null, currency: "EUR" });
    expect(parseMarketSlug("no-en-eur")).toEqual({ country: "NO", lang: "en", currency: "EUR" });
    for (const bad of ["", "n", "nor", "no-", "no-e", "no-eur-en", "NO", "no-en-eur-x", "no_en"]) expect(parseMarketSlug(bad), bad).toBeNull();
  });
});
