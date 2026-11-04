import { describe, expect, it } from "vitest";

import type { CreditNoteSnapshot } from "./credit-allocation";
import type { OrderInvoiceSnapshot, SnapshotLine } from "./invoice-snapshot";
import { minorOf } from "./tripletex";
import {
  customerKey,
  shopCreditNoteDoc,
  shopCustomerBody,
  shopInvoiceDoc,
  stableJson,
  voucherBody,
  workCreditNoteDoc,
  workCustomerBody,
  workInvoiceDoc,
  type BookingDoc,
  type VoucherIds,
} from "./tripletex-map";
import { computeLine } from "./work-calc";

const STORE = "1a2b3c4d-0000-4000-8000-000000000001";

const IDS: VoucherIds = {
  receivableAccountId: 15000,
  customerId: 777,
  voucherTypeId: null,
  bookings: {
    standard_25: { accountId: 30000, vatTypeId: 103 },
    standard_15: { accountId: 30000, vatTypeId: 131 },
    exempt: { accountId: 31000, vatTypeId: 105 },
    reverse_charge: { accountId: 32000, vatTypeId: 106 },
    gift_card: { accountId: 29000, vatTypeId: 100 },
  },
};

const WORK_INVOICE = workInvoiceDoc({
  id: "inv-1",
  documentNumber: "W-1042",
  issuedOn: "2026-09-29",
  currency: "NOK",
  totalMinor: 1_550_000,
  clientId: "client-1",
  buyerName: "Acme AS",
  lines: [
    { description: "Consulting 10 h", vatCategory: "standard", vatRate: "0.2500", inclMinor: 1_500_000 },
    { description: "Course fee", vatCategory: "exempt", vatRate: "0", inclMinor: 50_000 },
  ],
});

const sumOf = (body: { postings: { amountGross: number }[] }) => body.postings.reduce((s, p) => s + minorOf(p.amountGross)!, 0);

describe("a Work invoice as a voucher (D453)", () => {
  it("debits the customer's receivable and credits income per line, with the line's VAT code", () => {
    const result = voucherBody(WORK_INVOICE, IDS, { storeId: STORE, language: "nb" });
    expect(result).toEqual({
      ok: true,
      body: {
        date: "2026-09-29",
        description: "Faktura W-1042 · Acme AS",
        externalVoucherNumber: "kf/1a2b3c4d/W-1042",
        postings: [
          { row: 1, date: "2026-09-29", description: "Faktura W-1042 · Acme AS", account: { id: 15000 }, customer: { id: 777 }, amountGross: 15500, amountGrossCurrency: 15500, invoiceNumber: "W-1042" },
          { row: 2, date: "2026-09-29", description: "W-1042 Consulting 10 h", account: { id: 30000 }, vatType: { id: 103 }, amountGross: -15000, amountGrossCurrency: -15000 },
          { row: 3, date: "2026-09-29", description: "W-1042 Course fee", account: { id: 31000 }, vatType: { id: 105 }, amountGross: -500, amountGrossCurrency: -500 },
        ],
      },
    });
    if (result.ok) expect(sumOf(result.body)).toBe(0);
  });

  it("writes in English when asked, and uses the company's voucher type when one is chosen", () => {
    const result = voucherBody(WORK_INVOICE, { ...IDS, voucherTypeId: 9 }, { storeId: STORE, language: "en", posting: 2 });
    expect(result.ok && result.body.description).toBe("Invoice W-1042 · Acme AS");
    expect(result.ok && result.body.voucherType).toEqual({ id: 9 });
    expect(result.ok && result.body.externalVoucherNumber).toBe("kf/1a2b3c4d/W-1042#2");
  });

  it("books a credit note with the signs turned, matched to its invoice's number", () => {
    const credit = workCreditNoteDoc({
      id: "cn-1",
      documentNumber: "WCN-3",
      invoiceNumber: "W-1042",
      issuedOn: "2026-10-02",
      currency: "NOK",
      totalMinor: 150_000,
      clientId: "client-1",
      buyerName: "Acme AS",
      lines: [{ description: "Consulting 1 h", vat_category: "standard", vat_rate: "0.2500", excl_minor: 120_000, vat_minor: 30_000, incl_minor: 150_000 }],
    });
    const result = voucherBody(credit, IDS, { storeId: STORE, language: "nb" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.description).toBe("Kreditnota WCN-3 for W-1042 · Acme AS");
    expect(result.body.externalVoucherNumber).toBe("kf/1a2b3c4d/WCN-3");
    expect(result.body.postings.map((p) => [p.amountGross, p.invoiceNumber ?? null])).toEqual([
      [-1500, "W-1042"],
      [1500, null],
    ]);
    expect(sumOf(result.body)).toBe(0);
  });

  it("waits, sending nothing, for another currency, a VAT kind with no place, or lines that do not add up", () => {
    expect(voucherBody({ ...WORK_INVOICE, currency: "EUR" }, IDS, { storeId: STORE, language: "nb" })).toEqual({ ok: false, code: "currency_unsupported", detail: "EUR" });
    const noExempt = { ...IDS, bookings: { standard_25: IDS.bookings.standard_25 } };
    expect(voucherBody(WORK_INVOICE, noExempt, { storeId: STORE, language: "nb" })).toEqual({ ok: false, code: "vat_unmapped", detail: "exempt" });
    expect(voucherBody({ ...WORK_INVOICE, totalMinor: 1_550_001 }, IDS, { storeId: STORE, language: "nb" })).toEqual({ ok: false, code: "totals_mismatch" });
    const oddRate: BookingDoc = { ...WORK_INVOICE, lines: [{ key: null, text: "x", grossMinor: 1_550_000 }] };
    expect(voucherBody(oddRate, IDS, { storeId: STORE, language: "nb" })).toMatchObject({ ok: false, code: "vat_unmapped" });
    expect(voucherBody({ ...WORK_INVOICE, totalMinor: 0, lines: [] }, IDS, { storeId: STORE, language: "nb" })).toEqual({ ok: false, code: "nothing_to_book" });
  });

  it("leaves out lines that come to nothing", () => {
    const doc: BookingDoc = { ...WORK_INVOICE, lines: [...WORK_INVOICE.lines, { key: "standard_25", text: "Free call", grossMinor: 0 }] };
    const result = voucherBody(doc, IDS, { storeId: STORE, language: "nb" });
    expect(result.ok && result.body.postings).toHaveLength(3);
  });
});

/**
 * Tripletex works the VAT out of each posting's gross amount. Work worked it out of the line's net (`computeLine()`: half up,
 * per line). One posting per line lands on the same VAT when, for every net, rounding gross × rate / (1 + rate) half up gives
 * Work's VAT back: checked here for every net up to 20 000.00 at Norway's three rates. (Tripletex's own rounding is checked in
 * its sandbox; a difference is recorded on the voucher's row, never a failure.)
 */
describe("VAT per line survives Tripletex working it out of the gross", () => {
  it("for every net amount from 0.00 to 20 000.00 at 25, 15 and 12 %", () => {
    for (const bp of [2500, 1500, 1200]) {
      let mismatches = 0;
      for (let excl = 0; excl <= 2_000_000; excl += 1) {
        const line = computeLine({ quantityHundredths: 100, unitPriceMinor: excl, discountBp: 0, vatBp: bp, vatCategory: "standard" });
        const incl = BigInt(line.inclMinor);
        const fromGross = (incl * BigInt(bp) * BigInt(2) + BigInt(10_000 + bp)) / (BigInt(10_000 + bp) * BigInt(2));
        if (Number(fromGross) !== line.vatMinor) mismatches += 1;
      }
      expect(mismatches, `${bp / 100} %`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------

const line = (over: Partial<SnapshotLine>): SnapshotLine => ({
  lineId: "l1",
  sku: "SKU",
  title: "Kaffe",
  kind: "goods",
  quantity: 1,
  listNetMinor: 0,
  discountNetMinor: 0,
  netMinor: 0,
  vatRate: 0.25,
  basis: "standard",
  vatMinor: 0,
  grossMinor: 0,
  unitNetMinor: 0,
  serviceDate: null,
  service: null,
  wouldHaveRate: null,
  ...over,
});

const shopInvoice = (over: Partial<OrderInvoiceSnapshot> = {}): OrderInvoiceSnapshot =>
  ({
    version: 1,
    documentType: "invoice",
    number: "2026-1042",
    issuedOn: "2026-10-01",
    currency: "NOK",
    buyer: { type: "consumer", name: "Ola Nordmann", company: null, organisationNumber: null, vatNumber: null, address: {}, email: "ola@example.com", complete: true },
    lines: [line({ title: "Kaffe 1 kg", vatRate: 0.15, grossMinor: 34_500 }), line({ lineId: "l2", title: "Kopp", grossMinor: 12_500 })],
    shipping: { label: "Posten", netBeforeMinor: 0, discountNetMinor: 0, netMinor: 0, vatRate: 0.25, basis: "standard", vatMinor: 0, grossMinor: 9_900, wouldHaveRate: null },
    totals: { netMinor: 0, vatMinor: 0, grossMinor: 56_900 },
    ...over,
  }) as unknown as OrderInvoiceSnapshot;

describe("a shop invoice as a voucher", () => {
  it("books each line and the shipping on its rate's account, on the shop's own customer: never a shopper's name", () => {
    const doc = shopInvoiceDoc("si-1", shopInvoice());
    expect(doc.customer).toEqual({ kind: "shop_customers" });
    expect(customerKey(doc.customer)).toBe("shop");
    const result = voucherBody(doc, IDS, { storeId: STORE, language: "nb" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.description).toBe("Faktura 2026-1042 · Nettbutikk");
    expect(JSON.stringify(result.body)).not.toContain("Ola");
    expect(result.body.postings.map((p) => [p.vatType?.id ?? null, p.amountGross])).toEqual([
      [null, 569],
      [131, -345],
      [103, -125],
      [103, -99],
    ]);
  });

  it("books a Norwegian business on its own customer card, by organisation number", () => {
    const doc = shopInvoiceDoc("si-2", shopInvoice({ buyer: { type: "business", name: "Kari", company: "Kafé Nord AS", organisationNumber: "NO 912 345 678 MVA", vatNumber: null, address: {} } as never }));
    expect(doc.customer).toEqual({ kind: "shop_business", orgNumber: "912345678", name: "Kafé Nord AS" });
    expect(customerKey(doc.customer)).toBe("org:912345678");
    expect(doc.counterparty).toBe("Kafé Nord AS");
  });

  it("puts a gift card sold on the gift card account, and leaves IOSS waiting for a person", () => {
    const withCard = shopInvoiceDoc("si-3", shopInvoice({ lines: [line({ title: "Gavekort", vatRate: 0, grossMinor: 47_000, voucher: true })] }));
    expect(withCard.lines[0].key).toBe("gift_card");
    const ioss = shopInvoiceDoc("si-4", shopInvoice({ lines: [line({ basis: "ioss", grossMinor: 47_000 })] }));
    expect(voucherBody(ioss, IDS, { storeId: STORE, language: "nb" })).toMatchObject({ ok: false, code: "vat_unmapped" });
  });

  it("books a shop credit note per VAT bucket against its invoice", () => {
    const snapshot = {
      number: "K-7",
      issuedOn: "2026-10-05",
      currency: "NOK",
      buyer: shopInvoice().buyer,
      refersTo: { invoiceId: "si-1", invoiceNumber: "2026-1042", invoiceIssuedOn: "2026-10-01" },
      buckets: [
        { rate: 0.15, basis: "standard", netMinor: 30_000, vatMinor: 4_500, grossMinor: 34_500 },
        { rate: 0, basis: "standard", netMinor: 10_000, vatMinor: 0, grossMinor: 10_000 },
      ],
      totals: { netMinor: 40_000, vatMinor: 4_500, grossMinor: 44_500 },
    } as unknown as CreditNoteSnapshot;
    const invoice = shopInvoice({ lines: [line({ vatRate: 0.15, grossMinor: 34_500 }), line({ lineId: "g", vatRate: 0, grossMinor: 10_000, voucher: true })] });
    const doc = shopCreditNoteDoc("cn-1", snapshot, invoice);
    expect(doc.lines.map((l) => l.key)).toEqual(["standard_15", "gift_card"]);
    const result = voucherBody(doc, IDS, { storeId: STORE, language: "nb" });
    expect(result.ok && result.body.description).toBe("Kreditnota K-7 for 2026-1042 · Nettbutikk");
    expect(result.ok && result.body.postings.map((p) => p.amountGross)).toEqual([-445, 345, 100]);
    // The same 0 % bucket is a sale without VAT when the invoice sold something else at 0 %.
    const mixed = shopInvoice({ lines: [line({ vatRate: 0, grossMinor: 5_000 }), line({ lineId: "g", vatRate: 0, grossMinor: 10_000, voucher: true })] });
    expect(shopCreditNoteDoc("cn-2", snapshot, mixed).lines[1].key).toBe("standard_0");
  });
});

describe("customer cards", () => {
  const CLIENT = {
    name: "Acme",
    legalName: "Acme AS",
    organisationNumber: "912 345 678",
    vatNumber: null,
    business: true,
    country: "NO",
    billingAddress: { line1: "Storgata 1", line2: "", postalCode: "0155", city: "Oslo" },
    billingEmail: "faktura@acme.example",
    locale: "nb-NO",
    paymentDays: 14,
  };

  it("send a business's legal name, number and address, and never email unless switched on", () => {
    expect(workCustomerBody(CLIENT, { sendContactEmail: false, countryId: 161 })).toEqual({
      name: "Acme AS",
      organizationNumber: "912345678",
      isPrivateIndividual: false,
      language: "NO",
      invoiceSendMethod: "MANUAL",
      invoicesDueIn: 14,
      invoicesDueInType: "DAYS",
      postalAddress: { addressLine1: "Storgata 1", postalCode: "0155", city: "Oslo", country: { id: 161 } },
    });
    expect(workCustomerBody(CLIENT, { sendContactEmail: true, countryId: 161 }).email).toBe("faktura@acme.example");
  });

  it("send a consumer's name and country only", () => {
    const person = { ...CLIENT, name: "Kari Nordmann", legalName: null, organisationNumber: null, business: false, locale: "en-GB", paymentDays: null };
    expect(workCustomerBody(person, { sendContactEmail: false, countryId: 161 })).toEqual({
      name: "Kari Nordmann",
      isPrivateIndividual: true,
      language: "EN",
      invoiceSendMethod: "MANUAL",
      postalAddress: { country: { id: 161 } },
    });
  });

  it("keep a foreign business's VAT number in the description (Tripletex has no field for it)", () => {
    const foreign = { ...CLIENT, organisationNumber: "556123-4567", vatNumber: "SE556123456701", country: "SE" };
    const body = workCustomerBody(foreign, { sendContactEmail: false, countryId: null });
    expect(body.organizationNumber).toBeUndefined();
    expect(body.description).toBe("VAT SE556123456701");
  });

  it("name the shop's customer card for what it is", () => {
    expect(shopCustomerBody({ kind: "shop_customers" }, "nb").name).toBe("Nettbutikkunder (Kaizena Flow)");
    expect(shopCustomerBody({ kind: "shop_business", orgNumber: "912345678", name: "Kafé Nord AS" }, "en")).toMatchObject({ organizationNumber: "912345678", isPrivateIndividual: false });
  });

  it("hash the same whatever the order of the keys", () => {
    expect(stableJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: undefined } })).toBe(stableJson({ a: { d: [1, { e: 3, f: 2 }] }, b: 1 }));
  });
});
