import { describe, expect, it } from "vitest";

import {
  isEuCountry,
  looksLikeVatNumber,
  normaliseVatNumber,
  priceInvoice,
  resolveLineVat,
  suggestTreatment,
  vatNoteKeys,
  vatNotesFor,
  workInvoiceReadiness,
  type BuyerDetails,
  type PricedLineInput,
  type ReadinessInput,
  type SellerDetails,
  type VatContext,
} from "./work-vat";

const registered: VatContext = {
  sellerVatRegistered: true,
  clientTreatment: "domestic",
  clientBusiness: true,
  standardRateBp: 2500,
};
const hours = (o: Partial<PricedLineInput> = {}): PricedLineInput => ({
  quantityHundredths: 175,
  unitPriceMinor: 120_000,
  discountBp: 0,
  category: "standard",
  ...o,
});

describe("which rate a line gets", () => {
  it("charges the store's rate for a domestic client", () => {
    expect(resolveLineVat(registered, "standard")).toEqual({ category: "standard", vatBp: 2500 });
  });

  it("charges nothing when the store is not VAT registered", () => {
    const ctx = { ...registered, sellerVatRegistered: false };
    expect(resolveLineVat(ctx, "standard")).toEqual({ category: "standard", vatBp: 0 });
    expect(resolveLineVat({ ...ctx, clientTreatment: "reverse_charge" }, "standard")).toEqual({
      category: "standard",
      vatBp: 0,
    });
  });

  it("follows the client's treatment for standard lines: 0 % under its own category", () => {
    for (const treatment of ["reverse_charge", "outside_scope", "exempt"] as const) {
      expect(resolveLineVat({ ...registered, clientTreatment: treatment }, "standard")).toEqual({
        category: treatment,
        vatBp: 0,
      });
    }
  });

  it("keeps a line the owner set to a special category, at 0 %", () => {
    expect(resolveLineVat(registered, "exempt")).toEqual({ category: "exempt", vatBp: 0 });
    expect(resolveLineVat({ ...registered, clientTreatment: "reverse_charge" }, "exempt")).toEqual({
      category: "exempt",
      vatBp: 0,
    });
  });

  it("always charges domestic VAT to a private customer", () => {
    for (const treatment of ["reverse_charge", "outside_scope", "exempt"] as const) {
      expect(resolveLineVat({ ...registered, clientBusiness: false, clientTreatment: treatment }, "standard")).toEqual({
        category: "standard",
        vatBp: 2500,
      });
    }
  });
});

describe("what a treatment does to the totals", () => {
  const lines = [hours(), hours({ quantityHundredths: 100, unitPriceMinor: 50_000 })];

  it("domestic: 25 % on everything", () => {
    const p = priceInvoice(registered, lines);
    expect(p.totals).toMatchObject({ subtotalMinor: 260_000, vatMinor: 65_000, totalMinor: 325_000 });
    expect(p.totals.vatGroups).toEqual([
      { category: "standard", vatBp: 2500, netMinor: 260_000, vatMinor: 65_000, grossMinor: 325_000 },
    ]);
    expect(p.noteKeys).toEqual([]);
    expect(p.lines[0]).toMatchObject({ exclMinor: 210_000, vatMinor: 52_500, inclMinor: 262_500, vatBp: 2500 });
  });

  it("not VAT registered: no VAT, the one note", () => {
    const p = priceInvoice({ ...registered, sellerVatRegistered: false }, lines);
    expect(p.totals).toMatchObject({ subtotalMinor: 260_000, vatMinor: 0, totalMinor: 260_000 });
    expect(p.noteKeys).toEqual(["not_registered"]);
  });

  it("reverse charge: no VAT, the note, and a group of its own", () => {
    const p = priceInvoice({ ...registered, clientTreatment: "reverse_charge" }, lines);
    expect(p.totals).toMatchObject({ vatMinor: 0, totalMinor: 260_000 });
    expect(p.totals.vatGroups).toEqual([
      { category: "reverse_charge", vatBp: 0, netMinor: 260_000, vatMinor: 0, grossMinor: 260_000 },
    ]);
    expect(p.noteKeys).toEqual(["reverse_charge"]);
  });

  it("outside the scope and exempt: no VAT, their notes", () => {
    expect(priceInvoice({ ...registered, clientTreatment: "outside_scope" }, lines).noteKeys).toEqual([
      "outside_scope",
    ]);
    const exempt = priceInvoice({ ...registered, clientTreatment: "exempt" }, lines);
    expect(exempt.noteKeys).toEqual(["exempt"]);
    expect(exempt.totals.vatMinor).toBe(0);
  });

  it("mixes a taxed line and an exempt line on one invoice", () => {
    const p = priceInvoice(registered, [
      hours(),
      hours({ category: "exempt", quantityHundredths: 100, unitPriceMinor: 30_000 }),
    ]);
    expect(p.totals).toMatchObject({ subtotalMinor: 240_000, vatMinor: 52_500, totalMinor: 292_500 });
    expect(p.totals.vatGroups.map((g) => [g.category, g.vatBp])).toEqual([
      ["standard", 2500],
      ["exempt", 0],
    ]);
    expect(p.noteKeys).toEqual(["exempt"]);
  });

  it("a private customer of a store with a reverse-charge setting is still charged", () => {
    const p = priceInvoice({ ...registered, clientBusiness: false, clientTreatment: "reverse_charge" }, lines);
    expect(p.totals.vatMinor).toBe(65_000);
    expect(p.noteKeys).toEqual([]);
  });

  it("handles large amounts without losing a minor unit", () => {
    const p = priceInvoice(registered, [
      hours({ quantityHundredths: 9_999_999, unitPriceMinor: 999_999_999, discountBp: 1_234 }),
    ]);
    const exact = (BigInt(9_999_999) * BigInt(999_999_999) * BigInt(8_766) + BigInt(500_000)) / BigInt(1_000_000);
    expect(p.totals.subtotalMinor).toBe(Number(exact));
    expect(p.totals.totalMinor).toBe(p.totals.subtotalMinor + p.totals.vatMinor);
  });
});

describe("which notes a document carries", () => {
  it("a seller that is not registered has one note whatever the lines say", () => {
    expect(vatNoteKeys(false, [{ vatCategory: "standard" }, { vatCategory: "reverse_charge" }])).toEqual([
      "not_registered",
    ]);
  });

  it("a registered seller's notes follow the categories in use, in a fixed order, once each", () => {
    expect(
      vatNoteKeys(true, [
        { vatCategory: "exempt" },
        { vatCategory: "reverse_charge" },
        { vatCategory: "exempt" },
        { vatCategory: "standard" },
      ]),
    ).toEqual(["reverse_charge", "exempt"]);
    expect(vatNoteKeys(true, [{ vatCategory: "standard" }])).toEqual([]);
    expect(vatNoteKeys(true, [])).toEqual([]);
  });

  it("writes them in the client's language, citing the VAT Directive only for a seller in the EU", () => {
    const nbNo = vatNotesFor(["reverse_charge"], "nb-NO", "NO");
    expect(nbNo).toEqual([
      { key: "reverse_charge", text: "Omvendt avgiftsplikt: kjøper beregner og betaler merverdiavgiften." },
    ]);
    const nbSe = vatNotesFor(["reverse_charge"], "nb-NO", "SE");
    expect(nbSe[0].text).toContain("Artikkel 196");
    expect(vatNotesFor(["reverse_charge"], "sv-SE", "SE")[0].text).toContain("Omvänd betalningsskyldighet");
    expect(vatNotesFor(["reverse_charge"], "da-DK", "DK")[0].text).toContain("Omvendt betalingspligt");
    expect(vatNotesFor(["reverse_charge"], "en", "SE")[0].text).toContain("Directive 2006/112/EC");
    expect(vatNotesFor(["outside_scope"], "nb", "NO")[0].text).toContain("Utenfor merverdiavgiftsområdet");
    expect(vatNotesFor(["exempt"], "nb", "SE")[0].text).toBe("Fritatt for merverdiavgift.");
  });

  it("falls back to English for other languages", () => {
    expect(vatNotesFor(["not_registered"], "de-DE", "DE")[0].text).toBe(
      "VAT is not charged: the seller is not registered for VAT.",
    );
    expect(vatNotesFor(["exempt"], null, null)[0].text).toBe("Exempt from VAT.");
  });
});

describe("the treatment to suggest for a new client", () => {
  const suggest = (sellerCountry: string, clientCountry: string | null, business: boolean, vat: string | null = null) =>
    suggestTreatment({ sellerCountry, clientCountry, business, clientVatNumber: vat });

  it("is domestic for consumers and clients in the same country", () => {
    expect(suggest("NO", "SE", false)).toBe("domestic");
    expect(suggest("NO", "NO", true, "NO123456789MVA")).toBe("domestic");
    expect(suggest("SE", null, true)).toBe("domestic");
  });

  it("is reverse charge for an EU business with a VAT number, and domestic without one", () => {
    expect(suggest("SE", "DK", true, "DK12345678")).toBe("reverse_charge");
    expect(suggest("SE", "DK", true, "")).toBe("domestic");
    expect(suggest("SE", "DK", true)).toBe("domestic");
  });

  it("is outside the scope when either side is outside the EU", () => {
    expect(suggest("NO", "SE", true, "SE123456789001")).toBe("outside_scope");
    expect(suggest("SE", "NO", true, "NO123456789MVA")).toBe("outside_scope");
    expect(suggest("SE", "US", true)).toBe("outside_scope");
  });

  it("knows the EU", () => {
    expect(isEuCountry("se")).toBe(true);
    expect(isEuCountry("GR")).toBe(true);
    expect(isEuCountry("NO")).toBe(false);
    expect(isEuCountry("GB")).toBe(false);
    expect(isEuCountry(null)).toBe(false);
  });
});

describe("VAT numbers", () => {
  it("normalises", () => {
    expect(normaliseVatNumber("no 123.456.789 mva")).toBe("NO123456789MVA");
    expect(normaliseVatNumber("SE-556016-0680-01")).toBe("SE556016068001");
  });

  it("recognises the launch countries' numbers and rejects typos", () => {
    expect(looksLikeVatNumber("NO", "NO 123 456 789 MVA")).toBe(true);
    expect(looksLikeVatNumber("NO", "123456789")).toBe(true);
    expect(looksLikeVatNumber("NO", "12345678")).toBe(false);
    expect(looksLikeVatNumber("SE", "SE556016068001")).toBe(true);
    expect(looksLikeVatNumber("SE", "SE5560160680")).toBe(false);
    expect(looksLikeVatNumber("DK", "DK12345678")).toBe(true);
    expect(looksLikeVatNumber("DK", "1234567")).toBe(false);
    expect(looksLikeVatNumber("DE", "DE123456789")).toBe(true);
    expect(looksLikeVatNumber("DE", "123456789")).toBe(false);
    expect(looksLikeVatNumber("US", "12-3456789")).toBe(true);
    expect(looksLikeVatNumber("US", "1")).toBe(false);
  });
});

describe("what a store must have before it issues", () => {
  const seller: SellerDetails = {
    legalName: "Kaizen Consulting AS",
    organisationNumber: "123456789",
    postalAddress: "Storgata 1, 0155 Oslo",
    country: "NO",
    vatRegistered: true,
    vatNumber: "NO123456789MVA",
    bankAccount: "1234.56.78903",
  };
  const buyer: BuyerDetails = {
    name: "Acme AS",
    address: "Kirkeveien 2, 0368 Oslo",
    country: "NO",
    business: true,
    vatNumber: null,
    vatTreatment: "domestic",
  };
  const line = { description: "Consulting", exclMinor: 210_000, vatCategory: "standard" as const, vatBp: 2500 };
  const input = (o: Partial<ReadinessInput> = {}): ReadinessInput => ({
    seller,
    buyer,
    currency: "NOK",
    sellerHomeCurrency: "NOK",
    fxRate: null,
    lines: [line],
    ...o,
  });
  const codes = (r: ReturnType<typeof workInvoiceReadiness>) => r.problems.map((p) => p.code).sort();

  it("passes a complete store with a domestic client", () => {
    expect(workInvoiceReadiness(input())).toEqual({ ready: true, problems: [] });
  });

  it("lists everything missing at once, with where to fix it", () => {
    const r = workInvoiceReadiness(
      input({
        seller: {
          ...seller,
          legalName: " ",
          organisationNumber: null,
          postalAddress: "",
          country: "",
          vatNumber: "",
          bankAccount: null,
        },
        buyer: { ...buyer, name: "", address: null, country: null },
        lines: [],
      }),
    );
    expect(r.ready).toBe(false);
    expect(codes(r)).toEqual(
      [
        "seller_legal_name",
        "seller_organisation_number",
        "seller_address",
        "seller_country",
        "seller_vat_number",
        "seller_bank_account",
        "buyer_name",
        "buyer_address",
        "buyer_country",
        "no_lines",
      ].sort(),
    );
    expect(r.problems.find((p) => p.code === "seller_bank_account")?.where).toBe("settings");
    expect(r.problems.find((p) => p.code === "buyer_address")?.where).toBe("client");
    expect(r.problems.find((p) => p.code === "seller_legal_name")?.where).toBe("company");
    expect(r.problems.every((p) => p.severity === "error")).toBe(true);
  });

  it("does not ask a store that is not VAT registered for a VAT number, but it may not charge VAT", () => {
    const notRegistered = { ...seller, vatRegistered: false, vatNumber: null };
    expect(workInvoiceReadiness(input({ seller: notRegistered, lines: [{ ...line, vatBp: 0 }] })).ready).toBe(true);
    expect(codes(workInvoiceReadiness(input({ seller: notRegistered })))).toEqual(["vat_when_not_registered"]);
  });

  it("checks the bank account: an IBAN's check digits", () => {
    expect(workInvoiceReadiness(input({ seller: { ...seller, bankAccount: "NO93 8601 1117 947" } })).ready).toBe(true);
    expect(codes(workInvoiceReadiness(input({ seller: { ...seller, bankAccount: "NO94 8601 1117 947" } })))).toEqual([
      "seller_bank_account_invalid",
    ]);
  });

  it("warns, without blocking, about a VAT number that does not look right", () => {
    const r = workInvoiceReadiness(input({ seller: { ...seller, vatNumber: "12" } }));
    expect(r.ready).toBe(true);
    expect(codes(r)).toEqual(["seller_vat_number_format"]);
    expect(r.problems[0].severity).toBe("warning");
  });

  it("reverse charge needs a business client abroad with a VAT number", () => {
    const se: SellerDetails = { ...seller, country: "SE", vatNumber: "SE556016068001" };
    const dk: BuyerDetails = { ...buyer, country: "DK", vatNumber: "DK12345678", vatTreatment: "reverse_charge" };
    const rc = { ...line, vatCategory: "reverse_charge" as const, vatBp: 0 };
    expect(workInvoiceReadiness(input({ seller: se, buyer: dk, lines: [rc] })).ready).toBe(true);
    expect(codes(workInvoiceReadiness(input({ seller: se, buyer: { ...dk, vatNumber: "" }, lines: [rc] })))).toEqual([
      "buyer_vat_number",
    ]);
    expect(codes(workInvoiceReadiness(input({ seller: se, buyer: { ...dk, business: false }, lines: [rc] })))).toEqual([
      "reverse_charge_consumer",
    ]);
    expect(
      codes(
        workInvoiceReadiness(
          input({ seller: se, buyer: { ...dk, country: "SE", vatNumber: "SE556016068001" }, lines: [rc] }),
        ),
      ),
    ).toEqual(["reverse_charge_domestic"]);
    const outside = workInvoiceReadiness(
      input({ seller: se, buyer: { ...dk, country: "US", vatNumber: "123456789" }, lines: [rc] }),
    );
    expect(outside.ready).toBe(true);
    expect(codes(outside)).toEqual(["reverse_charge_outside_eu"]);
    const norway = workInvoiceReadiness(
      input({ buyer: { ...dk, country: "SE", vatNumber: "SE556016068001" }, lines: [rc] }),
    );
    expect(codes(norway)).toEqual(["reverse_charge_seller_not_eu"]);
    expect(norway.ready).toBe(true);
  });

  it("warns about lines that look unfinished and refuses VAT on a zero-rate category", () => {
    expect(codes(workInvoiceReadiness(input({ lines: [{ ...line, description: "Line item" }] })))).toEqual([
      "unnamed_line",
    ]);
    expect(codes(workInvoiceReadiness(input({ lines: [{ ...line, exclMinor: 0 }] })))).toEqual(["line_without_amount"]);
    expect(codes(workInvoiceReadiness(input({ lines: [{ ...line, vatCategory: "exempt" }] })))).toEqual([
      "vat_on_special_category",
    ]);
    expect(codes(workInvoiceReadiness(input({ lines: [{ ...line, vatBp: 0 }] })))).toEqual(["standard_rate_zero"]);
  });

  it("wants the VAT in the home currency for a foreign-currency invoice", () => {
    expect(codes(workInvoiceReadiness(input({ currency: "EUR" })))).toEqual(["vat_home_amount"]);
    expect(workInvoiceReadiness(input({ currency: "EUR", fxRate: "11.6543" })).ready).toBe(true);
    expect(codes(workInvoiceReadiness(input({ currency: "EUR", fxRate: "abc" })))).toEqual(["vat_home_amount"]);
    // no VAT charged, nothing to state
    expect(
      workInvoiceReadiness(input({ currency: "EUR", lines: [{ ...line, vatBp: 0, vatCategory: "outside_scope" }] }))
        .ready,
    ).toBe(true);
    // unknown home currency: the check is skipped
    expect(workInvoiceReadiness(input({ currency: "EUR", sellerHomeCurrency: null })).ready).toBe(true);
  });
});
