import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { BookingDoc } from "@/lib/accounting-docs";
import {
  BUCKET_VAT,
  FX_GAIN_ACCOUNT,
  FX_LOSS_ACCOUNT,
  LEDGER_KINDS,
  PAYMENT_ACCOUNTS,
  SHOP_PAYMENT_ACCOUNTS,
  STORE_CREDIT_ACCOUNT,
  shopMoneyAccount,
  CARD_FEE_ACCOUNT,
  entryName,
  entryOfDoc,
  entryOfPayment,
  entryOfPaymentReversal,
  entryOfDisputeLine,
  entryOfPayout,
  entryProblems,
  handEntryOf,
  isDay,
  isVatCode,
  noKindOf,
  postingOfTripletex,
  standardAccount,
  standardOf,
  startingChart,
  trialBalance,
  type DocProblem,
  type DocRate,
  type EntryProblem,
  type HandProblem,
  type HandRow,
  type LedgerEntryInput,
  type LedgerPosting,
  type PaymentMethod,
  type PaymentProblem,
  type PaymentRates,
  type TrialBalance,
  type VatRow,
  vatByCode,
} from "@/lib/ledger";
import { parseAmount } from "@/lib/field-money";
import { mainCurrency } from "@/lib/markets";

import { loadDocument, type DocumentKind } from "./accounting-documents";
import { compareWithTripletex } from "./ledger-compare";
import { matchAllBankStatements, matchBankStatement } from "./bank-statements";
import { audit, type Membership } from "./auth";
import { log } from "./log";
import { getTripletexConnection } from "./tripletex";
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
    z.object({ name: col.text, legal_name: col.textOrNull, organisation_number: col.textOrNull, country: col.textOrNull }),
    sql`select name, legal_name, organisation_number, country from commerce.stores where id = ${member.store.id}::uuid`,
  );
  // The store's own country, else its first market's (a store set up before it was asked).
  const country = store?.country ?? member.store.markets[0]?.code ?? null;
  if (!store || !country || !PACKS.has(country)) return { ok: false, problem: "no_pack" };
  if (await openBookOf(member.store.id)) return { ok: false, problem: "open" };
  const currency = mainCurrency(member.store);
  const book = await db().transaction(async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.ledger_books (store_id, legal_name, organisation_number, country, currency, opened_on, opened_by)
      values (${member.store.id}::uuid, ${(store.legal_name || store.name).slice(0, 200)}, ${(store.organisation_number ?? "").slice(0, 40)}, ${country},
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
  await audit(member.account.id, member.store.id, "work.ledger_book_opened", { bookId: book, openedOn, country, currency });
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
  input: { number: number; name?: string; vatCode?: string | null; standard?: string | null },
): Promise<{ ok: true } | { ok: false; problem: AddAccountProblem }> {
  // The standard account it reports as: its own number's (`standardOf()`), else one given for a number of the company's own (an opening
  // balance read from Tripletex, `nearestStandard()`), in the same class.
  const given = input.standard && standardAccount(input.standard) && input.standard[0] === String(input.number)[0] ? input.standard : null;
  const standard = Number.isInteger(input.number) && input.number >= 1000 && input.number <= 99999 ? (standardOf(input.number) ?? given) : null;
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
  fx: DocRate | null = null,
): Promise<{ ok: true; id: string } | { ok: false; problem: DocProblem | PostProblem }> {
  const made = entryOfDoc(doc, posting, book.currency, fx);
  if (!made.ok) return made;
  const posted = await postLedgerEntry(book.id, made.entry, by);
  return posted.ok ? posted : { ok: false, problem: posted.problems[0] };
}

/**
 * Posts an entry typed by hand to the store's open book (step 3b, the owner's): its rows read by `handEntryOf()`, then posted as every
 * entry is, by the database, which numbers it, and kept in the audit log. What cannot be posted says why, and which rows.
 */
export async function postHandEntry(
  member: Membership,
  input: { series: string; date: string; text: string; rows: readonly HandRow[] },
): Promise<{ ok: true; id: string } | { ok: false; problems: (HandProblem | PostProblem | "no_book")[]; rows: number[] }> {
  const book = await openBookOf(member.store.id);
  if (!book) return { ok: false, problems: ["no_book"], rows: [] };
  const made = handEntryOf(input, book.currency, parseAmount);
  if (!made.ok) return made;
  const posted = await postLedgerEntry(book.id, made.entry, member.account.id);
  if (!posted.ok) return { ok: false, problems: posted.problems, rows: [] };
  await audit(member.account.id, member.store.id, "work.ledger_entry_posted", { bookId: book.id, entryId: posted.id, series: made.entry.series, lines: made.entry.lines.length });
  return posted;
}

export type JournalEntry = {
  id: string;
  name: string;
  date: string;
  text: string;
  sourceKind: string | null;
  /** The entry this one turns back, by its name. */
  reverses: string | null;
  /** The entry that turned this one back, by its name. */
  reversedBy: string | null;
  lines: { account: number; name: string; amount: number; vatCode: string | null }[];
};

/** The book's latest entries, newest first, each with its lines and what reversed it or what it reverses: the journal on the books' screen. */
export async function ledgerJournal(bookId: string, limit = 30): Promise<JournalEntry[]> {
  const entries = await typedRows(
    z.object({
      id: col.uuid,
      series: col.text,
      year: col.int,
      number: col.int,
      entry_date: col.text,
      text: col.text,
      source_kind: col.textOrNull,
      reverses: col.textOrNull,
      reversed_by: col.textOrNull,
    }),
    sql`
      select e.id, e.series, e.year, e.number, e.entry_date::text, e.text, e.source_kind,
             (select o.series || o.year || '-' || o.number from commerce.ledger_entries o where o.id = e.reverses) as reverses,
             (select r.series || r.year || '-' || r.number from commerce.ledger_entries r where r.reverses = e.id limit 1) as reversed_by
        from commerce.ledger_entries e
       where e.book_id = ${bookId}::uuid
       order by e.posted_at desc, e.entry_date desc, e.number desc
       limit ${limit}
    `,
  );
  if (entries.length === 0) return [];
  const ids = sql.join(entries.map((e) => sql`${e.id}::uuid`), sql`, `);
  const lines = await typedRows(
    z.object({ entry_id: col.uuid, account: col.int, name: col.textOrNull, amount_minor: col.minor, vat_code: col.textOrNull }),
    sql`
      select l.entry_id, l.account, a.name, l.amount_minor, l.vat_code
        from commerce.ledger_lines l
        left join commerce.ledger_accounts a on a.book_id = l.book_id and a.number = l.account
       where l.entry_id in (${ids})
       order by l.entry_id, l.line
    `,
  );
  return entries.map((e) => ({
    id: e.id,
    name: entryName(e.series, e.year, e.number),
    date: e.entry_date,
    text: e.text,
    sourceKind: e.source_kind,
    reverses: e.reverses,
    reversedBy: e.reversed_by,
    lines: lines.filter((l) => l.entry_id === e.id).map((l) => ({ account: l.account, name: l.name ?? "", amount: l.amount_minor, vatCode: l.vat_code })),
  }));
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
    // A bank line matched to the entry waits again, and may match another entry of the same money.
    await matchBankStatement(member.store.id, entry.book_id);
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

/** VAT by code for the days `from` through `to` (step 3b, `vatByCode()`): each standard VAT code's base and VAT, from the lines that carry it. */
export async function ledgerVatByCode(bookId: string, from: string, to: string): Promise<VatRow[]> {
  const lines = await typedRows(
    z.object({ account: col.int, vat_code: col.text, amount_minor: col.minor }),
    sql`
      select l.account, l.vat_code, sum(l.amount_minor) as amount_minor
        from commerce.ledger_lines l
        join commerce.ledger_entries e on e.id = l.entry_id
       where l.book_id = ${bookId}::uuid and l.vat_code is not null and e.entry_date between ${from}::date and ${to}::date
       group by l.account, l.vat_code
    `,
  );
  return vatByCode(lines.map((l) => ({ account: l.account, vatCode: l.vat_code, amountMinor: l.amount_minor })));
}

// ---------------------------------------------------------------------------------------------------------------------
// Step 2: the store's documents, posted as they are issued
// ---------------------------------------------------------------------------------------------------------------------

/** How many documents a book posts in one go, and how long the dispatcher's job may take. */
const DOCS_A_ROUND = 100;
const BUDGET_MS = 40_000;

/** Where a store's documents are posted: its Tripletex settings' accounts where it books there (so the two compare), else Norway's. */
async function postingOf(storeId: string): Promise<LedgerPosting> {
  const connection = await getTripletexConnection(storeId);
  return postingOfTripletex(connection?.settings ?? null);
}

/** The accounts a posting needs, added to the book's chart where it lacks a standard one (a store's Tripletex settings may book to 3020). */
async function chartFor(storeId: string, bookId: string, posting: LedgerPosting): Promise<void> {
  const needed = new Set([
    posting.receivable,
    ...Object.values(posting.income),
    ...Object.values(BUCKET_VAT).flatMap((v) => (v.vatAccount ? [v.vatAccount] : [])),
    ...Object.values(PAYMENT_ACCOUNTS),
    ...Object.values(SHOP_PAYMENT_ACCOUNTS),
    STORE_CREDIT_ACCOUNT,
    CARD_FEE_ACCOUNT,
    FX_GAIN_ACCOUNT,
    FX_LOSS_ACCOUNT,
  ]);
  const have = new Set((await ledgerAccounts(bookId)).map((a) => a.number));
  for (const number of needed) if (!have.has(number) && standardOf(number)) await addLedgerAccount(storeId, bookId, { number });
}

const RATE = z.object({ fx_rate: col.textOrNull, vat_home_minor: z.union([z.number(), z.string()]).nullable(), home: col.textOrNull });

/**
 * A document's own rate into the book's currency, as it was issued (`fx_rate`, and its VAT there, `vat_home_minor`): a shop's document says
 * which currency that is, and is used only where it is the book's; a Work document's is the seller's, which its books are kept in.
 */
async function docRateOf(storeId: string, kind: DocumentKind, id: string, bookCurrency: string): Promise<DocRate | null> {
  const query =
    kind === "work_invoice"
      ? sql`select fx_rate::text, vat_home_minor, null::text as home from commerce.work_invoices where store_id = ${storeId}::uuid and id = ${id}::uuid`
      : kind === "work_credit_note"
        ? sql`select fx_rate::text, vat_home_minor, null::text as home from commerce.work_credit_notes where store_id = ${storeId}::uuid and id = ${id}::uuid`
        : kind === "shop_invoice"
          ? sql`select fx_rate::text, vat_home_minor, vat_home_currency::text as home from commerce.invoices where store_id = ${storeId}::uuid and id = ${id}::uuid`
          : sql`select fx_rate::text, vat_home_minor, vat_home_currency::text as home from commerce.credit_notes where store_id = ${storeId}::uuid and id = ${id}::uuid`;
  const row = await typedRow(RATE, query);
  if (!row || row.fx_rate === null || row.vat_home_minor === null) return null;
  if (row.home !== null && row.home.trim() !== bookCurrency) return null;
  const vatHomeMinor = Number(row.vat_home_minor);
  return Number.isSafeInteger(vatHomeMinor) ? { rate: row.fx_rate, vatHomeMinor } : null;
}

/**
 * A shop payment's day: when staff said the money came (a payment by hand), else the day its order's invoice was issued (a card payment is
 * captured as the invoice is issued, D159), else the day it was made, in the store's days.
 */
const SHOP_PAYMENT_DAY = sql`coalesce(p.received_on,
  (select min(i.issued_on) from commerce.invoices i where i.store_id = p.store_id and i.order_id = p.order_id),
  (p.created_at at time zone s.time_zone)::date)`;

const DUE = z.object({ kind: z.enum(["work_invoice", "work_credit_note", "shop_invoice", "shop_credit_note", "work_payment", "shop_payment", "shop_refund", "payout", "dispute"]), id: col.text });

/**
 * The documents of a book's days not posted yet, the oldest first, invoices before credit notes: the same as Tripletex books (Work's sent
 * invoices, not imported ones, and credit notes; the shop's invoices and credit notes), each once; and the payments for Work's invoices
 * received in those days (step 2c), an imported invoice's too when it was issued before the book opened (its receivable is in the opening
 * balance; one issued later, brought in from Tripletex, D494, is in Tripletex's books and not in these, nor is its payment), a reversal
 * after what it reverses;
 * and the shop's captured payments, its refunds that move money or owe it as store credit, and the payment provider's paid payouts. One that has an entry (even one a person
 * reversed) is done; one that waits is tried again a day after it was last tried.
 */
async function dueDocuments(storeId: string, book: { id: string; opened_on: string; closed_on: string | null }, limit: number): Promise<z.infer<typeof DUE>[]> {
  const to = book.closed_on ?? "9999-12-31";
  return typedRows(
    DUE,
    sql`
      select d.kind, d.id from (
        select 'work_invoice' as kind, id::text as id, issued_on, 0 as rank from commerce.work_invoices
         where store_id = ${storeId}::uuid and status <> 'draft' and not imported and length(document_number) between 1 and 50
           and issued_on between ${book.opened_on}::date and ${to}::date
        union all
        select 'work_credit_note', id::text, issued_on, 1 from commerce.work_credit_notes
         where store_id = ${storeId}::uuid and length(document_number) between 1 and 50 and issued_on between ${book.opened_on}::date and ${to}::date
        union all
        select 'shop_invoice', id::text, issued_on, 0 from commerce.invoices
         where store_id = ${storeId}::uuid and length(document_number) between 1 and 50 and issued_on between ${book.opened_on}::date and ${to}::date
        union all
        select 'shop_credit_note', id::text, issued_on, 1 from commerce.credit_notes
         where store_id = ${storeId}::uuid and length(document_number) between 1 and 50 and issued_on between ${book.opened_on}::date and ${to}::date
        union all
        select 'work_payment', p.id::text, p.received_on, case when p.reverses is null then 2 else 3 end from commerce.work_invoice_payments p
          join commerce.work_invoices i on i.store_id = p.store_id and i.id = p.invoice_id
         where p.store_id = ${storeId}::uuid and i.status <> 'draft' and p.received_on between ${book.opened_on}::date and ${to}::date
           and (not i.imported or i.issued_on < ${book.opened_on}::date)
        union all
        select m.kind, m.id, m.day, m.rank from (
          select 'shop_payment' as kind, p.id::text as id, ${SHOP_PAYMENT_DAY} as day, 4 as rank
            from commerce.payments p join commerce.stores s on s.id = p.store_id
           where p.store_id = ${storeId}::uuid and p.status = 'captured' and not p.test_mode and p.amount_minor > 0 and p.provider <> 'exchange'
          union all
          select 'shop_refund', r.id::text, (r.created_at at time zone s.time_zone)::date, 5
            from commerce.refunds r
            join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
            join commerce.stores s on s.id = r.store_id
           where r.store_id = ${storeId}::uuid and r.status = 'succeeded' and r.kind in ('money', 'release', 'store_credit')
             and p.status = 'captured' and not p.test_mode and r.amount_minor > 0 and p.provider <> 'exchange'
          union all
          select 'payout', po.id::text, coalesce(po.arrival_on, (po.provider_created_at at time zone s.time_zone)::date), 6
            from commerce.payouts po join commerce.stores s on s.id = po.store_id
           where po.store_id = ${storeId}::uuid and po.status = 'paid' and not po.test_mode
          union all
          select 'dispute', l.id::text, (l.provider_created_at at time zone s.time_zone)::date, 7
            from commerce.payout_lines l
            join commerce.payouts po on po.store_id = l.store_id and po.id = l.payout_id
            join commerce.stores s on s.id = l.store_id
           where l.store_id = ${storeId}::uuid and l.kind = 'dispute' and l.amount_minor <> 0 and po.status = 'paid' and not po.test_mode
        ) m
         where m.day between ${book.opened_on}::date and ${to}::date
      ) d
      where not exists (select 1 from commerce.ledger_entries e where e.book_id = ${book.id}::uuid and e.source_kind = d.kind and e.source_id = d.id)
        and not exists (select 1 from commerce.ledger_waiting w where w.book_id = ${book.id}::uuid and w.source_kind = d.kind and w.source_id = d.id
                          and w.tried_at > now() - interval '1 day')
      order by d.issued_on, d.rank, d.id
      limit ${limit}
    `,
  );
}

const PAYMENT = z.object({
  id: col.uuid,
  amount_minor: col.minor,
  currency: col.currency,
  received_on: col.text,
  method: z.enum(["bank", "card", "cash", "other", "stripe", "prepaid"]),
  reverses: col.textOrNull,
  document_number: col.text,
  buyer_name: col.textOrNull,
  invoice_currency: col.currency,
  invoice_rate: col.textOrNull,
});

/** Units of the book's currency for one of another on a day: the ECB's rates of that day, or of the last day they were published before it. */
async function rateOnDay(bookCurrency: string, currency: string, day: string): Promise<string | null> {
  const row = await typedRow(
    z.object({ rate: col.textOrNull }),
    sql`
      select (
        (case when ${bookCurrency} = 'EUR' then 1::numeric
              else (select r.rate from commerce.ecb_reference_rates r where r.currency = ${bookCurrency} and r.rate_date <= ${day}::date order by r.rate_date desc limit 1) end)
        / nullif(case when ${currency} = 'EUR' then 1::numeric
              else (select r.rate from commerce.ecb_reference_rates r where r.currency = ${currency} and r.rate_date <= ${day}::date order by r.rate_date desc limit 1) end, 0)
      )::text as rate
    `,
  );
  return row?.rate ?? null;
}

/**
 * Posts a payment for a Work invoice (step 2c, `entryOfPayment()`): the money where its method says against the receivable, in the bank
 * series on its day; in another currency at the invoice's rate and the day's, the difference a gain or a loss. A reversal turns the entry of
 * the payment it takes back, and waits until that one is posted.
 */
async function postPayment(
  storeId: string,
  book: { id: string; currency: string },
  posting: LedgerPosting,
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; problem: PaymentProblem | PostProblem | "original" | "unreadable" }> {
  const payment = await typedRow(
    PAYMENT,
    sql`
      select p.id, p.amount_minor, p.currency, p.received_on::text, p.method, p.reverses::text,
             i.document_number, i.buyer ->> 'name' as buyer_name, i.currency as invoice_currency, i.fx_rate::text as invoice_rate
        from commerce.work_invoice_payments p
        join commerce.work_invoices i on i.store_id = p.store_id and i.id = p.invoice_id
       where p.store_id = ${storeId}::uuid and p.id = ${id}::uuid
    `,
  );
  if (!payment) return { ok: false, problem: "unreadable" };
  const facts = { id: payment.id, invoiceNumber: payment.document_number, counterparty: payment.buyer_name, receivedOn: payment.received_on };
  let made: ReturnType<typeof entryOfPayment>;
  if (payment.reverses) {
    const original = await typedRows(
      z.object({ account: col.int, amount_minor: col.minor }),
      sql`
        select l.account, l.amount_minor from commerce.ledger_lines l
          join commerce.ledger_entries e on e.id = l.entry_id
         where e.book_id = ${book.id}::uuid and e.source_kind = 'work_payment' and e.source_id = ${payment.reverses}
         order by l.line
      `,
    );
    if (original.length === 0) return { ok: false, problem: "original" };
    made = entryOfPaymentReversal(facts, original.map((l) => ({ account: l.account, amountMinor: l.amount_minor })));
  } else {
    const foreign = payment.currency !== book.currency;
    if (foreign && payment.invoice_currency !== payment.currency) return { ok: false, problem: "currency" };
    const day = foreign ? await rateOnDay(book.currency, payment.currency, payment.received_on) : null;
    const rates = foreign && payment.invoice_rate && day ? { invoice: payment.invoice_rate, day } : null;
    made = entryOfPayment(
      { ...facts, amountMinor: payment.amount_minor, currency: payment.currency, method: payment.method as PaymentMethod },
      posting,
      book.currency,
      rates,
    );
  }
  if (!made.ok) return made;
  const posted = await postLedgerEntry(book.id, made.entry, null);
  return posted.ok ? posted : { ok: false, problem: posted.problems[0] };
}

/**
 * Posts one Work invoice's payment at once in the store's open book (one recorded from the bank's statement, B4, D487), as the job would:
 * the entry's id, or null when the store keeps no books here or the payment cannot be posted yet, when it waits for the job as any other.
 */
export async function postWorkPaymentNow(storeId: string, paymentId: string): Promise<string | null> {
  const book = await typedRow(
    z.object({ id: col.uuid, currency: col.currency }),
    sql`
      select b.id, b.currency from commerce.ledger_books b
       where b.store_id = ${storeId}::uuid and b.closed_on is null
         -- An imported invoice issued after the book opened is not in it, so neither is its payment (as dueDocuments() does).
         and not exists (select 1 from commerce.work_invoice_payments p join commerce.work_invoices i on i.store_id = p.store_id and i.id = p.invoice_id
                          where p.store_id = b.store_id and p.id = ${paymentId}::uuid and i.imported and i.issued_on >= b.opened_on)`,
  );
  if (!book) return null;
  const posting = await postingOf(storeId);
  await chartFor(storeId, book.id, posting);
  const result = await postPayment(storeId, book, posting, paymentId);
  if (!result.ok) return null;
  await db().execute(sql`delete from commerce.ledger_waiting where book_id = ${book.id}::uuid and source_kind = 'work_payment' and source_id = ${paymentId}`);
  return result.id;
}

/** A shop's payment posted at once (a balance on terms paid from the bank's statement, D487), as `postWorkPaymentNow()`. */
export async function postShopPaymentNow(storeId: string, paymentId: string): Promise<string | null> {
  const book = await typedRow(
    z.object({ id: col.uuid, currency: col.currency }),
    sql`select id, currency from commerce.ledger_books where store_id = ${storeId}::uuid and closed_on is null`,
  );
  if (!book) return null;
  const posting = await postingOf(storeId);
  await chartFor(storeId, book.id, posting);
  const result = await postShopMoney(storeId, book, posting, "shop_payment", paymentId);
  if (!result.ok) return null;
  await db().execute(sql`delete from commerce.ledger_waiting where book_id = ${book.id}::uuid and source_kind = 'shop_payment' and source_id = ${paymentId}`);
  return result.id;
}

const SHOP_MONEY = z.object({
  id: col.uuid,
  amount_minor: col.minor,
  currency: col.currency,
  day: col.text,
  provider: col.text,
  method: col.textOrNull,
  kind: col.textOrNull,
  order_number: col.text,
});

/**
 * What a shop payment or refund in another currency is worth in the book's (step 2c): the receivable at its document's own rate (the
 * order's invoice, a refund's credit note, both in the book's currency for VAT), and the money at what Stripe settled it for (its payout's
 * line, so it waits until that payout is read, `lines`), or at the ECB's rate of its day when staff took it by hand. A gift card or store
 * credit in another currency waits (`currency`): what cards owe is kept at the rate they were sold at, which this step does not follow.
 */
async function shopMoneyRates(
  storeId: string,
  bookCurrency: string,
  kind: "shop_payment" | "shop_refund",
  id: string,
  provider: string,
  day: string,
): Promise<{ rates: PaymentRates } | { problem: "currency" | "lines" }> {
  if (provider !== "stripe" && provider !== "manual") return { problem: "currency" };
  const row = await typedRow(
    z.object({ invoice_rate: col.textOrNull, settled: col.minorOrNull }),
    kind === "shop_payment"
      ? sql`
          select (select i.fx_rate::text from commerce.invoices i
                   where i.store_id = p.store_id and i.order_id = p.order_id and i.vat_home_currency = ${bookCurrency} and i.fx_rate is not null
                   order by i.issued_on, i.id limit 1) as invoice_rate,
                 (select sum(l.amount_minor) from commerce.payout_lines l
                   where l.store_id = p.store_id and l.payment_id = p.id and l.kind = 'charge' and l.currency = ${bookCurrency}) as settled
            from commerce.payments p where p.store_id = ${storeId}::uuid and p.id = ${id}::uuid`
      : sql`
          select coalesce(
                   (select c.fx_rate::text from commerce.credit_notes c
                     where c.store_id = r.store_id and c.refund_id = r.id and c.vat_home_currency = ${bookCurrency} and c.fx_rate is not null limit 1),
                   (select i.fx_rate::text from commerce.invoices i
                     where i.store_id = p.store_id and i.order_id = p.order_id and i.vat_home_currency = ${bookCurrency} and i.fx_rate is not null
                     order by i.issued_on, i.id limit 1)) as invoice_rate,
                 (select sum(l.amount_minor) from commerce.payout_lines l
                   where l.store_id = r.store_id and l.refund_id = r.id and l.kind = 'refund' and l.currency = ${bookCurrency}) as settled
            from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
           where r.store_id = ${storeId}::uuid and r.id = ${id}::uuid`,
  );
  if (!row?.invoice_rate) return { problem: "currency" };
  if (provider === "stripe") return row.settled === null ? { problem: "lines" } : { rates: { invoice: row.invoice_rate, moneyMinor: row.settled } };
  const currency = (
    await typedRow(
      z.object({ currency: col.currency }),
      kind === "shop_payment"
        ? sql`select currency from commerce.payments where store_id = ${storeId}::uuid and id = ${id}::uuid`
        : sql`select p.currency from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id where r.store_id = ${storeId}::uuid and r.id = ${id}::uuid`,
    )
  )?.currency;
  const dayRate = currency ? await rateOnDay(bookCurrency, currency, day) : null;
  return dayRate ? { rates: { invoice: row.invoice_rate, day: dayRate } } : { problem: "currency" };
}

/**
 * Posts a shop's captured payment or its refund (step 2c): the order's receivable against where the money is (`shopMoneyAccount()`): the
 * provider's balance, the till or the bank, what gift cards owe for a card or store credit spent (2900), what the store owes the customer for
 * a refund to store credit, in the bank series on its day. A way of paying the books do not follow yet (Mollie, at a venue, on terms) waits
 * (`provider`); an exchange's payment moves no money and is never due. Only in the book's currency for now: a payment in another waits.
 */
async function postShopMoney(
  storeId: string,
  book: { id: string; currency: string },
  posting: LedgerPosting,
  kind: "shop_payment" | "shop_refund",
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; problem: PaymentProblem | PostProblem | "unreadable" | "provider" | "lines" }> {
  const row = await typedRow(
    SHOP_MONEY,
    kind === "shop_payment"
      ? sql`
          select p.id, p.amount_minor, p.currency, (${SHOP_PAYMENT_DAY})::text as day, p.provider, p.method, null::text as kind, o.number as order_number
            from commerce.payments p
            join commerce.stores s on s.id = p.store_id
            join commerce.orders o on o.store_id = p.store_id and o.id = p.order_id
           where p.store_id = ${storeId}::uuid and p.id = ${id}::uuid`
      : sql`
          select r.id, r.amount_minor, p.currency, ((r.created_at at time zone s.time_zone)::date)::text as day, p.provider, p.method, r.kind, o.number as order_number
            from commerce.refunds r
            join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
            join commerce.stores s on s.id = r.store_id
            join commerce.orders o on o.store_id = p.store_id and o.id = p.order_id
           where r.store_id = ${storeId}::uuid and r.id = ${id}::uuid`,
  );
  if (!row) return { ok: false, problem: "unreadable" };
  // Where the money is (`shopMoneyAccount()`): a gift card's and store credit's off what cards owe, a way of paying not followed yet waits.
  const place = shopMoneyAccount({ provider: row.provider, method: row.method, refundKind: row.kind });
  if ("wait" in place) return { ok: false, problem: place.wait };
  if ("skip" in place) return { ok: false, problem: "nothing" };
  // In another currency: the receivable at its document's own rate, the money at what it was worth in the book's currency.
  let rates: PaymentRates | null = null;
  if (row.currency !== book.currency) {
    const priced = await shopMoneyRates(storeId, book.currency, kind, id, row.provider, row.day);
    if ("problem" in priced) return { ok: false, problem: priced.problem };
    rates = priced.rates;
  }
  const made = entryOfPayment(
    {
      id: row.id,
      invoiceNumber: "",
      what: `ordre ${row.order_number}`,
      counterparty: null,
      receivedOn: row.day,
      amountMinor: kind === "shop_payment" ? row.amount_minor : -row.amount_minor,
      currency: row.currency,
      method: "other",
      sourceKind: kind,
      account: place.account,
    },
    posting,
    book.currency,
    rates,
  );
  if (!made.ok) return made;
  const posted = await postLedgerEntry(book.id, made.entry, null);
  return posted.ok ? posted : { ok: false, problem: posted.problems[0] };
}

/**
 * Posts a dispute's money as a paid payout's line shows it (step 2c, `entryOfDisputeLine()`): taken back from the provider's balance, the
 * order's receivable open again; given back, cleared again. Only in the book's currency for now: another waits.
 */
async function postDisputeLine(
  storeId: string,
  book: { id: string; currency: string },
  posting: LedgerPosting,
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; problem: PaymentProblem | PostProblem | "unreadable" }> {
  const line = await typedRow(
    z.object({ id: col.uuid, amount_minor: col.minor, currency: col.currency, day: col.text, order_number: col.textOrNull }),
    sql`
      select l.id, l.amount_minor, l.currency, ((l.provider_created_at at time zone s.time_zone)::date)::text as day, o.number as order_number
        from commerce.payout_lines l
        join commerce.stores s on s.id = l.store_id
        left join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
       where l.store_id = ${storeId}::uuid and l.id = ${id}::uuid and l.kind = 'dispute'
    `,
  );
  if (!line) return { ok: false, problem: "unreadable" };
  if (line.currency !== book.currency) return { ok: false, problem: "currency" };
  const made = entryOfDisputeLine({ id: line.id, day: line.day, amountMinor: line.amount_minor, orderNumber: line.order_number }, posting);
  if (!made.ok) return made;
  const posted = await postLedgerEntry(book.id, made.entry, null);
  return posted.ok ? posted : { ok: false, problem: posted.problems[0] };
}

/**
 * Posts a paid payout (step 2c, `entryOfPayout()`): its fees are what its lines say Stripe kept (each line's fee, and a fee of its own as a
 * line), so one whose lines are not read yet waits (`lines`); a manual payout lists none and is posted at its amount alone.
 */
async function postPayout(
  storeId: string,
  book: { id: string; currency: string },
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; problem: PaymentProblem | PostProblem | "unreadable" | "lines" }> {
  const payout = await typedRow(
    z.object({ id: col.uuid, provider: col.text, amount_minor: col.minor, currency: col.currency, automatic: col.bool, lines_complete: col.bool, day: col.text, fees: col.minor }),
    sql`
      select po.id, po.provider, po.amount_minor, po.currency, po.automatic, po.lines_complete,
             coalesce(po.arrival_on, (po.provider_created_at at time zone s.time_zone)::date)::text as day,
             coalesce((select sum(l.fee_minor) + sum(case when l.kind = 'fee' then -l.amount_minor else 0 end)
                         from commerce.payout_lines l where l.store_id = po.store_id and l.payout_id = po.id), 0) as fees
        from commerce.payouts po join commerce.stores s on s.id = po.store_id
       where po.store_id = ${storeId}::uuid and po.id = ${id}::uuid
    `,
  );
  if (!payout) return { ok: false, problem: "unreadable" };
  if (payout.currency !== book.currency) return { ok: false, problem: "currency" };
  if (payout.automatic && !payout.lines_complete) return { ok: false, problem: "lines" };
  const made = entryOfPayout({ id: payout.id, day: payout.day, amountMinor: payout.amount_minor, feeMinor: payout.fees, provider: payout.provider });
  if (!made.ok) return made;
  const posted = await postLedgerEntry(book.id, made.entry, null);
  return posted.ok ? posted : { ok: false, problem: posted.problems[0] };
}

/** What waits in a book, and why: for the books' screen. */
export async function ledgerWaiting(bookId: string): Promise<{ kind: string; id: string; problem: string; since: string }[]> {
  const rows = await typedRows(
    z.object({ source_kind: col.text, source_id: col.text, problem: col.text, since: col.timestamp }),
    sql`select source_kind, source_id, problem, since from commerce.ledger_waiting where book_id = ${bookId}::uuid order by since, source_kind, source_id`,
  );
  return rows.map((r) => ({ kind: r.source_kind, id: r.source_id, problem: r.problem, since: r.since }));
}

/**
 * Posts a book's due documents (`dueDocuments()`), up to `limit` or the deadline: each posted once where `postingOf()` says; one that cannot
 * be posted as it is waits with why (`ledger_waiting`), and stops waiting once posted.
 */
export async function postDueDocuments(
  storeId: string,
  book: { id: string; currency: string; opened_on: string; closed_on: string | null },
  options: { limit?: number; deadline?: number } = {},
): Promise<{ posted: number; waiting: number }> {
  const due = await dueDocuments(storeId, book, options.limit ?? DOCS_A_ROUND);
  if (due.length === 0) return { posted: 0, waiting: 0 };
  const posting = await postingOf(storeId);
  await chartFor(storeId, book.id, posting);
  let posted = 0;
  let waiting = 0;
  for (const d of due) {
    if (options.deadline && Date.now() > options.deadline) break;
    let result: { ok: true; id: string } | { ok: false; problem: string };
    if (d.kind === "work_payment") result = await postPayment(storeId, book, posting, d.id);
    else if (d.kind === "shop_payment" || d.kind === "shop_refund") result = await postShopMoney(storeId, book, posting, d.kind, d.id);
    else if (d.kind === "payout") result = await postPayout(storeId, book, d.id);
    else if (d.kind === "dispute") result = await postDisputeLine(storeId, book, posting, d.id);
    else {
      const loaded = await loadDocument(storeId, d.kind as DocumentKind, d.id);
      const fx = loaded && loaded.doc.currency !== book.currency ? await docRateOf(storeId, d.kind as DocumentKind, d.id, book.currency) : null;
      result = loaded ? await postLedgerDoc({ id: book.id, currency: book.currency }, loaded.doc, posting, null, fx) : { ok: false as const, problem: "unreadable" };
    }
    if (result.ok) {
      posted += 1;
      await db().execute(sql`delete from commerce.ledger_waiting where book_id = ${book.id}::uuid and source_kind = ${d.kind} and source_id = ${d.id}`);
      continue;
    }
    waiting += 1;
    await db().execute(sql`
      insert into commerce.ledger_waiting (store_id, book_id, source_kind, source_id, problem)
      values (${storeId}::uuid, ${book.id}::uuid, ${d.kind}, ${d.id}, ${result.problem})
      on conflict (book_id, source_kind, source_id) do update set problem = excluded.problem, tried_at = now()
    `);
  }
  if (waiting > 0) log("info", "ledger.documents_waiting", { storeId, bookId: book.id, waiting });
  return { posted, waiting };
}

/**
 * The dispatcher's `ledger` job (D478 steps 2 and 4): each store's books, open or closed in the last 60 days, post the documents issued in
 * their days, and the open ones compare what is posted with Tripletex, store after store within 40 seconds.
 */
export async function runLedgerPosting(options: { budgetMs?: number } = {}): Promise<{ books: number; posted: number; waiting: number; compared: number }> {
  const deadline = Date.now() + (options.budgetMs ?? BUDGET_MS);
  const books = await typedRows(
    z.object({ id: col.uuid, store_id: col.uuid, currency: col.currency, opened_on: col.text, closed_on: col.textOrNull }),
    sql`select id, store_id, currency, opened_on::text, closed_on::text from commerce.ledger_books
         where closed_on is null or closed_on >= current_date - 60
         order by updated_at`,
  );
  let posted = 0;
  let waiting = 0;
  let compared = 0;
  let done = 0;
  for (const book of books) {
    if (Date.now() > deadline) break;
    try {
      const r = await postDueDocuments(book.store_id, book, { deadline });
      posted += r.posted;
      waiting += r.waiting;
      // Step 4: what is posted here, compared with what Tripletex holds for it.
      if (book.closed_on === null) compared += (await compareWithTripletex(book.store_id, book, { deadline })).compared;
      done += 1;
    } catch (error) {
      log("error", "ledger.posting_failed", { storeId: book.store_id, bookId: book.id }, error);
    }
  }
  // B4: bank lines matched to what was just posted (a payout's entry may come after the statement that shows it).
  if (Date.now() < deadline) {
    try {
      await matchAllBankStatements(deadline);
    } catch (error) {
      log("error", "bank.matching_failed", {}, error);
    }
  }
  return { books: done, posted, waiting, compared };
}

