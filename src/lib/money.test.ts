import { describe, expect, it } from "vitest";

import { formatMoney, isPriceDecimals, minorUnitDigits } from "./money";

describe("minorUnitDigits", () => {
  it("uses ISO 4217 minor units for every market currency, including HUF", () => {
    for (const currency of ["EUR", "SEK", "DKK", "NOK", "PLN", "CZK", "HUF", "RON"]) {
      expect(minorUnitDigits(currency)).toBe(2);
    }
  });

  it("refuses a currency it does not know", () => {
    expect(() => minorUnitDigits("XYZ")).toThrow(RangeError);
  });
});

/** Intl writes no-break spaces (U+00A0, U+202F); the D429 cases are written with plain ones. */
const spaced = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("formatMoney", () => {
  it("formats minor units in the shopper's locale", () => {
    expect(formatMoney(1999, "EUR", "de-DE")).toBe("19,99 €");
    expect(formatMoney(1999, "EUR", "en-IE")).toBe("€19.99");
    expect(formatMoney(24900, "SEK", "sv-SE")).toBe("249,00 kr");
  });

  it("counts HUF in hundredths but shows whole forints", () => {
    expect(formatMoney(1250000, "HUF", "hu-HU")).toBe("12 500 Ft");
  });

  it("refuses fractional minor units", () => {
    expect(() => formatMoney(19.5, "EUR", "de-DE")).toThrow(RangeError);
  });

  // D429: prices with or without decimals.
  it("keeps the decimals unless the style hides them on a whole amount", () => {
    expect(spaced(formatMoney(49900, "NOK", "nb-NO"))).toBe("499,00 kr");
    expect(spaced(formatMoney(49900, "NOK", "nb-NO", { decimals: "always" }))).toBe("499,00 kr");
    expect(spaced(formatMoney(49900, "NOK", "nb-NO", null))).toBe("499,00 kr");
    expect(spaced(formatMoney(49900, "NOK", "nb-NO", { decimals: "hide_whole" }))).toBe("499 kr");
    expect(spaced(formatMoney(129900, "EUR", "de-DE", { decimals: "hide_whole" }))).toBe("1.299 €");
    expect(spaced(formatMoney(0, "SEK", "sv-SE", { decimals: "hide_whole" }))).toBe("0 kr");
    expect(spaced(formatMoney(-2500, "EUR", "en-IE", { decimals: "hide_whole" }))).toBe("-€25");
  });

  it("never rounds: an amount with a fraction keeps all its decimals", () => {
    expect(spaced(formatMoney(49950, "NOK", "nb-NO", { decimals: "hide_whole" }))).toBe("499,50 kr");
    expect(spaced(formatMoney(49901, "NOK", "nb-NO", { decimals: "hide_whole" }))).toBe("499,01 kr");
    expect(spaced(formatMoney(1999, "EUR", "en-IE", { decimals: "hide_whole" }))).toBe("€19.99");
  });

  it("leaves HUF as it was: whole forints either way", () => {
    expect(spaced(formatMoney(1250000, "HUF", "hu-HU", { decimals: "hide_whole" }))).toBe("12 500 Ft");
    expect(spaced(formatMoney(1250000, "HUF", "hu-HU", { decimals: "always" }))).toBe("12 500 Ft");
  });
});

describe("isPriceDecimals", () => {
  it("knows the two choices only", () => {
    expect(isPriceDecimals("always")).toBe(true);
    expect(isPriceDecimals("hide_whole")).toBe(true);
    expect(isPriceDecimals("hide")).toBe(false);
    expect(isPriceDecimals(null)).toBe(false);
  });
});
