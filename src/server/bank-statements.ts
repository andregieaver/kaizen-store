import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { matchBankLines, readStatement, type StatementProblem } from "@/lib/bank-statement";
import { entryName } from "@/lib/ledger";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Bank statements in a store's books (B4 route 1 of `docs/own-books-and-sales.md`, D486): the owner uploads the bank's file (camt.053 or a
 * netbank's CSV, read by `readStatement()`), its lines are kept once per account, and each is matched to the entry of the books that moved
 * the same money on the bank's account (`matchBankLines()`): the same amount to the øre, at most four days apart, one to one. What is left
 * on either side is what the owner looks at. Matching runs again as the books post (`runLedgerPosting()`), as a payout's entry may come after
 * the statement that shows it. Reads only what the owner gives; writes nothing to the bank.
 */

/** The bank's account in the books (NS 4102's 1920), the one a statement is matched to while a store keeps one. */
export const BANK_ACCOUNT = 1920;

/**
 * The largest file read: a year of a busy account's statement is far below it, and it fits the admin's form, whose request may be 4 MB
 * (`serverActions.bodySizeLimit`, under Vercel's 4.5 MB for a function's request).
 */
export const STATEMENT_BYTES = 3 * 1024 * 1024;

export type ImportProblem = StatementProblem | "book" | "too_big" | "book_currency";

export type ImportResult =
  | { ok: true; statementId: string; lines: number; newLines: number; matched: number }
  | { ok: false; problem: ImportProblem; currency?: string };

const BOOK = z.object({ id: col.uuid, currency: col.currency });

async function openBook(storeId: string): Promise<{ id: string; currency: string } | null> {
  return typedRow(BOOK, sql`select id, currency from commerce.ledger_books where store_id = ${storeId}::uuid and closed_on is null`);
}

/**
 * Reads a statement file into the store's open books (the owner's upload on Settings → Books): refused whole when it cannot be read, or is
 * in another currency than the books'. Its lines already kept (a statement uploaded twice, or two that overlap) are kept once. Then every
 * line not matched yet is matched to the books, and the upload is written in the activity log.
 */
export async function importBankStatement(member: Membership, file: { name: string; bytes: Uint8Array }): Promise<ImportResult> {
  const storeId = member.store.id;
  if (file.bytes.length > STATEMENT_BYTES) return { ok: false, problem: "too_big" };
  const book = await openBook(storeId);
  if (!book) return { ok: false, problem: "book" };
  const read = readStatement(file.bytes, book.currency);
  if (!read.ok) return { ok: false, problem: read.problem };
  const statement = read.statement;
  if (statement.currency !== book.currency) return { ok: false, problem: "book_currency", currency: statement.currency };
  const name = file.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "statement";
  const kept = await db().transaction(async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.bank_statements (store_id, book_id, ledger_account, file_name, format, account_ref, currency, from_day, to_day,
        opening_minor, closing_minor, lines, new_lines, imported_by)
      values (${storeId}::uuid, ${book.id}::uuid, ${BANK_ACCOUNT}, ${name}, ${statement.format}, ${statement.account?.slice(0, 64) ?? null},
        ${statement.currency}, ${statement.fromDay}::date, ${statement.toDay}::date, ${statement.openingMinor}, ${statement.closingMinor},
        ${statement.lines.length}, 0, ${member.account.id}::uuid)
      returning id`);
    const statementId = String(row.id);
    const lines = statement.lines.map((l) => ({
      key: l.key,
      day: l.bookedOn,
      amount: l.amountMinor,
      currency: l.currency,
      text: l.text,
      reference: l.reference,
      counterparty: l.counterparty,
    }));
    const added = await tx.execute<{ id: string }>(sql`
      insert into commerce.bank_lines (store_id, book_id, statement_id, ledger_account, line_key, booked_on, amount_minor, currency, text, reference, counterparty)
      select ${storeId}::uuid, ${book.id}::uuid, ${statementId}::uuid, ${BANK_ACCOUNT}, l.key, l.day::date, l.amount, l.currency, l.text, l.reference, l.counterparty
        from jsonb_to_recordset(${JSON.stringify(lines)}::jsonb)
             as l(key text, day text, amount bigint, currency text, text text, reference text, counterparty text)
      on conflict (book_id, ledger_account, line_key) do nothing
      returning id`);
    await tx.execute(sql`update commerce.bank_statements set new_lines = ${added.length} where id = ${statementId}::uuid`);
    return { statementId, newLines: added.length };
  });
  const matched = await matchBankStatement(storeId, book.id);
  await audit(member.account.id, storeId, "work.bank_statement_imported", { lines: statement.lines.length, new: kept.newLines, matched, format: statement.format }, {
    target: { type: "bank_statement", id: kept.statementId },
  });
  return { ok: true, statementId: kept.statementId, lines: statement.lines.length, newLines: kept.newLines, matched };
}

const UNMATCHED_BANK = z.object({ id: col.uuid, day: col.text, amount_minor: col.minor });
const UNMATCHED_BOOKS = z.object({ entry_id: col.uuid, day: col.text, amount_minor: col.minor });

/**
 * Matches a book's bank lines not matched yet to the lines of its entries on the bank's account not matched yet (an entry that stands:
 * neither reversed nor a reversal), one to one (`matchBankLines()`). Returns how many were matched now.
 */
export async function matchBankStatement(storeId: string, bookId: string): Promise<number> {
  // A line matched to an entry since reversed is the bank's money the books no longer hold: it waits again.
  await db().execute(sql`
    update commerce.bank_lines b set entry_id = null, matched_at = null
     where b.book_id = ${bookId}::uuid and b.store_id = ${storeId}::uuid and b.entry_id is not null
       and exists (select 1 from commerce.ledger_entries r where r.reverses = b.entry_id)`);
  const [bank, books] = await Promise.all([
    typedRows(
      UNMATCHED_BANK,
      sql`select id, booked_on::text as day, amount_minor from commerce.bank_lines
           where book_id = ${bookId}::uuid and ledger_account = ${BANK_ACCOUNT} and entry_id is null`,
    ),
    typedRows(
      UNMATCHED_BOOKS,
      sql`
        select e.id as entry_id, e.entry_date::text as day, sum(l.amount_minor) as amount_minor
          from commerce.ledger_entries e join commerce.ledger_lines l on l.entry_id = e.id
         where e.book_id = ${bookId}::uuid and l.account = ${BANK_ACCOUNT} and e.reverses is null
           and not exists (select 1 from commerce.ledger_entries r where r.reverses = e.id)
           and not exists (select 1 from commerce.bank_lines b where b.book_id = e.book_id and b.entry_id = e.id)
         group by e.id, e.entry_date
        having sum(l.amount_minor) <> 0`,
    ),
  ]);
  if (bank.length === 0 || books.length === 0) return 0;
  const pairs = matchBankLines(
    bank.map((b) => ({ id: b.id, day: b.day, amountMinor: b.amount_minor })),
    books.map((l) => ({ entryId: l.entry_id, day: l.day, amountMinor: l.amount_minor })),
  );
  let matched = 0;
  for (const pair of pairs) {
    try {
      const done = await db().execute(sql`
        update commerce.bank_lines set entry_id = ${pair.entryId}::uuid, matched_at = now()
         where id = ${pair.bankId}::uuid and store_id = ${storeId}::uuid and entry_id is null
        returning id`);
      matched += done.length;
    } catch (error) {
      // Another run matched the entry meanwhile (`bank_lines_entry_once`): this line waits for the next.
      log("info", "bank.match_taken", { storeId, bookId }, error);
    }
  }
  return matched;
}

/**
 * Matches the bank lines of every open book that has some waiting, or matched to an entry since reversed (the ledger's job, after it posts).
 * Returns how many were matched.
 */
export async function matchAllBankStatements(deadline: number): Promise<number> {
  const books = await typedRows(
    z.object({ store_id: col.uuid, book_id: col.uuid }),
    sql`select distinct b.store_id, b.book_id from commerce.bank_lines b join commerce.ledger_books k on k.id = b.book_id
         where k.closed_on is null
           and (b.entry_id is null or exists (select 1 from commerce.ledger_entries r where r.reverses = b.entry_id))`,
  );
  let matched = 0;
  for (const b of books) {
    if (Date.now() > deadline) break;
    matched += await matchBankStatement(b.store_id, b.book_id);
  }
  return matched;
}

export type BankLineView = { id: string; day: string; amountMinor: number; text: string; counterparty: string | null; reference: string | null };
export type BooksLineView = { entryId: string; day: string; amountMinor: number; text: string; name: string };

export type BankSummary = {
  statements: number;
  lines: number;
  matched: number;
  fromDay: string | null;
  toDay: string | null;
  /** The bank's last closing balance and its day, and what the books hold on the bank's account at the end of that day. */
  closing: { day: string; bankMinor: number; booksMinor: number } | null;
  /** Money in the bank the books do not have yet, the newest first. */
  bankOnly: BankLineView[];
  /** The books' money on the bank's account within the statements' days that the bank has not shown, the newest first. */
  booksOnly: BooksLineView[];
};

/** What the Books screen shows of the bank: how much is matched, the balances side by side, and what is left on either side. */
export async function bankSummary(bookId: string, limit = 30): Promise<BankSummary> {
  const counts = await typedRow(
    z.object({ statements: col.int, lines: col.int, matched: col.int, from_day: col.textOrNull, to_day: col.textOrNull }),
    sql`
      select (select count(*) from commerce.bank_statements s where s.book_id = ${bookId}::uuid)::int as statements,
             count(*)::int as lines, count(entry_id)::int as matched,
             (select min(from_day)::text from commerce.bank_statements s where s.book_id = ${bookId}::uuid) as from_day,
             (select max(to_day)::text from commerce.bank_statements s where s.book_id = ${bookId}::uuid) as to_day
        from commerce.bank_lines where book_id = ${bookId}::uuid and ledger_account = ${BANK_ACCOUNT}`,
  );
  const empty: BankSummary = { statements: 0, lines: 0, matched: 0, fromDay: null, toDay: null, closing: null, bankOnly: [], booksOnly: [] };
  if (!counts || counts.statements === 0) return empty;
  const [closing, bankOnly, booksOnly] = await Promise.all([
    typedRow(
      z.object({ day: col.text, bank: col.minor, books: col.minor }),
      sql`
        select s.to_day::text as day, s.closing_minor as bank,
               coalesce((select sum(l.amount_minor) from commerce.ledger_lines l join commerce.ledger_entries e on e.id = l.entry_id
                          where e.book_id = s.book_id and l.account = ${BANK_ACCOUNT} and e.entry_date <= s.to_day), 0) as books
          from commerce.bank_statements s
         where s.book_id = ${bookId}::uuid and s.closing_minor is not null
         order by s.to_day desc, s.imported_at desc limit 1`,
    ),
    typedRows(
      z.object({ id: col.uuid, day: col.text, amount_minor: col.minor, text: col.text, counterparty: col.textOrNull, reference: col.textOrNull }),
      sql`select id, booked_on::text as day, amount_minor, text, counterparty, reference from commerce.bank_lines
           where book_id = ${bookId}::uuid and ledger_account = ${BANK_ACCOUNT} and entry_id is null
           order by booked_on desc, id limit ${limit}`,
    ),
    typedRows(
      z.object({ entry_id: col.uuid, day: col.text, amount_minor: col.minor, text: col.text, series: col.text, year: col.int, number: col.int }),
      sql`
        select e.id as entry_id, e.entry_date::text as day, sum(l.amount_minor) as amount_minor, e.text, e.series, e.year, e.number
          from commerce.ledger_entries e join commerce.ledger_lines l on l.entry_id = e.id
         where e.book_id = ${bookId}::uuid and l.account = ${BANK_ACCOUNT} and e.reverses is null
           and e.entry_date between ${counts.from_day}::date and ${counts.to_day}::date
           and not exists (select 1 from commerce.ledger_entries r where r.reverses = e.id)
           and not exists (select 1 from commerce.bank_lines b where b.book_id = e.book_id and b.entry_id = e.id)
         group by e.id
        having sum(l.amount_minor) <> 0
         order by e.entry_date desc, e.id limit ${limit}`,
    ),
  ]);
  return {
    statements: counts.statements,
    lines: counts.lines,
    matched: counts.matched,
    fromDay: counts.from_day,
    toDay: counts.to_day,
    closing: closing ? { day: closing.day, bankMinor: closing.bank, booksMinor: closing.books } : null,
    bankOnly: bankOnly.map((b) => ({ id: b.id, day: b.day, amountMinor: b.amount_minor, text: b.text, counterparty: b.counterparty, reference: b.reference })),
    booksOnly: booksOnly.map((l) => ({ entryId: l.entry_id, day: l.day, amountMinor: l.amount_minor, text: l.text, name: entryName(l.series, l.year, l.number) })),
  };
}
