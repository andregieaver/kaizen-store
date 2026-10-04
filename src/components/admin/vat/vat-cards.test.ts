import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { VatCategoryRow } from "@/lib/vat";
import type { CoverageCountry, ShippingRuleRow, VatRateRow } from "@/server/vat-admin";

import { CategoriesCard } from "./categories-card";
import { CoverageCard } from "./coverage-card";
import { RateForm } from "./rate-form";
import { RateHistory, UnverifiedCard } from "./rates-table";
import { ShippingRulesCard } from "./shipping-rules-card";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const action = async () => ({ status: "idle" as const, messages: [] });
const bound = () => action;

const categories: VatCategoryRow[] = [
  { code: "standard", nameEn: "Standard rate", description: "Most goods.", sort: 0, active: true, builtIn: true },
  { code: "exempt", nameEn: "Exempt from VAT", description: "", sort: 1, active: true, builtIn: true },
  { code: "food", nameEn: "Food and drink", description: "Food for people.", sort: 10, active: true, builtIn: false },
  { code: "books", nameEn: "Books", description: "", sort: 11, active: false, builtIn: false },
];
const countries = [
  { code: "NO", name: "Norway" },
  { code: "SE", name: "Sweden" },
];
const rate = (extra: Partial<VatRateRow> = {}): VatRateRow => ({
  country: "NO",
  category: "food",
  rate: 0.15,
  validFrom: "2026-01-01",
  validTo: null,
  source: "https://www.skatteetaten.no/en/rates/value-added-tax/",
  checkedOn: "2026-10-03",
  note: "",
  verified: null,
  state: "current",
  ...extra,
});
const name = (code: string) => categories.find((c) => c.code === code)?.nameEn ?? code;

describe("CategoriesCard", () => {
  const out = html(h(CategoriesCard, { categories, addAction: action, activeAction: bound }));

  it("lists every category, marks the built-in and the switched-off ones, and gives only the others a switch", () => {
    expect(out).toContain("Standard rate");
    expect(out).toContain("Built in");
    expect(out).toContain(">Off<");
    expect((out.match(/Switch off/g) ?? []).length).toBe(1);
    expect((out.match(/Switch on/g) ?? []).length).toBe(1);
  });

  it("has the add form with the names the action reads, and says categories are never deleted", () => {
    for (const field of ["code", "nameEn", "description", "sort"]) expect(out).toContain(`name="${field}"`);
    expect(out).toContain("never deleted");
  });
});

describe("UnverifiedCard and RateHistory", () => {
  it("lists each unverified rate with its source as a link and the date it was checked, and a way to verify it", () => {
    const out = html(h(UnverifiedCard, { rows: [rate(), rate({ country: "SE", source: "Mervärdesskattelagen" })], categoryName: name, verify: bound }));
    expect(out).toContain("2 rates to verify.");
    expect(out).toContain('href="https://www.skatteetaten.no/en/rates/value-added-tax/"');
    expect(out).toContain("Mervärdesskattelagen");
    expect(out).toContain("Checked 3 Oct 2026");
    expect((out.match(/Mark verified/g) ?? []).length).toBe(2);
    expect(out).toContain('href="/admin/platform/vat/NO"');
    expect(out).toContain("15 %");
  });

  it("says plainly when everything is verified", () => {
    expect(html(h(UnverifiedCard, { rows: [], categoryName: name, verify: bound }))).toContain("has been verified");
  });

  it("shows a country's whole history: periods, state, who verified, and a button only on a live unverified row", () => {
    const out = html(
      h(RateHistory, {
        rows: [
          rate({ rate: 0.14, validFrom: "2026-06-01", state: "scheduled" }),
          rate({ validTo: "2026-06-01", state: "ended" }),
          rate({ category: "standard", rate: 0.25, verified: { at: "2026-10-03T10:00:00Z", by: "Anna" } }),
        ],
        categoryName: name,
        verify: bound,
      }),
    );
    expect(out).toContain("Scheduled");
    expect(out).toContain("Ended");
    expect(out).toContain("In force");
    expect(out).toContain("Anna, 3 Oct 2026");
    expect(out).toContain("first day it no longer applies");
    expect((out.match(/Mark verified/g) ?? []).length).toBe(1);
    expect(out).toContain("Not verified");
  });
});

describe("CoverageCard", () => {
  const cells = (food: Partial<CoverageCountry["cells"][string]>) => ({
    standard: { rate: 0.25, hasRow: true, text: "25 %", fallback: false, verified: true },
    food: { rate: 0.25, hasRow: false, text: "x", fallback: true, verified: false, ...food },
  });
  const rows: CoverageCountry[] = [
    { code: "NO", name: "Norway", inUse: true, cells: cells({ rate: 0.15, hasRow: true, fallback: false, verified: false }) },
    { code: "DK", name: "Denmark", inUse: false, cells: cells({}) },
  ];
  const out = html(h(CoverageCard, { categories, countries: rows }));

  it("leaves the exempt category out, since it has no rate", () => {
    expect(out).not.toContain("Exempt from VAT");
    expect(out).toContain("Food and drink");
  });

  it("says standard where no reduced rate is known, and marks an unverified rate in words for a screen reader", () => {
    expect(out).toContain(">standard<");
    expect(out).toContain("15 %");
    expect(out).toContain("(unverified)");
    expect(out).toContain("In use");
    expect(out).toContain('href="/admin/platform/vat/DK"');
  });
});

describe("RateForm", () => {
  it("has the fields setVatRateAction reads, and no exempt choice when the caller leaves it out", () => {
    const out = html(h(RateForm, { categories: categories.filter((c) => c.code !== "exempt"), countries, action }));
    for (const field of ["country", "category", "ratePercent", "validFrom", "source", "checkedOn", "note"]) expect(out).toContain(`name="${field}"`);
    expect(out).not.toContain("Exempt from VAT");
    expect(out).toContain("Books (off)");
    expect(out).toContain("placed order keeps the rate it was charged");
  });

  it("fixes the country on a country's own page", () => {
    const out = html(h(RateForm, { categories, countries, country: "NO", action }));
    expect(out).toContain('type="hidden" name="country" value="NO"');
    expect(out).not.toContain("<select name=\"country\"");
  });
});

describe("ShippingRulesCard", () => {
  const rules: ShippingRuleRow[] = [
    { country: "NO", name: "Norway", rule: "standard", source: "", checkedOn: null, note: "", verified: false, applied: "standard" },
    { country: "DE", name: "Germany", rule: "follows_goods", source: "https://example.org/act", checkedOn: "2026-10-01", note: "", verified: false, applied: "standard" },
    { country: "SE", name: "Sweden", rule: "highest", source: "Act 1", checkedOn: "2026-10-01", note: "", verified: true, applied: "highest" },
  ];

  it("lists only countries with a rule of its own, and says a draft is not applied", () => {
    const out = html(h(ShippingRulesCard, { rules, countries, action }));
    expect(out).not.toContain('pr-3">Norway<');
    expect(out).toContain("Germany");
    expect(out).toContain("Draft: not applied");
    expect(out).toContain("Verified");
    expect(out).toContain("Follows the goods");
  });

  it("says every country uses the standard rate when none has a rule", () => {
    expect(html(h(ShippingRulesCard, { rules: [rules[0]], countries, action }))).toContain("every country uses the standard rate");
  });

  it("has the fields setShippingVatRuleAction reads, including the verified box", () => {
    const out = html(h(ShippingRulesCard, { rules, countries, action }));
    for (const field of ["country", "rule", "source", "checkedOn", "note", "verified"]) expect(out).toContain(`name="${field}"`);
  });

  it("shows a country's own rule and fills the form with it", () => {
    const out = html(h(ShippingRulesCard, { rules, countries, country: "DE", action }));
    expect(out).toContain("Germany");
    expect(out).not.toContain("Sweden");
    expect(out).toContain('value="https://example.org/act"');
  });
});
