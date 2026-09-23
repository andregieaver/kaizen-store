import { describe, expect, it } from "vitest";

import { formatMoney, minorUnitDigits } from "./money";

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
});
