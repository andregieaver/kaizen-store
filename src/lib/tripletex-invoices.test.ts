import { describe, expect, it } from "vitest";

import { invoicesFrom, nameKey, planTripletexInvoices, readTripletexInvoice, summarisePlan, type HereClient, type HereInvoice, type PlanInput, type TxInvoice } from "./tripletex-invoices";

const STORE = "6f1c2a7e-0b3d-4c5e-9a8b-1c2d3e4f5a6b";

/** Tripletex's answer for one invoice, as `GET /invoice` with our fields gives it. */
function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 501,
    invoiceNumber: 2154,
    invoiceDate: "2026-06-08",
    invoiceDueDate: "2026-06-22",
    isCreditNote: false,
    creditedInvoice: null,
    amountCurrency: 23467.51,
    amountExcludingVatCurrency: 18774.01,
    amountCurrencyOutstanding: 0,
    invoiceComment: "Mai",
    currency: { code: "NOK" },
    customer: {
      id: 77,
      name: "Acme Norge AS",
      organizationNumber: "912 345 678",
      invoiceEmail: "faktura@acme.example",
      email: "post@acme.example",
      phoneNumber: "+47 22 00 00 00",
      isPrivateIndividual: false,
      language: "NO",
      invoicesDueIn: 14,
      invoicesDueInType: "DAYS",
      currency: { code: "NOK" },
      postalAddress: { addressLine1: "Gata 1", addressLine2: "", postalCode: "0150", city: "Oslo", country: { isoAlpha2Code: "NO" } },
    },
    orderLines: [
      {
        description: "Utvikling",
        count: 12.5,
        unitPriceExcludingVatCurrency: 1250,
        discount: 0,
        amountExcludingVatCurrency: 15625,
        amountIncludingVatCurrency: 19531.25,
        sortIndex: 1,
        vatType: { number: "3", percentage: 25 },
        product: { name: "Timer", productUnit: { nameShort: "t", commonCode: "HUR" } },
      },
      {
        description: null,
        count: 1,
        unitPriceExcludingVatCurrency: 3149.01,
        discount: 0,
        amountExcludingVatCurrency: 3149.01,
        amountIncludingVatCurrency: 3936.26,
        sortIndex: 2,
        vatType: { number: "3", percentage: 25 },
        product: { name: "Lisens", productUnit: { nameShort: "stk" } },
      },
    ],
    postings: [
      { date: "2026-06-08", amountCurrency: 23467.51 },
      { date: "2026-06-20", amountCurrency: -23467.51 },
    ],
    ...over,
  };
}

const tx = (over: Record<string, unknown> = {}): TxInvoice => readTripletexInvoice(raw(over)) as TxInvoice;

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    storeId: STORE,
    companyId: 9001,
    invoices: [tx()],
    clients: [],
    here: [],
    storeCountry: "NO",
    countries: new Set(["NO", "SE", "DE"]),
    today: "2026-11-08",
    ...over,
  };
}

const client = (over: Partial<HereClient> = {}): HereClient => ({
  id: "c1",
  name: "Acme",
  legalName: null,
  organisationNumber: null,
  billingEmail: null,
  phone: null,
  hasAddress: false,
  locale: "nb-NO",
  vatTreatment: "domestic",
  ...over,
});

const life = (over: Partial<HereInvoice> = {}): HereInvoice => ({
  id: "i1",
  clientId: "c1",
  imported: true,
  legacyNumber: null,
  documentNumber: "Imported",
  status: "sent",
  issuedOn: "2026-06-08",
  currency: "NOK",
  totalMinor: 2_346_751,
  paidMinor: 0,
  ...over,
});

describe("Tripletex's invoices read (D494)", () => {
  it("reads an invoice, its customer, its lines in order and the days money came", () => {
    const t = tx();
    expect(t).toMatchObject({ id: 501, number: 2154, issuedOn: "2026-06-08", currency: "NOK", totalMinor: 2_346_751, exclMinor: 1_877_401, outstandingMinor: 0, paidDays: ["2026-06-20"] });
    expect(t.customer).toMatchObject({ id: 77, name: "Acme Norge AS", organisationNumber: "912 345 678", email: "faktura@acme.example", business: true, paymentDays: 14, country: "NO" });
    expect(t.lines.map((l) => [l.description ?? l.productName, l.hours, l.exclMinor])).toEqual([
      ["Utvikling", true, 1_562_500],
      ["Lisens", false, 314_901],
    ]);
  });

  it("refuses what is no invoice, and keeps no line when one cannot be read", () => {
    expect(readTripletexInvoice({ id: 1 })).toBeNull();
    expect(readTripletexInvoice(raw({ currency: { code: "kroner" } }))).toBeNull();
    expect(tx({ orderLines: [{ description: "x" }] }).lines).toEqual([]);
  });

  it("knows one company by its name with or without its legal form", () => {
    expect(nameKey("Acme Norge AS")).toBe(nameKey("ACME NORGE"));
    expect(nameKey("Bølgen & Co. ENK")).toBe("bølgen co");
    expect(nameKey("Acme Sverige AB")).not.toBe(nameKey("Acme Norge AS"));
  });
});

describe("the plan of what comes into Work (D494)", () => {
  it("brings in a new invoice with its lines, a new client from the customer card, and the payment Tripletex has", () => {
    const plan = planTripletexInvoices(input());
    expect(plan.clients).toHaveLength(1);
    expect(plan.clients[0]).toMatchObject({ name: "Acme Norge AS", organisationNumber: "912 345 678", country: "NO", locale: "nb-NO", vatTreatment: "domestic", paymentDays: 14 });
    const [invoice] = plan.invoices;
    expect(invoice).toMatchObject({ number: "2154", status: "sent", issuedOn: "2026-06-08", dueOn: "2026-06-22", paymentDays: 14, subtotalMinor: 1_877_401, vatMinor: 469_350, totalMinor: 2_346_751, linesJoined: false, clientId: plan.clients[0].id });
    expect(invoice.lines.map((l) => [l.description, l.unit, l.quantityHundredths, l.unitPriceMinor, l.vatCategory, l.vatRate, l.exclMinor, l.vatMinor])).toEqual([
      ["Utvikling", "hour", 1250, 125_000, "standard", "0.2500", 1_562_500, 390_625],
      ["Lisens", "unit", 100, 314_901, "standard", "0.2500", 314_901, 78_725],
    ]);
    expect(invoice.payment).toMatchObject({ amountMinor: 2_346_751, currency: "NOK", receivedOn: "2026-06-20" });
    expect(plan.links).toEqual([{ clientId: plan.clients[0].id, theirId: 77 }]);
  });

  it("plans the same ids twice, so a second run adds nothing", () => {
    const a = planTripletexInvoices(input());
    const b = planTripletexInvoices(input());
    expect(b.invoices.map((i) => [i.id, i.lines.map((l) => l.id), i.payment?.id])).toEqual(a.invoices.map((i) => [i.id, i.lines.map((l) => l.id), i.payment?.id]));
    expect(planTripletexInvoices(input({ companyId: 9002 })).invoices[0].id).not.toBe(a.invoices[0].id);
  });

  it("finds the client by organisation number, else by name, and fills in only what it lacks", () => {
    const byOrg = planTripletexInvoices(input({ clients: [client({ id: "c9", name: "Something else", organisationNumber: "912345678", billingEmail: "own@acme.example" })] }));
    expect(byOrg.clients).toEqual([]);
    expect(byOrg.invoices[0].clientId).toBe("c9");
    expect(byOrg.fills).toEqual([{ clientId: "c9", theirId: 77, phone: "+47 22 00 00 00", address: { line1: "Gata 1", line2: null, postalCode: "0150", city: "Oslo" } }]);

    const byName = planTripletexInvoices(input({ clients: [client({ id: "c2", name: "ACME NORGE" })] }));
    expect(byName.invoices[0].clientId).toBe("c2");
    expect(byName.fills[0]).toMatchObject({ clientId: "c2", organisationNumber: "912 345 678", billingEmail: "faktura@acme.example" });

    // A client of the same name with another organisation number is another company.
    const other = planTripletexInvoices(input({ clients: [client({ id: "c3", name: "Acme Norge AS", organisationNumber: "998 877 665" })] }));
    expect(other.clients).toHaveLength(1);
  });

  it("knows an invoice already here by Tripletex's number, and adds only the money it lacks", () => {
    const plan = planTripletexInvoices(input({ clients: [client()], here: [life({ legacyNumber: "2154", documentNumber: "2154", paidMinor: 1_000_000 })] }));
    expect(plan.invoices).toEqual([]);
    expect(plan.matched).toEqual([{ invoiceId: "i1", theirId: 501, number: "2154", giveNumber: null, payment: expect.objectContaining({ amountMinor: 1_346_751, receivedOn: "2026-06-20" }) }]);
    // Paid here already: nothing more.
    expect(planTripletexInvoices(input({ clients: [client()], here: [life({ legacyNumber: "2154", status: "paid", paidMinor: 2_346_751 })] })).matched[0].payment).toBeNull();
  });

  it("knows one of Life's unnumbered invoices by client, amount and a week, and gives it Tripletex's number", () => {
    const here = [life({ id: "far", issuedOn: "2026-05-20" }), life({ id: "near", issuedOn: "2026-06-05" }), life({ id: "other", clientId: "c2", issuedOn: "2026-06-08" })];
    const plan = planTripletexInvoices(input({ clients: [client({ name: "Acme Norge" }), client({ id: "c2", name: "Beta" })], here }));
    expect(plan.invoices).toEqual([]);
    expect(plan.matched).toEqual([expect.objectContaining({ invoiceId: "near", giveNumber: "2154", payment: expect.objectContaining({ amountMinor: 2_346_751 }) })]);
    // Another amount is another invoice.
    expect(planTripletexInvoices(input({ clients: [client({ name: "Acme Norge" })], here: [life({ totalMinor: 100 })] })).invoices).toHaveLength(1);
  });

  it("leaves out an invoice whose number an invoice here already has", () => {
    const plan = planTripletexInvoices(input({ here: [life({ imported: false, documentNumber: "2154" })] }));
    expect(plan.invoices).toEqual([]);
    expect(plan.skipped).toEqual([{ number: "2154", issuedOn: "2026-06-08", reason: "number_taken" }]);
  });

  it("makes a wholly credited invoice void, and leaves out one credited in part with its credit note", () => {
    const original = tx({ amountCurrencyOutstanding: 0, postings: [] });
    const whole = tx({ id: 502, invoiceNumber: 2160, invoiceDate: "2026-06-10", isCreditNote: true, creditedInvoice: 501, amountCurrency: -23467.51, amountExcludingVatCurrency: -18774.01 });
    const voided = planTripletexInvoices(input({ invoices: [original, whole] }));
    expect(voided.invoices.map((i) => [i.number, i.status, i.payment])).toEqual([["2154", "void", null]]);
    expect(summarisePlan(voided)).toMatchObject({ invoices: 1, voided: 1, totals: [] });

    const part = tx({ id: 503, invoiceNumber: 2161, isCreditNote: true, creditedInvoice: 501, amountCurrency: -1000, amountExcludingVatCurrency: -800 });
    const leftOut = planTripletexInvoices(input({ invoices: [original, part] }));
    expect(leftOut.invoices).toEqual([]);
    expect(leftOut.skipped.map((s) => [s.number, s.reason])).toEqual([
      ["2161", "credited_part"],
      ["2154", "credited_part"],
    ]);

    const alone = planTripletexInvoices(input({ invoices: [tx({ id: 504, invoiceNumber: 2170, isCreditNote: true, creditedInvoice: 400, amountCurrency: -10 })] }));
    expect(alone.skipped).toEqual([{ number: "2170", issuedOn: "2026-06-08", reason: "credit_alone" }]);
  });

  it("shows a discount line's invoice as one line per VAT rate, and a part payment as part", () => {
    const t = tx({
      amountCurrency: 1125,
      amountExcludingVatCurrency: 900,
      amountCurrencyOutstanding: 125,
      orderLines: [
        { description: "Rådgivning", count: 1, unitPriceExcludingVatCurrency: 1000, discount: 0, amountExcludingVatCurrency: 1000, amountIncludingVatCurrency: 1250, sortIndex: 1, vatType: { number: "3", percentage: 25 } },
        { description: "Rabatt", count: 1, unitPriceExcludingVatCurrency: -100, discount: 0, amountExcludingVatCurrency: -100, amountIncludingVatCurrency: -125, sortIndex: 2, vatType: { number: "3", percentage: 25 } },
      ],
    });
    const [invoice] = planTripletexInvoices(input({ invoices: [t] })).invoices;
    expect(invoice.linesJoined).toBe(true);
    expect(invoice.lines).toEqual([expect.objectContaining({ description: "Rådgivning; Rabatt", quantityHundredths: 100, unitPriceMinor: 90_000, exclMinor: 90_000, vatMinor: 22_500, vatRate: "0.2500" })]);
    expect(invoice.payment).toMatchObject({ amountMinor: 100_000 });
  });

  it("shows an invoice whose lines do not add up to it as one line of its own totals", () => {
    // Project hours Tripletex keeps outside the order lines: the lines give 1 000.00 of the 5 000.00.
    const t = tx({
      amountCurrency: 6250,
      amountExcludingVatCurrency: 5000,
      orderLines: [{ description: "Reise", count: 1, unitPriceExcludingVatCurrency: 1000, discount: 0, amountExcludingVatCurrency: 1000, amountIncludingVatCurrency: 1250, sortIndex: 1, vatType: { number: "3", percentage: 25 } }],
    });
    const [invoice] = planTripletexInvoices(input({ invoices: [t] })).invoices;
    expect(invoice.linesJoined).toBe(true);
    expect(invoice.lines).toEqual([expect.objectContaining({ description: "Tripletex 2154", exclMinor: 500_000, vatMinor: 125_000, vatRate: "0.2500" })]);
  });

  it("gives a foreign business reverse charge, and a line with no VAT the category its code says", () => {
    const t = tx({
      customer: { ...(raw().customer as Record<string, unknown>), id: 88, organizationNumber: null, postalAddress: { country: { isoAlpha2Code: "SE" } } },
      amountCurrency: 1000,
      amountExcludingVatCurrency: 1000,
      orderLines: [{ description: "Konsulent", count: 1, unitPriceExcludingVatCurrency: 1000, discount: 0, amountExcludingVatCurrency: 1000, amountIncludingVatCurrency: 1000, sortIndex: 1, vatType: { number: "52", percentage: 0 } }],
    });
    const plan = planTripletexInvoices(input({ invoices: [t] }));
    expect(plan.clients[0]).toMatchObject({ country: "SE", vatTreatment: "reverse_charge" });
    expect(plan.invoices[0].lines[0]).toMatchObject({ vatCategory: "reverse_charge", vatRate: "0.0000" });
    expect(plan.invoices[0].vatNotes).toEqual(["reverse_charge"]);

    const home = tx({ amountCurrency: 1000, amountExcludingVatCurrency: 1000, orderLines: [{ description: "Leie", count: 1, unitPriceExcludingVatCurrency: 1000, discount: 0, amountExcludingVatCurrency: 1000, amountIncludingVatCurrency: 1000, sortIndex: 1, vatType: { number: "6", percentage: 0 } }] });
    expect(planTripletexInvoices(input({ invoices: [home] })).invoices[0].lines[0].vatCategory).toBe("outside_scope");
  });

  it("dates a payment it cannot date by the due day, never after today", () => {
    const due = planTripletexInvoices(input({ invoices: [tx({ postings: [] })] })).invoices[0];
    expect(due.payment?.receivedOn).toBe("2026-06-22");
    const future = planTripletexInvoices(input({ invoices: [tx({ postings: [], invoiceDate: "2026-11-01", invoiceDueDate: "2026-11-30" })] })).invoices[0];
    expect(future.payment?.receivedOn).toBe("2026-11-01");
  });

  it("counts the plan for the owner", () => {
    const plan = planTripletexInvoices(input({ invoices: [tx(), tx({ id: 600, invoiceNumber: 2200, amountCurrencyOutstanding: 23467.51 })] }));
    expect(summarisePlan(plan)).toMatchObject({ invoices: 2, lines: 4, paid: 1, clients: 1, alreadyHere: 0, firstDay: "2026-06-08", totals: [{ currency: "NOK", minor: 4_693_502 }] });
  });

  it("takes a first day from 2000 to today only", () => {
    expect(invoicesFrom("2016-01-01", "2026-11-08")).toBe("2016-01-01");
    expect(invoicesFrom(" 2026-11-08 ", "2026-11-08")).toBe("2026-11-08");
    expect(invoicesFrom("2026-11-09", "2026-11-08")).toBeNull();
    expect(invoicesFrom("1999-12-31", "2026-11-08")).toBeNull();
    expect(invoicesFrom("2026-02-30x", "2026-11-08")).toBeNull();
    expect(invoicesFrom(null, "2026-11-08")).toBeNull();
  });
});
