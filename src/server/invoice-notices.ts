import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { DocumentKind } from "@/lib/document-token";
import { renderEmail } from "@/lib/email-layout";
import { documentEmailText } from "@/lib/invoice-text";

import type { SendOutcome } from "./email";
import { sendEmail } from "./email";
import { documentBlocks, recordDocumentDeliveries } from "./invoice-emails";
import { refundEmailOffSql } from "./notifications";
import { getOrder } from "./orders";
import { emailContext, emailFooter } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * The stand-alone emails about documents (D159, `docs/wave-1b-invoices.md` 2.2 and 2.5): the invoice of an order that waited and was
 * issued later, the credit note of a refund that completed later (a bank method that was pending, a refund made in Stripe's Dashboard) or
 * that waited for its invoice, and a document staff send again. Each goes to the order's own address, never one typed anywhere else,
 * once per document (idempotency key `invoice:{id}`, `credit-note:{id}`), in the order's language, with the link and, when it exists, the
 * PDF. The words are `invoice-text.ts`'s, hand-written in nb, sv, da and en, and need legal review. Never throws: an email never undoes
 * a document.
 */

type Found = { orderId: string; documentNumber: string };

async function documentOf(storeId: string, kind: DocumentKind, id: string): Promise<Found | null> {
  const [row] =
    kind === "invoice"
      ? await db().execute<Row>(sql`select order_id, document_number from commerce.invoices where store_id = ${storeId}::uuid and id = ${id}::uuid and anonymised_at is null`)
      : await db().execute<Row>(sql`
          select i.order_id, c.document_number from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
          where c.store_id = ${storeId}::uuid and c.id = ${id}::uuid and c.anonymised_at is null
        `);
  return row ? { orderId: String(row.order_id), documentNumber: String(row.document_number) } : null;
}

async function send(storeId: string, kind: DocumentKind, id: string, key: string): Promise<SendOutcome | null> {
  try {
    const doc = await documentOf(storeId, kind, id);
    if (!doc) return null;
    const order = await getOrder(storeId, doc.orderId);
    // History copied from another store (D129) is never mailed about, and an order with no address has nobody to tell.
    if (!order || order.copied || !order.email) return null;
    const ctx = await emailContext(storeId, order.marketCode, order.locale, order.currency);
    if (!ctx) return null;
    const { store, market, text } = ctx;
    const words = documentEmailText(ctx.lang);
    const blocks = await documentBlocks({
      storeId,
      orderId: doc.orderId,
      storeSlug: store.slug,
      marketSlug: market.slug,
      lang: ctx.lang,
      want: kind === "invoice" ? { invoice: true } : { creditNoteId: id },
      attach: true,
    });
    if (blocks.docs.length === 0) return null;
    const subject = kind === "invoice" ? words.invoiceSubject(doc.documentNumber, store.name) : words.creditNoteSubject(doc.documentNumber, store.name);
    const intro = kind === "invoice" ? words.invoiceIntro(order.number) : words.creditNoteIntro(order.number);
    const email = renderEmail({
      subject,
      preview: intro,
      lang: ctx.lang,
      footer: emailFooter(store, text),
      blocks: [{ type: "heading", text: subject }, { type: "paragraph", text: intro }, ...blocks.blocks.filter((b) => b.type === "button")],
    });
    const outcome = await sendEmail({
      storeId,
      kind: kind === "invoice" ? "invoice.issued" : "credit_note.issued",
      to: order.email,
      email,
      fromName: store.name,
      replyTo: store.details.contactEmail,
      idempotencyKey: key,
      orderId: doc.orderId,
      attachments: blocks.attachments,
    });
    if (outcome !== "duplicate" && outcome !== "failed" && outcome !== "suppressed") await recordDocumentDeliveries(storeId, blocks.docs, { idempotencyKey: key });
    return outcome;
  } catch {
    return null;
  }
}

/** The invoice of an order that waited and was issued later. Once per invoice. */
export const sendInvoiceNotice = (storeId: string, invoiceId: string) => send(storeId, "invoice", invoiceId, `invoice:${invoiceId}`);

/** The credit note of a refund that completed later, or that waited for its invoice. Once per credit note. */
export const sendCreditNoteNotice = (storeId: string, creditNoteId: string) => send(storeId, "credit_note", creditNoteId, `credit-note:${creditNoteId}`);

/**
 * Staff send a document again to the order's own address (`orders:write`). A key of its own, so the first sending does not stop it; the
 * order's history says so (`invoice.emailed` / `credit_note.emailed`).
 */
export async function sendDocumentAgain(storeId: string, kind: DocumentKind, id: string, accountId: string | null): Promise<SendOutcome | null> {
  const key = `${kind === "invoice" ? "invoice" : "credit-note"}:${id}:again:${crypto.randomUUID()}`;
  const outcome = await send(storeId, kind, id, key);
  if (outcome === "sent" || outcome === "logged") {
    const doc = await documentOf(storeId, kind, id);
    if (doc) {
      await db().execute(sql`
        insert into commerce.order_events (store_id, order_id, type, data, actor)
        values (${storeId}::uuid, ${doc.orderId}::uuid, ${kind === "invoice" ? "invoice.emailed" : "credit_note.emailed"},
                ${JSON.stringify({ document: doc.documentNumber, by: accountId })}::jsonb, 'staff')
      `);
    }
  }
  return outcome;
}

/** How soon after the payment (or the refund) a document counts as issued "later" and so needs an email of its own. */
const LATE_MINUTES = 2;
/** Documents older than this are not announced any more: the email would be a surprise. */
const RECENT_DAYS = 3;

/**
 * The job: the stand-alone email for each document no earlier email carried and that was issued later than the payment or the refund
 * (an invoice that waited for the seller's details; a credit note of a refund Stripe completed or made later, or that waited for its
 * invoice and so was not in the refund email the shopper got). A refund staff made and chose not to tell the shopper about is not
 * announced, because its credit note was issued with it and no email about the refund exists, unless the store switched the refund email
 * (or, for a return's refund, the return refunded email) off (D238, `refundEmailOffSql()`): then no refund email can carry it, and it goes on its
 * own. A credit note is announced no sooner
 * than two minutes after it was issued, so the refund's own email (which carries it) has been sent and noted first.
 * Returns how many emails were handed over.
 */
export async function sendPendingDocumentNotices(limit = 50): Promise<number> {
  const invoices = await inPages(limit, (after) => db().execute<Row>(sql`
      select i.store_id, i.id, i.issued_at::text as cursor_at from commerce.invoices i
      where i.issued_at > now() - make_interval(days => ${RECENT_DAYS}) and i.anonymised_at is null
        and i.issued_at > (select min(e.created_at) from commerce.order_events e where e.store_id = i.store_id and e.order_id = i.order_id and e.type = 'order.paid')
                          + make_interval(mins => ${LATE_MINUTES})
        and not exists (select 1 from commerce.document_deliveries d where d.store_id = i.store_id and d.document_type = 'invoice' and d.document_id = i.id)
        and not exists (select 1 from commerce.email_messages m where m.store_id = i.store_id and m.idempotency_key = 'invoice:' || i.id::text)
        and (${after?.at ?? null}::timestamptz is null or (i.issued_at, i.id) > (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
      order by i.issued_at, i.id limit ${limit}
    `), (row) => sendInvoiceNotice(String(row.store_id), String(row.id)));
  const notes = await inPages(limit, (after) => db().execute<Row>(sql`
      select c.store_id, c.id, c.issued_at::text as cursor_at from commerce.credit_notes c
      left join commerce.refunds r on r.store_id = c.store_id and r.id = c.refund_id
      where c.issued_at > now() - make_interval(days => ${RECENT_DAYS}) and c.anonymised_at is null
        and c.issued_at < now() - make_interval(mins => ${LATE_MINUTES})
        and (
          (c.source = 'refund'
           and not exists (select 1 from commerce.returns rt where rt.store_id = c.store_id and rt.refund_id = c.refund_id)
           and (r.created_by is null or c.issued_at > r.created_at + make_interval(mins => ${LATE_MINUTES})
                or exists (select 1 from commerce.email_messages e where e.store_id = c.store_id and e.idempotency_key = 'order-refunded:' || c.refund_id::text)
                or ${refundEmailOffSql(sql`c.store_id`, "order")}))
          -- A refund email the store switched off (D238) never carries the credit note, so the document goes on its own: a notification switch
          -- never silences a credit note (D159; the invoice settings' switch governs documents). A return's note (through Stripe or outside) too.
          or ((c.source = 'return_outside'
               or (c.source = 'refund' and exists (select 1 from commerce.returns rt where rt.store_id = c.store_id and rt.refund_id = c.refund_id)))
              and ${refundEmailOffSql(sql`c.store_id`, "return")})
        )
        and not exists (select 1 from commerce.document_deliveries d where d.store_id = c.store_id and d.document_type = 'credit_note' and d.document_id = c.id)
        and not exists (select 1 from commerce.email_messages m where m.store_id = c.store_id and m.idempotency_key = 'credit-note:' || c.id::text)
        and (${after?.at ?? null}::timestamptz is null or (c.issued_at, c.id) > (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
      order by c.issued_at, c.id limit ${limit}
    `), (row) => sendCreditNoteNotice(String(row.store_id), String(row.id)));
  return invoices + notes;
}

/** The most pages of waiting documents one run looks through, each of `limit`. */
const NOTICE_PAGES = 10;

/**
 * Sends the waiting documents a page at a time in order of issue, up to `NOTICE_PAGES` pages. A document that can never be sent (a copied order, no
 * address, a refused address) is not marked and comes first again on every run, so a run that read only the first page would let fifty of them hold
 * back every later document for the days they stay waiting. Returns how many emails were handed over; a failure ends the run (tried again next time).
 */
async function inPages(
  limit: number,
  page: (after: { at: string; id: string } | null) => Promise<Row[]>,
  sendOne: (row: Row) => Promise<SendOutcome | null>,
): Promise<number> {
  let sent = 0;
  let after: { at: string; id: string } | null = null;
  try {
    for (let n = 0; n < NOTICE_PAGES; n += 1) {
      const rows = await page(after);
      for (const row of rows) {
        const outcome = await sendOne(row);
        if (outcome === "sent" || outcome === "logged") sent += 1;
      }
      if (rows.length < limit) break;
      const last = rows[rows.length - 1];
      // The database's own text of the time, so no microsecond is lost between pages.
      after = { at: String(last.cursor_at), id: String(last.id) };
    }
  } catch {
    // Tried again on the next run.
  }
  return sent;
}
