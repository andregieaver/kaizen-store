import { LEDGER_SERIES, UNCARRIED_RESULT_ACCOUNT, type LedgerEntryInput } from "./ledger";
import { groupingOf } from "./saft";

/**
 * The year-end (B5 step 3, D506). Pure: what must be done before a year is closed and whether it is, the entry that carries the year's
 * result to equity, and the year's figures by the codes of Skatteetaten's business specification (*næringsspesifikasjon*, the same codes
 * the SAF-T file groups each account under, `groupingOf()`), which the business's tax return asks for.
 */

/** Where a year's result goes: *Overføringer annen egenkapital* against *Annen egenkapital* (NS 4102), a profit or a loss alike. */
export const YEAR_END_ACCOUNTS = { transfer: 8960, equity: UNCARRIED_RESULT_ACCOUNT } as const;

/** The source a closing entry is posted under: one standing entry per book and year (`ledger_post()` keeps it once). */
export const YEAR_END_SOURCE = "year_end";

export const lastDayOf = (year: number) => `${year}-12-31`;

/** The entry that carries a year's result (a profit positive) to equity on the year's last day; none for a year that came out even. */
export function closingEntryOf(year: number, resultMinor: number): LedgerEntryInput | null {
  if (!Number.isInteger(resultMinor) || resultMinor === 0) return null;
  return {
    series: LEDGER_SERIES.manual,
    date: lastDayOf(year),
    text: resultMinor > 0 ? `Årsoppgjør ${year}: årets overskudd til annen egenkapital` : `Årsoppgjør ${year}: årets underskudd mot annen egenkapital`,
    source: { kind: YEAR_END_SOURCE, id: String(year) },
    lines: [
      { account: YEAR_END_ACCOUNTS.transfer, amountMinor: resultMinor, vatCode: null },
      { account: YEAR_END_ACCOUNTS.equity, amountMinor: -resultMinor, vatCode: null },
    ],
  };
}

export const YEAR_END_CHECKS = ["year_over", "nothing_waiting", "bank_matched", "bank_balance", "receivables", "payables"] as const;
export type YearEndCheckKey = (typeof YEAR_END_CHECKS)[number];

/** A check: `ok`, `todo` (must be done before the year is closed) or `info` (worth a look, never in the way). */
export type YearEndCheck = { key: YearEndCheckKey; state: "ok" | "todo" | "info"; count?: number; amount?: number; day?: string };

export type YearEndFacts = {
  year: number;
  today: string;
  /** Documents waiting to be posted (`ledger_waiting`), any day. */
  waiting: number;
  /** Lines of the year's bank statements the books do not have yet. */
  bankWaiting: number;
  /** The bank's own balance on a statement ending on or after the year's last day, and the books' bank account on that day; null without one. */
  bankAtYearEnd: { day: string; bank: number; books: number } | null;
  /** What customers owe and what the store owes its suppliers on the year's last day. */
  receivables: number;
  payables: number;
};

/**
 * The year-end's checks, in order: the year is over; nothing waits to be posted; every bank line of the year is in the books; the bank's
 * balance at the year's end agrees with the books (a statement covering the last day is needed); then what customers still owe (lost ones
 * written off first, D500) and what is owed to suppliers, both only to look at.
 */
export function yearEndChecks(f: YearEndFacts): YearEndCheck[] {
  const end = lastDayOf(f.year);
  const bank = f.bankAtYearEnd;
  return [
    { key: "year_over", state: f.today > end ? "ok" : "todo", day: end },
    { key: "nothing_waiting", state: f.waiting === 0 ? "ok" : "todo", count: f.waiting },
    { key: "bank_matched", state: f.bankWaiting === 0 ? "ok" : "todo", count: f.bankWaiting },
    bank === null
      ? { key: "bank_balance", state: "todo" }
      : { key: "bank_balance", state: bank.bank === bank.books ? "ok" : "todo", amount: bank.bank - bank.books, day: bank.day },
    { key: "receivables", state: f.receivables === 0 ? "ok" : "info", amount: f.receivables },
    { key: "payables", state: f.payables === 0 ? "ok" : "info", amount: f.payables },
  ];
}

/** Whether a year may be closed: every check that must be done is. */
export const readyToClose = (checks: readonly YearEndCheck[]): boolean => checks.every((c) => c.state !== "todo");

export type SpecLine = { code: string; category: string; nb: string; en: string; amount: number };

export type BusinessSpec = {
  /** The profit and loss by code: income and costs both positive. */
  result: SpecLine[];
  /** The balance on the year's last day by code: assets positive, equity and liabilities positive. */
  balance: SpecLine[];
  income: number;
  costs: number;
  /** Income less costs: the year's result. */
  resultTotal: number;
  assets: number;
  equityAndLiabilities: number;
};

const INCOME = new Set(["salgsinntekt", "annenDriftsinntekt", "finansinntekt"]);
const COSTS = new Set(["varekostnad", "loennskostnad", "annenDriftskostnad", "finanskostnad", "skattekostnad"]);
const ASSETS = new Set(["balanseverdiForAnleggsmiddel", "balanseverdiForOmloepsmiddel"]);
const EQUITY_AND_LIABILITIES = new Set(["egenkapital", "langsiktigGjeld", "kortsiktigGjeld"]);

/**
 * The year's business specification from its trial balance (debits positive): each profit and loss account's movement in the year and
 * each balance account's balance on its last day, summed by the code its account is grouped under. A result not yet carried to equity
 * (the year not closed, or earlier ones) is counted on other equity, so the balance sums as it will once closed. Accounts without a code
 * (the result's own allocation, 88xx and 89xx) are left out, as the specification has them in the equity they moved.
 */
export function businessSpecOf(rows: readonly { account: number; standard?: string | null; movement: number; closing: number }[]): BusinessSpec {
  const result = new Map<string, SpecLine>();
  const balance = new Map<string, SpecLine>();
  let uncarried = 0;
  for (const r of rows) {
    const grouping = groupingOf(r.account, r.standard);
    const head = Number(String(r.account).slice(0, 4));
    if (head >= 8800) {
      // The allocation of results (8800 to 8999): what it moved is already in equity; what it holds of earlier years is not.
      uncarried -= r.closing;
      continue;
    }
    if (!grouping) continue;
    if (INCOME.has(grouping.category) || COSTS.has(grouping.category)) {
      const amount = INCOME.has(grouping.category) ? -r.movement : r.movement;
      // Earlier years' results on these accounts, never carried to equity, are equity now.
      uncarried -= r.closing - r.movement;
      if (amount === 0) continue;
      const line = result.get(grouping.code) ?? { ...grouping, amount: 0 };
      line.amount += amount;
      result.set(grouping.code, line);
    } else if (ASSETS.has(grouping.category) || EQUITY_AND_LIABILITIES.has(grouping.category)) {
      const amount = ASSETS.has(grouping.category) ? r.closing : -r.closing;
      if (amount === 0) continue;
      const line = balance.get(grouping.code) ?? { ...grouping, amount: 0 };
      line.amount += amount;
      balance.set(grouping.code, line);
    }
  }
  const resultLines = [...result.values()].sort((a, b) => a.code.localeCompare(b.code));
  const income = resultLines.filter((l) => INCOME.has(l.category)).reduce((s, l) => s + l.amount, 0);
  const costs = resultLines.filter((l) => COSTS.has(l.category)).reduce((s, l) => s + l.amount, 0);
  // Every result not carried to equity, this year's among them, on other equity.
  const open = uncarried + (income - costs);
  if (open !== 0) {
    const equity = groupingOf(UNCARRIED_RESULT_ACCOUNT);
    if (equity) {
      const line = balance.get(equity.code) ?? { ...equity, amount: 0 };
      line.amount += open;
      balance.set(equity.code, line);
    }
  }
  const balanceLines = [...balance.values()].filter((l) => l.amount !== 0).sort((a, b) => a.code.localeCompare(b.code));
  return {
    result: resultLines,
    balance: balanceLines,
    income,
    costs,
    resultTotal: income - costs,
    assets: balanceLines.filter((l) => ASSETS.has(l.category)).reduce((s, l) => s + l.amount, 0),
    equityAndLiabilities: balanceLines.filter((l) => EQUITY_AND_LIABILITIES.has(l.category)).reduce((s, l) => s + l.amount, 0),
  };
}
