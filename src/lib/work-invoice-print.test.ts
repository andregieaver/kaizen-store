import { describe, expect, it } from "vitest";

import { formatMoney } from "@/lib/money";
import { documentLabels } from "@/lib/work-invoice-text";

import {
  addressLines,
  countryText,
  dayText,
  documentFileName,
  moneyText,
  percentText,
  periodText,
  printableState,
  printLocale,
  quantityText,
  rateText,
} from "./work-invoice-print";

describe("which invoices may be printed", () => {
  it("refuses a draft, however complete it looks", () => {
    expect(printableState({ status: "draft", documentNumber: null })).toEqual({ printable: false, reason: "draft" });
    // Even one that somehow carries a number: a draft is not a document.
    expect(printableState({ status: "draft", documentNumber: "W-1001" })).toEqual({
      printable: false,
      reason: "draft",
    });
  });

  it("refuses an issued-looking invoice without a number", () => {
    expect(printableState({ status: "sent", documentNumber: null })).toEqual({
      printable: false,
      reason: "unnumbered",
    });
    expect(printableState({ status: "sent", documentNumber: "  " })).toEqual({
      printable: false,
      reason: "unnumbered",
    });
  });

  it("prints every issued state, a fully credited invoice too", () => {
    for (const status of ["sent", "paid", "void"]) {
      expect(printableState({ status, documentNumber: "W-1001" })).toEqual({ printable: true });
    }
  });
});

describe("writing a document's numbers and days", () => {
  it("accepts the document's locale, or falls back to its language", () => {
    expect(printLocale("nb-NO")).toBe("nb-NO");
    expect(printLocale("sv_SE")).toBe("sv-SE");
    expect(printLocale("!!")).toBe("en");
    expect(printLocale(null)).toBe("en");
    expect(printLocale("nn")).toBe("nn");
  });

  it("formats money from minor units and survives a currency it does not know", () => {
    expect(moneyText(123_456, "NOK", "nb-NO")).toBe(formatMoney(123_456, "NOK", "nb-NO"));
    expect(moneyText(-5_000, "EUR", "en-GB")).toBe(formatMoney(-5_000, "EUR", "en-GB"));
    expect(moneyText(12_345, "XYZ", "en-GB")).toBe("123.45 XYZ");
  });

  it("writes hours with the language's unit and other quantities plainly", () => {
    const nb = documentLabels("nb");
    const sv = documentLabels("sv");
    expect(quantityText({ unit: "hour", quantityHundredths: 175 }, "nb-NO", nb)).toBe("1,75 t");
    expect(quantityText({ unit: "hour", quantityHundredths: 50 }, "sv-SE", sv)).toBe("0,50 tim");
    expect(quantityText({ unit: "hour", quantityHundredths: 1_000 }, "en-GB", documentLabels("en"))).toBe("10.00 h");
    expect(quantityText({ unit: "unit", quantityHundredths: 300 }, "nb-NO", nb)).toBe("3 stk");
    expect(quantityText({ unit: "unit", quantityHundredths: 250 }, "en-GB", documentLabels("en"))).toBe("2.5 pcs");
  });

  it("writes basis points as a percentage", () => {
    expect(percentText(2500, "en-GB")).toBe("25%");
    expect(percentText(1250, "en-GB")).toBe("12.5%");
    expect(percentText(0, "en-GB")).toBe("0%");
    expect(percentText(2500, "nb-NO")).toMatch(/^25\s%$/);
  });

  it("writes days, periods and countries in the locale", () => {
    expect(dayText("2026-09-28", "nb-NO")).toBe("28.09.2026");
    expect(dayText("2026-09-28", "en-GB")).toBe("28/09/2026");
    expect(dayText(null, "en-GB")).toBe("");
    expect(dayText("not a day", "en-GB")).toBe("not a day");
    expect(periodText({ from: "2026-09-01", to: "2026-09-27" }, "nb-NO")).toBe("01.09.2026 – 27.09.2026");
    expect(periodText({ from: "2026-09-01", to: "2026-09-01" }, "nb-NO")).toBe("01.09.2026");
    expect(periodText({ from: null, to: "2026-09-27" }, "nb-NO")).toBe("27.09.2026");
    expect(periodText(null, "nb-NO")).toBe("");
    expect(countryText("no", "en-GB")).toBe("Norway");
    expect(countryText("SE", "sv-SE")).toBe("Sverige");
    expect(countryText(null, "en")).toBe("");
  });

  it("trims an exchange rate and lays out an address", () => {
    expect(rateText("11.50000000")).toBe("11.5");
    expect(rateText("10.00000000")).toBe("10");
    expect(rateText("11")).toBe("11");
    expect(addressLines({ line1: " Kirkegata 2 ", line2: "", postalCode: "0153", city: "Oslo" })).toEqual([
      "Kirkegata 2",
      "0153 Oslo",
    ]);
    expect(addressLines({})).toEqual([]);
  });

  it("names a saved PDF after the document, without characters a file cannot have", () => {
    expect(documentFileName("Faktura", "W-1001")).toBe("Faktura W-1001");
    expect(documentFileName("Invoice", "A/B:1*")).toBe("Invoice AB1");
    expect(documentFileName("Invoice", null)).toBe("Invoice");
  });
});
