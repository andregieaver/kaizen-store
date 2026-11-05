import { describe, expect, it } from "vitest";

import type { BookingDoc } from "./accounting-docs";
import { sameSale, saleBody, shopContactBody, totalsOf, workContactBody } from "./fiken-map";
import { defaultFikenSettings, readFikenSettings } from "./fiken-settings";
import { checkFikenSettings, planFikenSetup } from "./fiken-setup";

const BOOKINGS = defaultFikenSettings(["standard_25", "standard_15", "gift_card"], { work: true, shop: true }).bookings;

const INVOICE: BookingDoc = {
  source: "shop",
  kind: "invoice",
  id: "inv-1",
  documentNumber: "1042",
  invoiceNumber: "1042",
  issuedOn: "2026-11-05",
  dueOn: "2026-11-05",
  currency: "NOK",
  totalMinor: 47_000,
  vatMinor: 8_500,
  lines: [
    { key: "standard_15", text: "Kaffe 1 kg", grossMinor: 34_500, netMinor: 30_000, vatMinor: 4_500 },
    { key: "standard_25", text: "Frakt", grossMinor: 12_500, netMinor: 10_000, vatMinor: 2_500 },
  ],
  customer: { kind: "shop_customers" },
  counterparty: null,
};

const ctx = { customerId: 77, bookings: BOOKINGS, language: "nb" as const };

describe("a document as a sale in Fiken (D460)", () => {
  it("is an external invoice under its own number, with each line's net and VAT as the document charged them", () => {
    const sale = saleBody(INVOICE, ctx);
    expect(sale).toEqual({
      ok: true,
      body: {
        saleNumber: "1042",
        date: "2026-11-05",
        kind: "external_invoice",
        currency: "NOK",
        customerId: 77,
        dueDate: "2026-11-05",
        lines: [
          { description: "Kaffe 1 kg", netPrice: 30_000, vat: 4_500, account: "3000", vatType: "MEDIUM" },
          { description: "Frakt", netPrice: 10_000, vat: 2_500, account: "3000", vatType: "HIGH" },
        ],
      },
    });
    expect(sale.ok && totalsOf(sale.body)).toEqual({ net: 40_000, vat: 7_000 });
  });

  it("turns a credit note's lines negative, says what it credits, and never dates a sale due before it was issued", () => {
    const credit: BookingDoc = { ...INVOICE, kind: "credit_note", documentNumber: "K-7", invoiceNumber: "1042", dueOn: "2026-11-01", totalMinor: 12_500, lines: [INVOICE.lines[1]] };
    const sale = saleBody(credit, { ...ctx, language: "en" });
    expect(sale.ok && sale.body).toMatchObject({ saleNumber: "K-7", dueDate: "2026-11-05", lines: [{ description: "Credit note K-7 for invoice 1042: Frakt", netPrice: -10_000, vat: -2_500 }] });
  });

  it("waits, sending nothing, on another currency, a VAT nobody placed, or lines that do not add up", () => {
    expect(saleBody({ ...INVOICE, currency: "EUR" }, ctx)).toEqual({ ok: false, code: "currency_unsupported", detail: "EUR" });
    expect(saleBody({ ...INVOICE, lines: [{ ...INVOICE.lines[0], key: "exempt" }, INVOICE.lines[1]] }, ctx)).toEqual({ ok: false, code: "vat_unmapped", detail: "exempt" });
    expect(saleBody({ ...INVOICE, lines: [{ ...INVOICE.lines[0], key: null }, INVOICE.lines[1]] }, ctx)).toMatchObject({ ok: false, code: "vat_unmapped" });
    expect(saleBody({ ...INVOICE, lines: [{ ...INVOICE.lines[0], vatMinor: 4_400 }, INVOICE.lines[1]] }, ctx)).toMatchObject({ ok: false, code: "totals_mismatch" });
    expect(saleBody({ ...INVOICE, lines: [{ ...INVOICE.lines[0], netMinor: undefined }, INVOICE.lines[1]] }, ctx)).toMatchObject({ ok: false, code: "totals_mismatch" });
    expect(saleBody({ ...INVOICE, totalMinor: 1 }, ctx)).toMatchObject({ ok: false, code: "totals_mismatch" });
    expect(saleBody({ ...INVOICE, lines: [] }, ctx)).toMatchObject({ ok: false, code: "nothing_to_book" });
  });

  it("adopts a sale under the number only when it is this one, and never a deleted one", () => {
    const body = (saleBody(INVOICE, ctx) as { ok: true; body: Parameters<typeof sameSale>[1] }).body;
    expect(sameSale({ saleId: 1, date: "2026-11-05", netAmount: 40_000, vatAmount: 7_000 }, body)).toBe(true);
    expect(sameSale({ saleId: 1, date: "2026-11-05", netAmount: 40_000, vatAmount: 7_000, deleted: true }, body)).toBe(false);
    expect(sameSale({ saleId: 1, date: "2026-11-04", netAmount: 40_000, vatAmount: 7_000 }, body)).toBe(false);
    expect(sameSale({ saleId: 1, date: "2026-11-05", netAmount: 39_999, vatAmount: 7_000 }, body)).toBe(false);
  });
});

describe("a customer as a contact in Fiken (D460)", () => {
  const client = {
    name: "Acme",
    legalName: "Acme AS",
    organisationNumber: "987 654 321 MVA",
    vatNumber: null,
    business: true,
    country: "NO",
    billingAddress: { line1: "Kirkeveien 1", postalCode: "0364", city: "Oslo" },
    billingEmail: "faktura@acme.example",
    locale: "nb-NO",
    paymentDays: 14,
  };

  it("gives a business its organisation number and address, and an email only when switched on", () => {
    expect(workContactBody(client, { sendContactEmail: false })).toEqual({
      name: "Acme AS",
      customer: true,
      organizationNumber: "987654321",
      language: "NORWEGIAN",
      daysUntilInvoicingDueDate: 14,
      address: { streetAddress: "Kirkeveien 1", postCode: "0364", city: "Oslo", country: "Norway" },
    });
    expect(workContactBody(client, { sendContactEmail: true }).email).toBe("faktura@acme.example");
  });

  it("gives a consumer a name only, and every shopper one contact per store", () => {
    expect(workContactBody({ ...client, business: false, legalName: null, name: "Kari", locale: "en-GB", paymentDays: null }, { sendContactEmail: false })).toEqual({ name: "Kari", customer: true, language: "ENGLISH" });
    expect(shopContactBody({ kind: "shop_customers" }, "nb")).toEqual({ name: "Nettbutikkunder (Kaizena Flow)", customer: true, language: "NORWEGIAN" });
    expect(shopContactBody({ kind: "shop_business", orgNumber: "912345678", name: "Bedrift AS" }, "en")).toMatchObject({ organizationNumber: "912345678", language: "NORWEGIAN" });
  });
});

describe("setting Fiken up from the company's own accounts (D460)", () => {
  const accounts = [
    { code: "1500", name: "Kundefordringer" },
    { code: "1500:10001", name: "Acme AS" },
    { code: "2900", name: "Annen kortsiktig gjeld" },
    { code: "3000", name: "Salgsinntekt, avgiftspliktig" },
    { code: "3600", name: "Leieinntekt" },
  ];

  it("takes the standard account where the company has it, the nearest in range where not, and asks the rest", () => {
    const plan = planFikenSetup(accounts, ["standard_25", "exempt", "gift_card"]);
    expect(plan.bookings).toEqual({ standard_25: { account: "3000", vatType: "HIGH" }, exempt: { account: "3000", vatType: "EXEMPT" }, gift_card: { account: "2900", vatType: "NONE" } });
    expect(plan.picks.map((p) => [p.key, p.how])).toEqual([
      ["standard_25", "standard"],
      ["exempt", "nearest"],
      ["gift_card", "standard"],
    ]);
    const bare = planFikenSetup([{ code: "3000", name: "Salg" }], ["gift_card"]);
    expect(bare.questions).toEqual([{ key: "gift_card", problem: "no_account", options: [] }]);
  });

  it("holds kept settings to the company's chart and the store's own buckets", () => {
    const settings = { bookings: { standard_25: { account: "3999", vatType: "HIGH" as const }, gift_card: { account: "3000", vatType: "NONE" as const } } };
    expect(checkFikenSettings(settings, accounts, ["standard_25", "standard_15"])).toEqual([
      { key: "standard_25", problem: "account_missing", account: "3999" },
      { key: "standard_15", problem: "missing", account: null },
      { key: "gift_card", problem: "wrong_range", account: "3000" },
    ]);
  });

  it("reads back only settings that fit the schema", () => {
    expect(readFikenSettings(defaultFikenSettings(["standard_25"], { work: true, shop: false }))).toMatchObject({ version: 1, sources: { work: true, shop: false } });
    expect(readFikenSettings({ version: 1, bookings: { standard_25: { account: "30000", vatType: "HIGH" } } })).toBeNull();
    expect(readFikenSettings({ ...defaultFikenSettings([], { work: true, shop: true }), bookings: { standard_25: { account: "3000", vatType: "HIGH_DIRECT" } } })).toBeNull();
  });
});
