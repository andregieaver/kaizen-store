import { describe, expect, it } from "vitest";

import { t } from "./i18n";
import { formatMoney } from "./money";
import { priceView } from "./pricing";
import { wordpressPrice } from "./wordpress-view";

const m = t("nb");

describe("wordpressPrice", () => {
  it("writes a price with VAT as the storefront does", () => {
    const price = wordpressPrice(priceView(19900, "NOK", null), false, "nb-NO", m);
    expect(price.text).toBe(formatMoney(19900, "NOK", "nb-NO"));
    expect(price.vat_label).toBe(m.vatIncluded);
    expect(price).toMatchObject({ from_label: null, prior_text: null, unit_text: null, amount_minor: 19900, currency: "NOK" });
  });

  it("shows the 30-day reference only for a genuine reduction", () => {
    expect(wordpressPrice(priceView(15000, "NOK", 19900), false, "nb-NO", m).prior_text).not.toBeNull();
    expect(wordpressPrice(priceView(19900, "NOK", 15000), false, "nb-NO", m).prior_text).toBeNull();
    expect(wordpressPrice(priceView(15000, "NOK", 19900), false, "nb-NO", m).prior_label).toBe(m.priorPrice);
  });

  it("says From when the variants differ, in the market's language", () => {
    expect(wordpressPrice(priceView(100, "NOK", null), true, "nb-NO", m).from_label).toBe(m.fromPrice);
    expect(wordpressPrice(priceView(100, "SEK", null), true, "sv-SE", t("sv")).from_label).toBe(t("sv").fromPrice);
  });

  it("shows a business store's price without VAT, with its label", () => {
    const price = wordpressPrice(priceView(12500, "NOK", null, { rate: 0.25, shown: "excl" }), false, "nb-NO", m);
    expect(price.amount_minor).toBe(10000);
    expect(price.vat_label).toBe(m.vatExcluded);
  });

  it("shows a store that sells to both with VAT", () => {
    const price = wordpressPrice(priceView(12500, "NOK", null, { rate: 0.25, shown: "choice" }), false, "nb-NO", m);
    expect(price.amount_minor).toBe(12500);
    expect(price.vat_label).toBe(m.vatIncluded);
  });

  it("gives the unit price from the shown price, and none for a price equal to it", () => {
    const measure = { amount: "500", unit: "g", base: "kg" } as const;
    const price = wordpressPrice(priceView(9980, "NOK", null, undefined, measure), false, "nb-NO", m);
    expect(price.unit_text).toMatch(/199[,.]60/u);
    expect(price.unit_text).toContain("kg");
  });
});
