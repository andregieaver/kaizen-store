import { describe, expect, it } from "vitest";

import { toMarket } from "./markets";
import { effectiveCurrencies, effectiveLocales, isOfferable, languageOptions, localizationOf, offers, currencyChoices, mergeLocales } from "./localization";

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
