import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatMoney } from "@/lib/money";
import { computeLine, totalsOf, type LineInput } from "@/lib/work-calc";
import {
  creditNoteWording,
  defaultLatePaymentNote,
  documentLabels,
  documentLanguage,
  type VatNoteKey,
} from "@/lib/work-invoice-text";
import { vatNotesFor } from "@/lib/work-vat";
import type { CreditNoteDocument, DocumentLine, InvoiceDocument } from "@/server/work-invoices";

import { CreditNoteDocumentView, DOCUMENT_CSS, InvoiceDocumentView } from "./invoice-document";

/**
 * The printed documents (docs/work.md 4.7, WP7a): rendered on the server from
 * frozen snapshots, in each of the four document languages, with the VAT
 * scenarios of 4.5, credit notes, long and hostile text.
 */

type LineSpec = {
  description?: string;
  unit?: "hour" | "unit";
  quantityHundredths: number;
  unitPriceMinor: number;
  discountBp?: number;
  vatBp: number;
  vatCategory?: LineInput["vatCategory"];
};

function documentLines(specs: LineSpec[]) {
  const inputs: LineInput[] = specs.map((s) => ({
    quantityHundredths: s.quantityHundredths,
    unitPriceMinor: s.unitPriceMinor,
    discountBp: s.discountBp ?? 0,
    vatBp: s.vatBp,
    vatCategory: s.vatCategory ?? "standard",
  }));
  const amounts = inputs.map(computeLine);
  const lines: DocumentLine[] = specs.map((s, i) => ({
    description: s.description ?? `Consulting ${i + 1}`,
    unit: s.unit ?? "hour",
    quantityHundredths: s.quantityHundredths,
    unitPriceMinor: s.unitPriceMinor,
    discountBp: s.discountBp ?? 0,
    vatCategory: inputs[i].vatCategory,
    vatBp: s.vatBp,
    exclMinor: amounts[i].exclMinor,
    vatMinor: amounts[i].vatMinor,
    inclMinor: amounts[i].inclMinor,
  }));
  const totals = totalsOf(
    amounts.map((a, i) => ({ ...a, vatBp: inputs[i].vatBp, vatCategory: inputs[i].vatCategory })),
  );
  return { lines, totals };
}

type InvoiceOptions = {
  locale?: string;
  currency?: string;
  lines?: LineSpec[];
  sellerCountry?: string;
  vatRegistered?: boolean;
  notes?: VatNoteKey[];
  vatHome?: { amountMinor: number; currency: string; rate: string } | null;
  over?: Partial<InvoiceDocument>;
};

function invoice(o: InvoiceOptions = {}): InvoiceDocument {
  const locale = o.locale ?? "nb-NO";
  const language = documentLanguage(locale);
  const { lines, totals } = documentLines(
    o.lines ?? [{ description: "Consulting", quantityHundredths: 150, unitPriceMinor: 120_000, vatBp: 2500 }],
  );
  const country = o.sellerCountry ?? "NO";
  return {
    kind: "invoice",
    invoiceId: "00000000-0000-4000-8000-000000000001",
    draft: false,
    status: "sent",
    documentNumber: "W-1001",
    language,
    locale,
    labels: documentLabels(language),
    currency: o.currency ?? "NOK",
    issuedOn: "2026-09-28",
    dueOn: "2026-10-12",
    paymentDays: 14,
    servicePeriod: { from: "2026-09-01", to: "2026-09-27" },
    reference: "PO 4471",
    notes: null,
    seller: {
      legalName: "Kaizen Konsult AS",
      organisationNumber: "923 456 789",
      vatRegistered: o.vatRegistered ?? true,
      vatNumber: "NO923456789MVA",
      address: "Storgata 1\n0155 Oslo",
      country,
      email: "faktura@example.com",
      bankAccount: "NO9386011117947",
      bic: "DNBANOKK",
      paymentNote: null,
      invoiceFooter: "Kaizen Konsult AS · Storgata 1 · Oslo",
      latePaymentNote: null,
    },
    buyer: {
      name: "Kunde AS",
      clientName: "Kunde",
      organisationNumber: "912 345 678",
      vatNumber: null,
      address: { line1: "Kirkegata 2", postalCode: "0153", city: "Oslo" },
      country: "NO",
      email: null,
      contactName: "Kari Nordmann",
      business: true,
      vatTreatment: "domestic",
    },
    lines,
    totals,
    vatHome: o.vatHome ?? null,
    vatNotes: vatNotesFor(o.notes ?? [], locale, country),
    consistent: true,
    payment: {
      bankAccount: "NO9386011117947",
      bic: "DNBANOKK",
      paymentReference: "W-1001",
      note: null,
      dueOn: "2026-10-12",
      amountDueMinor: totals.totalMinor,
    },
    latePaymentNote: defaultLatePaymentNote(language),
    footer: "Kaizen Konsult AS · Storgata 1 · Oslo",
    amounts: { totalMinor: totals.totalMinor, paidMinor: 0, creditedMinor: 0, outstandingMinor: totals.totalMinor },
    creditNotes: [],
    publicToken: null,
    ...o.over,
  };
}

function creditNote(
  o: { locale?: string; full?: boolean; over?: Partial<CreditNoteDocument> } = {},
): CreditNoteDocument {
  const locale = o.locale ?? "nb-NO";
  const language = documentLanguage(locale);
  const base = invoice({
    locale,
    lines: [{ description: "Consulting", quantityHundredths: 50, unitPriceMinor: 120_000, vatBp: 2500 }],
  });
  const full = o.full ?? false;
  return {
    kind: "credit_note",
    creditNoteId: "00000000-0000-4000-8000-000000000002",
    invoiceId: base.invoiceId,
    documentNumber: "WCN-1",
    invoiceNumber: "W-1001",
    issuedOn: "2026-09-29",
    language,
    locale,
    labels: base.labels,
    currency: "NOK",
    seller: base.seller,
    buyer: base.buyer,
    lines: base.lines,
    totals: base.totals,
    vatHome: null,
    vatNotes: [],
    consistent: true,
    reason: "Wrong number of hours",
    full,
    wording: creditNoteWording(language, { invoiceNumber: "W-1001", full }),
    ...o.over,
  };
}

const render = (doc: InvoiceDocument) => renderToStaticMarkup(createElement(InvoiceDocumentView, { doc }));
const renderCredit = (doc: CreditNoteDocument) => renderToStaticMarkup(createElement(CreditNoteDocumentView, { doc }));

const summaryRows = (html: string) => {
  const table = /<table class="wd-summary">[\s\S]*?<\/table>/.exec(html)?.[0] ?? "";
  return (table.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length;
};

describe("the invoice document, in the four document languages", () => {
  const cases = [
    {
      locale: "nb-NO",
      lang: "nb",
      title: "Faktura",
      terms: "Betalingsbetingelser: 14 dager netto",
      hours: "1,50 t",
      late: "forsinkelsesrente",
      labels: [
        "Fakturadato",
        "Forfallsdato",
        "Leveringsperiode",
        "Faktureres til",
        "Org.nr.",
        "MVA-nr.",
        "Kontonummer",
        "Betalingsreferanse",
        "Sum inkl. mva.",
      ],
    },
    {
      locale: "sv-SE",
      lang: "sv",
      title: "Faktura",
      terms: "Betalningsvillkor: 14 dagar netto",
      hours: "1,50 tim",
      late: "dröjsmålsränta",
      labels: [
        "Fakturadatum",
        "Förfallodatum",
        "Leveransperiod",
        "Faktureras till",
        "Organisationsnr",
        "Momsregistreringsnr",
        "Bankkonto",
        "Betalningsreferens",
        "Summa inkl. moms",
      ],
    },
    {
      locale: "da-DK",
      lang: "da",
      title: "Faktura",
      terms: "Betalingsbetingelser: 14 dage netto",
      hours: "1,50 t",
      late: "morarenter",
      labels: [
        "Fakturadato",
        "Forfaldsdato",
        "Leveringsperiode",
        "Faktureres til",
        "CVR-nr.",
        "Momsnr.",
        "Bankkonto",
        "Betalingsreference",
        "I alt inkl. moms",
      ],
    },
    {
      locale: "en-GB",
      lang: "en",
      title: "Invoice",
      terms: "Payment terms: 14 days net",
      hours: "1.50 h",
      late: "Interest may be charged",
      labels: [
        "Issue date",
        "Due date",
        "Period of supply",
        "Bill to",
        "Organisation no.",
        "VAT no.",
        "Bank account",
        "Payment reference",
        "Total incl. VAT",
      ],
    },
  ];

  it.each(cases)("writes a domestic 25 % invoice in $lang ($locale)", (c) => {
    const html = render(invoice({ locale: c.locale, notes: [] }));
    expect(html).toContain(`lang="${c.lang}"`);
    expect(html).toContain(`<h1>${c.title}</h1>`);
    expect(html).toContain("W-1001");
    for (const label of c.labels) expect(html, label).toContain(label);
    expect(html).toContain(c.terms);
    expect(html).toContain(c.hours);
    expect(html).toContain(c.late);
    // Seller, buyer, payment details.
    expect(html).toContain("Kaizen Konsult AS");
    expect(html).toContain("923 456 789");
    expect(html).toContain("NO923456789MVA");
    expect(html).toContain("NO9386011117947");
    expect(html).toContain("DNBANOKK");
    expect(html).toContain("Kunde AS");
    expect(html).toContain("Kari Nordmann");
    expect(html).toContain("0153 Oslo");
    expect(html).toContain("PO 4471");
    // Money from integer minor units, in the document's locale; 1.5 h at 1 200.00 = 1 800.00 + 25 %.
    for (const minor of [180_000, 45_000, 225_000, 120_000]) {
      expect(html).toContain(formatMoney(minor, "NOK", c.locale));
    }
    // Days in the document's locale, and the VAT rate in it.
    expect(html).toContain(
      new Intl.DateTimeFormat(c.locale, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(
        new Date("2026-09-28T00:00:00Z"),
      ),
    );
    expect(html).toContain(new Intl.NumberFormat(c.locale, { style: "percent" }).format(0.25));
  });

  it("uses each language's own hour unit and formats amounts per locale", () => {
    const amounts = new Set(cases.map((c) => formatMoney(225_000, "NOK", c.locale)));
    expect(amounts.size).toBe(4);
    expect(render(invoice({ locale: "sv-SE" }))).toContain(formatMoney(225_000, "NOK", "sv-SE"));
    expect(render(invoice({ locale: "en-GB" }))).not.toContain(formatMoney(225_000, "NOK", "nb-NO"));
  });

  it("falls back to English for a language it has no words for, and never fails on a bad locale", () => {
    const de = render(invoice({ locale: "de-DE" }));
    expect(de).toContain("<h1>Invoice</h1>");
    expect(de).toContain("Payment terms: 14 days net");
    expect(de).toContain('lang="en"');
    expect(() => render(invoice({ locale: "!!not a locale" }))).not.toThrow();
    expect(render(invoice({ locale: "!!not a locale" }))).toContain("<h1>Invoice</h1>");
  });

  it("is a table with a caption and column and row scopes", () => {
    const html = render(invoice());
    expect(html).toContain("<caption>Faktura W-1001</caption>");
    expect(html).toContain('<th scope="col" class="wd-left">Beskrivelse</th>');
    expect(html).toContain('<th scope="row" class="wd-left wd-lines">Consulting</th>');
    expect(html).toContain("<caption>MVA-oversikt</caption>");
    expect(html).toContain('<article class="wd" lang="nb" aria-label="Faktura W-1001">');
  });

  it("carries print styles without characters React would escape", () => {
    const html = render(invoice());
    expect(html).toContain("@page { size: A4;");
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("@media print");
    expect(DOCUMENT_CSS).not.toMatch(/[>&"']/);
    // The style went out as written.
    expect(html).toContain(DOCUMENT_CSS);
    // No theme colours or classes: black on white.
    expect(html).toContain("color: #000");
    expect(html).not.toContain("var(--");
  });

  it("leaves out what the invoice does not have", () => {
    const html = render(
      invoice({
        over: {
          reference: null,
          servicePeriod: null,
          payment: {
            bankAccount: "NO9386011117947",
            bic: null,
            paymentReference: "W-1001",
            note: null,
            dueOn: "2026-10-12",
            amountDueMinor: 225_000,
          },
        },
      }),
    );
    expect(html).not.toContain("Deres referanse");
    expect(html).not.toContain("Leveringsperiode");
    expect(html).not.toContain("BIC/SWIFT");
    expect(html).not.toContain("Merknader");
  });

  it("shows the seller's own payment instructions and the buyer's VAT number", () => {
    const doc = invoice();
    doc.payment.note = "Betal innen fristen.\nMerk betalingen med fakturanummer.";
    doc.buyer.vatNumber = "NO912345678MVA";
    const html = render(doc);
    expect(html).toContain("Betal innen fristen.\nMerk betalingen med fakturanummer.");
    expect(html).toContain("NO912345678MVA");
    expect(html).toContain("wd-lines");
  });
});

describe("VAT on the document", () => {
  it("states the not-registered note and no VAT", () => {
    const doc = invoice({
      vatRegistered: false,
      notes: ["not_registered"],
      lines: [{ quantityHundredths: 100, unitPriceMinor: 100_000, vatBp: 0 }],
    });
    doc.seller.vatRegistered = false;
    doc.seller.vatNumber = null;
    const html = render(doc);
    expect(html).toContain("Selger er ikke registrert i Merverdiavgiftsregisteret. Merverdiavgift er ikke beregnet.");
    expect(html).not.toContain("NO923456789MVA");
    expect(summaryRows(html)).toBe(1);
    expect(html).toContain(formatMoney(100_000, "NOK", "nb-NO"));
  });

  it("states the reverse charge with the buyer's VAT number, citing the Directive for an EU seller", () => {
    const doc = invoice({
      locale: "sv-SE",
      currency: "SEK",
      sellerCountry: "SE",
      notes: ["reverse_charge"],
      lines: [{ quantityHundredths: 200, unitPriceMinor: 50_000, vatBp: 0, vatCategory: "reverse_charge" }],
    });
    doc.buyer = {
      ...doc.buyer,
      name: "Kund GmbH",
      country: "DE",
      vatNumber: "DE123456789",
      vatTreatment: "reverse_charge",
    };
    const html = render(doc);
    expect(html).toContain(
      "Omvänd betalningsskyldighet: köparen redovisar momsen. Artikel 196, rådets direktiv 2006/112/EG.",
    );
    expect(html).toContain("DE123456789");
    expect(html).toContain("Tyskland");
  });

  it("states the reverse charge without a citation for a seller outside the EU", () => {
    const html = render(
      invoice({
        notes: ["reverse_charge"],
        lines: [{ quantityHundredths: 100, unitPriceMinor: 100_000, vatBp: 0, vatCategory: "reverse_charge" }],
      }),
    );
    expect(html).toContain("Omvendt avgiftsplikt: kjøper beregner og betaler merverdiavgiften.");
    expect(html).not.toContain("2006/112");
  });

  it("states the VAT in the seller's currency for a foreign-currency invoice, with the rate", () => {
    const doc = invoice({
      currency: "EUR",
      locale: "en-GB",
      lines: [{ quantityHundredths: 100, unitPriceMinor: 100_000, vatBp: 2500 }],
      vatHome: { amountMinor: 287_500, currency: "NOK", rate: "11.50000000" },
    });
    const html = render(doc);
    expect(html).toContain("VAT in NOK");
    expect(html).toContain(formatMoney(287_500, "NOK", "en-GB"));
    expect(html).toContain("1 EUR = 11.5 NOK");
    // The invoice itself is in euro.
    expect(html).toContain(formatMoney(25_000, "EUR", "en-GB"));
    expect(html).toContain(formatMoney(125_000, "EUR", "en-GB"));
  });

  it("does not state VAT in another currency when there is none to state", () => {
    expect(render(invoice())).not.toContain("MVA i ");
  });

  it("lists every VAT rate in its own group, and the groups add up to the total", () => {
    const doc = invoice({
      locale: "da-DK",
      currency: "DKK",
      sellerCountry: "DK",
      notes: ["exempt"],
      lines: [
        { description: "Rådgivning", quantityHundredths: 300, unitPriceMinor: 80_000, vatBp: 2500 },
        { description: "Rådgivning, reduceret", quantityHundredths: 100, unitPriceMinor: 50_000, vatBp: 1200 },
        {
          description: "Kursus",
          unit: "unit",
          quantityHundredths: 200,
          unitPriceMinor: 30_000,
          vatBp: 0,
          vatCategory: "exempt",
        },
      ],
    });
    const html = render(doc);
    expect(summaryRows(html)).toBe(3);
    expect(doc.totals.vatGroups).toHaveLength(3);
    expect(doc.totals.vatGroups.reduce((s, g) => s + g.vatMinor, 0)).toBe(doc.totals.vatMinor);
    for (const g of doc.totals.vatGroups) {
      expect(html).toContain(formatMoney(g.netMinor, "DKK", "da-DK"));
      expect(html).toContain(formatMoney(g.vatMinor, "DKK", "da-DK"));
    }
    expect(html).toContain(formatMoney(doc.totals.totalMinor, "DKK", "da-DK"));
    expect(html).toContain("2 stk");
    expect(html).toContain("Fritaget for moms.");
    expect(html).toContain(new Intl.NumberFormat("da-DK", { style: "percent" }).format(0.12));
  });

  it("shows a line's discount only when there is one", () => {
    const doc = invoice({
      lines: [
        { description: "Discounted", quantityHundredths: 100, unitPriceMinor: 100_000, discountBp: 1000, vatBp: 2500 },
        { description: "Full price", quantityHundredths: 100, unitPriceMinor: 100_000, vatBp: 2500 },
      ],
    });
    const html = render(doc);
    expect(html).toContain(new Intl.NumberFormat("nb-NO", { style: "percent" }).format(0.1));
    expect(html.match(/<td class="wd-num"><\/td>/g)).toHaveLength(1);
  });
});

describe("what a document does with text it was given", () => {
  const hostile = '<script>alert("x")</script><img src=x onerror=alert(1)>&amp;';

  it("draws descriptions, notes, footers and names as text, never as HTML", () => {
    const doc = invoice({
      lines: [{ description: hostile, quantityHundredths: 100, unitPriceMinor: 100_000, vatBp: 2500 }],
      over: { notes: hostile, reference: hostile, footer: hostile },
    });
    doc.seller.legalName = hostile;
    doc.seller.address = hostile;
    doc.seller.invoiceFooter = hostile;
    doc.buyer.name = hostile;
    doc.buyer.contactName = hostile + "2";
    doc.payment.note = hostile;
    doc.buyer.address = { line1: hostile };
    const html = render(doc);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;amp;");
    // Only the style element is markup the page owns.
    expect(html.match(/<style>/g)).toHaveLength(1);
  });

  it("does the same for a credit note", () => {
    const doc = creditNote({ over: { reason: hostile } });
    doc.lines[0].description = hostile;
    doc.buyer.name = hostile;
    const html = renderCredit(doc);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps a long description whole, on the row, with its line breaks", () => {
    const long = `${"Workshop ".repeat(120)}\nSecond paragraph\n${"x".repeat(600)}`;
    const html = render(
      invoice({ lines: [{ description: long, quantityHundredths: 100, unitPriceMinor: 100_000, vatBp: 2500 }] }),
    );
    expect(html).toContain(long);
    expect(html).toContain('class="wd-left wd-lines"');
    expect(DOCUMENT_CSS).toContain("white-space: pre-line");
    expect(DOCUMENT_CSS).toContain("overflow-wrap: anywhere");
    // A row is never cut by a page break.
    expect(DOCUMENT_CSS).toMatch(/\.wd tr \{[^}]*break-inside: avoid/);
  });

  it("puts only the seller's footer at the bottom, and none when there is none", () => {
    expect(render(invoice())).toContain(
      '<footer class="wd-footer wd-lines">Kaizen Konsult AS · Storgata 1 · Oslo</footer>',
    );
    const doc = invoice();
    doc.seller.invoiceFooter = "  ";
    expect(render(doc)).not.toContain("<footer");
  });
});

describe("an invoice that has been paid or credited", () => {
  it("shows what was paid, credited and is still due, with the credit notes named", () => {
    const doc = invoice({ locale: "en-GB" });
    const total = doc.totals.totalMinor;
    doc.amounts = { totalMinor: total, paidMinor: 100_000, creditedMinor: 50_000, outstandingMinor: total - 150_000 };
    doc.creditNotes = [
      {
        id: "cn1",
        documentNumber: "WCN-1",
        issuedOn: "2026-09-29",
        currency: "NOK",
        reason: null,
        subtotalMinor: 40_000,
        vatMinor: 10_000,
        totalMinor: 50_000,
        lines: [],
        createdAt: "2026-09-29T10:00:00Z",
        createdByName: null,
      },
    ];
    const html = render(doc);
    expect(html).toContain(formatMoney(-100_000, "NOK", "en-GB"));
    expect(html).toContain(formatMoney(-50_000, "NOK", "en-GB"));
    expect(html).toContain(formatMoney(total - 150_000, "NOK", "en-GB"));
    expect(html).toContain("Credit note WCN-1");
    expect(html).toContain(formatMoney(-50_000, "NOK", "en-GB"));
  });

  it("has no paid or credited rows when nothing has happened", () => {
    const html = render(invoice({ locale: "en-GB" }));
    expect(html).not.toContain("Credit note");
    expect(html).not.toMatch(/<dt>Paid<\/dt>/);
  });
});

describe("the credit note document", () => {
  it("names the invoice it corrects and says what it does, in each language", () => {
    const words = {
      "nb-NO": [
        "Kreditnota",
        "Denne kreditnotaen krediterer en del av faktura W-1001.",
        "Beløp som allerede er betalt, gjøres opp særskilt.",
        "Kreditert faktura",
      ],
      "sv-SE": [
        "Kreditfaktura",
        "Denna kreditfaktura krediterar en del av faktura W-1001.",
        "Belopp som redan har betalats regleras separat.",
        "Krediterad faktura",
      ],
      "da-DK": [
        "Kreditnota",
        "Denne kreditnota krediterer en del af faktura W-1001.",
        "Beløb, der allerede er betalt, afregnes særskilt.",
        "Krediteret faktura",
      ],
      "en-GB": [
        "Credit note",
        "This credit note credits part of invoice W-1001.",
        "Amounts already paid are settled separately.",
        "Credited invoice",
      ],
    } as const;
    for (const [locale, [title, statement, settlement, label]] of Object.entries(words)) {
      const html = renderCredit(creditNote({ locale }));
      expect(html, locale).toContain(`<h1>${title}</h1>`);
      expect(html).toContain("WCN-1");
      expect(html).toContain(statement);
      expect(html).toContain(settlement);
      expect(html).toContain(label);
      expect(html).toContain("W-1001");
      expect(html).toContain(`lang="${documentLanguage(locale)}"`);
    }
  });

  it("says a full credit cancels the whole invoice", () => {
    expect(renderCredit(creditNote({ full: true }))).toContain(
      "Denne kreditnotaen krediterer faktura W-1001 i sin helhet.",
    );
  });

  it("shows the credited lines, the reason and the totals as negative amounts", () => {
    const doc = creditNote({ locale: "en-GB" });
    const html = renderCredit(doc);
    expect(html).toContain("Wrong number of hours");
    expect(html).toContain("Consulting");
    expect(html).toContain("0.50 h");
    // The unit price stays positive; amounts, VAT and the total are credits.
    expect(html).toContain(formatMoney(120_000, "NOK", "en-GB"));
    expect(html).toContain(formatMoney(-doc.totals.subtotalMinor, "NOK", "en-GB"));
    expect(html).toContain(formatMoney(-doc.totals.vatMinor, "NOK", "en-GB"));
    expect(html).toContain(formatMoney(-doc.totals.totalMinor, "NOK", "en-GB"));
    // No payment block on a credit note.
    expect(html).not.toContain("Payment details");
    expect(html).not.toContain("Amount due");
  });

  it("carries the frozen VAT notes and the foreign-currency VAT of its invoice", () => {
    const doc = creditNote({
      locale: "en-GB",
      over: {
        currency: "EUR",
        vatNotes: vatNotesFor(["exempt"], "en-GB", "NO"),
        vatHome: { amountMinor: 11_500, currency: "NOK", rate: "11.5" },
      },
    });
    const html = renderCredit(doc);
    expect(html).toContain("Exempt from VAT.");
    expect(html).toContain("VAT in NOK");
    expect(html).toContain(formatMoney(-11_500, "NOK", "en-GB"));
    expect(html).toContain("1 EUR = 11.5 NOK");
  });

  it("is a table with a caption, like the invoice", () => {
    const html = renderCredit(creditNote());
    expect(html).toContain("<caption>Kreditnota WCN-1</caption>");
    expect(html).toContain('<th scope="col">');
    expect(html).toContain("Kaizen Konsult AS");
  });
});
