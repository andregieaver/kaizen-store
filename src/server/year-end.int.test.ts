import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const yearEnd = await import("./year-end");
const ledger = await import("./ledger");
const { importBankStatement } = await import("./bank-statements");
const { LEDGER_SERIES } = await import("@/lib/ledger");

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * The year-end (D506) against a real database: a year not over or not ready is refused; once its bank is in the books and agrees, it is
 * closed with its result carried to other equity on its last day and the book locked through it; closing again does nothing more; its
 * business specification sums as the books do; reopened, the lock steps back and the closing entry is reversed, and it closes again.
 */

const run = Date.now().toString(36);
afterAll(async () => closeDb());

async function books(): Promise<{ storeId: string; bookId: string; member: Membership }> {
  const name = `yearend-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Årsoppgjør') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Årsoppgjør', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const [book] = await db().execute<Row>(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, 'Årsoppgjør ENK', 'NO', 'NOK', '2025-01-01', ${String(owner.id)}::uuid) returning id`);
  const bookId = String(book.id);
  await db().execute(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
    select ${storeId}::uuid, ${bookId}::uuid, n, 'Account ' || n, n::text, k
      from (values (1920, 'asset'), (3000, 'income'), (6800, 'expense')) as a(n, k)`);
  return { storeId, bookId, member: { account: { id: String(owner.id) }, store: { id: storeId } } as unknown as Membership };
}

describe("the year-end (D506)", () => {
  it("closes a ready year with its result on other equity, locks it, and reopens it", async () => {
    const { storeId, bookId, member } = await books();
    const post = (date: string, account: number, amount: number) =>
      ledger.postLedgerEntry(
        bookId,
        { series: LEDGER_SERIES.manual, date, text: "Test", source: null, lines: [{ account, amountMinor: amount, vatCode: null }, { account: 1920, amountMinor: -amount, vatCode: null }] },
        member.account.id,
      );
    expect((await post("2025-03-10", 3000, -800_000)).ok).toBe(true);
    expect((await post("2025-06-10", 6800, 300_000)).ok).toBe(true);

    const book = (await ledger.openBookOf(storeId))!;
    expect(await yearEnd.yearEndYear(book, "2026-01-15")).toBe(2025);
    // Not over yet; then over, but without a statement covering its last day.
    expect(await yearEnd.closeYear(member, 2025, "2025-12-31")).toEqual({ ok: false, problem: "year" });
    expect(await yearEnd.closeYear(member, 2025, "2026-01-15")).toEqual({ ok: false, problem: "not_ready" });
    let view = await yearEnd.yearEndView(storeId, book, 2025, "2026-01-15");
    expect(view.checks.find((c) => c.key === "bank_balance")).toEqual({ key: "bank_balance", state: "todo" });
    expect(view.pl.result).toBe(500_000);
    expect(view.spec.result.map((l) => [l.code, l.amount])).toEqual([
      ["3000", 800_000],
      ["6995", 300_000],
    ]);
    expect(view.spec.assets).toBe(view.spec.equityAndLiabilities);

    // The year's statement: its balance on the last day (5 000 NOK) agrees with the books, every line matched.
    const camt = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
      <Acct><Id><IBAN>NO9386011117947</IBAN></Id><Ccy>NOK</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="NOK">0.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2025-01-01</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="NOK">5000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2025-12-31</Dt></Dt></Bal>
      <Ntry><Amt Ccy="NOK">8000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2025-03-10</Dt></BookgDt><AcctSvcrRef>${run}-in</AcctSvcrRef><AddtlNtryInf>Innbetaling</AddtlNtryInf></Ntry>
      <Ntry><Amt Ccy="NOK">3000.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2025-06-10</Dt></BookgDt><AcctSvcrRef>${run}-out</AcctSvcrRef><AddtlNtryInf>Kontorrekvisita</AddtlNtryInf></Ntry>
    </Stmt></BkToCstmrStmt></Document>`;
    expect(await importBankStatement(member, { name: "konto-2025.xml", bytes: new TextEncoder().encode(camt) })).toMatchObject({ ok: true });
    view = await yearEnd.yearEndView(storeId, book, 2025, "2026-01-15");
    expect(view.checks.find((c) => c.key === "bank_balance")).toMatchObject({ state: "ok", amount: 0 });
    expect(view.ready).toBe(true);

    expect(await yearEnd.closeYear(member, 2025, "2026-01-15")).toEqual({ ok: true, result: 500_000 });
    const lines = await db().execute<Row>(sql`
      select e.entry_date::text as day, l.account, l.amount_minor::int as amount from commerce.ledger_entries e join commerce.ledger_lines l on l.entry_id = e.id
       where e.book_id = ${bookId}::uuid and e.source_kind = 'year_end' order by l.line`);
    expect(lines.map((l) => [l.day, l.account, l.amount])).toEqual([
      ["2025-12-31", 8960, 500_000],
      ["2025-12-31", 2050, -500_000],
    ]);
    const locked = (await ledger.openBookOf(storeId))!;
    expect(locked.lockedThrough).toBe("2025-12-31");
    // Closed: the same result, the balance as before, nothing posted twice, and the next year is the one to get ready.
    const closed = await yearEnd.yearEndView(storeId, locked, 2025, "2026-01-15");
    expect(closed.closed).toEqual({ entryId: expect.any(String), result: 500_000 });
    expect(closed.spec.balance).toEqual(view.spec.balance);
    expect(await yearEnd.closeYear(member, 2025, "2026-01-16")).toEqual({ ok: true, result: 500_000 });
    expect(await yearEnd.yearEndYear(locked, "2026-01-15")).toBe(2026);

    // Reopened: unlocked, the entry reversed; and closed again with a new entry.
    expect(await yearEnd.reopenYear(member, 2025)).toEqual({ ok: true });
    const reopened = (await ledger.openBookOf(storeId))!;
    expect(reopened.lockedThrough).toBeNull();
    expect((await yearEnd.yearEndView(storeId, reopened, 2025, "2026-01-15")).closed).toBeNull();
    expect(await yearEnd.closeYear(member, 2025, "2026-01-15")).toEqual({ ok: true, result: 500_000 });
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.ledger_entries where book_id = ${bookId}::uuid and source_kind = 'year_end'`);
    expect(count.n).toBe(2);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action in ('work.ledger_year_closed', 'work.ledger_year_reopened')`);
    expect(audited.n).toBe(3);
  });
});
