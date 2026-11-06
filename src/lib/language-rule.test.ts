import { describe, expect, it } from "vitest";

import {
  browserLanguages,
  chosenLanguage,
  currencyForLanguage,
  isLanguageRule,
  languageCookie,
  languageCookieName,
  languageCurrencies,
  regionCurrency,
} from "./language-rule";

describe("browserLanguages", () => {
  it("reads the languages a browser asks for, best first, as two letters", () => {
    expect(browserLanguages("nb-NO,nb;q=0.9,en-US;q=0.8,en;q=0.7")).toEqual(["nb", "en"]);
    expect(browserLanguages("en;q=0.5, de")).toEqual(["de", "en"]);
    expect(browserLanguages("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5")).toEqual(["fr", "en", "de"]);
  });

  it("leaves out weights of 0, wildcards and what is not a language", () => {
    expect(browserLanguages("sv;q=0, *, x-klingon, 12, en")).toEqual(["en"]);
    expect(browserLanguages("")).toEqual([]);
    expect(browserLanguages(null)).toEqual([]);
    expect(browserLanguages("de;q=abc")).toEqual([]);
  });

  it("keeps the order a browser gives for equal weights", () => {
    expect(browserLanguages("da, sv, nb")).toEqual(["da", "sv", "nb"]);
  });
});

describe("chosenLanguage", () => {
  const offered = ["nb", "en", "sv"];

  it("leaves the address as it is with the country's own rule", () => {
    expect(chosenLanguage("own", offered, { country: "SE", acceptLanguage: "sv" })).toBeNull();
  });

  it("takes the language of the country the visitor is in", () => {
    expect(chosenLanguage("location", offered, { country: "SE", acceptLanguage: "en" })).toBe("sv");
    expect(chosenLanguage("location", offered, { country: "se" })).toBe("sv");
    // Finland reads Finnish first, then Swedish: the store has only Swedish.
    expect(chosenLanguage("location", offered, { country: "FI" })).toBe("sv");
    // A country whose languages the store does not have, or an unknown one.
    expect(chosenLanguage("location", offered, { country: "DE" })).toBeNull();
    expect(chosenLanguage("location", offered, { country: null })).toBeNull();
  });

  it("takes the browser's language, the first the store has", () => {
    expect(chosenLanguage("browser", offered, { country: "SE", acceptLanguage: "de-DE,en;q=0.8" })).toBe("en");
    expect(chosenLanguage("browser", offered, { acceptLanguage: "de-DE" })).toBeNull();
  });

  it("reads Norwegian and Nynorsk as Bokmål where the store has no other", () => {
    expect(chosenLanguage("browser", offered, { acceptLanguage: "no" })).toBe("nb");
    expect(chosenLanguage("browser", offered, { acceptLanguage: "nn-NO" })).toBe("nb");
    expect(chosenLanguage("browser", ["nn", "nb"], { acceptLanguage: "nn-NO" })).toBe("nn");
  });

  it("lets the browser overrule where the visitor is, and falls back to it", () => {
    expect(chosenLanguage("location-browser", offered, { country: "SE", acceptLanguage: "en-GB" })).toBe("en");
    expect(chosenLanguage("location-browser", offered, { country: "SE", acceptLanguage: "de" })).toBe("sv");
    expect(chosenLanguage("location-browser", offered, { country: "DE", acceptLanguage: "de" })).toBeNull();
  });

  it("puts the visitor's own choice first, under every rule", () => {
    for (const rule of ["own", "location", "location-browser", "browser"] as const) {
      expect(chosenLanguage(rule, offered, { country: "SE", acceptLanguage: "sv", remembered: "en" })).toBe("en");
    }
    // A choice of a language the store no longer has is passed over.
    expect(chosenLanguage("location", offered, { country: "SE", remembered: "de" })).toBe("sv");
    expect(chosenLanguage("own", offered, { remembered: "<script>" })).toBeNull();
  });

  it("knows its rules and names its cookie per store", () => {
    expect(isLanguageRule("browser")).toBe(true);
    expect(isLanguageRule("geo")).toBe(false);
    expect(languageCookieName("4f1c")).toBe("kaizen_lang_4f1c");
  });

  it("writes the cookie of a visitor's choice for a year, for the whole site", () => {
    const store = "6c0a1d5e-2f9b-4d7a-9a7e-0b1f2c3d4e5f";
    expect(languageCookie(store, "en", true)).toBe(`kaizen_lang_${store}=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
    expect(languageCookie(store, "nb-NO", false)).toBe(`kaizen_lang_${store}=nb; Path=/; Max-Age=31536000; SameSite=Lax`);
    expect(languageCookie(store, undefined, true)).toBeNull();
    expect(languageCookie(store, "en;x=1", true)).toBeNull();
    expect(languageCookie("not-a-store", "en", true)).toBeNull();
  });
});

describe("the currency that goes with a language", () => {
  it("is the currency of the country a variant names", () => {
    expect(regionCurrency("en-IE")).toBe("EUR");
    expect(regionCurrency("en-GB")).toBe("GBP");
    expect(regionCurrency("sv-SE")).toBe("SEK");
    expect(regionCurrency("bg-BG")).toBe("EUR");
    expect(regionCurrency("en")).toBeNull();
    expect(regionCurrency("es-MX")).toBeNull();
  });

  it("is the owner's choice, else the variant's, where the store offers it", () => {
    const offered = ["NOK", "EUR", "SEK"];
    expect(languageCurrencies(["nb-NO", "en-GB", "sv-SE", "de-DE"], {}, offered)).toEqual({ nb: "NOK", sv: "SEK", de: "EUR" });
    // English in euro by the owner's choice; German keeps the country's own.
    expect(languageCurrencies(["nb-NO", "en-GB", "de-DE"], { en: "EUR", de: "own" }, offered)).toEqual({ nb: "NOK", en: "EUR" });
    // A choice of a currency the store does not offer is passed over.
    expect(languageCurrencies(["en-GB"], { en: "USD" }, offered)).toEqual({});
  });

  it("follows the language only while it is on, and only where the country can be shown in it", () => {
    const byLanguage = { en: "EUR", sv: "SEK" };
    const canShow = (currency: string) => currency !== "SEK";
    expect(currencyForLanguage("en", { byLanguage, current: "NOK", native: "NOK", canShow })).toBe("EUR");
    expect(currencyForLanguage("sv", { byLanguage, current: "EUR", native: "NOK", canShow })).toBe("NOK");
    expect(currencyForLanguage("nb", { byLanguage, current: "EUR", native: "NOK", canShow })).toBe("NOK");
    expect(currencyForLanguage("en", { byLanguage: null, current: "USD", native: "NOK", canShow })).toBe("USD");
  });
});
