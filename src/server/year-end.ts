import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { profitAndLoss, type ProfitAndLoss } from "@/lib/ledger";
import {
  businessSpecOf,
  closingEntryOf,
  lastDayOf,
  readyToClose,
  YEAR_END_ACCOUNTS,
  YEAR_END_SOURCE,
  yearEndChecks,
  type BusinessSpec,
  type YearEndCheck,
  type YearEndFacts,
} from "@/lib/year-end";

import { audit, type Membership } from "./auth";
import { BANK_ACCOUNT } from "./bank-statements";
import { addLedgerAccount, ledgerAccounts, ledgerTrialBalance, openBookOf, postLedgerEntry, reverseLedgerEntry, type LedgerBook } from "./ledger";
import { log } from "./log";
import { col, typedRow } from "./typed-rows";

/**
 * The year-end on Settings → Books (B5 step 3, D506, `src/lib/year-end.ts`): what must be done before a year is closed, the year's result,
 * closing it (its result carried to other equity on its last day, then the year locked) and reopening it, and its business specification.
 * Owners close and reopen; audited.
 */

export type YearEndView = {
  year: number;
  checks: YearEndCheck[];
  ready: boolean;
  pl: ProfitAndLoss;
  spec: BusinessSpec;
  /** The standing closing entry, when the year is closed with a result. */
  closed: { entryId: string | null; result: number } | null;
};

/** The year's standing closing entry, if any. */
async function closingEntry(bookId: string, year: number): Promise<{ id: string } | null> {
  return typedRow(
    z.object({ id: col.uuid }),
    sql`select e.id from commerce.ledger_entries e
         where e.book_id = ${bookId}::uuid and e.source_kind = ${YEAR_END_SOURCE} and e.source_id = ${String(year)} and e.reverses is null
           and not exists (select 1 from commerce.ledger_entries r where r.reverses = e.id)`,
  );
}

/** The days of a year the book holds: from its first day or the year's, through the year's last. */
const yearDays = (book: Pick<LedgerBook, "openedOn">, year: number) => ({ from: book.openedOn > `${year}-01-01` ? book.openedOn : `${year}-01-01`, to: lastDayOf(year) });

/** What the checks need from the books on a day. */
async function factsOf(book: LedgerBook, year: number, today: string): Promise<YearEndFacts> {
  const { from, to } = yearDays(book, year);
  const row = await typedRow(
    z.object({ waiting: col.int, bank_waiting: col.int, receivables: col.minor, payables: col.minor }),
    sql`select
          (select count(*)::int from commerce.ledger_waiting where book_id = ${book.id}::uuid) as waiting,
          (select count(*)::int from commerce.bank_lines where book_id = ${book.id}::uuid and ledger_account = ${BANK_ACCOUNT}
              and entry_id is null and payment_ref is null and booked_on between ${from}::date and ${to}::date) as bank_waiting,
          coalesce((select sum(l.amount_minor) from commerce.ledger_lines l join commerce.ledger_entries e on e.id = l.entry_id
              where l.book_id = ${book.id}::uuid and l.account between 1500 and 1599 and e.entry_date <= ${to}::date), 0) as receivables,
          coalesce((select -sum(l.amount_minor) from commerce.ledger_lines l join commerce.ledger_entries e on e.id = l.entry_id
              where l.book_id = ${book.id}::uuid and l.account between 2400 and 2499 and e.entry_date <= ${to}::date), 0) as payables`,
  );
  // The first statement covering the year's last day: its own closing balance against the books' bank account on its last day.
  const bank = await typedRow(
    z.object({ day: col.text, bank: col.minor, books: col.minor }),
    sql`select s.to_day::text as day, s.closing_minor as bank,
               coalesce((select sum(l.amount_minor) from commerce.ledger_lines l join commerce.ledger_entries e on e.id = l.entry_id
                          where e.book_id = s.book_id and l.account = ${BANK_ACCOUNT} and e.entry_date <= s.to_day), 0) as books
          from commerce.bank_statements s
         where s.book_id = ${book.id}::uuid and s.closing_minor is not null and s.to_day >= ${to}::date and s.from_day <= ${to}::date
         order by s.to_day, s.imported_at desc limit 1`,
  );
  return {
    year,
    today,
    waiting: row?.waiting ?? 0,
    bankWaiting: row?.bank_waiting ?? 0,
    bankAtYearEnd: bank,
    receivables: row?.receivables ?? 0,
    payables: row?.payables ?? 0,
  };
}

/** A year's year-end as it stands: its checks, its result, whether it is closed, and its business specification. */
export async function yearEndView(storeId: string, book: LedgerBook, year: number, today: string): Promise<YearEndView> {
  const { from, to } = yearDays(book, year);
  const [facts, tb, chart, entry] = await Promise.all([factsOf(book, year, today), ledgerTrialBalance(book.id, from, to), ledgerAccounts(book.id), closingEntry(book.id, year)]);
  const standard = new Map(chart.map((a) => [a.number, a.standard]));
  const pl = profitAndLoss(tb.rows);
  const spec = businessSpecOf(tb.rows.map((r) => ({ account: r.account, standard: standard.get(r.account) ?? null, movement: r.debit + r.credit, closing: r.after })));
  const checks = yearEndChecks(facts);
  // A year that came out even has no entry: it is closed once it is locked.
  const closed = entry ? { entryId: entry.id, result: pl.result } : pl.result === 0 && book.lockedThrough !== null && book.lockedThrough >= to ? { entryId: null, result: 0 } : null;
  return { year, checks, ready: readyToClose(checks), pl, spec, closed };
}

/**
 * The year a store's year-end is about on a day: the first year of the book not closed that has ended, else the year under way (to get
 * ready for). Closing goes year by year.
 */
export async function yearEndYear(book: LedgerBook, today: string): Promise<number> {
  const current = Number(today.slice(0, 4));
  for (let year = Number(book.openedOn.slice(0, 4)); year < current; year++) {
    const entry = await closingEntry(book.id, year);
    if (!entry && !(book.lockedThrough !== null && book.lockedThrough >= lastDayOf(year))) return year;
  }
  return current;
}

export type CloseProblem = "no_book" | "year" | "not_ready" | "later_locked" | "post";

/** Moves the book's lock (audited), as the lock card does. */
async function setLock(member: Membership, bookId: string, day: string | null, why: string): Promise<void> {
  await db().execute(sql`update commerce.ledger_books set locked_through = ${day}::date, updated_at = now() where id = ${bookId}::uuid and store_id = ${member.store.id}::uuid`);
  await audit(member.account.id, member.store.id, "work.ledger_locked", { bookId, through: day, why });
}

/**
 * Closes a year: once it is over and ready (nothing waits, the bank is in the books and agrees), its result is carried to other equity on
 * its last day (`closingEntryOf()`) and the book is locked through that day. Closing a closed year does nothing more. A lock already on the
 * last day is stepped back a day for the entry and put back; one in a later year refuses.
 */
export async function closeYear(member: Membership, year: number, today: string): Promise<{ ok: true; result: number } | { ok: false; problem: CloseProblem }> {
  const book = await openBookOf(member.store.id);
  if (!book) return { ok: false, problem: "no_book" };
  const end = lastDayOf(year);
  if (!Number.isInteger(year) || end < book.openedOn || today <= end) return { ok: false, problem: "year" };
  if (book.lockedThrough !== null && book.lockedThrough > end) return { ok: false, problem: "later_locked" };
  const view = await yearEndView(member.store.id, book, year, today);
  if (view.closed) return { ok: true, result: view.closed.result };
  if (!view.ready) return { ok: false, problem: "not_ready" };
  const entry = closingEntryOf(year, view.pl.result);
  if (entry) {
    const have = new Set((await ledgerAccounts(book.id)).map((a) => a.number));
    for (const number of [YEAR_END_ACCOUNTS.transfer, YEAR_END_ACCOUNTS.equity]) if (!have.has(number)) await addLedgerAccount(member.store.id, book.id, { number });
    if (book.lockedThrough === end) await setLock(member, book.id, `${year}-12-30`, "year_end");
    const posted = await postLedgerEntry(book.id, entry, member.account.id);
    if (!posted.ok) {
      log("warn", "ledger.year_end_refused", { storeId: member.store.id, bookId: book.id, year, problems: posted.problems.join(",") });
      if (book.lockedThrough === end) await setLock(member, book.id, end, "year_end");
      return { ok: false, problem: "post" };
    }
  }
  await setLock(member, book.id, end, "year_end");
  await audit(member.account.id, member.store.id, "work.ledger_year_closed", { bookId: book.id, year, result: view.pl.result });
  return { ok: true, result: view.pl.result };
}

/**
 * Reopens a closed year: the book's lock goes back to the year before's last day (or off, for its first year), and the closing entry is
 * reversed on its own day, so the year can be put right and closed again. A lock in a later year refuses.
 */
export async function reopenYear(member: Membership, year: number): Promise<{ ok: true } | { ok: false; problem: CloseProblem | "not_closed" }> {
  const book = await openBookOf(member.store.id);
  if (!book) return { ok: false, problem: "no_book" };
  const end = lastDayOf(year);
  if (book.lockedThrough !== null && book.lockedThrough > end) return { ok: false, problem: "later_locked" };
  const entry = await closingEntry(book.id, year);
  if (!entry && !(book.lockedThrough !== null && book.lockedThrough >= end)) return { ok: false, problem: "not_closed" };
  const before = lastDayOf(year - 1);
  await setLock(member, book.id, before >= book.openedOn ? before : null, "year_reopened");
  if (entry) {
    const reversed = await reverseLedgerEntry(member, entry.id, end);
    if (!reversed.ok) return { ok: false, problem: "post" };
  }
  await audit(member.account.id, member.store.id, "work.ledger_year_reopened", { bookId: book.id, year });
  return { ok: true };
}
