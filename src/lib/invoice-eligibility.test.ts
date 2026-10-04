import { describe, expect, it } from "vitest";

import { ELIGIBILITY_REASONS, ELIGIBILITY_WORDS, eligibilityOf, invoiceFileName, type EligibilityFacts } from "./invoice-eligibility";

const ok: EligibilityFacts = { copied: false, host: false, paid: true, testMode: false, invoicingOff: false, paidBeforeStart: false, totalMinor: 100 };

describe("when an order gets an invoice", () => {
  it("is eligible when it is paid, the store's own, live, switched on and not empty", () => {
    expect(eligibilityOf(ok)).toBe("ok");
  });

  it("names the first reason that fails, in the order of the list", () => {
    expect(eligibilityOf({ ...ok, copied: true, host: true, paid: false })).toBe("copied");
    expect(eligibilityOf({ ...ok, host: true, paid: false })).toBe("host");
    expect(eligibilityOf({ ...ok, paid: false, testMode: true })).toBe("not_paid");
    expect(eligibilityOf({ ...ok, testMode: true, invoicingOff: true })).toBe("test_mode");
    expect(eligibilityOf({ ...ok, invoicingOff: true, totalMinor: 0 })).toBe("disabled");
    expect(eligibilityOf({ ...ok, paidBeforeStart: true })).toBe("disabled");
    expect(eligibilityOf({ ...ok, totalMinor: 0 })).toBe("zero_total");
  });

  it("has words for every reason, and says nothing to the shopper but about a test order", () => {
    for (const reason of ELIGIBILITY_REASONS) expect(ELIGIBILITY_WORDS[reason].staff.length, reason).toBeGreaterThan(10);
    expect(ELIGIBILITY_REASONS.filter((r) => ELIGIBILITY_WORDS[r].shopper !== null)).toEqual(["test_mode"]);
  });

  it("names a document's file by its number, safe in a file name", () => {
    expect(invoiceFileName("F-17")).toBe("F-17.pdf");
    expect(invoiceFileName("INV/2026/5")).toBe("INV-2026-5.pdf");
    expect(invoiceFileName("../../x")).toBe("x.pdf");
    expect(invoiceFileName("")).toBe("document.pdf");
  });
});
