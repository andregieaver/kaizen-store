import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { DocumentKind } from "@/lib/document-token";
import type { EmailBlock } from "@/lib/email-layout";
import { invoiceFileName } from "@/lib/invoice-eligibility";
import { documentEmailText } from "@/lib/invoice-text";
import { marketPath, storeSiteUrl } from "@/lib/paths";

import type { OutgoingEmail } from "./email";
import { readPdf } from "./invoice-storage";

type Row = Record<string, unknown>;

/**
 * The documents inside the shopper's emails (D159, `docs/wave-1b-invoices.md` 2.2 and 5.2): a line with the document's number and a link to
 * its hosted page, and the PDF attached **only when it already exists** and is at most 1 MB (a PDF is made on demand and the first
 * confirmation is sent seconds after payment, so most emails carry the link alone). The words are `invoice-text.ts`'s, hand-written in
 * nb, sv, da and en. Which email carried which document is kept in `commerce.document_deliveries`, so the stand-alone email is sent
 * only for a document no earlier email carried (`invoice-notices.ts`).
 *
 * This module imports neither the shopper emails nor Chromium: it is read by them.
 */

export type DocRef = { type: DocumentKind; id: string };
export type Attachment = NonNullable<OutgoingEmail["attachments"]>[number];

/** The largest PDF an email carries. */
export const MAX_ATTACHED_BYTES = 1_000_000;

/** The hosted page of a document: the token is the whole access. */
export const documentUrl = (storeSlug: string, marketSlug: string, token: string): string =>
  `${storeSiteUrl(storeSlug)}${marketPath(storeSlug, marketSlug, `/account/documents/${token}`)}`;

export type DocumentWant = {
  /** The order's invoice. */
  invoice?: boolean;
  /** The credit note of this refund. */
  creditNoteOfRefund?: string | null;
  /** The credit note of this return, whether it was refunded through Stripe or outside Kaizen. */
  creditNoteOfReturn?: string | null;
  /** A credit note by its own id. */
  creditNoteId?: string | null;
};

export type DocumentBlocks = { blocks: EmailBlock[]; attachments: Attachment[]; docs: DocRef[] };

type Found = { type: DocumentKind; id: string; documentNumber: string; token: string; hasPdf: boolean };

async function find(storeId: string, orderId: string, want: DocumentWant): Promise<Found[]> {
  const found: Found[] = [];
  if (want.invoice) {
    const [i] = await db().execute<Row>(sql`
      select id, document_number, public_token, pdf_path is not null as has_pdf from commerce.invoices
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and public_token is not null and anonymised_at is null
    `);
    if (i) found.push({ type: "invoice", id: String(i.id), documentNumber: String(i.document_number), token: String(i.public_token), hasPdf: i.has_pdf === true });
  }
  if (want.creditNoteOfRefund || want.creditNoteOfReturn || want.creditNoteId) {
    const [c] = await db().execute<Row>(sql`
      select c.id, c.document_number, c.public_token, c.pdf_path is not null as has_pdf
      from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
      where c.store_id = ${storeId}::uuid and i.order_id = ${orderId}::uuid and c.public_token is not null and c.anonymised_at is null
        and (${want.creditNoteId ?? null}::uuid is not null and c.id = ${want.creditNoteId ?? null}::uuid
          or ${want.creditNoteOfRefund ?? null}::uuid is not null and c.refund_id = ${want.creditNoteOfRefund ?? null}::uuid
          or ${want.creditNoteOfReturn ?? null}::uuid is not null and (c.return_id = ${want.creditNoteOfReturn ?? null}::uuid
            or c.refund_id = (select rt.refund_id from commerce.returns rt where rt.store_id = c.store_id and rt.id = ${want.creditNoteOfReturn ?? null}::uuid)))
      order by c.number limit 1
    `);
    if (c) found.push({ type: "credit_note", id: String(c.id), documentNumber: String(c.document_number), token: String(c.public_token), hasPdf: c.has_pdf === true });
  }
  return found;
}

/**
 * The blocks an email adds for the order's documents: for each, its number and a button to open it, and when `attach` the PDF if it
 * exists. Nothing (an empty result) when the order has no such document: a waiting invoice, a test order or a copied one says nothing.
 */
export async function documentBlocks(input: {
  storeId: string;
  orderId: string;
  storeSlug: string;
  marketSlug: string;
  /** The order's language (`nb`, `sv`, `da`, `en`; any other shows English). */
  lang: string;
  want: DocumentWant;
  attach?: boolean;
  /** The storage reader (tests); the stored file or null. */
  readFile?: (kind: DocumentKind, id: string) => Promise<Uint8Array | null>;
}): Promise<DocumentBlocks> {
  const words = documentEmailText(input.lang);
  const docs = await find(input.storeId, input.orderId, input.want);
  const blocks: EmailBlock[] = [];
  const attachments: Attachment[] = [];
  const carried: DocRef[] = [];
  for (const doc of docs) {
    const line = doc.type === "invoice" ? words.yourInvoice(doc.documentNumber) : words.yourCreditNote(doc.documentNumber);
    const intro = doc.type === "credit_note" ? `${words.refundCreditNote}` : null;
    const open = doc.type === "invoice" ? words.openInvoice : words.openCreditNote;
    let attached = false;
    if (input.attach && doc.hasPdf) {
      const bytes = await (input.readFile ?? ((kind, id) => readPdf(input.storeId, kind, id)))(doc.type, doc.id).catch(() => null);
      if (bytes && bytes.length > 0 && bytes.length <= MAX_ATTACHED_BYTES) {
        attachments.push({ filename: invoiceFileName(doc.documentNumber), content: Buffer.from(bytes).toString("base64"), contentType: "application/pdf", encoding: "base64" });
        attached = true;
      }
    }
    blocks.push({ type: "paragraph", text: [intro, line, attached ? words.pdfAttached : null].filter(Boolean).join("\n") });
    blocks.push({ type: "button", text: open, url: documentUrl(input.storeSlug, input.marketSlug, doc.token) });
    carried.push({ type: doc.type, id: doc.id });
  }
  return { blocks, attachments, docs: carried };
}

/**
 * Notes that an email carried these documents, once the email is kept: found by its idempotency key, else the newest of its kind for the
 * order (an email sent again on request has no key). Never throws: bookkeeping never undoes an email.
 */
export async function recordDocumentDeliveries(
  storeId: string,
  docs: readonly DocRef[],
  email: { idempotencyKey?: string | null; orderId?: string | null; kind?: string },
): Promise<void> {
  if (docs.length === 0) return;
  try {
    const [message] = email.idempotencyKey
      ? await db().execute<Row>(sql`select id from commerce.email_messages where store_id = ${storeId}::uuid and idempotency_key = ${email.idempotencyKey}`)
      : await db().execute<Row>(sql`
          select id from commerce.email_messages
          where store_id = ${storeId}::uuid and order_id = ${email.orderId ?? null}::uuid and kind = ${email.kind ?? ""}
          order by created_at desc limit 1
        `);
    if (!message) return;
    for (const doc of docs) {
      await db().execute(sql`
        insert into commerce.document_deliveries (store_id, document_type, document_id, email_message_id)
        values (${storeId}::uuid, ${doc.type}, ${doc.id}::uuid, ${String(message.id)}::uuid)
        on conflict do nothing
      `);
    }
  } catch {
    // The email is kept either way.
  }
}

/** Whether the order confirmation and the shipped email carry the invoice (`invoice_settings.email_with_confirmation`, on unless the owner switched it off). */
export async function emailsCarryInvoice(storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select email_with_confirmation from commerce.invoice_settings where store_id = ${storeId}::uuid`);
  return row ? row.email_with_confirmation !== false : true;
}
