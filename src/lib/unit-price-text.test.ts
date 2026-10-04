import { describe, expect, it } from "vitest";

import { t } from "./i18n";
import { BASES } from "./unit-price";
import { baseLabel, lineUnitWords, unitLabelsOf, unitPriceSpoken, unitPriceText, unitPriceWords } from "./unit-price-text";

describe("unitPriceText", () => {
  it("writes the amount, a slash and the base, in the market's currency and the shown language", () => {
    const nb = unitPriceText({ minor: 19960, base: "kg" }, "NOK", "nb-NO", t("nb"));
    expect(nb.replace(/ /g, " ")).toMatch(/^199,60 kr\/kg$/);
    expect(unitPriceText({ minor: 19960, base: "kg" }, "NOK", "en", t("en")).replace(/\u00a0/g, " ")).toBe("NOK 199.60/kg");
    expect(unitPriceText({ minor: 1740, base: "kg" }, "EUR", "nb-NO", t("nb")).replace(/ /g, " ")).toBe("17,40 €/kg");
    expect(unitPriceText({ minor: 1996, base: "100g" }, "NOK", "nb-NO", t("nb")).replace(/ /g, " ")).toBe("19,96 kr/100 g");
    expect(unitPriceText({ minor: 650, base: "piece" }, "SEK", "sv-SE", t("sv")).replace(/ /g, " ")).toBe("6,50 kr/st");
    expect(unitPriceText({ minor: 650, base: "piece" }, "DKK", "da-DK", t("da")).replace(/ /g, " ")).toBe("6,50 kr./stk.");
    expect(unitPriceText({ minor: 650, base: "piece" }, "EUR", "en", t("en")).replace(/\u00a0/g, " ")).toBe("€6.50/piece");
  });

  it("says it for a screen reader with the language's own term", () => {
    expect(unitPriceSpoken({ minor: 19960, base: "kg" }, "NOK", "nb-NO", t("nb")).replace(/ /g, " ")).toBe("Enhetspris: 199,60 kr per kg");
    expect(unitPriceSpoken({ minor: 19960, base: "kg" }, "SEK", "sv-SE", t("sv")).replace(/ /g, " ")).toBe("Jämförpris: 199,60 kr per kg");
    expect(unitPriceSpoken({ minor: 19960, base: "kg" }, "DKK", "da-DK", t("da")).replace(/ /g, " ")).toMatch(/^Enhedspris: 199,60 kr\.? per kg$/);
    expect(unitPriceSpoken({ minor: 19960, base: "l" }, "NOK", "en", t("en")).replace(/\u00a0/g, " ")).toBe("Unit price: NOK 199.60 per l");
  });
});

describe("m.unitPrice in the four hand-written languages", () => {
  for (const lang of ["nb", "sv", "da", "en"]) {
    it(`${lang} has the label, the spoken sentence and every base`, () => {
      const m = t(lang);
      expect(m.unitPrice.label.length).toBeGreaterThan(3);
      expect(m.unitPrice.spoken("1", "kg")).toContain("1");
      for (const base of BASES) expect(baseLabel(base, m).length, `${lang} ${base}`).toBeGreaterThan(0);
    });
  }
});

describe("the unit price as plain data (D160)", () => {
  const kaffe = { amount: "250", unit: "g" as const, base: "kg" as const };

  it("gives a client component the words without a function: the spoken sentence keeps its two places", () => {
    const labels = unitLabelsOf(t("nb"));
    expect(labels.spoken).toBe("Enhetspris: {amount} per {base}");
    expect(JSON.parse(JSON.stringify(labels))).toEqual(labels);
    const words = unitPriceWords({ minor: 19960, base: "kg" }, "NOK", "nb-NO", labels);
    expect(words.text.replace(/\s/g, " ")).toBe("199,60 kr/kg");
    expect(words.spoken.replace(/\s/g, " ")).toBe("Enhetspris: 199,60 kr per kg");
  });

  it("does not let a price's own characters be read as a replacement pattern", () => {
    const words = unitPriceWords({ minor: 100, base: "kg" }, "USD", "en-US", { spoken: "{amount} per {base}", bases: { kg: "$&", "100g": "", l: "", "100ml": "", m: "", m2: "", piece: "" } });
    expect(words.spoken).toBe("$1.00 per $&");
  });

  it("works a line's words from its price and measure, or none", () => {
    const m = t("en");
    expect(lineUnitWords({ unitPriceMinor: 4990, measure: kaffe }, "NOK", "en-GB", m)?.text).toMatch(/199\.60\/kg$/);
    expect(lineUnitWords({ unitPriceMinor: 4990, measure: null }, "NOK", "en-GB", m)).toBeNull();
    expect(lineUnitWords({ unitPriceMinor: 0, measure: kaffe }, "NOK", "en-GB", m)).toBeNull();
    expect(lineUnitWords({ unitPriceMinor: null, measure: kaffe }, "NOK", "en-GB", m)).toBeNull();
    expect(lineUnitWords({ unitPriceMinor: 4990, measure: kaffe, gift: true }, "NOK", "en-GB", m)).toBeNull();
  });
});
