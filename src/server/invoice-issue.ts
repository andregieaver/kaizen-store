import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { DocumentKind } from "@/lib/document-token";

import { sendPendingDocumentNotices } from "./invoice-notices";
import { reconcilePendingRefunds } from "./stripe-refunds";
import { ensureSubscriptionEvents } from "./subscriptions";

type Row = Record<string, unknown>;

/**
 * Issuing what could not be issued in the payment's transaction (D159, `docs/wave-1b-invoices.md` 2.1, 2.7 and 5.2). An invoice is made
 * only by `commerce.issue_order_invoice()`, called inside `complete_order_payment()`; one that could not be made then (the seller's
 * details incomplete, no exchange rate, an error) waits, and the same function is called here for each waiting order as soon as the cause is
 * gone, with the later day as its issue date and the payment day as its supply date. A credit note is only ever made by
 * `commerce.issue_credit_note()`; the job asks it for the refunds that succeeded before their invoice existed, or whose first try failed.
 * Nothing here writes a document itself, and nothing throws: the five-minute job calls `invoiceJobs()`, and a failure is tried again.
 */

/** Invoices the job makes for one store in one run; the rest wait for the next. */
const PER_STORE = 200;
/** Stores the job looks at in one run. */
const STORES_PER_RUN = 50;
/** The job only looks for waiting orders paid in this many days; the owner's *Check again* has no such limit. */
const LOOKBACK_DAYS = 120;

/** Issues the store's waiting invoices (up to `limit`), then the credit notes that waited for them. Returns the invoices issued. */
export async function issueWaitingInvoices(storeId: string, limit = PER_STORE): Promise<number> {
  try {
    const [row] = await db().execute<Row>(sql`select commerce.issue_waiting_invoices(${storeId}::uuid, ${limit}) as issued`);
    return Number(row?.issued ?? 0);
  } catch (error) {
    console.error("[invoices] waiting invoices could not be issued:", error instanceof Error ? error.message : error);
    return 0;
  }
}

/** Issues the credit notes of succeeded refunds (and of returns refunded outside) that have none. Returns how many. */
export async function issueMissingCreditNotes(storeId: string): Promise<number> {
  try {
    const [row] = await db().execute<Row>(sql`select commerce.issue_missing_credit_notes(${storeId}::uuid) as issued`);
    return Number(row?.issued ?? 0);
  } catch (error) {
    console.error("[invoices] missing credit notes could not be issued:", error instanceof Error ? error.message : error);
    return 0;
  }
}

/**
 * *Try again* on the Waiting tab for a PDF that failed five times: the failures are forgotten and the PDF job (`/api/cron/document-pdfs`)
 * makes it on its next run, or the next download does. It never renders here, so the page's action stays free of Chromium. A document of
 * another store is untouched. Returns whether the document had failures to forget.
 */
export async function retryPdfLater(storeId: string, kind: DocumentKind, documentId: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.document_pdf_state set attempts = 0, last_attempt_at = null
    where store_id = ${storeId}::uuid and document_type = ${kind} and document_id = ${documentId}::uuid and attempts > 0
    returning document_id
  `);
  return rows.length > 0;
}

/**
 * The stores with something to do: a paid order of the last days that has no invoice (invoicing on, not copied, not a host's), or a
 * succeeded refund with no credit note whose order has an invoice.
 */
export async function storesWithDocumentWork(limit = STORES_PER_RUN): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select store_id from (
      select o.store_id from commerce.orders o
      left join commerce.invoice_settings cfg on cfg.store_id = o.store_id
      where o.copied_from is null and o.host_id is null and coalesce(cfg.enabled, true)
        and o.placed_at > now() - make_interval(days => ${LOOKBACK_DAYS})
        and not exists (select 1 from commerce.invoices i where i.store_id = o.store_id and i.order_id = o.id)
        and exists (select 1 from commerce.order_events e where e.store_id = o.store_id and e.order_id = o.id and e.type = 'order.paid'
                      and (cfg.enabled_from is null or e.created_at >= cfg.enabled_from))
      union
      select rf.store_id from commerce.refunds rf
      join commerce.payments p on p.store_id = rf.store_id and p.id = rf.payment_id
      join commerce.invoices i on i.store_id = rf.store_id and i.order_id = p.order_id
      where rf.status = 'succeeded'
        and not exists (select 1 from commerce.credit_notes c where c.store_id = rf.store_id and c.refund_id = rf.id)
        and not exists (select 1 from commerce.order_events e where e.store_id = rf.store_id and e.order_id = p.order_id and e.type in ('credit_note.short', 'credit_note.not_invoiced') and e.data ->> 'key' = rf.id::text)
      union
      select rt.store_id from commerce.returns rt
      join commerce.invoices i on i.store_id = rt.store_id and i.order_id = rt.order_id
      where rt.refund_outside and rt.refund_id is null and coalesce(rt.refund_minor, 0) > 0
        and not exists (select 1 from commerce.credit_notes c where c.store_id = rt.store_id and c.return_id = rt.id and c.source = 'return_outside')
        and not exists (select 1 from commerce.order_events e where e.store_id = rt.store_id and e.order_id = rt.order_id and e.type in ('credit_note.short', 'credit_note.not_invoiced') and e.data ->> 'key' = rt.id::text)
    ) x
    limit ${limit}
  `);
  return rows.map((r) => String(r.store_id));
}

export type InvoiceJobsResult = {
  stores: number;
  invoices: number;
  refundsCompleted: number;
  notices: number;
};

/**
 * The five-minute job's part (`/api/cron/cart-reminders`): refunds Stripe left pending asked of Stripe, waiting invoices and credit notes
 * issued for each store with work to do, the stand-alone emails for documents issued later than their payment or refund, and the platform's
 * webhook asked to send refund events (once per server instance and mode). No Chromium: PDFs are made by `/api/cron/document-pdfs`.
 * Never throws.
 */
export async function invoiceJobs(): Promise<InvoiceJobsResult> {
  const result: InvoiceJobsResult = { stores: 0, invoices: 0, refundsCompleted: 0, notices: 0 };
  try {
    await Promise.all([ensureSubscriptionEvents("test"), ensureSubscriptionEvents("live")]).catch(() => undefined);
    result.refundsCompleted = (await reconcilePendingRefunds()).updated;
    const stores = await storesWithDocumentWork();
    result.stores = stores.length;
    for (const storeId of stores) {
      result.invoices += await issueWaitingInvoices(storeId);
      await issueMissingCreditNotes(storeId);
    }
    result.notices = await sendPendingDocumentNotices();
  } catch (error) {
    console.error("[invoices] the job failed:", error instanceof Error ? error.message : error);
  }
  return result;
}
