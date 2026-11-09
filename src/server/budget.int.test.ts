import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const budget = await import("./budget");
const { postLedgerEntry } = await import("./ledger");
const { LEDGER_SERIES } = await import("@/lib/ledger");
const { saveRecurringCost } = await import("./recurring-costs");

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * Budget against actual, and a forecast (D505), against a real database: what the ledger holds per account and month (income and costs
 * positive), a budget set, changed and removed, and the forecast taking a subscription for an account without a budget.
 */

const run = Date.now().toString(36);
afterAll(async () => closeDb());

async function books(): Promise<{ storeId: string; bookId: string; member: Membership }> {
  const name = `budget-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Budsjett') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Budsjett', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const [book] = await db().execute<Row>(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, 'Budsjett AS', 'NO', 'NOK', '2026-01-01', ${String(owner.id)}::uuid) returning id`);
  const bookId = String(book.id);
  await db().execute(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
    select ${storeId}::uuid, ${bookId}::uuid, n, 'Account ' || n, n::text, k
      from (values (1920, 'asset'), (3000, 'income'), (6553, 'expense'), (6800, 'expense'), (2710, 'liability')) as a(n, k)`);
  return { storeId, bookId, member: { account: { id: String(owner.id) }, store: { id: storeId } } as unknown as Membership };
}

describe("budget and forecast (D505)", () => {
  it("reads the year's actuals, keeps a budget, and forecasts the rest of the year", async () => {
    const { storeId, bookId, member } = await books();
    const entry = (date: string, account: number, amount: number) =>
      postLedgerEntry(bookId, {
        series: LEDGER_SERIES.manual,
        date,
        text: "Test",
        source: null,
        lines: [
          { account, amountMinor: amount, vatCode: null },
          { account: 1920, amountMinor: -amount, vatCode: null },
        ],
      }, member.account.id);
    expect((await entry("2026-01-10", 3000, -500_000)).ok).toBe(true);
    expect((await entry("2026-02-10", 3000, -300_000)).ok).toBe(true);
    expect((await entry("2026-02-12", 6800, 40_000)).ok).toBe(true);
    expect((await entry("2025-12-30", 6800, 99_000)).ok).toBe(false);

    expect(await budget.actualRows(bookId, 2026)).toEqual(
      expect.arrayContaining([
        { account: 3000, month: 1, amount: 500_000 },
        { account: 3000, month: 2, amount: 300_000 },
        { account: 6800, month: 2, amount: 40_000 },
      ]),
    );

    expect(await budget.saveBudget(member, bookId, { year: 2026, account: 3000, months: Array(12).fill(400_000) })).toEqual({ ok: true, removed: false });
    expect(await budget.saveBudget(member, bookId, { year: 2026, account: 3000, months: Array(12).fill(450_000) })).toEqual({ ok: true, removed: false });
    expect(await budget.saveBudget(member, bookId, { year: 2026, account: 1920, months: Array(12).fill(1) })).toEqual({ ok: false, problem: "account" });
    expect(await budget.budgetRows(bookId, 2026)).toEqual([{ account: 3000, months: Array(12).fill(450_000) }]);
    await saveRecurringCost(member, { name: "Claude Max", matchText: "ANTHROPIC", kind: "software", vatRate: 0, abroad: true, every: "month", amountMinor: 220_000, startedOn: "2026-02-01" }, "NOK");

    // In March: sales from the budget, software from the subscription, office supplies from February's average.
    const view = await budget.budgetOf(storeId, bookId, 2026, "2026-03-05");
    expect(view.lines.map((l) => [l.account, l.budget, l.actual, l.forecast, l.source])).toEqual([
      [3000, 5_400_000, 800_000, 800_000 + 450_000 * 10, "budget"],
      [6553, null, 0, 220_000 * 10, "subscriptions"],
      [6800, null, 40_000, 40_000 + 20_000 * 10, "run_rate"],
    ]);

    expect(await budget.saveBudget(member, bookId, { year: 2026, account: 3000, months: Array(12).fill(0) })).toEqual({ ok: true, removed: true });
    expect(await budget.budgetRows(bookId, 2026)).toEqual([]);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action like 'work.ledger_budget_%'`);
    expect(audited.n).toBe(3);
  });
});
