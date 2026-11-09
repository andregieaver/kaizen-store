import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { budgetView, MONTHS, subscriptionMonths, type ActualRow, type BudgetRow, type BudgetView } from "@/lib/budget";
import { isIncomeAccount, resultGroupOf } from "@/lib/ledger";
import { PURCHASE_KINDS } from "@/lib/purchases";

import { audit, type Membership } from "./auth";
import { recurringView } from "./recurring-costs";
import { col, typedRows } from "./typed-rows";

/**
 * Budget against actual, and a forecast, on Settings → Books (D505, `src/lib/budget.ts`): the year's budget the owner sets per account, what
 * the ledger holds per account and month, and the subscriptions of the register (D503) for the forecast. Owners set it; audited. Nothing in
 * a budget is posted.
 */

/** A year's budget rows of a book. */
export async function budgetRows(bookId: string, year: number): Promise<BudgetRow[]> {
  const rows = await typedRows(
    z.object({ account: col.int, months: z.array(z.coerce.number()) }),
    sql`select account, months from commerce.ledger_budgets where book_id = ${bookId}::uuid and year = ${year} order by account`,
  );
  return rows.filter((r) => r.months.length === MONTHS).map((r) => ({ account: r.account, months: r.months }));
}

/** What the ledger holds on each result account in each month of a year, as the profit and loss shows it (income and costs positive). */
export async function actualRows(bookId: string, year: number): Promise<ActualRow[]> {
  const rows = await typedRows(
    z.object({ account: col.int, month: col.int, amount: col.minor }),
    sql`select l.account, extract(month from e.entry_date)::int as month, coalesce(sum(l.amount_minor), 0) as amount
          from commerce.ledger_lines l join commerce.ledger_entries e on e.id = l.entry_id
         where l.book_id = ${bookId}::uuid and l.account between 3000 and 8999
           and e.entry_date between make_date(${year}, 1, 1) and make_date(${year}, 12, 31)
         group by l.account, month`,
  );
  return rows.filter((r) => resultGroupOf(r.account) !== null).map((r) => ({ account: r.account, month: r.month, amount: isIncomeAccount(r.account) ? -r.amount : r.amount }));
}

/** The month under way of a year on a day: 1 to 12, 13 for a year gone by, 0 for one not begun. */
export const monthOf = (year: number, today: string): number => {
  const [y, m] = today.split("-").map(Number);
  return y < year ? 0 : y > year ? 13 : m;
};

/** The year's budget view of a book on a day: the budget, the actual and the forecast per account, with the subscriptions in it. */
export async function budgetOf(storeId: string, bookId: string, year: number, today: string): Promise<BudgetView> {
  const [budgets, actuals, recurring] = await Promise.all([budgetRows(bookId, year), actualRows(bookId, year), recurringView(storeId, bookId, today)]);
  const subscriptions = recurring.rows.map((r) => ({ account: PURCHASE_KINDS[r.cost.kind].account, months: subscriptionMonths(r.cost, year, r.lastDay) }));
  return budgetView({ month: monthOf(year, today), budgets, actuals, subscriptions });
}

export type BudgetProblem = "account" | "year";

/** Sets an account's budget for a year (all twelve months nought removes it). Audited. */
export async function saveBudget(
  member: Membership,
  bookId: string,
  input: { year: number; account: number; months: readonly number[] },
): Promise<{ ok: true; removed: boolean } | { ok: false; problem: BudgetProblem }> {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) return { ok: false, problem: "year" };
  if (!Number.isInteger(input.account) || resultGroupOf(input.account) === null) return { ok: false, problem: "account" };
  const months = Array.from({ length: MONTHS }, (_, i) => Math.max(0, Math.round(input.months[i] ?? 0)));
  const storeId = member.store.id;
  const removed = months.every((m) => m === 0);
  if (removed) {
    await db().execute(sql`delete from commerce.ledger_budgets where store_id = ${storeId}::uuid and book_id = ${bookId}::uuid and year = ${input.year} and account = ${input.account}`);
  } else {
    const array = sql`array[${sql.join(months.map((m) => sql`${m}::bigint`), sql`, `)}]`;
    await db().execute(sql`
      insert into commerce.ledger_budgets (store_id, book_id, year, account, months, updated_by)
      values (${storeId}::uuid, ${bookId}::uuid, ${input.year}, ${input.account}, ${array}, ${member.account.id}::uuid)
      on conflict (book_id, year, account) do update set months = excluded.months, updated_by = excluded.updated_by, updated_at = now()`);
  }
  await audit(member.account.id, storeId, removed ? "work.ledger_budget_removed" : "work.ledger_budget_set", { bookId, year: input.year, account: input.account, total: months.reduce((a, b) => a + b, 0) });
  return { ok: true, removed };
}
