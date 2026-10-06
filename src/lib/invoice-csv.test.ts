import { describe, expect, it } from "vitest";

import { creditNoteSnapshot } from "./credit-allocation";
import { bucketColumn, creditNoteCsv, invoiceCsv } from "./invoice-csv";
import { buildInvoiceSnapshot, vatIncludedExact, type InvoiceFacts, type InvoiceLineFacts, type OrderInvoiceSnapshot } from "./invoice-snapshot";

const line = (id: string, unit: number, rate: number): InvoiceLineFacts => {
  const tax = vatIncludedExact(unit, rate);
  return { id, sku: id, title: id, quantity: 1, unitPriceMinor: unit, totalMinor: unit, taxMinor: tax, taxRate: rate, delivery: "physical", gift: false, planned: false, bookedCount: null, vatCategory: "standard", booking: null };
};

function invoice(name: string, lines: InvoiceLineFacts[], over: { currency?: string; company?: string | null } = {}): OrderInvoiceSnapshot {
  const f: InvoiceFacts = {
    order: {
      id: "o", number: "1001", marketCode: "NO", currency: over.currency ?? "NOK", locale: "nb-NO", email: "k@example.com", placedOn: "2026-10-04", paidOn: "2026-10-04", shippingMinor: 0, discountMinor: 0,
      taxMinor: lines.reduce((s, l) => s + l.taxMinor, 0), totalMinor: lines.reduce((s, l) => s + l.totalMinor, 0), memberDiscountMinor: 0, memberLabel: null, campaignDiscountMinor: 0, campaignLabel: null,
      creditMinor: 0, referralDiscountMinor: 0, staffDiscountMinor: 0, staffLabel: null, discountCode: null, vatKind: "standard", vatReliefMinor: 0, shippingTaxRate: 0.25, marketStandardRate: 0.25, companyName: over.company ?? null,
      organisationNumber: null, balanceMinor: 0, billingAddress: { name, line1: "Storgata 5", city: "Oslo", country: "NO" }, shippingAddress: {}, deliveryLabel: null, onlineProvider: "stripe",
    },
    lines,
    seller: { legalName: "Fixture AS", organisationNumber: "923456789", postalAddress: "Storgata 1", country: "NO", email: null, footerNote: null },
    profile: { vatRegistered: true, vatNumber: "NO923456789MVA" },
    treatment: { reason: "consumer", sellerVatNumber: "NO923456789MVA", buyerVatNumber: null, iossNumber: null },
    fx: { homeCurrency: "NOK", mainCurrency: "NOK", rates: { NOK: "11.7" }, ratesAuto: false, ratesAsOf: "2026-10-01" },
  };
  return buildInvoiceSnapshot(f, { number: "F-1", issuedOn: "2026-10-04", supplyDate: "2026-10-03" });
}

const parse = (csv: string) => csv.trimEnd().split("\r\n");

describe("the column of a rate", () => {
  it("is named by the rate and the basis", () => {
    expect(bucketColumn({ rate: 0.25, basis: "standard" })).toBe("vat_25");
    expect(bucketColumn({ rate: 0.125, basis: "standard" })).toBe("vat_12_5");
    expect(bucketColumn({ rate: 0, basis: "reverse_charge" })).toBe("vat_0_rc");
    expect(bucketColumn({ rate: 0, basis: "exempt" })).toBe("vat_0_exempt");
    expect(bucketColumn({ rate: 0.255, basis: "standard" })).toBe("vat_25_5");
  });
});

describe("the accountant's CSV of invoices", () => {
  const a = invoice("Kari", [line("a", 12500, 0.25), line("b", 4950, 0.15)]);
  const b = invoice("Ola", [line("c", 1000, 0.25)], { currency: "EUR" });

  it("has a fixed layout: the document's figures, VAT per rate for every rate present, the VAT in the seller's currency, the treatment", () => {
    const rows = parse(invoiceCsv([{ documentNumber: "F-1", orderNumber: "1001", snapshot: a }, { documentNumber: "F-2", orderNumber: "1002", snapshot: b }]));
    expect(rows[0]).toBe(
      "number,issue_date,supply_date,order_number,document_type,buyer_type,buyer_name,buyer_country,buyer_vat_number,currency,net,vat,gross,vat_25_net,vat_25_vat,vat_15_net,vat_15_vat,vat_home_currency,vat_home,vat_home_rate,vat_home_rate_date,treatment",
    );
    const d = (minor: number) => (minor / 100).toFixed(2);
    const [b25, b15] = a.buckets;
    expect(rows[1]).toBe(
      ["F-1", "2026-10-04", "2026-10-03", "1001", "invoice", "consumer", "Kari", "NO", "", "NOK", d(a.totals.netMinor), d(a.totals.vatMinor), d(a.totals.grossMinor),
        d(b25.netMinor), d(b25.vatMinor), d(b15.netMinor), d(b15.vatMinor), "", "", "", "", "standard"].join(","),
    );
    // The second document has no 15 % bucket: empty cells, and its VAT in kroner with the rate.
    const cells = rows[2].split(",");
    expect(cells.slice(15, 17)).toEqual(["", ""]);
    expect(cells.slice(17, 21)).toEqual(["NOK", `${(Math.round(b.totals.vatMinor * 11.7) / 100).toFixed(2)}`, "11.7", "2026-10-01"]);
  });

  it("writes amounts as decimals with a point, the same number of columns in every row", () => {
    const rows = parse(invoiceCsv([{ documentNumber: "F-1", orderNumber: "1001", snapshot: a }, { documentNumber: "F-2", orderNumber: "1002", snapshot: b }]));
    const widths = new Set(rows.map((r) => r.split(",").length));
    expect(widths.size).toBe(1);
    expect(rows[1]).toMatch(/,\d+\.\d{2},\d+\.\d{2},\d+\.\d{2},/);
  });

  it("neutralises a name a spreadsheet would read as a formula, and quotes what needs it", () => {
    for (const name of ["=1+1", "+x", "-x", "@x", "\tx"]) {
      const row = parse(invoiceCsv([{ documentNumber: "F-1", orderNumber: "1", snapshot: invoice(name, [line("a", 1000, 0.25)]) }]))[1];
      expect(row.split(",")[6], name).toBe(`'${name}`);
    }
    const quoted = parse(invoiceCsv([{ documentNumber: "F-1", orderNumber: "1", snapshot: invoice('A, "B"', [line("a", 1000, 0.25)]) }]))[1];
    expect(quoted).toContain('"A, ""B"""');
  });

  it("is a header alone for no documents", () => {
    expect(parse(invoiceCsv([]))).toHaveLength(1);
  });
});

describe("the accountant's CSV of credit notes", () => {
  it("names the invoice each credits and why, with the credit note's own amounts", () => {
    const inv = invoice("Kari", [line("a", 12500, 0.25)]);
    const note = creditNoteSnapshot({ invoice: { id: "i", snapshot: inv }, earlier: [], source: "refund", returnNumber: null, refundMinor: 5000, working: null, number: "K-1", issuedOn: "2026-10-09" }).snapshot!;
    const rows = parse(creditNoteCsv([{ documentNumber: "K-1", orderNumber: "1001", snapshot: note }]));
    expect(rows[0].endsWith("treatment,credits_invoice,credits_invoice_date,reason")).toBe(true);
    const cells = rows[1].split(",");
    expect(cells.slice(0, 5)).toEqual(["K-1", "2026-10-09", "", "1001", "credit_note"]);
    expect(cells.slice(-4)).toEqual(["standard", "F-1", "2026-10-04", "refund"]);
    expect(cells[12]).toBe("50.00");
  });
});
