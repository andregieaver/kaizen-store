import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { BOOKING_KEYS, shopCreditNoteDoc, shopInvoiceDoc, shopKey, workCreditNoteDoc, workInvoiceDoc, workLineKey, type BookingDoc, type BookingKey } from "@/lib/accounting-docs";
import type { CreditNoteSnapshot } from "@/lib/credit-allocation";
import type { OrderInvoiceSnapshot } from "@/lib/invoice-snapshot";

import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The documents every accounting connection books (Tripletex D453, Fiken D460), read once for all of them: an issued Work invoice or
 * credit note, a shop invoice or credit note, as a `BookingDoc` (`src/lib/accounting-docs.ts`), and the VAT buckets a store's own documents
 * of the last year used, so a setup asks only about those. Read-only.
 */

export type DocumentKind = "work_invoice" | "work_credit_note" | "shop_invoice" | "shop_credit_note";

export const DOCUMENT_KINDS: readonly DocumentKind[] = ["work_invoice", "work_credit_note", "shop_invoice", "shop_credit_note"];

/** A document read for booking: the document, the invoice a credit note refers to, and the Work invoice it belongs to (for Work's history). */
export type LoadedDocument = { doc: BookingDoc; invoiceId: string | null; workInvoiceId: string | null };

export async function loadDocument(storeId: string, kind: DocumentKind, id: string): Promise<LoadedDocument | null> {
  if (kind === "work_invoice") {
    const row = await typedRow(
      z.object({
        id: col.uuid,
        document_number: col.text,
        issued_on: col.text,
        due_on: col.textOrNull,
        currency: col.currency,
        total_minor: col.minor,
        vat_minor: col.minor,
        client_id: col.uuid,
        buyer_name: col.textOrNull,
        lines: z.array(z.object({ description: col.text, vat_category: col.text, vat_rate: col.text, incl_minor: col.minor, excl_minor: col.minor, vat_minor: col.minor })),
      }),
      sql`select i.id, i.document_number, i.issued_on::text as issued_on, i.due_on::text as due_on, i.currency, i.total_minor, i.vat_minor, i.client_id,
                 i.buyer ->> 'name' as buyer_name,
                 coalesce((select json_agg(json_build_object('description', l.description, 'vat_category', l.vat_category, 'vat_rate', l.vat_rate::text,
                                                             'incl_minor', l.incl_minor, 'excl_minor', l.excl_minor, 'vat_minor', l.vat_minor) order by l.position, l.id)
                             from commerce.work_invoice_lines l where l.store_id = i.store_id and l.invoice_id = i.id), '[]') as lines
            from commerce.work_invoices i where i.store_id = ${storeId}::uuid and i.id = ${id}::uuid`,
    );
    if (!row) return null;
    const doc = workInvoiceDoc({
      id: row.id,
      documentNumber: row.document_number,
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      currency: row.currency,
      totalMinor: row.total_minor,
      vatMinor: row.vat_minor,
      clientId: row.client_id,
      buyerName: row.buyer_name ?? "",
      lines: row.lines.map((l) => ({ description: l.description, vatCategory: l.vat_category, vatRate: l.vat_rate, inclMinor: l.incl_minor, exclMinor: l.excl_minor, vatMinor: l.vat_minor })),
    });
    return { doc, invoiceId: null, workInvoiceId: row.id };
  }
  if (kind === "work_credit_note") {
    const row = await typedRow(
      z.object({
        id: col.uuid,
        document_number: col.text,
        invoice_number: col.text,
        invoice_id: col.uuid,
        issued_on: col.text,
        currency: col.currency,
        total_minor: col.minor,
        vat_minor: col.minor,
        client_id: col.uuid,
        buyer_name: col.textOrNull,
        lines: z.unknown(),
      }),
      sql`select c.id, c.document_number, i.document_number as invoice_number, c.invoice_id, c.issued_on::text as issued_on, c.currency, c.total_minor, c.vat_minor,
                 i.client_id, c.buyer ->> 'name' as buyer_name, c.lines
            from commerce.work_credit_notes c join commerce.work_invoices i on i.store_id = c.store_id and i.id = c.invoice_id
           where c.store_id = ${storeId}::uuid and c.id = ${id}::uuid`,
    );
    if (!row) return null;
    const doc = workCreditNoteDoc({
      id: row.id,
      documentNumber: row.document_number,
      invoiceNumber: row.invoice_number,
      issuedOn: row.issued_on,
      dueOn: row.issued_on,
      currency: row.currency,
      totalMinor: row.total_minor,
      vatMinor: row.vat_minor,
      clientId: row.client_id,
      buyerName: row.buyer_name ?? "",
      lines: row.lines,
    });
    return { doc, invoiceId: row.invoice_id, workInvoiceId: row.invoice_id };
  }
  if (kind === "shop_invoice") {
    const row = await typedRow(z.object({ id: col.uuid, snapshot: z.record(z.string(), z.unknown()) }), sql`select id, snapshot from commerce.invoices where store_id = ${storeId}::uuid and id = ${id}::uuid`);
    return row ? { doc: shopInvoiceDoc(row.id, row.snapshot as unknown as OrderInvoiceSnapshot), invoiceId: null, workInvoiceId: null } : null;
  }
  const row = await typedRow(
    z.object({ id: col.uuid, invoice_id: col.uuid, snapshot: z.record(z.string(), z.unknown()), invoice_snapshot: z.record(z.string(), z.unknown()) }),
    sql`select c.id, c.invoice_id, c.snapshot, i.snapshot as invoice_snapshot
          from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
         where c.store_id = ${storeId}::uuid and c.id = ${id}::uuid`,
  );
  if (!row) return null;
  return {
    doc: shopCreditNoteDoc(row.id, row.snapshot as unknown as CreditNoteSnapshot, row.invoice_snapshot as unknown as OrderInvoiceSnapshot),
    invoiceId: row.invoice_id,
    workInvoiceId: null,
  };
}

/**
 * The buckets this store's documents of the last year fell in, so the setup asks only about those: Work's lines by category
 * and rate, the shop's by basis and rate (a gift card apart). With none yet, sales at 25 %.
 */
export async function neededKeys(storeId: string): Promise<BookingKey[]> {
  const work = await typedRows(
    z.object({ vat_category: col.text, vat_rate: col.text }),
    sql`select distinct l.vat_category, l.vat_rate::text as vat_rate
          from commerce.work_invoice_lines l
          join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
         where l.store_id = ${storeId}::uuid and i.status <> 'draft' and i.issued_on >= current_date - 365`,
  );
  const shop = await typedRows(
    z.object({ basis: col.text, rate: col.text, voucher: col.bool }),
    sql`select distinct line ->> 'basis' as basis, coalesce(line ->> 'vatRate', '0') as rate, coalesce((line ->> 'voucher')::boolean, false) as voucher
          from commerce.invoices i, jsonb_array_elements(i.snapshot -> 'lines') as line
         where i.store_id = ${storeId}::uuid and i.issued_on >= current_date - 365`,
  );
  const keys = new Set<BookingKey>();
  for (const w of work) {
    const key = workLineKey(w.vat_category, w.vat_rate);
    if (key) keys.add(key);
  }
  for (const s of shop) {
    const key = shopKey(s.basis, Number(s.rate), s.voucher);
    if (key) keys.add(key);
  }
  if (keys.size === 0) keys.add("standard_25");
  return BOOKING_KEYS.filter((k) => keys.has(k));
}

/** The store's own organisation number (Settings → Your business), to compare with the accounting company's. */
export async function storeOrgNumber(storeId: string): Promise<string | null> {
  const row = await typedRow(z.object({ organisation_number: col.textOrNull }), sql`select organisation_number from commerce.stores where id = ${storeId}::uuid`);
  return row?.organisation_number ?? null;
}
