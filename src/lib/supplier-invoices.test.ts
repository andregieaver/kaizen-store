import { describe, expect, it } from "vitest";

import { entryProblems } from "./ledger";
import { entryOfBill, entryOfBillPayment, matchBills, type BankMoneyOut, type UnpaidBill } from "./supplier-invoices";

const bill = { id: "b1", day: "2027-01-10", totalMinor: 125_000, kind: "phone" as const, vatRate: 25 as const, text: "Telenor, faktura 88123" };

const out = (id: string, day: string, amountMinor: number, text: string, counterparty: string | null = null): BankMoneyOut => ({
  id,
  day,
  amountMinor,
  currency: "NOK",
  text,
  reference: null,
  counterparty,
});

const unpaid = (id: string, number: string | null, supplier: string, totalMinor: number): UnpaidBill => ({ id, number, supplier, currency: "NOK", issuedOn: "2027-01-10", totalMinor });

describe("a supplier's invoice, a bill (B3, D492)", () => {
  it("posts its cost and VAT against what the store owes, in the purchases series on its day, once", () => {
    const entry = entryOfBill(bill);
    expect(entry).toEqual({
      series: "L",
      date: "2027-01-10",
      text: "Telenor, faktura 88123",
      source: { kind: "supplier_invoice", id: "b1" },
      lines: [
        { account: 6900, amountMinor: 100_000, vatCode: "1" },
        { account: 2710, amountMinor: 25_000, vatCode: "1" },
        { account: 2400, amountMinor: -125_000, vatCode: null },
      ],
    });
    expect(entryProblems(entry)).toEqual([]);
  });

  it("is paid by the bank line that pays it whole: what is owed against the bank, on the bank's day", () => {
    const paid = entryOfBillPayment({ id: "l1", day: "2027-01-24", amountMinor: -125_000 }, bill)!;
    expect(paid).toEqual({
      series: "B",
      date: "2027-01-24",
      text: "Betalt: Telenor, faktura 88123",
      source: { kind: "bank_line", id: "l1" },
      lines: [
        { account: 2400, amountMinor: 125_000, vatCode: null },
        { account: 1920, amountMinor: -125_000, vatCode: null },
      ],
    });
    expect(entryProblems(paid)).toEqual([]);
    expect(entryOfBillPayment({ id: "l1", day: "2027-01-24", amountMinor: -100_000 }, bill)).toBeNull();
    expect(entryOfBillPayment({ id: "l1", day: "2027-01-24", amountMinor: 125_000 }, bill)).toBeNull();
  });

  it("knows the bill a line pays by its number or its supplier and exactly its amount, never a part", () => {
    const bills = [unpaid("b1", "88123", "Telenor Norge AS", 125_000), unpaid("b2", null, "Kontorbutikken AS", 45_000), unpaid("b3", "777", "Fiken AS", 9_900)];
    expect(matchBills([out("l1", "2027-01-24", -125_000, "Giro 88123")], bills)).toEqual([{ lineId: "l1", invoiceId: "b1", kind: "certain" }]);
    expect(matchBills([out("l2", "2027-01-24", -45_000, "Overføring", "KONTORBUTIKKEN AS")], bills)).toEqual([{ lineId: "l2", invoiceId: "b2", kind: "amount_name" }]);
    // A part of a bill, money in, or an amount no bill has: nothing.
    expect(matchBills([out("l3", "2027-01-24", -50_000, "Giro 88123")], bills)).toEqual([]);
    expect(matchBills([out("l4", "2027-01-24", 125_000, "Giro 88123")], bills)).toEqual([]);
    expect(matchBills([out("l5", "2027-01-24", -12_345, "Something")], bills)).toEqual([]);
  });
});
