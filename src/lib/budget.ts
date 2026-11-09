import { isIncomeAccount, resultGroupOf } from "./ledger";
import { costLinesOf, PURCHASE_KINDS } from "./purchases";
import type { RecurringCost } from "./recurring-costs";

/**
 * Budget against actual, and a forecast (D505, subscriptions step 4). Pure: a book's budget is an amount per account and month of a year
 * (income and costs both positive, as the profit and loss shows them); the actual is what the ledger holds per account and month; the rest
 * of the year is forecast per account from its budget, else from the subscriptions posted to it (D503), else from what its months so far
 * cost on average. The month under way counts what it holds or what was expected of it, whichever is more.
 */

export const MONTHS = 12;

/** An account's budget for a year: twelve amounts, January first, in minor units of the books' currency. */
export type BudgetRow = { account: number; months: readonly number[] };
/** What the ledger holds on a result account in a month, as the profit and loss shows it (income and costs positive). */
export type ActualRow = { account: number; month: number; amount: number };

export type ForecastSource = "budget" | "subscriptions" | "run_rate";

export type BudgetLine = {
  account: number;
  income: boolean;
  /** The year's budget, or null where none is set. */
  budget: number | null;
  /** What the ledger holds this year so far. */
  actual: number;
  /** The whole year as it is likely to end. */
  forecast: number;
  source: ForecastSource;
  /** How far the forecast misses the budget the wrong way (a cost over, income short), positive; negative when better; null without budget. */
  off: number | null;
};

export type BudgetView = {
  lines: BudgetLine[];
  income: { budget: number; actual: number; forecast: number };
  costs: { budget: number; actual: number; forecast: number };
  /** Income less costs. */
  result: { budget: number; actual: number; forecast: number };
};

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The months (1 to 12) of a year in which a subscription runs: from the month it started through the month it ended. */
function runningIn(cost: Pick<RecurringCost, "startedOn" | "endedOn">, year: number, month: number): boolean {
  const first = `${year}-${pad(month)}-01`;
  const last = `${year}-${pad(month)}-${pad(lastDay(year, month))}`;
  return cost.startedOn <= last && (cost.endedOn === null || cost.endedOn >= first);
}

/**
 * What a subscription costs its account in each month of a year, as the books will post it: the cost without the VAT taken back (all of it
 * when bought abroad, D502); a monthly one every month it runs, a yearly one in the month it falls due (the month of its last charge, else
 * of its start).
 */
export function subscriptionMonths(cost: RecurringCost, year: number, lastCharge: string | null = null): number[] {
  const account = PURCHASE_KINDS[cost.kind].account;
  const each = costLinesOf(cost.amountMinor, cost.kind, cost.vatRate, cost.abroad)
    .filter((l) => l.account === account)
    .reduce((sum, l) => sum + l.amountMinor, 0);
  const dueMonth = Number((lastCharge ?? cost.startedOn).slice(5, 7));
  return Array.from({ length: MONTHS }, (_, i) => {
    const month = i + 1;
    if (!runningIn(cost, year, month)) return 0;
    return cost.every === "month" || month === dueMonth ? each : 0;
  });
}

/**
 * The year's budget lines, with what the ledger holds and the forecast: every result account with a budget, money this year or a
 * subscription, the income first. `month` is the month under way (1 to 12), or 13 for a year gone by, 0 for one not begun.
 */
export function budgetView(input: {
  month: number;
  budgets: readonly BudgetRow[];
  actuals: readonly ActualRow[];
  subscriptions: readonly { account: number; months: readonly number[] }[];
}): BudgetView {
  const accounts = new Set<number>();
  for (const b of input.budgets) accounts.add(b.account);
  for (const a of input.actuals) if (a.amount !== 0) accounts.add(a.account);
  for (const s of input.subscriptions) if (s.months.some((m) => m !== 0)) accounts.add(s.account);
  const done = Math.max(0, Math.min(MONTHS, input.month - 1));
  const lines = [...accounts]
    .filter((account) => resultGroupOf(account) !== null)
    .map((account): BudgetLine => {
      const income = isIncomeAccount(account);
      const actualBy = Array.from({ length: MONTHS }, (_, i) => input.actuals.filter((a) => a.account === account && a.month === i + 1).reduce((sum, a) => sum + a.amount, 0));
      const budgetRow = input.budgets.find((b) => b.account === account) ?? null;
      const subs = input.subscriptions.filter((s) => s.account === account);
      const source: ForecastSource = budgetRow ? "budget" : subs.length > 0 ? "subscriptions" : "run_rate";
      const runRate = done > 0 ? Math.round(actualBy.slice(0, done).reduce((a, b) => a + b, 0) / done) : 0;
      const expected = (i: number) =>
        source === "budget" ? (budgetRow!.months[i] ?? 0) : source === "subscriptions" ? subs.reduce((sum, s) => sum + (s.months[i] ?? 0), 0) : runRate;
      let forecast = 0;
      for (let i = 0; i < MONTHS; i++) {
        const month = i + 1;
        if (month < input.month) forecast += actualBy[i];
        else if (month === input.month) forecast += Math.max(actualBy[i], expected(i));
        else forecast += expected(i);
      }
      const actual = actualBy.reduce((a, b) => a + b, 0);
      const budget = budgetRow ? budgetRow.months.reduce((a, b) => a + b, 0) : null;
      return { account, income, budget, actual, forecast, source, off: budget === null ? null : income ? budget - forecast : forecast - budget };
    })
    .sort((a, b) => Number(b.income) - Number(a.income) || a.account - b.account);
  const sum = (rows: BudgetLine[]) => ({
    budget: rows.reduce((s, l) => s + (l.budget ?? 0), 0),
    actual: rows.reduce((s, l) => s + l.actual, 0),
    forecast: rows.reduce((s, l) => s + l.forecast, 0),
  });
  const incomeSum = sum(lines.filter((l) => l.income));
  const costSum = sum(lines.filter((l) => !l.income));
  return {
    lines,
    income: incomeSum,
    costs: costSum,
    result: { budget: incomeSum.budget - costSum.budget, actual: incomeSum.actual - costSum.actual, forecast: incomeSum.forecast - costSum.forecast },
  };
}

/** Twelve months from a form: one amount for every month, or each month on its own where given (`month-1` … `month-12`). */
export function budgetMonthsOf(
  raw: { each: unknown; months: readonly unknown[] },
  currency: string,
  parse: (text: string, currency: string) => number | null,
): number[] | null {
  const each = String(raw.each ?? "").trim();
  const own = Array.from({ length: MONTHS }, (_, i) => String(raw.months[i] ?? "").trim());
  if (own.some((m) => m !== "")) {
    const months = own.map((m) => (m === "" ? 0 : parse(m, currency)));
    return months.every((m): m is number => m !== null && m >= 0) ? months : null;
  }
  if (each === "") return null;
  const amount = parse(each, currency);
  return amount === null || amount < 0 ? null : Array.from({ length: MONTHS }, () => amount);
}
