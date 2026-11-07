import { describe, expect, it } from "vitest";

import type { BookingDoc } from "./accounting-docs";
import { parseAmount } from "./field-money";
import {
  FX_GAIN_ACCOUNT,
  FX_LOSS_ACCOUNT,
  NO_POSTING,
  PAYMENT_ACCOUNTS,
  GIFT_CARD_ACCOUNT,
  SHOP_PAYMENT_ACCOUNTS,
  STORE_CREDIT_ACCOUNT,
  shopMoneyAccount,
  balanceSheet,
  compareWithTheirs,
  isVatAccount,
  NO_STANDARD_ACCOUNTS,
  NO_TAX_CODES,
  entryName,
  entryOfDoc,
  entryOfPayment,
  entryOfPayout,
  entryOfPaymentReversal,
  entryProblems,
  handEntryOf,
  isVatCode,
  nearestStandard,
  openingBalanceOf,
  noKindOf,
  postingOfTripletex,
  profitAndLoss,
  resultGroupOf,
  standardOf,
  startingChart,
  trialBalance,
  vatByCode,
  vatTermOf,
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

  it("posts one in another currency at the document's own rate, its VAT as the document reported it in the book's currency", () => {
    const eur: BookingDoc = { ...invoice, currency: "EUR", totalMinor: 125_000, vatMinor: 25_000, lines: [{ key: "standard_25", text: "Design", grossMinor: 125_000, netMinor: 100_000, vatMinor: 25_000 }] };
    expect(entryOfDoc(eur, NO_POSTING, "NOK")).toEqual({ ok: false, problem: "currency" });
    const at = entryOfDoc(eur, NO_POSTING, "NOK", { rate: "11.5", vatHomeMinor: 287_500 });
    expect(at.ok && at.entry.lines).toEqual([
      { account: 1500, amountMinor: 1_437_500, vatCode: null },
      { account: 3000, amountMinor: -1_150_000, vatCode: "3" },
      { account: 2700, amountMinor: -287_500, vatCode: "3" },
    ]);
    // 25 000 × 11.4567 rounds to 286 418; the document reported 286 417, so the VAT line says that and the receivable follows.
    const odd = entryOfDoc(eur, NO_POSTING, "NOK", { rate: "11.4567", vatHomeMinor: 286_417 });
    expect(odd.ok && odd.entry.lines.map((l) => l.amountMinor)).toEqual([1_432_087, -1_145_670, -286_417]);
    expect(odd.ok && entryProblems(odd.entry)).toEqual([]);
    // A credit note turns the signs, the reported VAT still a size.
    const credit = entryOfDoc({ ...eur, kind: "credit_note" }, NO_POSTING, "NOK", { rate: "11.5", vatHomeMinor: 287_500 });
    expect(credit.ok && credit.entry.lines.map((l) => l.amountMinor)).toEqual([-1_437_500, 1_150_000, 287_500]);
    expect(entryOfDoc(eur, NO_POSTING, "NOK", { rate: "0", vatHomeMinor: 0 })).toEqual({ ok: false, problem: "currency" });
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

describe("an entry compared with its voucher in Tripletex", () => {
  const ours = [
    { account: 1500, amountMinor: 137_500 },
    { account: 3000, amountMinor: -100_000 },
    { account: 3200, amountMinor: -12_500 },
    { account: 2700, amountMinor: -25_000 },
  ];

  it("agrees account by account and in VAT, whether or not Tripletex lists its VAT postings apart", () => {
    // VAT worked out of the gross on the income posting, no VAT posting listed.
    const folded = [
      { account: 1500, grossMinor: 137_500, netMinor: 137_500 },
      { account: 3000, grossMinor: -125_000, netMinor: -100_000 },
      { account: 3200, grossMinor: -12_500, netMinor: -12_500 },
    ];
    expect(compareWithTheirs(ours, folded)).toEqual({ agrees: true, differences: [] });
    // The same with its VAT posting listed on 2700.
    expect(compareWithTheirs(ours, [...folded, { account: 2700, grossMinor: -25_000, netMinor: -25_000 }])).toEqual({ agrees: true, differences: [] });
    expect(isVatAccount(2703)).toBe(true);
    expect(isVatAccount(3000)).toBe(false);
  });

  it("names every account that differs, and the VAT, by an øre", () => {
    const theirs = [
      { account: 1500, grossMinor: 137_500, netMinor: 137_500 },
      { account: 3020, grossMinor: -125_001, netMinor: -100_001 },
      { account: 3200, grossMinor: -12_499, netMinor: -12_499 },
    ];
    expect(compareWithTheirs(ours, theirs)).toEqual({
      agrees: false,
      differences: [
        { account: 3000, ours: -100_000, theirs: 0 },
        { account: 3020, ours: 0, theirs: -100_001 },
        { account: 3200, ours: -12_500, theirs: -12_499 },
      ],
    });
  });
});

describe("a payment for an invoice, posted", () => {
  const paid = { id: "pay-1", invoiceNumber: "1042", counterparty: "Kunde AS", receivedOn: "2027-01-20", amountMinor: 137_500, currency: "NOK", method: "bank" as const };

  it("puts the money in the bank against the receivable, in the bank series on its day", () => {
    const posted = entryOfPayment(paid, NO_POSTING, "NOK");
    expect(posted).toEqual({
      ok: true,
      entry: {
        series: "B",
        date: "2027-01-20",
        text: "Innbetaling faktura 1042, Kunde AS",
        source: { kind: "work_payment", id: "pay-1" },
        lines: [
          { account: 1920, amountMinor: 137_500, vatCode: null },
          { account: 1500, amountMinor: -137_500, vatCode: null },
        ],
      },
    });
    expect(posted.ok && entryProblems(posted.entry)).toEqual([]);
  });

  it("knows where each way of paying puts the money, and turns the signs for money paid back", () => {
    expect(PAYMENT_ACCOUNTS).toEqual({ bank: 1920, other: 1920, cash: 1900, card: 1579, stripe: 1579, prepaid: 2900 });
    const stripe = entryOfPayment({ ...paid, method: "stripe" }, { receivable: 1510 }, "NOK");
    expect(stripe.ok && stripe.entry.lines.map((l) => [l.account, l.amountMinor])).toEqual([[1579, 137_500], [1510, -137_500]]);
    const back = entryOfPayment({ ...paid, amountMinor: -20_000 }, NO_POSTING, "NOK");
    expect(back.ok && back.entry.text).toBe("Tilbakebetaling faktura 1042, Kunde AS");
    expect(back.ok && back.entry.lines.map((l) => l.amountMinor)).toEqual([-20_000, 20_000]);
    expect(entryOfPayment({ ...paid, amountMinor: 0 }, NO_POSTING, "NOK")).toEqual({ ok: false, problem: "nothing" });
  });

  it("in another currency: the receivable at the invoice's rate, the money at the day's, and the difference a gain or a loss", () => {
    const eur = { ...paid, amountMinor: 100_000, currency: "EUR" };
    expect(entryOfPayment(eur, NO_POSTING, "NOK")).toEqual({ ok: false, problem: "currency" });
    // Invoiced at 11.50, paid when a euro was 11.62: 11 500 kroner owed, 11 620 received, 120 gained.
    const gained = entryOfPayment(eur, NO_POSTING, "NOK", { invoice: "11.5", day: "11.62" });
    expect(gained.ok && gained.entry.lines).toEqual([
      { account: 1920, amountMinor: 1_162_000, vatCode: null },
      { account: 1500, amountMinor: -1_150_000, vatCode: null },
      { account: FX_GAIN_ACCOUNT, amountMinor: -12_000, vatCode: null },
    ]);
    expect(gained.ok && entryProblems(gained.entry)).toEqual([]);
    const lost = entryOfPayment(eur, NO_POSTING, "NOK", { invoice: "11.5", day: "11.4321" });
    expect(lost.ok && lost.entry.lines).toEqual([
      { account: 1920, amountMinor: 1_143_210, vatCode: null },
      { account: 1500, amountMinor: -1_150_000, vatCode: null },
      { account: FX_LOSS_ACCOUNT, amountMinor: 6_790, vatCode: null },
    ]);
    // The same rate both days: no difference to post.
    const same = entryOfPayment(eur, NO_POSTING, "NOK", { invoice: "11.5", day: "11.5" });
    expect(same.ok && same.entry.lines).toHaveLength(2);
    expect(entryOfPayment(eur, NO_POSTING, "NOK", { invoice: "0", day: "11.5" })).toEqual({ ok: false, problem: "currency" });
  });

  it("reverses a mistaken payment by turning its own entry, exchange difference and all", () => {
    const original = [
      { account: 1920, amountMinor: 1_162_000 },
      { account: 1500, amountMinor: -1_150_000 },
      { account: 8060, amountMinor: -12_000 },
    ];
    const reversed = entryOfPaymentReversal({ id: "pay-2", invoiceNumber: "1042", counterparty: null, receivedOn: "2027-01-22" }, original);
    expect(reversed).toEqual({
      ok: true,
      entry: {
        series: "B",
        date: "2027-01-22",
        text: "Reversert innbetaling faktura 1042",
        source: { kind: "work_payment", id: "pay-2" },
        lines: [
          { account: 1920, amountMinor: -1_162_000, vatCode: null },
          { account: 1500, amountMinor: 1_150_000, vatCode: null },
          { account: 8060, amountMinor: 12_000, vatCode: null },
        ],
      },
    });
    expect(entryOfPaymentReversal({ id: "x", invoiceNumber: "1", counterparty: null, receivedOn: "2027-01-22" }, [])).toEqual({ ok: false, problem: "nothing" });
  });
});

describe("the reports", () => {
  // Opening equity of 50 000, a sale of 100 000 + 25 000 VAT paid by card, its card fee 3 000, an exchange gain of 120.
  const rows = trialBalance([
    { account: 1920, name: "Bank", kind: "asset", before: 5_000_000, debit: 0, credit: -300_000 },
    { account: 1579, name: "Card provider", kind: "asset", before: 0, debit: 12_512_000, credit: 0 },
    { account: 1500, name: "Receivable", kind: "asset", before: 0, debit: 12_500_000, credit: -12_500_000 },
    { account: 2050, name: "Equity", kind: "equity", before: -5_000_000, debit: 0, credit: 0 },
    { account: 2700, name: "Output VAT", kind: "liability", before: 0, debit: 0, credit: -2_500_000 },
    { account: 3000, name: "Sales", kind: "income", before: 0, debit: 0, credit: -10_000_000 },
    { account: 7770, name: "Card fees", kind: "expense", before: 0, debit: 300_000, credit: 0 },
    { account: 8060, name: "Agio", kind: "income", before: 0, debit: 0, credit: -12_000 },
  ]).rows;

  it("reads an account's line of the profit and loss off its NS 4102 class", () => {
    expect([3000, 3600, 4300, 5000, 6010, 6300, 7770, 8060, 8160, 8300, 8800, 1920, 30001].map(resultGroupOf)).toEqual([
      "sales", "other_income", "goods", "payroll", "depreciation", "other_costs", "other_costs", "financial_income", "financial_costs", "tax", null, null, "sales",
    ]);
  });

  it("puts the profit and loss in its groups, income and costs both positive, with each result", () => {
    const pl = profitAndLoss(rows);
    expect(pl.groups).toEqual([
      { group: "sales", rows: [{ account: 3000, name: "Sales", amount: 10_000_000 }], total: 10_000_000 },
      { group: "other_costs", rows: [{ account: 7770, name: "Card fees", amount: 300_000 }], total: 300_000 },
      { group: "financial_income", rows: [{ account: 8060, name: "Agio", amount: 12_000 }], total: 12_000 },
    ]);
    expect(pl).toMatchObject({ operating: 9_700_000, financial: 12_000, beforeTax: 9_712_000, result: 9_712_000 });
    // The same result as the trial balance reads off it.
    expect(pl.result).toBe(trialBalance(rows).result);
  });

  it("balances the balance sheet with the result not yet carried to equity", () => {
    expect(trialBalance(rows).totals.after).toBe(0);
    const bs = balanceSheet(rows);
    expect(bs.groups.map((g) => [g.group, g.total])).toEqual([
      ["current_assets", 17_212_000],
      ["equity", 5_000_000],
      ["short_term", 2_500_000],
    ]);
    // The receivable is cleared: no line of nothing.
    expect(bs.groups[0].rows.map((r) => r.account)).toEqual([1579, 1920]);
    expect(bs.unallocated).toBe(9_712_000);
    expect(bs.assets).toBe(bs.equityAndLiabilities);
  });

  it("sums VAT by code, the base from the income lines and the VAT from the VAT accounts, sales positive", () => {
    expect(
      vatByCode([
        { account: 3000, vatCode: "3", amountMinor: -100_000 },
        { account: 2700, vatCode: "3", amountMinor: -25_000 },
        { account: 3000, vatCode: "3", amountMinor: 40_000 },
        { account: 2700, vatCode: "3", amountMinor: 10_000 },
        { account: 3200, vatCode: "6", amountMinor: -12_500 },
        { account: 3030, vatCode: "31", amountMinor: -20_000 },
        { account: 2701, vatCode: "31", amountMinor: -3_000 },
        { account: 6800, vatCode: "1", amountMinor: 8_000 },
        { account: 2710, vatCode: "1", amountMinor: 2_000 },
      ]),
    ).toEqual([
      { code: "1", base: -8_000, vat: -2_000 },
      { code: "3", base: 60_000, vat: 15_000 },
      { code: "6", base: 12_500, vat: 0 },
      { code: "31", base: 20_000, vat: 3_000 },
    ]);
  });

  it("knows the VAT term a day is in", () => {
    expect(vatTermOf("2027-01-14")).toEqual({ term: 1, from: "2027-01-01", to: "2027-02-28" });
    expect(vatTermOf("2028-02-29")).toEqual({ term: 1, from: "2028-01-01", to: "2028-02-29" });
    expect(vatTermOf("2027-12-31")).toEqual({ term: 6, from: "2027-11-01", to: "2027-12-31" });
    expect(vatTermOf("2027-08-01")).toEqual({ term: 4, from: "2027-07-01", to: "2027-08-31" });
  });
});

describe("an entry by hand", () => {
  const empty = { account: "", debit: "", credit: "", vatCode: "" };
  const opening = {
    series: "IB",
    date: "2027-01-01",
    text: "Inngående balanse",
    rows: [
      { account: "1920", debit: "250000", credit: "", vatCode: "" },
      { account: "1500", debit: "37 500".replace(" ", ""), credit: "", vatCode: "" },
      { account: "2000", debit: "", credit: "30000", vatCode: "" },
      { account: "2050", debit: "", credit: "257500,00", vatCode: "" },
      empty,
      empty,
    ],
  };

  it("reads the form's rows into a balanced entry, an empty row left out, a debit positive and a credit negative", () => {
    expect(handEntryOf(opening, "NOK", parseAmount)).toEqual({
      ok: true,
      entry: {
        series: "IB",
        date: "2027-01-01",
        text: "Inngående balanse",
        source: null,
        lines: [
          { account: 1920, amountMinor: 25_000_000, vatCode: null },
          { account: 1500, amountMinor: 3_750_000, vatCode: null },
          { account: 2000, amountMinor: -3_000_000, vatCode: null },
          { account: 2050, amountMinor: -25_750_000, vatCode: null },
        ],
      },
    });
  });

  it("keeps a VAT code where one is given", () => {
    const bought = handEntryOf(
      {
        series: "M",
        date: "2027-01-10",
        text: "Programvare",
        rows: [
          { account: "6800", debit: "2400", credit: "", vatCode: "1" },
          { account: "2710", debit: "600", credit: "", vatCode: "1" },
          { account: "1920", debit: "", credit: "3000", vatCode: "" },
        ],
      },
      "NOK",
      parseAmount,
    );
    expect(bought.ok && bought.entry.lines.map((l) => l.vatCode)).toEqual(["1", "1", null]);
  });

  it("says what a row cannot be, and which rows, before the entry's own rules", () => {
    expect(
      handEntryOf(
        { ...opening, rows: [{ account: "19", debit: "1", credit: "", vatCode: "" }, { account: "1920", debit: "1", credit: "1", vatCode: "" }, { account: "3000", debit: "abc", credit: "", vatCode: "4" }] },
        "NOK",
        parseAmount,
      ),
    ).toEqual({ ok: false, problems: ["account", "both", "amount", "vat_code"], rows: [0, 1, 2] });
    // A row with an account and nothing in either column.
    expect(handEntryOf({ ...opening, rows: [{ account: "1920", debit: "", credit: "", vatCode: "" }] }, "NOK", parseAmount)).toMatchObject({ ok: false, problems: ["zero"] });
    // Only the series of entries by hand: never the sales or bank series the documents are posted in.
    expect(handEntryOf({ ...opening, series: "S" }, "NOK", parseAmount)).toMatchObject({ ok: false, problems: ["series"] });
    // Rows that read well, but do not balance, or lack words.
    expect(handEntryOf({ ...opening, rows: opening.rows.slice(0, 3) }, "NOK", parseAmount)).toEqual({ ok: false, problems: ["balance"], rows: [] });
    expect(handEntryOf({ ...opening, text: "  " }, "NOK", parseAmount)).toEqual({ ok: false, problems: ["text"], rows: [] });
  });
});

describe("a shop's money, and the payment provider's payouts", () => {
  it("moves a shop order's receivable to where its money is, and back for a refund, in the shop's words", () => {
    const paid = entryOfPayment(
      { id: "p1", invoiceNumber: "", what: "ordre 1042", counterparty: null, receivedOn: "2027-01-14", amountMinor: 49_900, currency: "NOK", method: "stripe", sourceKind: "shop_payment", account: SHOP_PAYMENT_ACCOUNTS.stripe },
      NO_POSTING,
      "NOK",
    );
    expect(paid.ok && paid.entry).toEqual({
      series: "B",
      date: "2027-01-14",
      text: "Innbetaling ordre 1042",
      source: { kind: "shop_payment", id: "p1" },
      lines: [
        { account: 1579, amountMinor: 49_900, vatCode: null },
        { account: 1500, amountMinor: -49_900, vatCode: null },
      ],
    });
    // Paid back to store credit: owed to the customer, not money out of the provider.
    const credited = entryOfPayment(
      { id: "r1", invoiceNumber: "", what: "ordre 1042", counterparty: null, receivedOn: "2027-01-20", amountMinor: -10_000, currency: "NOK", method: "other", sourceKind: "shop_refund", account: STORE_CREDIT_ACCOUNT },
      NO_POSTING,
      "NOK",
    );
    expect(credited.ok && credited.entry.text).toBe("Tilbakebetaling ordre 1042");
    expect(credited.ok && credited.entry.lines.map((l) => [l.account, l.amountMinor])).toEqual([[2900, -10_000], [1500, 10_000]]);
    expect(SHOP_PAYMENT_ACCOUNTS).toEqual({ stripe: 1579, cash: 1900, bank_transfer: 1920, other: 1920 });
  });

  it("posts money in another currency at what the provider settled it for, the receivable at the invoice's rate, the rest a gain or a loss", () => {
    // 100.00 euro invoiced at 11.50: 1 150.00 kroner owed; Stripe settled it for 1 162.40, a gain of 12.40.
    const paid = entryOfPayment(
      { id: "e1", invoiceNumber: "", what: "ordre 2001", counterparty: null, receivedOn: "2027-03-02", amountMinor: 10_000, currency: "EUR", method: "other", sourceKind: "shop_payment", account: 1579 },
      NO_POSTING,
      "NOK",
      { invoice: "11.5", moneyMinor: 116_240 },
    );
    expect(paid.ok && paid.entry.lines.map((l) => [l.account, l.amountMinor])).toEqual([[1579, 116_240], [1500, -115_000], [8060, -1_240]]);
    // A refund settled for less than it was owed at: a loss.
    const back = entryOfPayment(
      { id: "e2", invoiceNumber: "", what: "ordre 2001", counterparty: null, receivedOn: "2027-03-09", amountMinor: -2_000, currency: "EUR", method: "other", sourceKind: "shop_refund", account: 1579 },
      NO_POSTING,
      "NOK",
      { invoice: "11.5", moneyMinor: -23_500 },
    );
    expect(back.ok && back.entry.lines.map((l) => [l.account, l.amountMinor])).toEqual([[1579, -23_500], [1500, 23_000], [8160, 500]]);
    // A settled amount of the wrong sign, or none and no day's rate, is nothing to post from.
    expect(entryOfPayment({ id: "e3", invoiceNumber: "", what: "x", counterparty: null, receivedOn: "2027-03-02", amountMinor: 10_000, currency: "EUR", method: "other", account: 1579 }, NO_POSTING, "NOK", { invoice: "11.5", moneyMinor: -1 })).toEqual({ ok: false, problem: "currency" });
    expect(entryOfPayment({ id: "e4", invoiceNumber: "", what: "x", counterparty: null, receivedOn: "2027-03-02", amountMinor: 10_000, currency: "EUR", method: "other", account: 1579 }, NO_POSTING, "NOK", { invoice: "11.5" })).toEqual({ ok: false, problem: "currency" });
  });

  it("knows where each way of paying puts the money: a gift card or store credit spent comes off what cards owe", () => {
    expect(shopMoneyAccount({ provider: "stripe", method: null })).toEqual({ account: 1579 });
    expect(shopMoneyAccount({ provider: "manual", method: "cash" })).toEqual({ account: 1900 });
    expect(shopMoneyAccount({ provider: "manual", method: "bank_transfer" })).toEqual({ account: 1920 });
    expect(shopMoneyAccount({ provider: "manual", method: null })).toEqual({ account: 1920 });
    // A card sold is a debt (the invoice's voucher line, 2900); spending it, or store credit (itself a card), pays it off; a refund puts it back.
    expect(GIFT_CARD_ACCOUNT).toBe(2900);
    expect(shopMoneyAccount({ provider: "gift_card", method: null })).toEqual({ account: 2900 });
    expect(shopMoneyAccount({ provider: "gift_card", method: null, refundKind: "money" })).toEqual({ account: 2900 });
    expect(shopMoneyAccount({ provider: "stripe", method: null, refundKind: "store_credit" })).toEqual({ account: 2900 });
    // An exchange moves no money; ways of paying the books do not follow yet wait, never guessed into the bank.
    expect(shopMoneyAccount({ provider: "exchange", method: null })).toEqual({ skip: true });
    for (const provider of ["mollie", "venue", "terms", "something_new"]) expect(shopMoneyAccount({ provider, method: null }), provider).toEqual({ wait: "provider" });
    const spent = entryOfPayment(
      { id: "g1", invoiceNumber: "", what: "ordre 1043", counterparty: null, receivedOn: "2027-01-15", amountMinor: 20_000, currency: "NOK", method: "other", sourceKind: "shop_payment", account: GIFT_CARD_ACCOUNT },
      NO_POSTING,
      "NOK",
    );
    expect(spent.ok && spent.entry.lines.map((l) => [l.account, l.amountMinor])).toEqual([[2900, 20_000], [1500, -20_000]]);
  });

  it("posts a payout as what reached the bank and the provider's fee, against the gross out of the provider's balance", () => {
    expect(entryOfPayout({ id: "po1", day: "2027-01-16", amountMinor: 96_500, feeMinor: 3_500, provider: "stripe" })).toEqual({
      ok: true,
      entry: {
        series: "B",
        date: "2027-01-16",
        text: "Utbetaling fra Stripe",
        source: { kind: "payout", id: "po1" },
        lines: [
          { account: 1920, amountMinor: 96_500, vatCode: null },
          { account: 7770, amountMinor: 3_500, vatCode: null },
          { account: 1579, amountMinor: -100_000, vatCode: null },
        ],
      },
    });
    // A manual payout with no fee read: the bank against the balance only.
    const manual = entryOfPayout({ id: "po2", day: "2027-01-17", amountMinor: 50_000, feeMinor: 0, provider: "stripe" });
    expect(manual.ok && manual.entry.lines.map((l) => l.account)).toEqual([1920, 1579]);
    // A negative balance taken from the bank: the signs turned.
    const back = entryOfPayout({ id: "po3", day: "2027-01-18", amountMinor: -20_000, feeMinor: 0, provider: "stripe" });
    expect(back.ok && back.entry.lines.map((l) => l.amountMinor)).toEqual([-20_000, 20_000]);
    expect(entryOfPayout({ id: "po4", day: "2027-01-18", amountMinor: 0, feeMinor: 0, provider: "stripe" })).toEqual({ ok: false, problem: "nothing" });
  });
});

describe("the opening balance read from another system (step 2d)", () => {
  const acc = (number: number, atOpeningMinor: number, yearToDateMinor = 0) => ({ number, name: `Konto ${number}`, atOpeningMinor, yearToDateMinor });

  it("carries the balance sheet on 1 January, and the year's result in the profit and loss accounts during a year", () => {
    // On 1 January: the bank and the receivable against equity; last year's sales are closed, so they carry nothing.
    const january = openingBalanceOf([acc(1920, 150_000_00), acc(1500, 20_000_00), acc(2050, -170_000_00), acc(3000, 0)]);
    expect(january).toEqual({
      ok: true,
      carriedMinor: 0,
      lines: [
        { account: 1500, name: "Konto 1500", amountMinor: 20_000_00, vatCode: null },
        { account: 1920, name: "Konto 1920", amountMinor: 150_000_00, vatCode: null },
        { account: 2050, name: "Konto 2050", amountMinor: -170_000_00, vatCode: null },
      ],
    });
    // On 1 July: this year's sales and costs so far come with it, so the year's result goes on in the new books.
    const july = openingBalanceOf([acc(1920, 180_000_00), acc(2050, -150_000_00), acc(3000, -40_000_00, -40_000_00), acc(6800, 10_000_00, 10_000_00)]);
    expect(july.ok && july.lines.map((l) => [l.account, l.amountMinor])).toEqual([[1920, 180_000_00], [2050, -150_000_00], [3000, -40_000_00], [6800, 10_000_00]]);
    expect(july.ok && july.carriedMinor).toBe(0);
  });

  it("puts a result of earlier years never carried to equity there on other equity, as a line of its own, and says so", () => {
    // Last year's result (a profit of 30 000) was never closed into equity: the sales account still holds it on 1 January.
    const opened = openingBalanceOf([acc(1920, 80_000_00), acc(2050, -50_000_00), acc(3000, -30_000_00)]);
    expect(opened.ok && opened.carriedMinor).toBe(-30_000_00);
    expect(opened.ok && opened.lines.at(-1)).toEqual({ account: 2050, name: "Annen egenkapital", amountMinor: -30_000_00, vatCode: null, text: "Resultat fra tidligere år, ikke overført til egenkapital" });
    expect(opened.ok && opened.lines.reduce((sum, l) => sum + l.amountMinor, 0)).toBe(0);
  });

  it("makes nothing from a trial balance that does not balance, or from nothing at all", () => {
    expect(openingBalanceOf([acc(1920, 100_00), acc(2050, -99_00)])).toEqual({ ok: false, problem: "unbalanced", differenceMinor: 1_00 });
    expect(openingBalanceOf([])).toEqual({ ok: false, problem: "empty", differenceMinor: 0 });
    expect(openingBalanceOf([acc(1920, 0), acc(3000, 0, 0)])).toEqual({ ok: false, problem: "empty", differenceMinor: 0 });
  });

  it("reads an account of the company's own as the standard account nearest below it", () => {
    expect(nearestStandard(1920)).toBe("1920");
    expect(nearestStandard(19201)).toBe("1920");
    expect(nearestStandard(1921)).toBe("1920");
    expect(nearestStandard(7771)).toBe("7770");
    expect(nearestStandard(99)).toBeNull();
    expect(nearestStandard(123456)).toBeNull();
  });
});
