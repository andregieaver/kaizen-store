import { describe, expect, it } from "vitest";

import { toMarket } from "./markets";
import {
  conversionFor,
  currencyChoices,
  effectiveCurrencies,
  effectiveLocales,
  isOfferable,
  keptChoices,
  languageChoices,
  languageOptions,
  localizationOf,
  marketChoices,
  mergeLocales,
  offers,
} from "./localization";

const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const se = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });

describe("languages", () => {
  it("are the chosen ones, main first, plus every country's own", () => {
    expect(effectiveLocales(["en-GB"], [no, se])).toEqual(["en-GB", "nb-NO", "sv-SE"]);
    expect(effectiveLocales([], [no, se])).toEqual(["nb-NO", "sv-SE"]);
  });

  it("keep one variant of a language", () => {
    expect(mergeLocales(["de-AT", "en-GB"], ["de-DE", "nb-NO"])).toEqual(["de-AT", "en-GB", "nb-NO"]);
  });

  it("are offered as the platform has them, with their variants", () => {
    const options = languageOptions([{ lang: "de", locales: ["de-DE", "de-AT"] }, { lang: "fr", locales: ["fr-FR"] }]);
    expect(options.find((o) => o.lang === "de")?.locales).toContain("de-AT");
    expect(isOfferable([{ locales: ["de-DE"] }], "de-DE")).toBe(true);
    expect(isOfferable([{ locales: ["de-DE"] }], "de-AT")).toBe(false);
  });
});

describe("currencies", () => {
  it("always include each country's own, and the euro converts once both have rates", () => {
    const loc = localizationOf([], [{ currency: "NOK", rate: 11.6, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no, se]);
    expect(effectiveCurrencies([], [no]).map((c) => c.currency)).toEqual(["NOK"]);
    expect(offers(loc, "NOK", "EUR")).toBe(true);
    // SEK has no rate yet, so it cannot be shown in euro.
    expect(offers(loc, "SEK", "EUR")).toBe(false);
    expect(currencyChoices(loc, "NOK")).toEqual(["NOK", "EUR"]);
    expect(currencyChoices(loc, "SEK")).toEqual(["SEK"]);
  });
});

describe("a store's main currency", () => {
  it("is its own country's, or euro before it has one", async () => {
    const { mainCurrency } = await import("./markets");
    expect(mainCurrency({ markets: [se, no] })).toBe("SEK");
    expect(mainCurrency({ markets: [] })).toBe("EUR");
  });
});

describe("with the Countries and languages features (D178)", () => {
  const dk = toMarket({ code: "DK", currency: "DKK", defaultLocale: "da-DK" });
  const rates = [
    { currency: "NOK", rate: 11.6, roundTo: 1 },
    { currency: "SEK", rate: 11, roundTo: 1 },
    { currency: "EUR", rate: 1, roundTo: 1 },
  ];

  it("offers each country only in its own language with Several languages off, the main one kept for the editors", () => {
    const on = localizationOf(["en-GB", "nb-NO"], rates, [no, se], { languages: true });
    const off = localizationOf(["en-GB", "nb-NO"], rates, [no, se], { languages: false });
    expect(on.locales).toEqual(["en-GB", "nb-NO", "sv-SE"]);
    expect(languageChoices(on, no)).toEqual(["en-GB", "nb-NO", "sv-SE"]);
    // The main language stays (everything is written in it first), with each country's own.
    expect(off.locales).toEqual(["en-GB", "nb-NO", "sv-SE"]);
    expect(off.languageChoice).toBe(false);
    expect(languageChoices(off, no)).toEqual(["nb-NO"]);
    expect(marketChoices(off).locales).toEqual([]);
    // A store whose main language is its country's own is in one language with one country offered.
    expect(localizationOf(["nb-NO", "en-GB"], rates, [no], { languages: false, kept: [no, se] }).locales).toEqual(["nb-NO"]);
  });

  it("shows each country in its own currency with Several currencies off, and keeps every rate for history", () => {
    const off = localizationOf([], rates, [no, se], { currencies: false });
    expect(off.currencies.map((c) => c.currency)).toEqual(["NOK", "SEK"]);
    expect(offers(off, "NOK", "EUR")).toBe(false);
    // Even another offered country's own currency is not offered to a Norwegian shopper.
    expect(offers(off, "NOK", "SEK")).toBe(false);
    expect(currencyChoices(off, "NOK")).toEqual(["NOK"]);
    expect(conversionFor(off, "NOK", "EUR")).toBeNull();
    // The rates are kept: past orders in euro still convert.
    expect(off.rates.get("EUR")?.rate).toBe(1);
    expect(off.rates.get("NOK")?.rate).toBe(11.6);
    expect(keptChoices(off).conversion("NOK", "EUR")).not.toBeNull();
  });

  it("keeps the languages and rates of countries kept but not offered", () => {
    const loc = localizationOf([], rates, [no], { kept: [no, se, dk] });
    expect(loc.locales).toEqual(["nb-NO"]);
    expect(loc.keptLocales).toEqual(["nb-NO", "sv-SE", "da-DK"]);
    expect(loc.currencies.map((c) => c.currency)).toEqual(["NOK", "SEK", "EUR"]);
    expect(loc.rates.get("SEK")?.rate).toBe(11);
    expect(loc.rates.has("DKK")).toBe(true);
  });
});
