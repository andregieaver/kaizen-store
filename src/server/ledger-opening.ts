import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { nearestStandard, openingBalanceOf, type OpeningProblem, type TheirBalance } from "@/lib/ledger";
import { minorOf } from "@/lib/tripletex";

import type { Membership } from "./auth";
import { audit } from "./auth";
import { addLedgerAccount, ledgerAccounts, openBookOf, postLedgerEntry, type PostProblem } from "./ledger";
import { log } from "./log";
import { getTripletexConnection, tripletexCredential } from "./tripletex";
import { listAll, openSession, type TripletexDeps, type TripletexSession } from "./tripletex-client";
import { col, typedRow } from "./typed-rows";

/**
 * Our own ledger, step 2d (D478): the opening balance read from the system the store kept its books in until its books here opened, so
 * the two start from the same place. Tripletex first: its balance sheet (`GET /balanceSheet`) for the day before the books open, each
 * balance sheet account at what it held and, when they open during a year, each profit and loss account at what it moved since 1 January
 * (`openingBalanceOf()`). Posted once, in the opening balance's series on the day the books open, as an entry the owner can reverse and read
 * again. Reads only from Tripletex.
 */

/** The opening balance's entry, posted once for its source (a reversed one may be read again). */
const SOURCE = { kind: "opening_balance", id: "tripletex" } as const;

export type OpeningResult =
  | { ok: true; id: string; accounts: number; carriedMinor: number }
  | { ok: false; problem: "book" | "posted" | "connection" | "session" | "read" | "account" | OpeningProblem | PostProblem; differenceMinor?: number };

type BalanceRow = { account?: { number?: unknown; name?: unknown }; balanceIn?: unknown; balanceChange?: unknown; balanceOut?: unknown };

/** The day after a day (`YYYY-MM-DD`), in plain dates. */
const dayAfter = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Each account's balance in Tripletex for books that open on `opensOn`: on 1 January what it held as that day began (`balanceIn` of the day),
 * otherwise what it held as the day before ended (`balanceOut` from 1 January to that day, exclusive) and what it moved in the year so far
 * (`balanceChange`). Null when Tripletex's answer cannot be read as amounts.
 */
export async function readTripletexBalances(session: TripletexSession, opensOn: string): Promise<{ ok: true; balances: TheirBalance[] } | { ok: false }> {
  const yearStart = `${opensOn.slice(0, 4)}-01-01`;
  const onNewYear = opensOn === yearStart;
  const read = await listAll<BalanceRow>(session, "/balanceSheet", {
    dateFrom: onNewYear ? opensOn : yearStart,
    dateTo: onNewYear ? dayAfter(opensOn) : opensOn,
    fields: "account(number,name),balanceIn,balanceChange,balanceOut",
  });
  if (!read.ok) return { ok: false };
  const balances: TheirBalance[] = [];
  for (const row of read.value) {
    const number = Number(row.account?.number);
    const atOpening = minorOf(onNewYear ? row.balanceIn : row.balanceOut);
    const yearToDate = onNewYear ? 0 : minorOf(row.balanceChange);
    if (!Number.isInteger(number) || atOpening === null || yearToDate === null) return { ok: false };
    balances.push({ number, name: String(row.account?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120), atOpeningMinor: atOpening, yearToDateMinor: yearToDate });
  }
  return { ok: true, balances };
}

/** Whether the book already has an opening balance from Tripletex that stands (not reversed). */
export async function hasOpeningBalance(bookId: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ one: col.int }),
    sql`
      select 1 as one from commerce.ledger_entries e
       where e.book_id = ${bookId}::uuid and e.source_kind = ${SOURCE.kind} and e.reverses is null
         and not exists (select 1 from commerce.ledger_entries r where r.reverses = e.id)
       limit 1`,
  );
  return row !== null;
}

/**
 * Reads the opening balance from the store's Tripletex and posts it to its open books (the owner's press on Settings → Books): any account
 * of Tripletex's own that the chart lacks is added first, reporting as its nearest standard account. Nothing is posted when the books already
 * have one, when Tripletex cannot be read, or when its trial balance does not balance.
 */
export async function postOpeningFromTripletex(member: Membership, deps: TripletexDeps = {}): Promise<OpeningResult> {
  const storeId = member.store.id;
  const book = await openBookOf(storeId);
  if (!book) return { ok: false, problem: "book" };
  if (await hasOpeningBalance(book.id)) return { ok: false, problem: "posted" };
  const connection = await getTripletexConnection(storeId);
  const credential = connection ? await tripletexCredential(storeId) : null;
  if (!credential) return { ok: false, problem: "connection" };
  const opened = await openSession(credential, deps);
  if (!opened.ok) {
    log("warn", "ledger.opening_no_session", { storeId, key: opened.failure.key });
    return { ok: false, problem: "session" };
  }
  const read = await readTripletexBalances(opened.session, book.openedOn);
  if (!read.ok) return { ok: false, problem: "read" };
  const made = openingBalanceOf(read.balances);
  if (!made.ok) return { ok: false, problem: made.problem, differenceMinor: made.differenceMinor };

  const have = new Set((await ledgerAccounts(book.id)).map((a) => a.number));
  for (const line of made.lines) {
    if (have.has(line.account)) continue;
    const added = await addLedgerAccount(storeId, book.id, { number: line.account, name: line.name || undefined, standard: nearestStandard(line.account) });
    if (!added.ok && added.problem !== "taken") {
      log("warn", "ledger.opening_account", { storeId, bookId: book.id, account: line.account, problem: added.problem });
      return { ok: false, problem: "account" };
    }
  }
  const posted = await postLedgerEntry(
    book.id,
    {
      series: "IB",
      date: book.openedOn,
      text: "Inngående balanse fra Tripletex",
      source: SOURCE,
      lines: made.lines.map(({ account, amountMinor, vatCode, text }) => ({ account, amountMinor, vatCode, text })),
    },
    member.account.id,
  );
  if (!posted.ok) return { ok: false, problem: posted.problems[0] };
  await audit(member.account.id, storeId, "work.ledger_opening_posted", { accounts: made.lines.length, carried: made.carriedMinor !== 0 }, { target: { type: "ledger_entry", id: posted.id } });
  return { ok: true, id: posted.id, accounts: made.lines.length, carriedMinor: made.carriedMinor };
}
