import { describe, expect, it } from "vitest";

import { firstSlug, languageSlug } from "./language-view";
import { localizationOf } from "./localization";
import { toMarket } from "./markets";

const NO = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const SE = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
const EUR = { currency: "EUR", rate: 1, roundTo: 1 };
const NOK = { currency: "NOK", rate: 11.6, roundTo: 100 };
const SEK = { currency: "SEK", rate: 11.2, roundTo: 100 };

describe("the view a language leads to (D474)", () => {
  const apart = localizationOf(["nb-NO", "en-IE", "sv-SE"], [EUR, NOK, SEK], [NO, SE]);
  const follows = localizationOf(["nb-NO", "en-IE", "sv-SE"], [EUR, NOK, SEK], [NO, SE], { currencyFollows: { chosen: {} } });

  it("keeps the currency shown while the currency does not follow the language", () => {
    expect(languageSlug(NO, apart, "en")).toBe("no-en");
    expect(languageSlug({ ...NO, currency: "EUR" }, apart, "en")).toBe("no-en-eur");
    expect(languageSlug(NO, apart, "nb")).toBe("no");
  });

  it("takes the language's currency with it while it follows", () => {
    expect(languageSlug(NO, follows, "en")).toBe("no-en-eur");
    expect(languageSlug(NO, follows, "sv")).toBe("no-sv-sek");
    // Back to the country's own language: its own currency again.
    expect(languageSlug({ ...NO, currency: "EUR" }, follows, "nb")).toBe("no");
    // Sweden in Swedish is Sweden's own view.
    expect(languageSlug(SE, follows, "sv")).toBe("se");
  });

  it("is never on with Several languages or Several currencies off", () => {
    expect(localizationOf(["nb-NO", "en-IE"], [EUR, NOK], [NO], { currencyFollows: { chosen: {} }, currencies: false }).currencyByLanguage).toBeNull();
    expect(localizationOf(["nb-NO", "en-IE"], [EUR, NOK], [NO], { currencyFollows: { chosen: {} }, languages: false }).currencyByLanguage).toBeNull();
    expect(localizationOf(["nb-NO", "en-IE"], [EUR, NOK], [NO], { rule: "browser", languages: false }).languageRule).toBe("own");
  });
});

describe("the view a visitor is first shown at the country chooser (D474)", () => {
  it("is each country's own until the rule or the visitor picks a language", () => {
    const own = localizationOf(["nb-NO", "en-GB"], [], [NO, SE]);
    expect(firstSlug(NO, own, { acceptLanguage: "en" })).toBe("no");
    expect(firstSlug(SE, own, { remembered: "en" })).toBe("se-en");
  });

  it("follows the browser into each country, with the language's currency while it follows", () => {
    const browser = localizationOf(["nb-NO", "en-IE"], [EUR, NOK, SEK], [NO, SE], { rule: "browser", currencyFollows: { chosen: {} } });
    expect(firstSlug(NO, browser, { acceptLanguage: "en-US" })).toBe("no-en-eur");
    expect(firstSlug(SE, browser, { acceptLanguage: "en-US" })).toBe("se-en-eur");
    expect(firstSlug(NO, browser, { acceptLanguage: "de" })).toBe("no");
  });
});
