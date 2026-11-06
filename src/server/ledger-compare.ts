import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { compareWithTheirs, type Difference, type TheirPosting } from "@/lib/ledger";
import { minorOf } from "@/lib/tripletex";

import { log } from "./log";
import { getTripletexConnection, tripletexCredential } from "./tripletex";
import { openSession, type TripletexDeps } from "./tripletex-client";
import { col, typedRows } from "./typed-rows";

/**
 * Our own ledger, step 4 (D478): each document posted to a store's books is compared with the voucher Tripletex holds for it, account by
 * account and in VAT (`compareWithTheirs()`), read back as the sync reads it (`GET /ledger/voucher/{id}` with its postings' account numbers
 * and amounts). One that agrees is kept so; one that differs or whose voucher is gone is compared again a day later. Reads only from
 * Tripletex. The pilot's exit is three months in which every document agrees.
 */

const DUE = z.object({ entry_id: col.uuid, source_kind: col.text, source_id: col.text, their_id: col.minor });

type VoucherRead = { value?: { postings?: { account?: { number?: unknown }; amountGross?: unknown; amount?: unknown }[] } };

/** A voucher's postings as compared, or null when one cannot be read. */
function theirPostings(read: VoucherRead): TheirPosting[] | null {
  const postings = read.value?.postings;
  if (!Array.isArray(postings)) return null;
  const out: TheirPosting[] = [];
  for (const p of postings) {
    const account = Number(p.account?.number);
    const grossMinor = minorOf(p.amountGross);
    const netMinor = minorOf(p.amount);
    if (!Number.isInteger(account) || grossMinor === null || netMinor === null) return null;
    out.push({ account, grossMinor, netMinor });
  }
  return out;
}

/**
 * Compares a book's documents with Tripletex: those posted here and booked there (the sync's row, `synced`, with Tripletex's voucher id)
 * that were never compared, or that differ and were compared more than a day ago, up to `limit` or the deadline.
 */
export async function compareWithTripletex(
  storeId: string,
  book: { id: string },
  options: { deps?: TripletexDeps; limit?: number; deadline?: number } = {},
): Promise<{ compared: number; agree: number; differ: number; missing: number }> {
  const done = { compared: 0, agree: 0, differ: 0, missing: 0 };
  const connection = await getTripletexConnection(storeId);
  if (!connection || connection.state !== "on") return done;
  const due = await typedRows(
    DUE,
    sql`
      select e.id as entry_id, e.source_kind, e.source_id, t.their_id
        from commerce.ledger_entries e
        join commerce.tripletex_sync t
          on t.store_id = e.store_id and t.mode = ${connection.mode} and t.company_id = ${connection.company.id}
         and t.kind = e.source_kind and t.local_id = e.source_id and t.state = 'synced' and t.their_id is not null
        left join commerce.ledger_comparisons c on c.book_id = e.book_id and c.source_kind = e.source_kind and c.source_id = e.source_id
       where e.book_id = ${book.id}::uuid and e.reverses is null
         and not exists (select 1 from commerce.ledger_entries r where r.reverses = e.id)
         and (c.book_id is null or (c.state <> 'agrees' and c.compared_at < now() - interval '1 day'))
       order by e.entry_date, e.series, e.number
       limit ${options.limit ?? 25}
    `,
  );
  if (due.length === 0) return done;
  const credential = await tripletexCredential(storeId);
  if (!credential) return done;
  const opened = await openSession(credential, options.deps ?? {});
  if (!opened.ok) {
    log("warn", "ledger.compare_no_session", { storeId, key: opened.failure.key });
    return done;
  }
  for (const d of due) {
    if (options.deadline && Date.now() > options.deadline) break;
    const read = await opened.session.get<VoucherRead>(`/ledger/voucher/${d.their_id}`, { fields: "id,postings(account(number),amountGross,amount)" });
    let state: "agrees" | "differs" | "missing";
    let differences: Difference[] = [];
    if (!read.ok) {
      if (read.failure.class !== "drift") continue;
      state = "missing";
    } else {
      const theirs = theirPostings(read.value);
      if (!theirs) continue;
      const ours = await typedRows(
        z.object({ account: col.int, amount_minor: col.minor }),
        sql`select account, amount_minor from commerce.ledger_lines where entry_id = ${d.entry_id}::uuid`,
      );
      const compared = compareWithTheirs(
        ours.map((l) => ({ account: l.account, amountMinor: l.amount_minor })),
        theirs,
      );
      state = compared.agrees ? "agrees" : "differs";
      differences = compared.differences;
    }
    await db().execute(sql`
      insert into commerce.ledger_comparisons (store_id, book_id, source_kind, source_id, state, differences, their_id, compared_at)
      values (${storeId}::uuid, ${book.id}::uuid, ${d.source_kind}, ${d.source_id}, ${state}, ${JSON.stringify(differences)}::jsonb, ${d.their_id}, now())
      on conflict (book_id, source_kind, source_id) do update
        set state = excluded.state, differences = excluded.differences, their_id = excluded.their_id, compared_at = now()
    `);
    done.compared += 1;
    if (state === "agrees") done.agree += 1;
    else if (state === "differs") done.differ += 1;
    else done.missing += 1;
  }
  if (done.differ + done.missing > 0) log("warn", "ledger.compare_differs", { storeId, bookId: book.id, differ: done.differ, missing: done.missing });
  return done;
}

export type LedgerComparisonSummary = {
  agree: number;
  differ: number;
  missing: number;
  /** The documents that differ or are gone, newest first, with the entry's words and what differs. */
  items: { kind: string; id: string; text: string; state: "differs" | "missing"; differences: Difference[] }[];
};

/** What the comparison with Tripletex has found for a book: how many agree, differ or are gone, and the ones that do not agree. */
export async function ledgerComparisonSummary(bookId: string): Promise<LedgerComparisonSummary> {
  const rows = await typedRows(
    z.object({ source_kind: col.text, source_id: col.text, state: z.enum(["agrees", "differs", "missing"]), differences: z.unknown(), text: col.textOrNull }),
    sql`
      select c.source_kind, c.source_id, c.state, c.differences,
             (select e.text from commerce.ledger_entries e where e.book_id = c.book_id and e.source_kind = c.source_kind and e.source_id = c.source_id
               order by e.posted_at desc limit 1) as text
        from commerce.ledger_comparisons c
       where c.book_id = ${bookId}::uuid
       order by c.compared_at desc
    `,
  );
  const summary: LedgerComparisonSummary = { agree: 0, differ: 0, missing: 0, items: [] };
  for (const r of rows) {
    if (r.state === "agrees") summary.agree += 1;
    else {
      if (r.state === "differs") summary.differ += 1;
      else summary.missing += 1;
      summary.items.push({ kind: r.source_kind, id: r.source_id, text: r.text ?? "", state: r.state, differences: Array.isArray(r.differences) ? (r.differences as Difference[]) : [] });
    }
  }
  return summary;
}
