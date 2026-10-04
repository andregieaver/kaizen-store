import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocumentsCard } from "./documents-card";
import { noop, orderDocuments, plain } from "./test-fixtures";

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

const draw = (documents = orderDocuments(), over: Partial<Parameters<typeof DocumentsCard>[0]> = {}) => {
  const html = renderToString(h(DocumentsCard, { base: "/admin/s", documents, canWrite: true, sendAgain: () => noop, ...over }));
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

const NOTE = { id: "44444444-4444-4444-8444-444444444444", type: "credit_note" as const, documentNumber: "K-3", issuedOn: "2026-10-09", token: "crn_x", hasPdf: false, totalMinor: 25_000, currency: "NOK" };

describe("the Documents card on an order", () => {
  it("shows the invoice with its date and total, and the links to view and download it", () => {
    const { html, text } = draw();
    expect(text).toContain("Invoice and credit notes");
    expect(text).toContain("Invoice F-17");
    expect(text).toContain("5 Oct 2026");
    expect(text).toContain("NOK 1,000.00");
    expect(html).toContain('href="/admin/s/invoices/22222222-2222-4222-8222-222222222222/print"');
    expect(html).toContain('href="/admin/s/invoices/22222222-2222-4222-8222-222222222222/pdf"');
  });

  it("lists each credit note under the invoice, linking its own pages", () => {
    const { html, text } = draw(orderDocuments({ creditNotes: [NOTE] }));
    expect(text).toContain("Credit note K-3");
    expect(text).toContain("9 Oct 2026");
    expect(html).toContain('href="/admin/s/invoices/credit-notes/44444444-4444-4444-8444-444444444444/print"');
    expect(html).toContain('href="/admin/s/invoices/credit-notes/44444444-4444-4444-8444-444444444444/pdf"');
  });

  it("offers Send again for each document to a member who may change orders, and to nobody else", () => {
    expect(draw(orderDocuments({ creditNotes: [NOTE] })).html.match(/Send to the customer again/g)).toHaveLength(2);
    expect(draw(orderDocuments(), { canWrite: false }).html).not.toContain("Send to the customer again");
  });

  it("binds the action of each document, by its kind and id", () => {
    const seen: string[] = [];
    draw(orderDocuments({ creditNotes: [NOTE] }), {
      sendAgain: (type, id) => {
        seen.push(`${type}:${id}`);
        return noop;
      },
    });
    expect(seen).toEqual(["invoice:22222222-2222-4222-8222-222222222222", "credit_note:44444444-4444-4444-8444-444444444444"]);
  });

  it("says why there is no invoice, in words, for a test order, a copied one and one paid before invoicing was on", () => {
    const test = draw(orderDocuments({ invoice: null, eligibility: "test_mode", staffNote: "Paid in Stripe's test mode: a test order gets no invoice, so the legal numbers are not used up." }));
    expect(test.text).toContain("a test order gets no invoice");
    expect(test.html).not.toContain("Send to the customer again");
    expect(draw(orderDocuments({ invoice: null, eligibility: "copied", staffNote: "History copied from another store is never invoiced." })).text).toContain("never invoiced");
    expect(draw(orderDocuments({ invoice: null, eligibility: "disabled", staffNote: "Invoicing is switched off for this store, or the order was paid before it was switched on." })).text).toContain("switched off");
  });

  it("says a paid order waits for its invoice, why, and links where to fix it and to everything that waits", () => {
    const { html, text } = draw(
      orderDocuments({ invoice: null, waiting: "seller_details", staffNote: "Complete your business details (legal name, address, organisation number, country, and a VAT number when you are registered)." }),
    );
    expect(text).toContain("Waiting for an invoice: business details missing");
    expect(text).toContain("Complete your business details");
    expect(html).toContain('href="/admin/s/settings/company"');
    expect(html).toContain('href="/admin/s/invoices?tab=waiting"');
  });

  it("links no fix for a failed invoice, which has no page to fix it", () => {
    const { html, text } = draw(orderDocuments({ invoice: null, waiting: "invoice_failed", staffNote: "Making the invoice failed; it is tried again every five minutes." }));
    expect(text).toContain("Making the invoice failed");
    expect(html).not.toContain("Fix it");
    expect(html).toContain("See everything that waits");
  });

  it("is not drawn for an order that has not been paid", () => {
    expect(renderToString(h(DocumentsCard, { base: "/admin/s", documents: orderDocuments({ invoice: null, eligibility: "not_paid" }), canWrite: true, sendAgain: () => noop }))).toBe("");
  });

  it("still shows the credit notes of an unpaid-looking order that has documents", () => {
    expect(draw(orderDocuments({ eligibility: "not_paid" })).text).toContain("Invoice F-17");
  });
});
