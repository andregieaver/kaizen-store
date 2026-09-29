import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { computeLine, totalsOf } from "@/lib/work-calc";
import { creditNoteWording, defaultLatePaymentNote, documentLabels, documentLanguage } from "@/lib/work-invoice-text";
import type { CreditNoteDocument, InvoiceDocument } from "@/server/work-invoices";

import { HostedInvoice } from "./hosted-invoice";

/**
 * The hosted invoice page's body (docs/work.md 4.7, WP7b): the frozen document in its own language with a short
 * frame, for a client who is not signed in.
 */

function invoice(locale: string, over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  const language = documentLanguage(locale);
  const amounts = computeLine({
    quantityHundredths: 200,
    unitPriceMinor: 100_000,
    discountBp: 0,
    vatBp: 2500,
    vatCategory: "standard",
  });
  const totals = totalsOf([{ ...amounts, vatBp: 2500, vatCategory: "standard" }]);
  return {
    kind: "invoice",
    invoiceId: "00000000-0000-4000-8000-000000000001",
    draft: false,
    status: "sent",
    documentNumber: "W-1001",
    language,
    locale,
    labels: documentLabels(language),
    currency: "NOK",
    issuedOn: "2026-09-28",
    dueOn: "2026-10-12",
    paymentDays: 14,
    servicePeriod: null,
    reference: null,
    notes: null,
    seller: {
      legalName: "Konsult AS",
      organisationNumber: "923456789",
      vatRegistered: true,
      vatNumber: "NO923456789MVA",
      address: "Storgata 1\n0155 Oslo",
      country: "NO",
      email: "faktura@example.com",
      bankAccount: "NO9386011117947",
      bic: null,
      paymentNote: null,
      invoiceFooter: null,
      latePaymentNote: null,
    },
    buyer: {
      name: "Kunde AS",
      clientName: "Kunde",
      organisationNumber: null,
      vatNumber: null,
      address: { line1: "Kirkegata 2", postalCode: "0153", city: "Oslo" },
      country: "NO",
      email: "kunde@example.no",
      contactName: null,
      business: true,
      vatTreatment: "domestic",
    },
    lines: [
      {
        description: "Consulting",
        unit: "hour",
        quantityHundredths: 200,
        unitPriceMinor: 100_000,
        discountBp: 0,
        vatCategory: "standard",
        vatBp: 2500,
        exclMinor: amounts.exclMinor,
        vatMinor: amounts.vatMinor,
        inclMinor: amounts.inclMinor,
      },
    ],
    totals,
    vatHome: null,
    vatNotes: [],
    consistent: true,
    payment: {
      bankAccount: "NO9386011117947",
      bic: null,
      paymentReference: "W-1001",
      note: null,
      dueOn: "2026-10-12",
      amountDueMinor: totals.totalMinor,
    },
    latePaymentNote: defaultLatePaymentNote(language),
    footer: null,
    amounts: { totalMinor: totals.totalMinor, paidMinor: 0, creditedMinor: 0, outstandingMinor: totals.totalMinor },
    creditNotes: [],
    publicToken: "T".repeat(32),
    ...over,
  };
}

const render = (doc: InvoiceDocument, credit: CreditNoteDocument | null = null) =>
  renderToStaticMarkup(
    createElement(HostedInvoice, {
      doc,
      credit,
      invoiceHref: "/s/konsult/no/account/invoice/TTTT",
      contactEmail: "post@konsult.no",
    }),
  );

describe("the hosted invoice", () => {
  it("draws the frozen document with what is due and a print button, in the document's language", () => {
    const html = render(invoice("sv-SE"));
    expect(html).toContain('lang="sv"');
    expect(html).toContain("Faktura</h1>");
    expect(html).toContain("Skriv ut eller spara som PDF");
    expect(html).toContain("Belopp att betala");
    expect(html).toContain("Frågor om fakturan? Skriv till post@konsult.no.");
    expect(html).toContain("W-1001");
  });

  it("says when it is paid or credited, and keeps the store's page out of a print", () => {
    const paid = render(invoice("en-GB", { status: "paid", amounts: { totalMinor: 250_000, paidMinor: 250_000, creditedMinor: 0, outstandingMinor: 0 } }));
    expect(paid).toContain("This invoice has been paid. Thank you.");
    expect(paid).not.toContain("Amount due:");
    expect(render(invoice("en-GB", { status: "void" }))).toContain("credited in full");
    expect(paid).toContain("@media print");
  });

  it("lists the credit notes as links to them, and draws one alone with a way back", () => {
    const note = {
      id: "00000000-0000-4000-8000-000000000002",
      documentNumber: "WCN-1",
      issuedOn: "2026-09-29",
      currency: "NOK",
      reason: null,
      subtotalMinor: 100_000,
      vatMinor: 25_000,
      totalMinor: 125_000,
      lines: [],
      createdAt: "2026-09-29T10:00:00.000Z",
      createdByName: null,
    };
    const doc = invoice("nb-NO", { creditNotes: [note] });
    const list = render(doc);
    expect(list).toContain("Kreditnotaer");
    expect(list).toContain(`/s/konsult/no/account/invoice/TTTT?credit=${note.id}`);

    const language = documentLanguage("nb-NO");
    const credit: CreditNoteDocument = {
      kind: "credit_note",
      creditNoteId: note.id,
      invoiceId: doc.invoiceId,
      documentNumber: "WCN-1",
      invoiceNumber: "W-1001",
      issuedOn: "2026-09-29",
      language,
      locale: "nb-NO",
      labels: doc.labels,
      currency: "NOK",
      seller: doc.seller,
      buyer: doc.buyer,
      lines: doc.lines,
      totals: doc.totals,
      vatHome: null,
      vatNotes: [],
      consistent: true,
      reason: "Feil timer",
      full: true,
      wording: creditNoteWording(language, { invoiceNumber: "W-1001", full: true }),
    };
    const alone = render(doc, credit);
    expect(alone).toContain("Kreditnota</h1>");
    expect(alone).toContain("Tilbake til fakturaen");
    expect(alone).not.toContain("Kreditnotaer");
  });

  it("never draws a name or note as markup", () => {
    const html = render(invoice("en", { buyer: { ...invoice("en").buyer, name: "<img src=x onerror=alert(1)>" } }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});
