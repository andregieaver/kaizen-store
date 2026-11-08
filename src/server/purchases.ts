import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { entryOfPurchase, PURCHASE_KINDS, purchaseAccounts, vatRateOf, voucherTypeOf, type PurchaseKind, type PurchaseVatRate } from "@/lib/purchases";

import { audit, type Membership } from "./auth";
import { BANK_ACCOUNT } from "./bank-statements";
import { documentStorage, type DocumentStorage } from "./invoice-storage";
import { addLedgerAccount, ledgerAccounts, postLedgerEntry, type PostProblem } from "./ledger";
import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A purchase the bank's statement shows, posted with its receipt (B3 of `docs/own-books-and-sales.md`, D490): the owner adds the receipt (a
 * photo or a PDF) to a line of money out the books do not have, says what it was and its VAT rate, and it is posted (`entryOfPurchase()`:
 * the cost and the deductible VAT apart, against the bank) and matched to the line. The receipt is the entry's voucher, kept in the private
 * `documents` bucket and in `commerce.ledger_vouchers`, never changed; without a place to keep it nothing is posted.
 */

/** The largest receipt taken: a phone's photo, under the admin form's 4 MB request. */
export const VOUCHER_BYTES = 3 * 1024 * 1024;

export type PurchaseProblem = "line" | "file" | "type" | "too_big" | "storage" | PostProblem;

export async function postPurchaseFromBank(
  member: Membership,
  lineId: string,
  input: { kind: PurchaseKind; vatRate: PurchaseVatRate; abroad?: boolean; text?: string | null },
  file: { name: string; bytes: Uint8Array },
  deps: { storage?: DocumentStorage | null } = {},
): Promise<{ ok: true; entryId: string; voucherId: string; account: number } | { ok: false; problem: PurchaseProblem }> {
  const storeId = member.store.id;
  if (file.bytes.length === 0) return { ok: false, problem: "file" };
  if (file.bytes.length > VOUCHER_BYTES) return { ok: false, problem: "too_big" };
  const type = voucherTypeOf(file.bytes);
  if (!type) return { ok: false, problem: "type" };
  const line = await typedRow(
    z.object({ id: col.uuid, book_id: col.uuid, day: col.text, amount_minor: col.minor, text: col.text }),
    sql`select b.id, b.book_id, b.booked_on::text as day, b.amount_minor, b.text
          from commerce.bank_lines b join commerce.ledger_books k on k.id = b.book_id
         where b.id = ${lineId}::uuid and b.store_id = ${storeId}::uuid and b.ledger_account = ${BANK_ACCOUNT}
           and b.entry_id is null and b.amount_minor < 0 and k.closed_on is null`,
  );
  if (!line) return { ok: false, problem: "line" };
  const entry = entryOfPurchase({ id: line.id, day: line.day, amountMinor: line.amount_minor, text: line.text }, input);
  if (!entry) return { ok: false, problem: "line" };
  // The accounts it posts to, added to the chart when the book has not got them.
  const abroad = input.abroad ?? false;
  const rate = abroad ? 0 : vatRateOf(input.kind, input.vatRate);
  const needed = purchaseAccounts(input.kind, input.vatRate, abroad);
  const have = new Set((await ledgerAccounts(line.book_id)).map((a) => a.number));
  for (const number of needed) if (!have.has(number)) await addLedgerAccount(storeId, line.book_id, { number });

  // The receipt is kept first: an entry is never posted without its voucher.
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  if (!storage) return { ok: false, problem: "storage" };
  const voucherId = randomUUID();
  const path = `${storeId}/vouchers/${voucherId}.${type.ext}`;
  if (!(await storage.upload(path, file.bytes, type.contentType))) return { ok: false, problem: "storage" };
  const posted = await postLedgerEntry(line.book_id, entry, member.account.id);
  if (!posted.ok) {
    await storage.remove([path]);
    return { ok: false, problem: posted.problems[0] };
  }
  const name = file.name.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 200) || `kvittering.${type.ext}`;
  await db().execute(sql`
    insert into commerce.ledger_vouchers (id, store_id, book_id, entry_id, bank_line_id, file_path, file_name, content_type, size_bytes, sha256, uploaded_by)
    values (${voucherId}::uuid, ${storeId}::uuid, ${line.book_id}::uuid, ${posted.id}::uuid, ${line.id}::uuid, ${path}, ${name}, ${type.contentType},
            ${file.bytes.length}, ${createHash("sha256").update(file.bytes).digest("hex")}, ${member.account.id}::uuid)`);
  try {
    await db().execute(sql`
      update commerce.bank_lines set entry_id = ${posted.id}::uuid, matched_at = now()
       where id = ${line.id}::uuid and store_id = ${storeId}::uuid and entry_id is null`);
  } catch (error) {
    log("info", "bank.purchase_match_taken", { storeId, lineId }, error);
  }
  await audit(member.account.id, storeId, "work.purchase_posted", { lineId, entryId: posted.id, voucherId, kind: input.kind, vatRate: rate, abroad });
  return { ok: true, entryId: posted.id, voucherId, account: PURCHASE_KINDS[input.kind].account };
}

/** A line of money out a purchase may be posted from (open, not matched): its amount and the book's currency, for reading its receipt. */
export async function purchaseLine(storeId: string, lineId: string): Promise<{ amountMinor: number; currency: string } | null> {
  const row = await typedRow(
    z.object({ amount_minor: col.minor, currency: col.currency }),
    sql`select b.amount_minor, k.currency from commerce.bank_lines b join commerce.ledger_books k on k.id = b.book_id
         where b.id = ${lineId}::uuid and b.store_id = ${storeId}::uuid and b.entry_id is null and b.amount_minor < 0 and k.closed_on is null`,
  );
  return row ? { amountMinor: row.amount_minor, currency: row.currency } : null;
}

export type VoucherView = { id: string; entryId: string; fileName: string; contentType: string };

/** The vouchers of entries of a book, by entry (the journal's *Receipt* links). */
export async function vouchersOf(storeId: string, entryIds: readonly string[]): Promise<Map<string, VoucherView>> {
  if (entryIds.length === 0) return new Map();
  const rows = await typedRows(
    z.object({ id: col.uuid, entry_id: col.uuid, file_name: col.text, content_type: col.text }),
    sql`select id, entry_id, file_name, content_type from commerce.ledger_vouchers
         where store_id = ${storeId}::uuid and entry_id in (${sql.join(entryIds.map((id) => sql`${id}::uuid`), sql`, `)})
         order by created_at`,
  );
  return new Map(rows.map((r) => [r.entry_id, { id: r.id, entryId: r.entry_id, fileName: r.file_name, contentType: r.content_type }]));
}

/** A voucher's file, for a member of its store who may read the books: its bytes, type and name, or null. */
export async function readVoucher(
  storeId: string,
  voucherId: string,
  deps: { storage?: DocumentStorage | null } = {},
): Promise<{ bytes: Uint8Array; contentType: string; fileName: string } | null> {
  const row = await typedRow(
    z.object({ file_path: col.text, content_type: col.text, file_name: col.text }),
    sql`select file_path, content_type, file_name from commerce.ledger_vouchers where store_id = ${storeId}::uuid and id = ${voucherId}::uuid`,
  );
  if (!row || !row.file_path.startsWith(`${storeId}/vouchers/`)) return null;
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  const bytes = storage ? await storage.download(row.file_path).catch(() => null) : null;
  return bytes ? { bytes, contentType: row.content_type, fileName: row.file_name } : null;
}
