import { describe, expect, it } from "vitest";

import { entryProblems, standardAccount } from "./ledger";
import { businessSpecOf, closingEntryOf, readyToClose, YEAR_END_ACCOUNTS, yearEndChecks, type YearEndFacts } from "./year-end";

const facts: YearEndFacts = {
  year: 2026,
  today: "2027-01-20",
  waiting: 0,
  bankWaiting: 0,
  bankAtYearEnd: { day: "2026-12-31", bank: 5_000_000, books: 5_000_000 },
  receivables: 1_250_000,
  payables: 0,
};

describe("the year-end (D506)", () => {
  it("carries a profit or a loss to other equity on the year's last day, once per year", () => {
    expect(standardAccount(String(YEAR_END_ACCOUNTS.transfer))).toBeTruthy();
    expect(standardAccount(String(YEAR_END_ACCOUNTS.equity))).toBeTruthy();
    const profit = closingEntryOf(2026, 30_000_000)!;
    expect(profit).toEqual({
      series: "M",
      date: "2026-12-31",
      text: "Årsoppgjør 2026: årets overskudd til annen egenkapital",
      source: { kind: "year_end", id: "2026" },
      lines: [
        { account: 8960, amountMinor: 30_000_000, vatCode: null },
        { account: 2050, amountMinor: -30_000_000, vatCode: null },
      ],
    });
    expect(entryProblems(profit)).toEqual([]);
    expect(closingEntryOf(2026, -4_000_000)!.lines).toEqual([
      { account: 8960, amountMinor: -4_000_000, vatCode: null },
      { account: 2050, amountMinor: 4_000_000, vatCode: null },
    ]);
    expect(closingEntryOf(2026, 0)).toBeNull();
  });

  it("checks the year is over, nothing waits, the bank is in the books and agrees, and shows what is owed", () => {
    expect(yearEndChecks(facts)).toEqual([
      { key: "year_over", state: "ok", day: "2026-12-31" },
      { key: "nothing_waiting", state: "ok", count: 0 },
      { key: "bank_matched", state: "ok", count: 0 },
      { key: "bank_balance", state: "ok", amount: 0, day: "2026-12-31" },
      { key: "receivables", state: "info", amount: 1_250_000 },
      { key: "payables", state: "ok", amount: 0 },
    ]);
    expect(readyToClose(yearEndChecks(facts))).toBe(true);
    // Before the year is over, with work left, and without a statement covering its last day: not ready.
    const early = yearEndChecks({ ...facts, today: "2026-12-31", waiting: 2, bankWaiting: 14, bankAtYearEnd: null });
    expect(early.filter((c) => c.state === "todo").map((c) => c.key)).toEqual(["year_over", "nothing_waiting", "bank_matched", "bank_balance"]);
    expect(readyToClose(early)).toBe(false);
    expect(yearEndChecks({ ...facts, bankAtYearEnd: { day: "2027-01-10", bank: 5_000_000, books: 4_990_000 } })[3]).toEqual({
      key: "bank_balance",
      state: "todo",
      amount: 10_000,
      day: "2027-01-10",
    });
  });

  it("sums the year by the business specification's codes, the result not yet carried counted on other equity", () => {
    // A year: sales 500 000 (VAT), 20 000 without VAT; software 60 000, office 15 000; interest 1 000. Bank 436 000, receivables
    // 50 000, VAT owed 30 000, opening equity 10 000 (bank 10 000 at the start).
    const rows = [
      { account: 3000, movement: -50_000_000, closing: -50_000_000 },
      { account: 3200, movement: -2_000_000, closing: -2_000_000 },
      { account: 6553, movement: 6_000_000, closing: 6_000_000 },
      { account: 6800, movement: 1_500_000, closing: 1_500_000 },
      { account: 8050, movement: -100_000, closing: -100_000 },
      { account: 1920, movement: 42_600_000, closing: 43_600_000 },
      { account: 1500, movement: 5_000_000, closing: 5_000_000 },
      { account: 2740, movement: -3_000_000, closing: -3_000_000 },
      { account: 2050, movement: 0, closing: -1_000_000 },
    ];
    const open = businessSpecOf(rows);
    expect(open.result.map((l) => [l.code, l.amount])).toEqual([
      ["3000", 50_000_000],
      ["3200", 2_000_000],
      ["6350", 6_000_000],
      ["6995", 1_500_000],
      ["8050", 100_000],
    ]);
    expect([open.income, open.costs, open.resultTotal]).toEqual([52_100_000, 7_500_000, 44_600_000]);
    expect(open.balance.map((l) => [l.code, l.category, l.amount])).toEqual([
      ["1500", "balanseverdiForOmloepsmiddel", 5_000_000],
      ["1920", "balanseverdiForOmloepsmiddel", 43_600_000],
      ["2050", "egenkapital", 1_000_000 + 44_600_000],
      ["2740", "kortsiktigGjeld", 3_000_000],
    ]);
    expect(open.assets).toBe(open.equityAndLiabilities);

    // Closed: the result is on other equity by the closing entry, and the balance is the same.
    const closed = businessSpecOf([
      ...rows.map((r) => (r.account === 2050 ? { ...r, movement: -44_600_000, closing: -45_600_000 } : r)),
      { account: 8960, movement: 44_600_000, closing: 44_600_000 },
    ]);
    expect(closed.balance).toEqual(open.balance);
    expect(closed.result).toEqual(open.result);

    // A year after one never closed: the earlier result, still on the accounts, is equity, not this year's result.
    const next = businessSpecOf([
      { account: 3000, movement: -10_000_000, closing: -60_000_000 },
      { account: 1920, movement: 10_000_000, closing: 60_000_000 },
    ]);
    expect(next.result.map((l) => [l.code, l.amount])).toEqual([["3000", 10_000_000]]);
    expect(next.balance.map((l) => [l.code, l.amount])).toEqual([
      ["1920", 60_000_000],
      ["2050", 60_000_000],
    ]);
  });
});
