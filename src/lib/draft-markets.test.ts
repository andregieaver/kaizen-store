import { describe, expect, it } from "vitest";

import { toRates } from "./currency";

import { draftMarketChoice, draftMarketOptions, draftMarketSlug } from "./draft-markets";

const markets = [
  { code: "NO", name: "Norge", ownLocale: "nb-NO", nativeCurrency: "NOK" },
  { code: "SE", name: "Sverige", ownLocale: "sv-SE", nativeCurrency: "SEK" },
  { code: "NO", name: "Norway", ownLocale: "nb-NO", nativeCurrency: "NOK" },
];
const currencies = [
  { currency: "NOK", rate: 11.5, roundTo: 1 },
  { currency: "SEK", rate: 11, roundTo: 1 },
  { currency: "EUR", rate: 1, roundTo: 1 },
];
const localization = { locales: ["nb-NO", "sv-SE", "en-GB"], currencies, rates: toRates(currencies) };

describe("the markets a draft can be made in", () => {
  const options = draftMarketOptions(markets, localization);

  it("lists each country once with the languages and currencies the store can show it in", () => {
    expect(options.countries.map((c) => c.code)).toEqual(["NO", "SE"]);
    expect(options.countries[0]).toMatchObject({ name: "Norge", ownLang: "nb", ownCurrency: "NOK" });
    expect(options.countries[0].currencies[0]).toBe("NOK");
    expect(options.languages.map((l) => l.lang)).toEqual(["nb", "sv", "en"]);
  });

  it("writes the address without what is the country's own", () => {
    expect(draftMarketSlug(options, { country: "NO", lang: "nb", currency: "NOK" })).toBe("no");
    expect(draftMarketSlug(options, { country: "NO", lang: "en", currency: "NOK" })).toBe("no-en");
    expect(options.countries[0].currencies).toEqual(["NOK", "SEK", "EUR"]);
    expect(draftMarketSlug(options, { country: "no", lang: "nb", currency: "eur" })).toBe("no-eur");
    expect(draftMarketSlug(options, { country: "se", lang: "en", currency: "SEK" })).toBe("se-en");
  });

  it("refuses a country, language or currency the store does not offer", () => {
    expect(draftMarketSlug(options, { country: "DK", lang: "nb", currency: "NOK" })).toBeNull();
    expect(draftMarketSlug(options, { country: "NO", lang: "de", currency: "NOK" })).toBeNull();
    expect(draftMarketSlug(options, { country: "NO", lang: "nb", currency: "JPY" })).toBeNull();
  });

  it("reads an address back into the three choices", () => {
    expect(draftMarketChoice(options, "no")).toEqual({ country: "NO", lang: "nb", currency: "NOK" });
    expect(draftMarketChoice(options, "se-en")).toEqual({ country: "SE", lang: "en", currency: "SEK" });
    expect(draftMarketChoice(options, "no-en-eur")).toEqual({ country: "NO", lang: "en", currency: "EUR" });
    expect(draftMarketChoice(options, "dk")).toBeNull();
    expect(draftMarketChoice(options, "not a slug")).toBeNull();
  });
});

describe("the markets a draft can be made in with the Countries and languages features off (D178)", () => {
  it("offers each country in its own language and currency only", () => {
    const options = draftMarketOptions(markets, { ...localization, languageChoice: false, currencyChoice: false });
    expect(options.countries[0].languages.map((l) => l.lang)).toEqual(["nb"]);
    expect(options.countries[1].languages.map((l) => l.lang)).toEqual(["sv"]);
    expect(options.countries[0].currencies).toEqual(["NOK"]);
    expect(draftMarketSlug(options, { country: "NO", lang: "nb", currency: "NOK" })).toBe("no");
    expect(draftMarketSlug(options, { country: "NO", lang: "en", currency: "NOK" })).toBeNull();
    expect(draftMarketSlug(options, { country: "NO", lang: "nb", currency: "EUR" })).toBeNull();
  });
});
