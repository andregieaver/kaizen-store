import { describe, expect, it } from "vitest";

import { WITHDRAWAL_EXCLUSIONS, PRODUCER_SCHEMES } from "../product-input";
import { UNIT_PRICE_EDITOR_EN, smallBaseWords } from "../unit-price-editor";
import { smallBaseNote } from "../unit-price-rules";
import { VAT_CATEGORY_LABELS } from "../vat";
import { productEn } from "./product.en";

/**
 * The product editor's English catalogue repeats words the libraries keep for their other readers (D312 A5): they must stay the same, so the
 * editor in English says exactly what it said before it read a catalogue.
 */
describe("the product catalogue's English", () => {
  it("is the unit price editor's own", () => {
    expect(productEn.unitPrice.editor).toEqual(UNIT_PRICE_EDITOR_EN);
    for (const countries of [["NO"], ["DE"], ["SE", "DK"], []]) {
      expect(smallBaseWords(countries, productEn.unitPrice.editor)).toBe(smallBaseNote(countries));
    }
  });

  it("names every withdrawal exclusion and recycling scheme as the product input does", () => {
    for (const e of WITHDRAWAL_EXCLUSIONS) expect(productEn.legal.exclusions[e.id]).toBe(e.label);
    for (const s of PRODUCER_SCHEMES) expect(productEn.legal.schemeNames[s.id]).toBe(s.label);
  });

  it("names the built-in VAT categories as the VAT library does", () => {
    expect(productEn.vatCategory.builtIn).toEqual(VAT_CATEGORY_LABELS);
  });
});
