import { describe, expect, it } from "vitest";

import type { CreditNoteDocument, DocumentLine, InvoiceDocument } from "@/server/work-invoices";

import { computeLine, totalsOf, type LineInput } from "./work-calc";
import { vatIdentifier, workDocumentUbl, workVatCategory } from "./work-einvoice";

type LineSpec = { description?: string; unit?: "hour" | "unit"; quantityHundredths: number; unitPriceMinor: number; discountBp?: number; vatBp: number; vatCategory?: LineInput["vatCategory"] };

function linesOf(specs: LineSpec[]) {
  const inputs: LineInput[] = specs.map((s) => ({ quantityHundredths: s.quantityHundredths, unitPriceMinor: s.unitPriceMinor, discountBp: s.discountBp ?? 0, vatBp: s.vatBp, vatCategory: s.vatCategory ?? "standard" }));
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
  return { lines, totals: totalsOf(amounts.map((a, i) => ({ ...a, vatBp: inputs[i].vatBp, vatCategory: inputs[i].vatCategory }))) };
}

function invoice(specs: LineSpec[] = [{ description: "Consulting", quantityHundredths: 150, unitPriceMinor: 120_000, vatBp: 2500 }], over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  const { lines, totals } = linesOf(specs);
  return {
    kind: "invoice",
    invoiceId: "00000000-0000-4000-8000-000000000001",
    draft: false,
    status: "sent",
    documentNumber: "W-1001",
    imported: false,
    language: "nb",
    locale: "nb-NO",
    labels: {} as InvoiceDocument["labels"],
    currency: "NOK",
    issuedOn: "2026-09-28",
    dueOn: "2026-10-12",
    paymentDays: 14,
    servicePeriod: { from: "2026-09-01", to: "2026-09-27" },
    reference: "PO 4471",
    notes: null,
    seller: {
      legalName: "Human Web André Giæver",
      organisationNumber: "915 429 777",
      vatRegistered: true,
      vatNumber: "915429777",
      address: "Storgata 1\n0155 Oslo",
      country: "NO",
      email: "faktura@example.com",
      bankAccount: "NO93 8601 1117 947",
      bic: "DNBANOKK",
      paymentNote: null,
      invoiceFooter: null,
      latePaymentNote: null,
    },
    buyer: {
      name: "Kunde AS",
      clientName: "Kunde",
      organisationNumber: "923 609 016",
      vatNumber: null,
      address: { line1: "Kirkegata 2", postalCode: "0153", city: "Oslo" },
      country: "NO",
      email: "post@kunde.example",
      contactName: "Kari Nordmann",
      business: true,
      vatTreatment: "domestic",
    },
    lines,
    totals,
    vatHome: null,
    vatNotes: [],
    consistent: true,
    payment: { bankAccount: "NO93 8601 1117 947", bic: "DNBANOKK", paymentReference: "W-1001", note: null, dueOn: "2026-10-12", amountDueMinor: totals.totalMinor },
    latePaymentNote: "",
    footer: null,
    amounts: { totalMinor: totals.totalMinor, paidMinor: 0, creditedMinor: 0, outstandingMinor: totals.totalMinor },
    creditNotes: [],
    publicToken: null,
    ...over,
  };
}

function creditNote(over: Partial<CreditNoteDocument> = {}): CreditNoteDocument {
  const base = invoice([{ description: "Consulting", quantityHundredths: 50, unitPriceMinor: 120_000, vatBp: 2500 }]);
  return {
    kind: "credit_note",
    creditNoteId: "00000000-0000-4000-8000-000000000002",
    invoiceId: base.invoiceId,
    documentNumber: "WCN-1",
    invoiceNumber: "W-1001",
    issuedOn: "2026-09-29",
    language: base.language,
    locale: base.locale,
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
    full: false,
    wording: { title: "", statement: "", settlement: "" },
    ...over,
  };
}

const xmlOf = (out: ReturnType<typeof workDocumentUbl>) => {
  if (!out.ok) throw new Error(out.problems.join(","));
  return out.xml;
};

describe("a Work invoice as an e-invoice", () => {
  it("is EHF Billing 3.0: the client by its organisation number, hours as hours, the net price, 25 % VAT and the totals", () => {
    const xml = xmlOf(workDocumentUbl(invoice()));
    expect(xml).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>");
    expect(xml).toContain("<cbc:ID>W-1001</cbc:ID><cbc:IssueDate>2026-09-28</cbc:IssueDate><cbc:DueDate>2026-10-12</cbc:DueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
    expect(xml).toContain('<cbc:EndpointID schemeID="0192">915429777</cbc:EndpointID>');
    expect(xml).toContain('<cbc:EndpointID schemeID="0192">923609016</cbc:EndpointID>');
    expect(xml).toContain("<cbc:CompanyID>NO915429777MVA</cbc:CompanyID>");
    expect(xml).toContain("<cbc:BuyerReference>PO 4471</cbc:BuyerReference>");
    expect(xml).toContain("<cac:InvoicePeriod><cbc:StartDate>2026-09-01</cbc:StartDate><cbc:EndDate>2026-09-27</cbc:EndDate></cac:InvoicePeriod>");
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="HUR">1.5</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="NOK">1800.00</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:PriceAmount currencyID="NOK">1200.0</cbc:PriceAmount>');
    expect(xml).toContain("<cbc:ID>S</cbc:ID><cbc:Percent>25</cbc:Percent>");
    expect(xml).toContain('<cbc:TaxAmount currencyID="NOK">450.00</cbc:TaxAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="NOK">2250.00</cbc:PayableAmount>');
    expect(xml).toContain("<cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cbc:PaymentID>W-1001</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>NO9386011117947</cbc:ID>");
    expect(xml).toContain("<cac:FinancialInstitutionBranch><cbc:ID>DNBANOKK</cbc:ID></cac:FinancialInstitutionBranch>");
    expect(xml).not.toContain("<cbc:Note>");
  });

  it("pays to a domestic account number as a plain credit transfer, and names the client's contact when it has no reference", () => {
    const xml = xmlOf(workDocumentUbl(invoice(undefined, { reference: null, payment: { ...invoice().payment, bankAccount: "8601.11.17947", bic: null } })));
    expect(xml).toContain("<cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>");
    expect(xml).toContain("<cbc:ID>86011117947</cbc:ID>");
    expect(xml).toContain("<cbc:BuyerReference>Kari Nordmann</cbc:BuyerReference>");
  });

  it("writes each line's net price after its discount so quantity times price rounds back to the line", () => {
    const xml = xmlOf(workDocumentUbl(invoice([{ quantityHundredths: 133, unitPriceMinor: 99_900, discountBp: 1000, vatBp: 2500 }])));
    const net = /<cbc:LineExtensionAmount currencyID="NOK">([\d.]+)<\/cbc:LineExtensionAmount><cac:Item>/.exec(xml)![1];
    const price = /<cbc:PriceAmount currencyID="NOK">([\d.]+)<\/cbc:PriceAmount>/.exec(xml)![1];
    expect((Math.round(1.33 * Number(price) * 100) / 100).toFixed(2)).toBe(net);
  });

  it("names each kind of line by its VAT category, and a seller not registered for VAT charges none", () => {
    expect(workVatCategory({ vatCategory: "standard", vatBp: 2500 }, true)).toBe("S");
    expect(workVatCategory({ vatCategory: "standard", vatBp: 0 }, true)).toBe("Z");
    expect(workVatCategory({ vatCategory: "exempt", vatBp: 0 }, true)).toBe("E");
    expect(workVatCategory({ vatCategory: "reverse_charge", vatBp: 0 }, true)).toBe("AE");
    expect(workVatCategory({ vatCategory: "outside_scope", vatBp: 0 }, true)).toBe("O");
    expect(workVatCategory({ vatCategory: "standard", vatBp: 2500 }, false)).toBe("O");
    const xml = xmlOf(workDocumentUbl(invoice([{ quantityHundredths: 100, unitPriceMinor: 50_000, vatBp: 0 }], { seller: { ...invoice().seller, vatRegistered: false, vatNumber: null } })));
    expect(xml).toContain("<cbc:ID>O</cbc:ID>");
    expect(xml).not.toContain("MVA</cbc:CompanyID>");
  });

  it("refuses what a receiver would reject: reverse charge without the client's VAT number, outside scope beside VAT, a draft, totals that do not add up", () => {
    const reverse = invoice([{ quantityHundredths: 100, unitPriceMinor: 50_000, vatBp: 0, vatCategory: "reverse_charge" }], { buyer: { ...invoice().buyer, country: "SE", vatNumber: null } });
    expect(workDocumentUbl(reverse)).toEqual({ ok: false, problems: ["buyer_vat_number"] });
    const withVat = { ...reverse, buyer: { ...reverse.buyer, vatNumber: "SE556036079301" } };
    expect(xmlOf(workDocumentUbl(withVat))).toContain("<cbc:CompanyID>SE556036079301</cbc:CompanyID>");
    const mixed = invoice([
      { quantityHundredths: 100, unitPriceMinor: 50_000, vatBp: 2500 },
      { quantityHundredths: 100, unitPriceMinor: 10_000, vatBp: 0, vatCategory: "outside_scope" },
    ]);
    expect(workDocumentUbl(mixed)).toEqual({ ok: false, problems: ["outside_scope_mixed"] });
    expect(workDocumentUbl(invoice(undefined, { draft: true })).ok).toBe(false);
    expect(workDocumentUbl(invoice(undefined, { consistent: false }))).toEqual({ ok: false, problems: ["totals"] });
    expect(workDocumentUbl(invoice(undefined, { seller: { ...invoice().seller, country: null } }))).toEqual({ ok: false, problems: ["seller_country"] });
  });
});

describe("a Work credit note as an e-invoice", () => {
  it("is a credit note of the invoice it credits, its lines credited as they were", () => {
    const out = workDocumentUbl(creditNote());
    const xml = xmlOf(out);
    expect(out.ok && out.fileName).toBe("credit-note-WCN-1.xml");
    expect(xml).toContain('<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"');
    expect(xml).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(xml).toContain("<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>W-1001</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>");
    expect(xml).toContain('<cbc:CreditedQuantity unitCode="HUR">0.5</cbc:CreditedQuantity>');
    expect(xml).not.toContain("<cac:PaymentMeans>");
  });
});

describe("a VAT identifier", () => {
  it("carries its country's prefix, Norway's as NO + nine digits + MVA", () => {
    expect(vatIdentifier("NO", "915 429 777")).toBe("NO915429777MVA");
    expect(vatIdentifier("NO", "NO915429777MVA")).toBe("NO915429777MVA");
    expect(vatIdentifier("SE", "556036079301")).toBe("SE556036079301");
    expect(vatIdentifier("DE", "DE123456789")).toBe("DE123456789");
    expect(vatIdentifier("NO", null)).toBeNull();
  });
});
