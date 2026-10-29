import { describe, expect, it } from "vitest";

import { vatIncluded } from "./checkout";
import { creditNoteSnapshot } from "./credit-allocation";
import { amount, creditNoteUbl, invoiceUbl, unitPrice, vatCategory, xmlText } from "./einvoice";
import { buildInvoiceSnapshot, type InvoiceFacts, type InvoiceLineFacts, type InvoiceOrderFacts } from "./invoice-snapshot";

/** Invoices as EN 16931 UBL (D403): from the frozen snapshot only, totals that add up as the rules ask, or the reason it cannot be one. */

const order = (over: Partial<InvoiceOrderFacts> = {}): InvoiceOrderFacts => ({
  id: "o1",
  number: "1001",
  marketCode: "NO",
  currency: "NOK",
  locale: "nb-NO",
  email: "kari@example.com",
  placedOn: "2026-10-04",
  paidOn: "2026-10-04",
  shippingMinor: 0,
  discountMinor: 0,
  taxMinor: 0,
  totalMinor: 0,
  memberDiscountMinor: 0,
  memberLabel: null,
  campaignDiscountMinor: 0,
  campaignLabel: null,
  creditMinor: 0,
  referralDiscountMinor: 0, staffDiscountMinor: 0, staffLabel: null,
  discountCode: null,
  vatKind: "standard",
  vatReliefMinor: 0,
  shippingTaxRate: 0.25,
  marketStandardRate: 0.25,
  companyName: null,
  organisationNumber: null,
  balanceMinor: 0,
  billingAddress: { name: "Kari Nordmann", line1: "Storgata 5", postalCode: "0182", city: "Oslo", country: "NO" },
  shippingAddress: {},
  deliveryLabel: null,
  onlineProvider: "stripe",
  ...over,
});

const line = (over: Partial<InvoiceLineFacts> & { id: string }): InvoiceLineFacts => ({
  sku: over.id,
  title: `Item ${over.id}`,
  quantity: 1,
  unitPriceMinor: 0,
  totalMinor: 0,
  taxMinor: 0,
  taxRate: 0.25,
  delivery: "physical",
  gift: false,
  planned: false,
  bookedCount: null,
  vatCategory: "standard",
  booking: null,
  ...over,
});

/** A line as `placeOrder()` writes it: the VAT of what is paid for it. */
const paidLine = (id: string, unit: number, quantity: number, rate: number, discount = 0): InvoiceLineFacts => {
  const total = unit * quantity - discount;
  return line({ id, quantity, unitPriceMinor: unit, totalMinor: total, taxMinor: vatIncluded(total, rate), taxRate: rate });
};

function facts(lines: InvoiceLineFacts[], over: Partial<InvoiceOrderFacts> = {}, extra: Partial<InvoiceFacts> = {}): InvoiceFacts {
  const shipping = over.shippingMinor ?? 0;
  const rate = over.shippingTaxRate === undefined ? 0.25 : over.shippingTaxRate;
  const linesTotal = lines.reduce((s, l) => s + l.totalMinor, 0);
  const tax = lines.reduce((s, l) => s + l.taxMinor, 0) + vatIncluded(shipping, rate ?? 0.25);
  return {
    order: order({ totalMinor: linesTotal + shipping, taxMinor: tax, ...over }),
    lines,
    seller: { legalName: "Fixture AS", organisationNumber: "923456789", postalAddress: "Storgata 1, 0155 Oslo", country: "NO", email: "post@fixture.example", footerNote: null },
    profile: { vatRegistered: true, vatNumber: "NO923456789MVA" },
    treatment: { reason: "consumer", sellerVatNumber: "NO923456789MVA", buyerVatNumber: null, iossNumber: null },
    fx: { homeCurrency: "NOK", mainCurrency: "NOK", rates: { NOK: "11.7", SEK: "11.2", DKK: "7.46" }, ratesAuto: false, ratesAsOf: "2026-10-01" },
    ...extra,
  };
}

const ctx = { number: "F-1", issuedOn: "2026-10-04", supplyDate: "2026-10-04" };

/** Every `<tag>` amount in the XML, as numbers. */
const amounts = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<cbc:${tag} currencyID="[A-Z]{3}">(-?[0-9.]+)</cbc:${tag}>`, "g"))].map((m) => Number(m[1]));
const one = (xml: string, tag: string) => amounts(xml, tag)[0];

describe("amounts and text", () => {
  it("writes minor units with the currency's decimals, and a unit price that multiplies back to the line's net", () => {
    expect(amount(12345, "NOK")).toBe("123.45");
    expect(amount(5, "EUR")).toBe("0.05");
    expect(amount(-250, "SEK")).toBe("-2.50");
    expect(Number(unitPrice(1000, 3, "NOK")) * 3).toBeCloseTo(10, 4);
    expect(xmlText(`A & B <"c">`)).toBe("A &amp; B &lt;&quot;c&quot;&gt;");
  });

  it("names the VAT category by what the sale was", () => {
    expect(vatCategory("standard", 0.25, true)).toBe("S");
    expect(vatCategory("standard", 0, true)).toBe("Z");
    expect(vatCategory("reverse_charge", 0, true)).toBe("AE");
    expect(vatCategory("exempt", 0, true)).toBe("E");
    expect(vatCategory("standard", 0.25, false)).toBe("O");
  });
});

describe("an invoice as UBL", () => {
  it("adds up as EN 16931's rules ask: lines, the shipping charge, the VAT and what was paid", () => {
    const snap = buildInvoiceSnapshot(facts([paidLine("a", 12500, 2, 0.25), paidLine("b", 9900, 1, 0.15)], { shippingMinor: 5900 }), ctx);
    const out = invoiceUbl(snap);
    if (!out.ok) throw new Error(out.problems.join(", "));
    const xml = out.xml;
    expect(xml).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>");
    expect(xml).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
    expect(xml).toContain('<cbc:EndpointID schemeID="0192">923456789</cbc:EndpointID>');
    const lines = amounts(xml, "LineExtensionAmount");
    const [lineTotal, ...each] = lines;
    // BR-CO-10: the lines add up to the total of the lines.
    expect(each.reduce((s, v) => Math.round((s + v) * 100) / 100, 0)).toBe(lineTotal);
    // BR-CO-13, 15, 16.
    expect(Math.round((lineTotal + one(xml, "ChargeTotalAmount")) * 100) / 100).toBe(one(xml, "TaxExclusiveAmount"));
    expect(Math.round((one(xml, "TaxExclusiveAmount") + one(xml, "TaxAmount")) * 100) / 100).toBe(one(xml, "TaxInclusiveAmount"));
    expect(one(xml, "TaxInclusiveAmount")).toBe(snap.totals.grossMinor / 100);
    expect(Math.round((one(xml, "TaxInclusiveAmount") - one(xml, "PrepaidAmount")) * 100) / 100).toBe(one(xml, "PayableAmount"));
    // BR-CO-14: the breakdown's VAT adds up to the VAT total, one subtotal per rate.
    const tax = amounts(xml, "TaxAmount");
    expect(tax.slice(1).reduce((s, v) => Math.round((s + v) * 100) / 100, 0)).toBe(tax[0]);
    expect(xml.match(/<cac:TaxSubtotal>/g)).toHaveLength(2);
  });

  it("marks a reverse-charge sale and carries the buyer's VAT number", () => {
    const f = facts([line({ id: "a", quantity: 1, unitPriceMinor: 10000, totalMinor: 10000, taxMinor: 0, taxRate: 0 })], {
      vatKind: "reverse_charge",
      companyName: "Kunde AB",
      billingAddress: { name: "Anna", line1: "Gatan 1", postalCode: "11122", city: "Stockholm", country: "SE" },
      shippingTaxRate: 0,
    }, { treatment: { reason: "reverse_charge", sellerVatNumber: "NO923456789MVA", buyerVatNumber: "SE556677889901", iossNumber: null } });
    const out = invoiceUbl(buildInvoiceSnapshot(f, ctx));
    if (!out.ok) throw new Error(out.problems.join(", "));
    expect(out.xml).toContain("<cbc:ID>AE</cbc:ID>");
    expect(out.xml).toContain("VATEX-EU-AE");
    expect(out.xml).toContain("SE556677889901");
  });

  it("refuses a document it cannot make, with the reason", () => {
    const snap = buildInvoiceSnapshot(facts([paidLine("a", 12500, 1, 0.25)]), ctx);
    expect(invoiceUbl({ ...snap, buyer: { ...snap.buyer, address: { ...snap.buyer.address, country: null } } })).toEqual({ ok: false, problems: ["buyer_country"] });
    expect(invoiceUbl({ ...snap, seller: { ...snap.seller, vatNumber: null }, treatment: { ...snap.treatment, sellerVatNumber: null } })).toEqual({ ok: false, problems: ["seller_vat_number"] });
    expect(invoiceUbl({ ...snap, totals: { ...snap.totals, grossMinor: snap.totals.grossMinor + 1 } })).toEqual({ ok: false, problems: ["totals"] });
  });
});

describe("a credit note as UBL", () => {
  it("refers to its invoice and has a line per VAT rate that adds up to its total", () => {
    const inv = buildInvoiceSnapshot(facts([paidLine("a", 12500, 2, 0.25), paidLine("b", 9900, 1, 0.15)]), ctx);
    const note = creditNoteSnapshot({ invoice: { id: "i1", snapshot: inv }, earlier: [], source: "refund", returnNumber: null, working: null, number: "K-1", issuedOn: "2026-10-09", refundMinor: 15000 }).snapshot!;
    const out = creditNoteUbl(note);
    if (!out.ok) throw new Error(out.problems.join(", "));
    expect(out.xml).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(out.xml).toContain("<cac:InvoiceDocumentReference><cbc:ID>F-1</cbc:ID><cbc:IssueDate>2026-10-04</cbc:IssueDate></cac:InvoiceDocumentReference>");
    expect(one(out.xml, "TaxInclusiveAmount")).toBe(150);
    expect(out.fileName).toBe("credit-note-K-1.xml");
  });
});
