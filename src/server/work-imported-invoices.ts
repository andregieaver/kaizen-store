import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";

import { audit, type Membership } from "./auth";
import { reverseLedgerEntry } from "./ledger";
import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Tidying invoices brought in from elsewhere (D501): an imported invoice (from Tripletex, Life, or recorded as issued elsewhere) that is
 * wrong or here twice can be deleted, or merged into the invoice it is the same as. Only while nothing hangs on it: no payment, no credit
 * note, no loss, no time logged on its lines (the database's guard holds the same, and only while it is told the work is the import's).
 * One posted to the books has its entry reversed first, so the books never hold an invoice that is gone. An invoice issued from Kaizena
 * Flow is never deleted: the Bookkeeping Act has a mistake corrected by a credit note. Owners only; audited.
 */

export type TidyProblem = "not_found" | "not_imported" | "hanging" | "same" | "different" | "books";
export type MergeCandidate = { id: string; number: string; issuedOn: string | null; status: string };

const INVOICE = z.object({
  id: col.uuid,
  client_id: col.uuid,
  currency: col.currency,
  total_minor: col.minor,
  imported: z.boolean(),
  status: col.text,
  legacy_number: col.textOrNull,
  document_number: col.textOrNull,
  hanging: z.boolean(),
});

async function invoiceOf(storeId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return typedRow(
    INVOICE,
    sql`
      select i.id, i.client_id, i.currency, i.total_minor, i.imported, i.status, i.legacy_number, i.document_number,
             (exists (select 1 from commerce.work_invoice_payments p where p.store_id = i.store_id and p.invoice_id = i.id)
              or exists (select 1 from commerce.work_credit_notes c where c.store_id = i.store_id and c.invoice_id = i.id)
              or exists (select 1 from commerce.work_invoice_losses l where l.store_id = i.store_id and l.invoice_id = i.id)
              or exists (select 1 from commerce.work_time_entries e join commerce.work_invoice_lines w on w.store_id = e.store_id and w.id = e.invoice_line_id
                          where w.store_id = i.store_id and w.invoice_id = i.id)) as hanging
        from commerce.work_invoices i
       where i.store_id = ${storeId}::uuid and i.id = ${id}::uuid
    `,
  );
}

/** Whether an imported invoice may be tidied, and the invoices it may be merged into: the same client, currency and total, issued. */
export async function tidyOptions(storeId: string, invoiceId: string): Promise<{ deletable: boolean; candidates: MergeCandidate[] }> {
  const invoice = await invoiceOf(storeId, invoiceId);
  if (!invoice || !invoice.imported || invoice.status === "draft") return { deletable: false, candidates: [] };
  const candidates = await typedRows(
    z.object({ id: col.uuid, number: col.text, issued_on: col.textOrNull, status: col.text }),
    sql`
      select id, coalesce(legacy_number, document_number, '') as number, issued_on::text, status from commerce.work_invoices
       where store_id = ${storeId}::uuid and id <> ${invoiceId}::uuid and client_id = ${invoice.client_id}::uuid and currency = ${invoice.currency}
         and total_minor = ${invoice.total_minor} and status <> 'draft'
       order by issued_on, id
       limit 20
    `,
  );
  return { deletable: !invoice.hanging, candidates: invoice.hanging ? [] : candidates.map((c) => ({ id: c.id, number: c.number, issuedOn: c.issued_on, status: c.status })) };
}

/** Reverses the invoice's entry in the books where it has one that stands; false when the books would not take the reversal. */
async function unpost(member: Membership, invoiceId: string): Promise<boolean> {
  const entries = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      select e.id from commerce.ledger_entries e
       where e.store_id = ${member.store.id}::uuid and e.source_kind = 'work_invoice' and e.source_id = ${invoiceId} and e.reverses is null
         and not exists (select 1 from commerce.ledger_entries r where r.reverses = e.id)
    `,
  );
  const [{ today }] = await db().execute<{ today: string }>(sql`select commerce.store_day(${member.store.id}::uuid, now())::text as today`);
  for (const e of entries) {
    const reversed = await reverseLedgerEntry(member, e.id, String(today));
    if (!reversed.ok) {
      log("warn", "work.tidy_unpost_refused", { storeId: member.store.id, invoiceId, problem: reversed.problem });
      return false;
    }
  }
  await db().execute(sql`delete from commerce.ledger_waiting where store_id = ${member.store.id}::uuid and source_kind = 'work_invoice' and source_id = ${invoiceId}`);
  return true;
}

/** Deletes an imported invoice nothing hangs on, its entry in the books reversed first. */
export async function deleteImportedInvoice(member: Membership, invoiceId: string): Promise<{ ok: true; number: string } | { ok: false; problem: TidyProblem }> {
  const invoice = await invoiceOf(member.store.id, invoiceId);
  if (!invoice) return { ok: false, problem: "not_found" };
  if (!invoice.imported || invoice.status === "draft") return { ok: false, problem: "not_imported" };
  if (invoice.hanging) return { ok: false, problem: "hanging" };
  if (!(await unpost(member, invoice.id))) return { ok: false, problem: "books" };
  await db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('commerce.work_importing', 'on', true)`);
    await tx.execute(sql`delete from commerce.work_invoices where store_id = ${member.store.id}::uuid and id = ${invoice.id}::uuid`);
  });
  const number = invoice.legacy_number ?? invoice.document_number ?? "";
  await audit(member.account.id, member.store.id, "work.invoice.imported_deleted", { invoiceId: invoice.id, number });
  return { ok: true, number };
}

/**
 * Merges an imported invoice into the one it is the same as (the same client, currency and total): the copy deleted as above, and the
 * invoice kept takes the copy's number when it is imported and came without one (Life's, D494), as an import would.
 */
export async function mergeImportedInvoice(
  member: Membership,
  invoiceId: string,
  intoId: string,
): Promise<{ ok: true; number: string } | { ok: false; problem: TidyProblem }> {
  const [copy, kept] = await Promise.all([invoiceOf(member.store.id, invoiceId), invoiceOf(member.store.id, intoId)]);
  if (!copy || !kept) return { ok: false, problem: "not_found" };
  if (copy.id === kept.id) return { ok: false, problem: "same" };
  if (!copy.imported || copy.status === "draft" || kept.status === "draft") return { ok: false, problem: "not_imported" };
  if (copy.hanging) return { ok: false, problem: "hanging" };
  if (copy.client_id !== kept.client_id || copy.currency !== kept.currency || copy.total_minor !== kept.total_minor) return { ok: false, problem: "different" };
  if (!(await unpost(member, copy.id))) return { ok: false, problem: "books" };
  const copyNumber = copy.legacy_number;
  await db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('commerce.work_importing', 'on', true)`);
    await tx.execute(sql`delete from commerce.work_invoices where store_id = ${member.store.id}::uuid and id = ${copy.id}::uuid`);
    if (kept.imported && kept.legacy_number === null && copyNumber) {
      await tx.execute(sql`
        update commerce.work_invoices set legacy_number = ${copyNumber}, document_number = ${copyNumber}
         where store_id = ${member.store.id}::uuid and id = ${kept.id}::uuid and legacy_number is null`);
    }
    await tx.execute(sql`
      select commerce.work_event(${member.store.id}::uuid, 'invoice', ${kept.id}::uuid, 'invoice.merged',
        ${JSON.stringify({ merged: copy.id, number: copyNumber ?? copy.document_number, by_hand: true })}::jsonb, ${member.account.id}::uuid)`);
  });
  const number = kept.legacy_number ?? copyNumber ?? kept.document_number ?? "";
  await audit(member.account.id, member.store.id, "work.invoice.imported_merged", { invoiceId: copy.id, intoId: kept.id });
  return { ok: true, number };
}
