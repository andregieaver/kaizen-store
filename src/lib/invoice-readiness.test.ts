import { describe, expect, it } from "vitest";

import { WAITING_REASONS, WAITING_WORDS, isOverdue, reverseChargeDeadline, sellerReadiness, waitingReason, type ReadinessFacts } from "./invoice-readiness";

const full = { legalName: "Fixture AS", postalAddress: "Storgata 1", organisationNumber: "923456789", country: "NO" };
const facts = (over: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  details: full,
  profile: { vatRegistered: true, vatNumber: "NO923456789MVA" },
  treatment: { reason: null, sellerVatNumber: "NO923456789MVA", buyerVatNumber: null, iossNumber: null },
  vatMinor: 2500,
  currency: "NOK",
  fx: { homeCurrency: "NOK", mainCurrency: "NOK", rates: {}, ratesAuto: false, ratesAsOf: "2026-10-01" },
  ...over,
});

describe("the seller's details an invoice needs", () => {
  it("lists what is missing, a VAT number only when registered", () => {
    expect(sellerReadiness(full, { vatRegistered: true, vatNumber: "NO1" })).toEqual([]);
    expect(sellerReadiness({ legalName: " ", postalAddress: null, organisationNumber: "", country: null }, { vatRegistered: false, vatNumber: null })).toEqual(["legal_name", "postal_address", "organisation_number", "country"]);
    expect(sellerReadiness(full, { vatRegistered: true, vatNumber: null })).toEqual(["vat_number"]);
    expect(sellerReadiness(full, { vatRegistered: false, vatNumber: null })).toEqual([]);
    expect(sellerReadiness(full, null)).toEqual([]);
    // The number the order was placed with counts.
    expect(sellerReadiness(full, { vatRegistered: true, vatNumber: null }, { reason: null, sellerVatNumber: "NO9", buyerVatNumber: null, iossNumber: null })).toEqual([]);
  });
});

describe("why an order waits", () => {
  it("is ready when nothing is in the way", () => {
    expect(waitingReason(facts())).toBeNull();
  });

  it("names the first reason, in the order of the list", () => {
    expect(waitingReason(facts({ details: { ...full, legalName: null }, profile: null }))).toBe("seller_details");
    expect(waitingReason(facts({ profile: null }))).toBe("tax_profile_missing");
    expect(waitingReason(facts({ profile: { vatRegistered: false, vatNumber: null }, treatment: null }))).toBe("vat_charged_not_registered");
    expect(waitingReason(facts({ profile: { vatRegistered: false, vatNumber: null }, treatment: null, vatMinor: 0 }))).toBeNull();
    expect(waitingReason(facts({ currency: "EUR" }))).toBe("no_exchange_rate");
    expect(waitingReason(facts({ currency: "EUR", fx: { homeCurrency: "NOK", mainCurrency: "NOK", rates: { NOK: "11.7" }, ratesAuto: true, ratesAsOf: "2026-10-01" } }))).toBeNull();
    expect(waitingReason(facts({ currency: "EUR", vatMinor: 0 }))).toBeNull();
    expect(waitingReason(facts({ profile: { vatRegistered: true, vatNumber: null }, treatment: null }))).toBe("seller_details");
  });

  it("has words for every reason and a place to fix it", () => {
    for (const reason of [...WAITING_REASONS, "invoice_failed" as const]) expect(WAITING_WORDS[reason].staff.length, reason).toBeGreaterThan(20);
    expect(WAITING_WORDS.invoice_failed.fixAt).toBeNull();
    expect(WAITING_REASONS.map((r) => WAITING_WORDS[r].fixAt)).toEqual(["/settings/company", "/settings/tax", "/settings/tax", "/settings/localization"]);
  });
});

describe("the deadline of a reverse-charge invoice (Directive Art. 222)", () => {
  it("is the 15th of the month after the payment, and only reverse charge has one", () => {
    expect(reverseChargeDeadline("2026-10-04")).toBe("2026-11-15");
    expect(reverseChargeDeadline("2026-12-31")).toBe("2027-01-15");
    expect(isOverdue({ kind: "reverse_charge", paidOn: "2026-10-04", today: "2026-11-15" })).toEqual({ overdue: false, deadline: "2026-11-15" });
    expect(isOverdue({ kind: "reverse_charge", paidOn: "2026-10-04", today: "2026-11-16" })).toEqual({ overdue: true, deadline: "2026-11-15" });
    expect(isOverdue({ kind: "standard", paidOn: "2026-10-04", today: "2027-05-01" })).toEqual({ overdue: false, deadline: null });
    expect(isOverdue({ kind: "ioss", paidOn: "2026-10-04", today: "2027-05-01" }).overdue).toBe(false);
  });
});
