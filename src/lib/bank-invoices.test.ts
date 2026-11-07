import { describe, expect, it } from "vitest";

import { matchInvoices, namesClient, namesInvoice, type BankMoneyIn, type OpenInvoice } from "./bank-invoices";

const line = (id: string, day: string, amountMinor: number, text: string, more: Partial<BankMoneyIn> = {}): BankMoneyIn => ({
  id,
  day,
  amountMinor,
  currency: "NOK",
  text,
  reference: null,
  counterparty: null,
  ...more,
});

const invoice = (id: string, printedNumber: string, number: number | null, outstandingMinor: number, more: Partial<OpenInvoice> = {}): OpenInvoice => ({
  id,
  printedNumber,
  number,
  client: "Acme AS",
  currency: "NOK",
  issuedOn: "2027-01-02",
  outstandingMinor,
  ...more,
});

describe("which invoice a client's payment on the statement pays (B4, D487)", () => {
  it("finds the invoice's number in the line as a word or a run of digits of its own, never inside another number", () => {
    expect(namesInvoice({ text: "Faktura 1042", reference: null }, { printedNumber: "F-1042", number: 1042 })).toBe(true);
    expect(namesInvoice({ text: "Betaling", reference: "F-1042" }, { printedNumber: "F-1042", number: 1042 })).toBe(true);
    expect(namesInvoice({ text: "Inv.1042.", reference: null }, { printedNumber: "1042", number: 1042 })).toBe(true);
    expect(namesInvoice({ text: "Faktura 01042", reference: null }, { printedNumber: "1042", number: 1042 })).toBe(true);
    expect(namesInvoice({ text: "KID 0012345678903", reference: null }, { printedNumber: "1234", number: 1234 })).toBe(false);
    expect(namesInvoice({ text: "Faktura 10420", reference: null }, { printedNumber: "1042", number: 1042 })).toBe(false);
    // An imported invoice keeps the number it had, all digits or not.
    expect(namesInvoice({ text: "Fakt. 2023-117", reference: null }, { printedNumber: "2023-117", number: null })).toBe(true);
    expect(namesInvoice({ text: "Fakt. 117", reference: null }, { printedNumber: "2023-117", number: null })).toBe(false);
    // A shop's invoice goes by its order's number too.
    expect(namesInvoice({ text: "Ordre 1001", reference: null }, { printedNumber: "F-4", number: 4, alsoNamed: ["1001"] })).toBe(true);
    expect(namesInvoice({ text: "Ordre 10011", reference: null }, { printedNumber: "F-4", number: 4, alsoNamed: ["1001"] })).toBe(false);
  });

  it("knows the client by a word of its name, not by its legal form", () => {
    expect(namesClient({ counterparty: "ACME AS", text: "" }, "Acme AS")).toBe(true);
    expect(namesClient({ counterparty: null, text: "Innbetaling fra Nordlys Design" }, "Nordlys Design AS")).toBe(true);
    expect(namesClient({ counterparty: "Other AS", text: "" }, "Acme AS")).toBe(false);
    expect(namesClient({ counterparty: "Søderberg Consulting", text: "" }, "Soderberg ENK")).toBe(true);
  });

  it("is certain only when the number is in the line and it pays exactly what is outstanding", () => {
    const invoices = [invoice("a", "F-1042", 1042, 150_000), invoice("b", "F-1043", 1043, 80_000)];
    expect(matchInvoices([line("1", "2027-01-20", 150_000, "Faktura 1042")], invoices)).toEqual([{ lineId: "1", invoiceId: "a", kind: "certain" }]);
    // Less than outstanding: a part payment, offered.
    expect(matchInvoices([line("1", "2027-01-20", 50_000, "Faktura 1042")], invoices)).toEqual([{ lineId: "1", invoiceId: "a", kind: "number" }]);
    // More than outstanding: nothing.
    expect(matchInvoices([line("1", "2027-01-20", 200_000, "Faktura 1042")], invoices)).toEqual([]);
    // Two numbers in the line: the one it pays exactly is offered, never certain.
    expect(matchInvoices([line("1", "2027-01-20", 80_000, "Faktura 1042 og 1043")], invoices)).toEqual([{ lineId: "1", invoiceId: "b", kind: "number" }]);
  });

  it("offers by the amount and the client's name, or by an amount only one open invoice has", () => {
    const invoices = [invoice("a", "F-1042", 1042, 150_000), invoice("b", "F-1043", 1043, 150_000, { client: "Nordlys Design AS" }), invoice("c", "F-1044", 1044, 99_000)];
    expect(matchInvoices([line("1", "2027-01-20", 150_000, "Overføring", { counterparty: "NORDLYS DESIGN AS" })], invoices)).toEqual([
      { lineId: "1", invoiceId: "b", kind: "amount_name" },
    ]);
    // Two invoices of the amount and no name: nothing is guessed.
    expect(matchInvoices([line("1", "2027-01-20", 150_000, "Overføring")], invoices)).toEqual([]);
    expect(matchInvoices([line("1", "2027-01-20", 99_000, "Overføring")], invoices)).toEqual([{ lineId: "1", invoiceId: "c", kind: "amount" }]);
  });

  it("never offers money out, an invoice issued after the money came, one in another currency, or one already paid off by an earlier line", () => {
    const invoices = [invoice("a", "F-1042", 1042, 150_000), invoice("e", "F-1050", 1050, 70_000, { currency: "EUR" }), invoice("l", "F-1060", 1060, 30_000, { issuedOn: "2027-02-01" })];
    expect(matchInvoices([line("1", "2027-01-20", -150_000, "Faktura 1042")], invoices)).toEqual([]);
    expect(matchInvoices([line("1", "2027-01-20", 70_000, "Faktura 1050")], invoices)).toEqual([]);
    expect(matchInvoices([line("1", "2027-01-20", 30_000, "Faktura 1060")], invoices)).toEqual([]);
    // Nor one that takes no money of the line's day.
    expect(matchInvoices([line("1", "2027-01-20", 150_000, "Faktura 1042")], [invoice("a", "F-1042", 1042, 150_000, { paidFrom: "2027-01-21" })])).toEqual([]);
    // Two lines naming the same invoice: the first pays it off, the second has nothing left to pay.
    expect(
      matchInvoices([line("2", "2027-01-21", 150_000, "Faktura 1042"), line("1", "2027-01-20", 150_000, "Faktura 1042")], invoices),
    ).toEqual([{ lineId: "1", invoiceId: "a", kind: "certain" }]);
    // Two part payments: each takes its part.
    expect(
      matchInvoices([line("1", "2027-01-20", 100_000, "Faktura 1042"), line("2", "2027-01-25", 50_000, "Faktura 1042")], invoices),
    ).toEqual([
      { lineId: "1", invoiceId: "a", kind: "number" },
      { lineId: "2", invoiceId: "a", kind: "certain" },
    ]);
  });
});
