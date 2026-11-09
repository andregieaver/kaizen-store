import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { NO_THRESHOLDS, watchThresholds, type OwnThreshold, type Watch } from "@/lib/turnover-watch";

import { audit, type Membership } from "./auth";
import { openBookOf } from "./ledger";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The threshold watch (D514, section 4.4 of `docs/own-books-and-sales.md`, `src/lib/turnover-watch.ts`): a store's turnover over the last
 * twelve months from its own books (the income accounts, class 3), against the country pack's legal thresholds (Norway's) and the owner's
 * own; read by the store home, the store checkup (and so the AI manager's checkup and the briefing) and the Books screen.
 */

/** The books' turnover over the twelve months to a day: what the income accounts (3000–3999) were credited, net of what was debited back. */
export async function turnoverOf(bookId: string, to: string): Promise<number> {
  const row = await typedRow(
    z.object({ turnover: col.minor }),
    sql`select coalesce(-sum(l.amount_minor), 0) as turnover
          from commerce.ledger_lines l join commerce.ledger_entries e on e.id = l.entry_id
         where l.book_id = ${bookId}::uuid and l.account between 3000 and 3999
           and e.entry_date > (${to}::date - interval '12 months') and e.entry_date <= ${to}::date`,
  );
  return row?.turnover ?? 0;
}

/** The owner's own thresholds, lowest first. */
export async function ownThresholds(storeId: string): Promise<OwnThreshold[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, amount_minor: col.minor, currency: col.currency, note: col.text }),
    sql`select id, amount_minor, currency, note from commerce.turnover_thresholds where store_id = ${storeId}::uuid order by amount_minor, created_at`,
  );
  return rows.map((r) => ({ id: r.id, amountMinor: r.amount_minor, currency: r.currency, note: r.note }));
}

/** What the watch says for a store today, with the turnover; nothing for a store without open books in a country with a pack. */
export async function turnoverWatch(storeId: string, today: string): Promise<{ turnoverMinor: number; currency: string; watches: Watch[] } | null> {
  const book = await openBookOf(storeId);
  if (!book || book.country !== "NO") return null;
  const monthAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const [turnover, monthAgoTurnover, own] = await Promise.all([turnoverOf(book.id, today), turnoverOf(book.id, monthAgo), ownThresholds(storeId)]);
  const watches = watchThresholds({ turnoverMinor: turnover, turnoverMonthAgoMinor: monthAgoTurnover, currency: book.currency, legalName: book.legalName, legal: NO_THRESHOLDS, own });
  return { turnoverMinor: turnover, currency: book.currency, watches };
}

export type ThresholdProblem = "amount" | "note";

/** Adds one of the owner's thresholds (an amount over twelve months, in the books' currency, and what they will do before it). Audited. */
export async function addOwnThreshold(member: Membership, input: { amountMinor: number; note: string }): Promise<{ ok: true } | { ok: false; problem: ThresholdProblem }> {
  const note = input.note.replace(/\s+/g, " ").trim();
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) return { ok: false, problem: "amount" };
  if (note.length < 1 || note.length > 120) return { ok: false, problem: "note" };
  const book = await openBookOf(member.store.id);
  const currency = book?.currency ?? "NOK";
  await db().execute(sql`
    insert into commerce.turnover_thresholds (store_id, amount_minor, currency, note, created_by)
    values (${member.store.id}::uuid, ${input.amountMinor}, ${currency}, ${note}, ${member.account.id}::uuid)`);
  await audit(member.account.id, member.store.id, "work.ledger_threshold_added", { amountMinor: input.amountMinor, currency });
  return { ok: true };
}

/** Takes one of the owner's thresholds away. Audited. */
export async function removeOwnThreshold(member: Membership, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  const rows = await db().execute(sql`delete from commerce.turnover_thresholds where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`);
  if (rows.length === 0) return false;
  await audit(member.account.id, member.store.id, "work.ledger_threshold_removed", { id });
  return true;
}
