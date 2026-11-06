import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { BookingDoc } from "@/lib/accounting-docs";
import {
  LEDGER_KINDS,
  entryName,
  entryOfDoc,
  entryProblems,
  isDay,
  isVatCode,
  noKindOf,
  standardAccount,
  standardOf,
  startingChart,
  trialBalance,
  type DocProblem,
  type EntryProblem,
  type LedgerEntryInput,
  type LedgerPosting,
  type TrialBalance,
} from "@/lib/ledger";
import { mainCurrency } from "@/lib/markets";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Our own ledger (B2 of `docs/own-books-and-sales.md`, D478), step 1: a store's books opened, entries posted, reversed and locked, and the
 * trial balance read. The rules are the database's (`commerce.ledger_post()`): this module checks first what it can say in words, and says
 * what the database refused. Nothing posts by itself yet: posting the store's documents, payouts and fees is step 2, the screens step 3,
 * the daily comparison with Tripletex step 4. Opening a book, reversing and locking are the owner's (the callers check), audited as
 * `work.ledger_*` with ids only.
 */

export type LedgerBook = {
  id: string;
  legalName: string;
  organisationNumber: string;
  country: string;
  currency: string;
  openedOn: string;
  closedOn: string | null;
  lockedThrough: string | null;
};

const BOOK = z.object({
  id: col.uuid,
  legal_name: col.text,
  organisation_number: col.text,
  country: col.text,
  currency: col.currency,
  opened_on: col.text,
  closed_on: col.textOrNull,
  locked_through: col.textOrNull,
});
const toBook = (r: z.infer<typeof BOOK>): LedgerBook => ({
  id: r.id,
  legalName: r.legal_name,
  organisationNumber: r.organisation_number,
  country: r.country,
  currency: r.currency,
  openedOn: r.opened_on,
  closedOn: r.closed_on,
  lockedThrough: r.locked_through,
});

/** The store's open book, or null when it keeps none. */
export async function openBookOf(storeId: string): Promise<LedgerBook | null> {
  const row = await typedRow(
    BOOK,
    sql`select id, legal_name, organisation_number, country, currency, opened_on::text, closed_on::text, locked_through::text
          from commerce.ledger_books where store_id = ${storeId}::uuid and closed_on is null`,
  );
  return row ? toBook(row) : null;
}

/** The countries with a pack (a chart and VAT codes): Norway first. */
const PACKS = new Set(["NO"]);

export type OpenBookProblem = "open" | "no_pack" | "date";

/**
 * Opens the store's books on a day, for the legal entity behind the store (its name and organisation number now), in its main currency,
 * with its country's starting chart. One open book a store.
 */
export async function openLedgerBook(member: Membership, openedOn: string): Promise<{ ok: true; book: LedgerBook } | { ok: false; problem: OpenBookProblem }> {
  if (!isDay(openedOn)) return { ok: false, problem: "date" };
  const store = await typedRow(
    z.object({ name: col.text, legal_name: col.textOrNull, organisation_number: col.textOrNull, country: col.text }),
    sql`select name, legal_name, organisation_number, country from commerce.stores where id = ${member.store.id}::uuid`,
  );
  if (!store || !PACKS.has(store.country)) return { ok: false, problem: "no_pack" };
  if (await openBookOf(member.store.id)) return { ok: false, problem: "open" };
  const currency = mainCurrency(member.store);
  const book = await db().transaction(async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.ledger_books (store_id, legal_name, organisation_number, country, currency, opened_on, opened_by)
      values (${member.store.id}::uuid, ${(store.legal_name || store.name).slice(0, 200)}, ${(store.organisation_number ?? "").slice(0, 40)}, ${store.country},
              ${currency}, ${openedOn}::date, ${member.account.id}::uuid)
      on conflict do nothing
      returning id
    `);
    if (!row) return null;
    for (const a of startingChart()) {
      await tx.execute(sql`
        insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind, vat_code)
        values (${member.store.id}::uuid, ${row.id}::uuid, ${a.number}, ${a.name}, ${a.standard}, ${a.kind}, ${a.vatCode})
      `);
    }
    return String(row.id);
  });
  if (!book) return { ok: false, problem: "open" };
  await audit(member.account.id, member.store.id, "work.ledger_book_opened", { bookId: book, openedOn, country: store.country, currency });
  return { ok: true, book: (await openBookOf(member.store.id))! };
}

export type LedgerAccount = { number: number; name: string; standard: string; kind: (typeof LEDGER_KINDS)[number]; vatCode: string | null; active: boolean };

/** A book's chart, by number. */
export async function ledgerAccounts(bookId: string): Promise<LedgerAccount[]> {
  const rows = await typedRows(
    z.object({ number: col.int, name: col.text, standard: col.text, kind: z.enum(LEDGER_KINDS), vat_code: col.textOrNull, active: col.bool }),
    sql`select number, name, standard, kind, vat_code, active from commerce.ledger_accounts where book_id = ${bookId}::uuid order by number`,
  );
  return rows.map((r) => ({ number: r.number, name: r.name, standard: r.standard, kind: r.kind, vatCode: r.vat_code, active: r.active }));
}

export type AddAccountProblem = "not_standard" | "taken" | "vat_code" | "name";

/**
 * Adds an account to a book's chart: a standard account, or a sub-account of one (`15001` under 1500), reporting as it; named as the
 * standard names it unless given a name; its kind from its class.
 */
export async function addLedgerAccount(
  storeId: string,
  bookId: string,
  input: { number: number; name?: string; vatCode?: string | null },
): Promise<{ ok: true } | { ok: false; problem: AddAccountProblem }> {
  const standard = Number.isInteger(input.number) && input.number >= 1000 && input.number <= 99999 ? standardOf(input.number) : null;
  if (!standard) return { ok: false, problem: "not_standard" };
  const name = (input.name ?? standardAccount(standard)!.nb).replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 120) return { ok: false, problem: "name" };
  if (input.vatCode != null && !isVatCode(input.vatCode)) return { ok: false, problem: "vat_code" };
  const [row] = await db().execute<{ number: number }>(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind, vat_code)
    values (${storeId}::uuid, ${bookId}::uuid, ${input.number}, ${name}, ${standard}, ${noKindOf(input.number)}, ${input.vatCode ?? null})
    on conflict do nothing
    returning number
  `);
  return row ? { ok: true } : { ok: false, problem: "taken" };
}

export type PostProblem = EntryProblem | "book" | "open" | "locked" | "reversed";

/** What the database said, read back into a problem by its rule's name (never its words, which may carry values). */
function refusal(error: unknown): PostProblem | null {
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  const match = text.match(/ledger\.(book|open|locked|reversed|reverses|balance|zero|lines|account|writer)\b/);
  if (!match) return null;
  const rule = match[1];
  if (rule === "reverses") return "reversed";
  if (rule === "writer") return null;
  return rule as PostProblem;
}

/**
 * Posts an entry to a book: checked here first, then by the database, which numbers it. An entry posted from something (`source`) is posted
 * once: posting it again returns the entry it has.
 */
export async function postLedgerEntry(bookId: string, entry: LedgerEntryInput, by: string | null): Promise<{ ok: true; id: string } | { ok: false; problems: PostProblem[] }> {
  const problems = entryProblems(entry);
  if (problems.length > 0) return { ok: false, problems };
  const lines = entry.lines.map((l) => ({ account: l.account, amount: l.amountMinor, vat_code: l.vatCode ?? null, text: l.text?.trim().slice(0, 200) || null }));
  try {
    const [row] = await db().execute<{ id: string }>(sql`
      select commerce.ledger_post(${bookId}::uuid, ${entry.series}, ${entry.date}::date, ${entry.text.trim()}, ${entry.source?.kind ?? null}, ${entry.source?.id ?? null},
                                  ${JSON.stringify(lines)}::jsonb, ${by}::uuid) as id
    `);
    return { ok: true, id: String(row.id) };
  } catch (error) {
    const problem = refusal(error);
    if (!problem) throw error;
    return { ok: false, problems: [problem] };
  }
}

/** Posts a Kaizena Flow document (`BookingDoc`) to a book where `posting` says, once; what cannot be posted as it is says why. */
export async function postLedgerDoc(
  book: Pick<LedgerBook, "id" | "currency">,
  doc: BookingDoc,
  posting: LedgerPosting,
  by: string | null = null,
): Promise<{ ok: true; id: string } | { ok: false; problem: DocProblem | PostProblem }> {
  const made = entryOfDoc(doc, posting, book.currency);
  if (!made.ok) return made;
  const posted = await postLedgerEntry(book.id, made.entry, by);
  return posted.ok ? posted : { ok: false, problem: posted.problems[0] };
}

const ENTRY = z.object({ id: col.uuid, book_id: col.uuid, series: col.text, year: col.int, number: col.int, entry_date: col.text, text: col.text, locked_through: col.textOrNull });

/**
 * Reverses an entry of the store's books: the same lines with their signs turned, in its series, on its own day when that is still open,
 * else on `date` (today in the caller's zone by default). Once; never a reversal.
 */
export async function reverseLedgerEntry(member: Membership, entryId: string, date: string): Promise<{ ok: true; id: string } | { ok: false; problem: PostProblem | "not_found" }> {
  const entry = await typedRow(
    ENTRY,
    sql`select e.id, e.book_id, e.series, e.year, e.number, e.entry_date::text, e.text, b.locked_through::text
          from commerce.ledger_entries e join commerce.ledger_books b on b.id = e.book_id
         where e.id = ${entryId}::uuid and e.store_id = ${member.store.id}::uuid`,
  );
  if (!entry) return { ok: false, problem: "not_found" };
  if (!isDay(date)) return { ok: false, problem: "date" };
  const on = entry.locked_through && entry.entry_date <= entry.locked_through ? date : entry.entry_date;
  const text = `Tilbakeføring av ${entryName(entry.series, entry.year, entry.number)}: ${entry.text}`.slice(0, 200).trim();
  try {
    const [row] = await db().execute<{ id: string }>(sql`select commerce.ledger_reverse(${entryId}::uuid, ${on}::date, ${text}, ${member.account.id}::uuid) as id`);
    await audit(member.account.id, member.store.id, "work.ledger_entry_reversed", { entryId, reversalId: String(row.id) });
    return { ok: true, id: String(row.id) };
  } catch (error) {
    const problem = refusal(error);
    if (!problem) throw error;
    return { ok: false, problem };
  }
}

/** Locks the store's open book through a day: nothing dated on or before it is posted after. Moving it back is the owner's too, and audited. */
export async function lockLedgerThrough(member: Membership, day: string | null): Promise<{ ok: boolean }> {
  if (day !== null && !isDay(day)) return { ok: false };
  const book = await typedRow(
    z.object({ id: col.uuid, before: col.textOrNull }),
    sql`update commerce.ledger_books b set locked_through = ${day}::date, updated_at = now()
          from (select id, locked_through from commerce.ledger_books where store_id = ${member.store.id}::uuid and closed_on is null for update) old
         where b.id = old.id and (${day}::date is null or ${day}::date >= b.opened_on)
         returning b.id, old.locked_through::text as before`,
  );
  if (!book) return { ok: false };
  await audit(member.account.id, member.store.id, "work.ledger_locked", { bookId: book.id, through: day, before: book.before });
  return { ok: true };
}

/**
 * The trial balance of a book for the days `from` through `to`: each account with postings, what it held before, its debits and credits
 * in the days, and what it holds after; with the totals (each zero in sound books) and the result.
 */
export async function ledgerTrialBalance(bookId: string, from: string, to: string): Promise<TrialBalance> {
  const rows = await typedRows(
    z.object({ account: col.int, name: col.text, kind: z.enum(LEDGER_KINDS), before: col.minor, debit: col.minor, credit: col.minor }),
    sql`
      select a.number as account, a.name, a.kind,
             coalesce(sum(l.amount_minor) filter (where e.entry_date < ${from}::date), 0) as before,
             coalesce(sum(l.amount_minor) filter (where e.entry_date between ${from}::date and ${to}::date and l.amount_minor > 0), 0) as debit,
             coalesce(sum(l.amount_minor) filter (where e.entry_date between ${from}::date and ${to}::date and l.amount_minor < 0), 0) as credit
        from commerce.ledger_lines l
        join commerce.ledger_entries e on e.id = l.entry_id
        join commerce.ledger_accounts a on a.book_id = l.book_id and a.number = l.account
       where l.book_id = ${bookId}::uuid and e.entry_date <= ${to}::date
       group by a.number, a.name, a.kind
    `,
  );
  const tb = trialBalance(rows);
  if (tb.totals.after !== 0) log("error", "ledger.unbalanced", { bookId, after: tb.totals.after });
  return tb;
}
