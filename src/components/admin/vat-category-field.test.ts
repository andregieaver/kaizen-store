import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { VatCategoryRow } from "@/lib/vat";

import { VatCategoryField } from "./vat-category-field";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const row = (code: string, nameEn: string, extra: Partial<VatCategoryRow> = {}): VatCategoryRow => ({ code, nameEn, description: "", sort: 0, active: true, builtIn: false, ...extra });
const categories: VatCategoryRow[] = [
  row("standard", "Standard rate", { builtIn: true, description: "Most goods." }),
  row("exempt", "Exempt from VAT", { builtIn: true, sort: 1 }),
  row("accommodation", "Accommodation", { builtIn: true, sort: 2 }),
  row("food", "Food and drink", { sort: 10, description: "Food for people." }),
  row("books", "Books", { sort: 11, active: false }),
];
const markets = [
  { code: "NO", name: "Norway", vatRates: { standard: 0.25, food: 0.15, books: 0, accommodation: 0.12 }, vatRows: { standard: true, food: true, books: true, accommodation: true } },
  { code: "DK", name: "Denmark", vatRates: { standard: 0.25, food: 0.25, books: 0.25, accommodation: 0.25 }, vatRows: { standard: true, food: false, books: false, accommodation: false } },
];
const field = (category: string, kind = "goods", rows = categories) => html(h(VatCategoryField, { category, kind, categories: rows, markets, onChange: () => {} }));

describe("VatCategoryField", () => {
  it("is a select of the active categories, and not of accommodation for goods", () => {
    const out = field("standard");
    expect(out).toContain("<select");
    expect(out).toContain("Food and drink");
    expect(out).toContain("Exempt from VAT");
    expect(out).not.toContain("Accommodation");
    expect(out).not.toContain("Books");
  });

  it("offers accommodation to a stay or a rental", () => {
    expect(field("standard", "stay")).toContain("Accommodation");
    expect(field("standard", "rental")).toContain("Accommodation");
  });

  it("says the rate in each of the store's markets, and when it is the standard rate by fallback", () => {
    const out = field("food");
    expect(out).toContain("Food for people.");
    expect(out).toContain("Norway: 15 %");
    expect(out).toContain("Denmark: no reduced rate known here: the standard rate (25 %) applies");
  });

  it("keeps a product's switched-off category, marked inactive, with a sentence on it", () => {
    const out = field("books");
    expect(out).toContain("Books (inactive)");
    expect(out).toContain("has been switched off");
  });

  it("shows no rates for an exempt product", () => {
    const out = field("exempt");
    expect(out).not.toContain("Norway:");
  });

  it("falls back to the three built-in categories when it is given none", () => {
    const out = field("standard", "goods", []);
    expect(out).toContain("Standard rate");
    expect(out).toContain("Exempt from VAT");
    expect(out).toContain("Norway: 25 %");
  });
});
