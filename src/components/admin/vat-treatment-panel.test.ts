import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OrderVatTreatment } from "@/lib/vat-treatment";

import { VatReliefRow, VatTreatmentPanel } from "./vat-treatment-panel";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/ /g, " ");

const money = (minor: number) => `${minor / 100} EUR`;

const reverse: OrderVatTreatment = {
  kind: "reverse_charge",
  reason: "reverse_charge",
  sellerVatNumber: "SE556677889901",
  sellerCountry: "SE",
  buyerVatNumber: "DE123456789",
  buyerCountry: "DE",
  vies: { status: "valid", checkedAt: "2026-10-03T10:00:00Z", requestIdentifier: "WAPIAAAAZZZ", registeredName: "Kaffe GmbH", registeredAddress: "Hauptstr. 1\n10115 Berlin" },
  iossNumber: null,
  consignmentEurMinor: null,
  shippingRule: "standard",
  shippingRate: 0.19,
};

const panel = (treatment: OrderVatTreatment | null, extra: Partial<Parameters<typeof VatTreatmentPanel>[0]> = {}) =>
  html(
    h(VatTreatmentPanel, {
      treatment,
      kind: treatment?.kind ?? "standard",
      reliefMinor: 0,
      shippingReliefMinor: 0,
      currency: "EUR",
      locale: "en",
      typedCompany: null,
      ...extra,
    }),
  );

describe("VatTreatmentPanel", () => {
  it("draws nothing for an order with no treatment (a host's, copied history, or one from before it was kept)", () => {
    expect(panel(null)).toBe("");
  });

  it("says reverse charge, why, both numbers, what VIES said and when, and the VAT not charged", () => {
    const out = panel(reverse, { reliefMinor: 4200, shippingReliefMinor: 300, typedCompany: "Kaffe GmbH" });
    expect(out).toContain("Reverse charge: no VAT charged");
    expect(out).toContain("the buyer accounts for the VAT");
    expect(out).toContain("SE556677889901");
    expect(out).toContain("DE123456789");
    expect(out).toContain("Registered, checked");
    expect(out).toContain("WAPIAAAAZZZ");
    expect(out).toContain("Hauptstr. 1");
    expect(out).toContain("€42.00");
    expect(out).toContain("€3.00");
    expect(out).toContain("19 %");
    expect(out).not.toContain("not the company the buyer typed");
  });

  it("hints, and only hints, when the name VIES holds is not the company typed", () => {
    const out = panel(reverse, { reliefMinor: 4200, typedCompany: "Something Else AB" });
    expect(out).toContain("not the company the buyer typed");
    expect(out).toContain("Nothing was blocked");
  });

  it("explains a refusal in plain words and shows no relief", () => {
    const out = panel({ ...reverse, kind: "standard", reason: "number_unavailable", vies: { ...reverse.vies, status: "unavailable", registeredName: null, registeredAddress: null, requestIdentifier: null } });
    expect(out).toContain("Standard: VAT charged");
    expect(out).toContain("VIES could not be reached");
    expect(out).toContain("Could not be checked");
    expect(out).not.toContain("VAT not charged");
  });

  it("shows the IOSS number and the consignment's value in euro for an IOSS order", () => {
    const out = panel({ ...reverse, kind: "ioss", reason: "ioss", buyerVatNumber: null, vies: { ...reverse.vies, status: "not_checked", checkedAt: null, requestIdentifier: null, registeredName: null, registeredAddress: null }, iossNumber: "IM2460000000", consignmentEurMinor: 12000 });
    expect(out).toContain("IOSS number");
    expect(out).toContain("IM2460000000");
    expect(out).toContain("€120.00");
    expect(out).not.toContain("Buyer&#x27;s VAT number");
  });

  it("names a shipping rule that is not the standard one", () => {
    expect(panel({ ...reverse, kind: "standard", reason: "consumer", shippingRule: "follows_goods", shippingRate: 0.07 })).toContain("rule: follows goods");
  });
});

describe("VatReliefRow", () => {
  it("gives back the VAT not charged on a reverse-charge order, and nothing on any other", () => {
    expect(html(h(VatReliefRow, { kind: "reverse_charge", reliefMinor: 4200, money }))).toContain("VAT not charged (reverse charge)");
    expect(html(h(VatReliefRow, { kind: "reverse_charge", reliefMinor: 4200, money }))).toContain("−42 EUR");
    expect(html(h(VatReliefRow, { kind: "standard", reliefMinor: 0, money }))).toBe("");
    expect(html(h(VatReliefRow, { kind: "ioss", reliefMinor: 0, money }))).toBe("");
  });
});
