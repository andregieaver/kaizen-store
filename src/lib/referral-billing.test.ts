import { describe, expect, it } from "vitest";

import {
  creditForInvoice,
  creditNoteExTaxMinor,
  creditNoteInvoiceId,
  invoiceExTaxMinor,
  invoicePaidAt,
  invoiceStoreMetadata,
  isPlanInvoice,
  type InvoiceShape,
} from "./referral-billing";
import { referralCreditAppliedEmail, referredStoreOpenedEmail } from "./referral-emails";
import { renderEmail } from "./email-layout";

const invoice = (over: Partial<InvoiceShape> = {}): InvoiceShape => ({
  id: "in_1",
  currency: "nok",
  total: 43_625,
  total_excluding_tax: 34_900,
  ...over,
});

describe("Kaizen's plan invoices and the referral program (D131)", () => {
  it("counts the invoices a subscription made", () => {
    expect(isPlanInvoice(invoice({ parent: { type: "subscription_details" } }))).toBe(true);
    expect(isPlanInvoice(invoice({ billing_reason: "subscription_cycle" }))).toBe(true);
    expect(isPlanInvoice(invoice({ billing_reason: "manual" }))).toBe(false);
    expect(isPlanInvoice(invoice())).toBe(false);
  });

  it("takes the amount without VAT, after discounts and credit: Stripe's figure, else the total less tax added on top", () => {
    expect(invoiceExTaxMinor(invoice())).toBe(34_900);
    expect(invoiceExTaxMinor(invoice({ total_excluding_tax: null, total_taxes: [{ amount: 8_725, tax_behavior: "exclusive" }] }))).toBe(34_900);
    // Tax already in the price is not added on top, so it is not taken off.
    expect(invoiceExTaxMinor(invoice({ total_excluding_tax: undefined, total: 1_000, total_taxes: [{ amount: 200, tax_behavior: "inclusive" }] }))).toBe(1_000);
    expect(invoiceExTaxMinor(invoice({ total_excluding_tax: 0 }))).toBe(0);
    expect(invoiceExTaxMinor(invoice({ total_excluding_tax: -5 }))).toBe(0);
  });

  it("takes the paid time from Stripe, else from the event, and the store from the subscription's mark", () => {
    expect(invoicePaidAt(invoice({ status_transitions: { paid_at: 1_790_000_100 } }), 1_800_000_000).getTime()).toBe(1_790_000_100_000);
    expect(invoicePaidAt(invoice(), 1_800_000_000).getTime()).toBe(1_800_000_000_000);
    expect(invoiceStoreMetadata(invoice({ parent: { subscription_details: { metadata: { kaizen_store_id: "s1" } } } }))).toBe("s1");
    expect(invoiceStoreMetadata(invoice())).toBeNull();
  });

  it("lets credit take at most what is usable and at most the invoice's amount without VAT", () => {
    expect(creditForInvoice(10_000, 34_900)).toBe(10_000);
    expect(creditForInvoice(50_000, 34_900)).toBe(34_900);
    expect(creditForInvoice(0, 34_900)).toBe(0);
    expect(creditForInvoice(5_000, 0)).toBe(0);
    expect(creditForInvoice(Number.NaN, 100)).toBe(0);
  });

  it("reads a credit note's invoice and the amount without VAT it credits", () => {
    expect(creditNoteInvoiceId({ id: "cn_1", invoice: "in_1", currency: "nok", total: 1250, total_excluding_tax: 1000 })).toBe("in_1");
    expect(creditNoteInvoiceId({ id: "cn_1", invoice: { id: "in_2" }, currency: "nok", total: 1 })).toBe("in_2");
    expect(creditNoteExTaxMinor({ id: "cn_1", invoice: "in_1", currency: "nok", total: 1250, total_excluding_tax: 1000 })).toBe(1000);
    expect(creditNoteExTaxMinor({ id: "cn_1", invoice: "in_1", currency: "nok", total: 1250 })).toBe(1250);
  });
});

describe("the referrer's emails", () => {
  it("tell them a referred store opened, by its name only, with the terms", () => {
    const email = renderEmail(referredStoreOpenedEmail({ storeName: "Kari's Kaffe", commissionBps: 1000, months: 12, url: "https://kaizen.test/admin/account/referrals" }));
    expect(email.subject).toBe("Kari's Kaffe opened its store through your link");
    expect(email.text).toContain("10 %");
    expect(email.text).toContain("12 months");
    expect(email.html).toContain("https://kaizen.test/admin/account/referrals");
    // Escaped, never raw.
    expect(renderEmail(referredStoreOpenedEmail({ storeName: "<b>x</b>", commissionBps: 250, months: 6, url: "https://k.test" })).html).not.toContain("<b>x</b>");
  });

  it("tell them credit was taken off an invoice, in its currency", () => {
    const email = renderEmail(referralCreditAppliedEmail({ amountMinor: 12_500, currency: "NOK", invoiceNumber: "KZ-0042", url: "https://k.test" }));
    expect(email.subject).toMatch(/125\.00|125,00/);
    expect(email.text).toContain("KZ-0042");
    expect(renderEmail(referralCreditAppliedEmail({ amountMinor: 500, currency: "EUR", invoiceNumber: null, url: "https://k.test" })).text).toContain("your next invoice");
  });
});
