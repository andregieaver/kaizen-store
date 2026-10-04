import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { INVOICE_NOTES } from "@/lib/invoice-admin";
import type { InvoiceReadiness, InvoiceSettings, SeriesState } from "@/server/invoice-settings";

import { InvoiceNotes, InvoiceReadinessList, InvoiceSettingsForm, SeriesForm } from "./invoice-settings-form";
import { noop, plain } from "./test-fixtures";

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

const readiness = (over: Partial<InvoiceReadiness> = {}): InvoiceReadiness => ({
  ready: true,
  missing: [],
  taxProfileSaved: true,
  vatRegistered: true,
  fixAt: {},
  ratesByHand: false,
  stripeInvoicesIgnored: false,
  ...over,
});

const settings = (over: Partial<InvoiceSettings> = {}): InvoiceSettings => ({ enabled: true, enabledFrom: null, footerNote: null, emailWithConfirmation: true, saved: true, ...over });

const series = (over: Partial<SeriesState> = {}): SeriesState => ({ series: "invoice", prefix: "F-", nextNumber: 1, issued: 0, locked: false, nextDocumentNumber: "F-1", ...over });

const drawn = (element: Parameters<typeof renderToString>[0]) => {
  const html = renderToString(element);
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("what is missing before invoicing", () => {
  it("says the details are complete when they are", () => {
    expect(drawn(h(InvoiceReadinessList, { base: "/admin/s", readiness: readiness() })).text).toContain("The business details and the tax profile an invoice needs are complete.");
  });

  it("lists each missing detail with where to give it", () => {
    const { html, text } = drawn(
      h(InvoiceReadinessList, {
        base: "/admin/s",
        readiness: readiness({ ready: false, missing: ["legal_name", "vat_number"], fixAt: { legal_name: "/settings/company", vat_number: "/settings/tax" } }),
      }),
    );
    expect(text).toContain("Legal name of the business is missing.");
    expect(text).toContain("VAT number (the store is registered for VAT) is missing.");
    expect(html).toContain('href="/admin/s/settings/company"');
    expect(html).toContain('href="/admin/s/settings/tax"');
    expect(text).toContain("the payment is never held back");
  });

  it("says when the tax profile is not saved, and warns about rates kept by hand", () => {
    const { html, text } = drawn(h(InvoiceReadinessList, { base: "/admin/s", readiness: readiness({ ready: false, taxProfileSaved: false, ratesByHand: true }) }));
    expect(text).toContain("The tax profile is not saved");
    expect(text).toContain("keeps its exchange rates by hand");
    expect(html).toContain('href="/admin/s/settings/localization"');
  });
});

describe("the switch, the note and the email option", () => {
  const form = (s = settings(), r = readiness()) => drawn(h(InvoiceSettingsForm, { settings: s, readiness: r, paymentsHref: "/admin/s/settings/payments", saveAction: noop }));

  it("shows the switch and the email option as they are, and the note", () => {
    const { html, text } = form(settings({ footerNote: "Bank 1234" }));
    expect(html).toMatch(/name="enabled"[^>]*checked/);
    expect(html).toMatch(/name="emailWithConfirmation"[^>]*checked/);
    expect(html).toContain("Bank 1234");
    expect(html).toContain('maxLength="1000"');
    expect(text).toContain("Make an invoice for every paid order");
    expect(text).toContain("Orders paid before it was switched on are never invoiced afterwards.");
  });

  it("shows an unticked switch and says new orders get no invoice, and to complete the list first when it is not complete", () => {
    const { html, text } = form(settings({ enabled: false }), readiness({ ready: false, missing: ["legal_name"] }));
    expect(html).not.toMatch(/name="enabled"[^>]*checked/);
    expect(text).toContain("It is off now, so new orders get no invoice.");
    expect(text).toContain("Complete the list above first");
  });

  it("says since when invoices are made, when it was switched on", () => {
    expect(form(settings({ enabledFrom: "2026-10-04T08:00:00.000Z" })).text).toContain("Switched on 4 Oct 2026.");
  });

  it("says Stripe's own invoice is not used while Kaizen makes them, with a link to payments", () => {
    const { html, text } = form(settings(), readiness({ stripeInvoicesIgnored: true }));
    expect(text).toContain("is not used while Kaizen makes the invoices");
    expect(html).toContain('href="/admin/s/settings/payments"');
    expect(form().text).not.toContain("not used while Kaizen");
  });
});

describe("a series' prefix and first number", () => {
  it("is open before the first document is issued, with what the first number will be", () => {
    const { html, text } = drawn(h(SeriesForm, { state: series(), action: noop }));
    expect(text).toContain("Invoice numbers");
    expect(html).toContain('name="series" value="invoice"');
    expect(html).toContain('name="prefix"');
    expect(html).toContain('value="F-"');
    expect(html).toContain('name="nextNumber"');
    expect(text).toContain("The first invoice will be F-1");
    expect(html).toContain("Save the numbers");
  });

  it("names the credit note series as its own", () => {
    const { html, text } = drawn(h(SeriesForm, { state: series({ series: "credit_note", prefix: "K-", nextDocumentNumber: "K-1" }), action: noop }));
    expect(text).toContain("Credit note numbers");
    expect(html).toContain('name="series" value="credit_note"');
    expect(text).toContain("The first credit note will be K-1");
  });

  it("is locked once a document is issued: the count and the next number, no fields", () => {
    const { html, text } = drawn(h(SeriesForm, { state: series({ issued: 17, locked: true, nextNumber: 18, nextDocumentNumber: "F-18" }), action: noop }));
    expect(text).toMatch(/17 issued\. The next number is F-18\s?\./);
    expect(text).toContain("Numbers already issued cannot be changed, and none can be skipped or removed.");
    expect(html).not.toContain('name="prefix"');
    expect(html).not.toContain("Save the numbers");
  });
});

describe("the notes for an accountant", () => {
  it("lists every note once and says it is not advice", () => {
    const { text } = drawn(h(InvoiceNotes));
    for (const note of INVOICE_NOTES) expect(text).toContain(note);
    expect(text).toContain("This is not legal, tax or accounting advice.");
    expect(new Set(INVOICE_NOTES).size).toBe(INVOICE_NOTES.length);
  });
});
