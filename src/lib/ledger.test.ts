import { describe, expect, it } from "vitest";

import type { BookingDoc } from "./accounting-docs";
import {
  NO_POSTING,
  NO_STANDARD_ACCOUNTS,
  NO_TAX_CODES,
  entryName,
  entryOfDoc,
  entryProblems,
  isVatCode,
  noKindOf,
  postingOfTripletex,
  standardOf,
  startingChart,
  trialBalance,
} from "./ledger";

const invoice: BookingDoc = {
  source: "work",
  kind: "invoice",
  id: "inv-1",
  documentNumber: "1042",
  invoiceNumber: "1042",
  issuedOn: "2027-01-14",
  currency: "NOK",
  totalMinor: 137_500,
  vatMinor: 25_000,
  lines: [
    { key: "standard_25", text: "Design", grossMinor: 125_000, netMinor: 100_000, vatMinor: 25_000 },
    { key: "outside_scope", text: "Fee", grossMinor: 12_500, netMinor: 12_500, vatMinor: 0 },
  ],
  customer: { kind: "work_client", clientId: "c-1" },
  counterparty: "Kunde AS",
};

describe("Norway's chart, from Skatteetaten's files", () => {
  it("holds the standard accounts and VAT codes as published, and reads an account's kind from its class", () => {
    expect(NO_STANDARD_ACCOUNTS.find((a) => a.id === "2703")).toMatchObject({ nb: "Utgående merverdiavgift, lav sats" });
    expect(NO_TAX_CODES.map((c) => c.code)).toEqual(expect.arrayContaining(["1", "3", "31", "33", "5", "52", "6"]));
    expect(isVatCode("3")).toBe(true);
    expect(isVatCode("4")).toBe(false);
    expect([1920, 2050, 2400, 3000, 4300, 7770, 8050, 8150, 8800].map(noKindOf)).toEqual(["asset", "equity", "liability", "income", "expense", "expense", "income", "expense", "expense"]);
    expect(standardOf(15001)).toBe("1500");
    expect(standardOf(1234)).toBeNull();
    const chart = startingChart();
    expect(chart.find((a) => a.number === 3000)).toEqual({ number: 3000, name: "Salgsinntekt handelsvarer, avgiftspliktig, høy sats", standard: "3000", kind: "income", vatCode: "3" });
    // Every account Kaizena Flow posts to is in the starting chart.
    for (const account of [NO_POSTING.receivable, ...Object.values(NO_POSTING.income), 2700, 2701, 2703]) expect(chart.map((a) => a.number)).toContain(account);
  });
});

describe("an entry", () => {
  it("is balanced, of two lines or more, none zero, in a series of capitals, with a day and words", () => {
    const ok = { series: "M", date: "2027-01-02", text: "Owner's deposit", source: null, lines: [{ account: 1920, amountMinor: 3_000_000 }, { account: 2000, amountMinor: -3_000_000 }] };
    expect(entryProblems(ok)).toEqual([]);
    expect(entryProblems({ ...ok, lines: [{ account: 1920, amountMinor: 100 }, { account: 2000, amountMinor: -99 }] })).toEqual(["balance"]);
    expect(entryProblems({ ...ok, series: "m1", date: "2027-02-30", text: " ", lines: [{ account: 999, amountMinor: 0 }] })).toEqual(
      expect.arrayContaining(["series", "date", "text", "lines", "zero", "account"]),
    );
    expect(entryProblems({ ...ok, lines: [{ account: 1920, amountMinor: 1, vatCode: "4" }, { account: 2000, amountMinor: -1 }] })).toEqual(["vat_code"]);
    expect(entryName("S", 2027, 14)).toBe("S2027-14");
  });
});

describe("a document, posted", () => {
  it("puts the total on the receivable, each bucket's net on its income account with its code, and the VAT on its rate's account", () => {
    const posted = entryOfDoc(invoice, NO_POSTING, "NOK");
    expect(posted).toEqual({
      ok: true,
      entry: {
        series: "S",
        date: "2027-01-14",
        text: "Faktura 1042, Kunde AS",
        source: { kind: "work_invoice", id: "inv-1" },
        lines: [
          { account: 1500, amountMinor: 137_500, vatCode: null },
          { account: 3000, amountMinor: -100_000, vatCode: "3" },
          { account: 3200, amountMinor: -12_500, vatCode: "6" },
          { account: 2700, amountMinor: -25_000, vatCode: "3" },
        ],
      },
    });
    expect(posted.ok && entryProblems(posted.entry)).toEqual([]);
  });

  it("turns a credit note's signs, and says what it cannot post", () => {
    const credit = entryOfDoc({ ...invoice, kind: "credit_note", id: "cn-1", documentNumber: "7" }, NO_POSTING, "NOK");
    expect(credit.ok && credit.entry.lines.map((l) => l.amountMinor)).toEqual([-137_500, 100_000, 12_500, 25_000]);
    expect(credit.ok && credit.entry.source).toEqual({ kind: "work_credit_note", id: "cn-1" });
    expect(entryOfDoc({ ...invoice, currency: "EUR" }, NO_POSTING, "NOK")).toEqual({ ok: false, problem: "currency" });
    expect(entryOfDoc({ ...invoice, lines: [{ ...invoice.lines[0], key: null }] }, NO_POSTING, "NOK")).toEqual({ ok: false, problem: "vat_unmapped" });
    expect(entryOfDoc({ ...invoice, totalMinor: 137_400 }, NO_POSTING, "NOK")).toEqual({ ok: false, problem: "totals" });
    // VAT where its bucket has no VAT account: not guessed.
    expect(entryOfDoc({ ...invoice, totalMinor: 125_000, lines: [{ key: "exempt", text: "x", grossMinor: 125_000, netMinor: 100_000, vatMinor: 25_000 }] }, NO_POSTING, "NOK")).toEqual({
      ok: false,
      problem: "vat_unmapped",
    });
  });

  it("posts where the store's Tripletex settings book, so the two books agree account by account", () => {
    const posting = postingOfTripletex({ receivableAccount: 1510, bookings: { standard_25: { account: 3020 } } });
    expect(posting).toEqual({ receivable: 1510, income: { ...NO_POSTING.income, standard_25: 3020 } });
    const posted = entryOfDoc(invoice, posting, "NOK");
    expect(posted.ok && posted.entry.lines.slice(0, 2).map((l) => l.account)).toEqual([1510, 3020]);
    expect(postingOfTripletex(null)).toBe(NO_POSTING);
  });
});

describe("a trial balance", () => {
  it("sums every column to zero in a sound book, and reads the result off the profit and loss side", () => {
    const tb = trialBalance([
      { account: 3000, name: "Sales", kind: "income", before: 0, debit: 0, credit: -100_000 },
      { account: 1500, name: "Receivable", kind: "asset", before: 0, debit: 125_000, credit: 0 },
      { account: 2700, name: "Output VAT", kind: "liability", before: 0, debit: 0, credit: -25_000 },
      { account: 7770, name: "Card fees", kind: "expense", before: 0, debit: 3_000, credit: 0 },
      { account: 1920, name: "Bank", kind: "asset", before: 50_000, debit: 0, credit: -3_000 },
      { account: 2050, name: "Equity", kind: "equity", before: -50_000, debit: 0, credit: 0 },
    ]);
    expect(tb.rows.map((r) => r.account)).toEqual([1500, 1920, 2050, 2700, 3000, 7770]);
    expect(tb.rows.find((r) => r.account === 1920)?.after).toBe(47_000);
    expect(tb.totals).toEqual({ before: 0, debit: 128_000, credit: -128_000, after: 0 });
    expect(tb.result).toBe(97_000);
  });
});
