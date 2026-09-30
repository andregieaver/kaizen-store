import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, readDb } from "@/db/client";
import type { RenderedEmail } from "@/lib/email-layout";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import {
  chooseAddress,
  cleanMessage,
  creditNoteEmail,
  hostedInvoicePath,
  invoiceEmail,
  reminderEmail,
  type WorkEmailFrame,
} from "@/lib/work-email";
import { printableState } from "@/lib/work-invoice-print";
import { documentLanguage } from "@/lib/work-invoice-text";
import { emailText } from "@/lib/email-text";

import { sendEmail, type SendOutcome } from "./email";
import { emailContext, emailFooter, storeById } from "./shopper-emails";
import { workEvent } from "./work";
import { creditNoteDocumentData, invoiceDocumentData } from "./work-invoices";

type Row = Record<string, unknown>;

/**
 * Work's emails (docs/work.md 4.7, WP7b): an issued invoice, a credit note and a
 * payment reminder to the client, in the document's language, through the same
 * `sendEmail()` as the shop's (kept in `email_messages` first; only kept and
 * logged while Resend is not set up). Each email carries a link to the hosted
 * page (`/s/{store}/{market}/account/invoice/{token}`, no sign-in): the token is
 * made here when the invoice has none yet. Only an issued invoice is ever sent;
 * a draft is refused. What was sent is recorded the way the schema allows: the
 * invoice's `sent_to` (the one column besides status that an issued invoice may
 * change) and an `invoice.emailed` event (no address in it); the database's own
 * events (`invoice.issued` and the rest) are never written again here.
 *
 * Idempotency: the first invoice email is kept under `work-invoice:{id}`, a
 * credit note's under `work-credit-note:{id}`, so an automatic send (recurring
 * invoices) or a retry never sends twice; an earlier attempt that failed is
 * tried again. A person pressing Send again passes `resend: true`, which makes
 * a new email. A reminder is once per invoice and day.
 */

/** `reason` is a short code when nothing was sent: `not_found`, `not_issued`, `imported`, `not_open`, `no_email`, `invalid_email`, `already_sent`, `failed`. */
export type WorkEmailResult = { sent: boolean; reason?: string; outcome?: SendOutcome; to?: string };

export type WorkEmailOptions = {
  /** The account that sent it (the history says who), null for the system. */
  by?: string | null;
  /** Another address than the client's. */
  to?: string | null;
  /** A note written on top of the email. */
  message?: string | null;
  /** Send again although it went out before (Resend). */
  resend?: boolean;
};

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;
const refused = (reason: string): WorkEmailResult => ({ sent: false, reason });

/** The hosted page's token for an invoice: its own, else a new unguessable one (192 random bits), kept so the link never changes. */
async function tokenFor(storeId: string, invoiceId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.work_invoices set public_token = ${randomBytes(24).toString("base64url")}
    where store_id = ${storeId}::uuid and id = ${invoiceId}::uuid and status <> 'draft' and public_token is null
    returning public_token
  `);
  if (row) return String(row.public_token);
  const [existing] = await db().execute<Row>(sql`
    select public_token from commerce.work_invoices
    where store_id = ${storeId}::uuid and id = ${invoiceId}::uuid and status <> 'draft'
  `);
  return existing?.public_token ? String(existing.public_token) : null;
}

/** The invoice's hosted page for the client: a full address in the market of the seller's country, or null without a market. */
async function hostedFrame(
  storeId: string,
  sellerCountry: string | null,
  locale: string,
  path: string,
): Promise<{ frame: Omit<WorkEmailFrame, "sellerName">; storeName: string; contactEmail: string | null } | null> {
  const store = await storeById(storeId);
  if (!store) return null;
  const language = documentLanguage(locale);
  const text = emailText(language);
  const home =
    store.markets.find((m) => m.code.toLowerCase() === (sellerCountry ?? "").toLowerCase()) ?? store.markets[0];
  const ctx = home ? await emailContext(storeId, home.code, language) : null;
  const url = ctx ? `${storeSiteUrl(store.slug)}${marketPath(store.slug, ctx.market.slug, path)}` : null;
  return {
    frame: { storeName: store.name, url, footer: emailFooter(store, text) },
    storeName: store.name,
    contactEmail: store.details.contactEmail,
  };
}

/** Keeps the email and, when it went (or was kept for later), records it on the invoice. */
async function deliver(args: {
  storeId: string;
  invoiceId: string;
  kind: "work.invoice" | "work.credit_note" | "work.reminder";
  eventKind: "invoice" | "credit_note" | "reminder";
  to: string;
  email: RenderedEmail;
  fromName: string;
  replyTo: string | null;
  key: string | null;
  by: string | null;
  data?: Record<string, unknown>;
}): Promise<WorkEmailResult> {
  const key = args.key;
  if (key) {
    // A first send happens once; only an attempt that failed is made again, and the failed row gives up the key.
    const [earlier] = await db().execute<Row>(sql`
      select status from commerce.email_messages where idempotency_key = ${key}
    `);
    if (earlier && earlier.status !== "failed") return refused("already_sent");
    if (earlier) {
      await db().execute(sql`
        update commerce.email_messages set idempotency_key = idempotency_key || ':failed:' || id::text
        where idempotency_key = ${key} and status = 'failed'
      `);
    }
  }
  const outcome = await sendEmail({
    storeId: args.storeId,
    kind: args.kind,
    to: args.to,
    email: args.email,
    fromName: args.fromName,
    replyTo: args.replyTo,
    idempotencyKey: key ?? undefined,
  }).catch((): SendOutcome => "failed");
  if (outcome === "duplicate") return refused("already_sent");
  if (outcome === "failed") return { sent: false, reason: "failed", outcome };
  await db().execute(sql`
    update commerce.work_invoices set sent_to = ${args.to}
    where store_id = ${args.storeId}::uuid and id = ${args.invoiceId}::uuid and status <> 'draft'
  `);
  await workEvent(
    db(),
    args.storeId,
    "invoice",
    args.invoiceId,
    args.eventKind === "reminder" ? "invoice.reminded" : "invoice.emailed",
    { kind: args.eventKind, ...args.data },
    args.by,
  );
  return { sent: true, outcome, to: args.to };
}

async function clientEmailOf(storeId: string, invoiceId: string): Promise<string | null> {
  const [row] = await readDb().execute<Row>(sql`
    select c.billing_email from commerce.work_invoices i
    join commerce.work_clients c on c.store_id = i.store_id and c.id = i.client_id
    where i.store_id = ${storeId}::uuid and i.id = ${invoiceId}::uuid
  `);
  return row?.billing_email ? String(row.billing_email) : null;
}

/**
 * Emails an issued invoice to its client (the invoice's frozen buyer address, else the client's billing address, or
 * `opts.to`). Refused, with a reason, for a draft, another store's invoice, or an address that is missing or not one.
 */
export async function sendInvoiceEmail(
  storeId: string,
  invoiceId: string,
  opts: WorkEmailOptions = {},
): Promise<WorkEmailResult> {
  if (!isUuid(storeId) || !isUuid(invoiceId)) return refused("not_found");
  const doc = await invoiceDocumentData(storeId, invoiceId);
  if (!doc) return refused("not_found");
  // An imported invoice was sent from Kaizen Life: never emailed again from here (nor by the import).
  if (doc.imported) return refused("imported");
  if (!printableState(doc).printable || !doc.documentNumber) return refused("not_issued");
  const address = chooseAddress(opts.to, doc.buyer.email, await clientEmailOf(storeId, invoiceId));
  if (!address.ok) return refused(address.reason);
  const token = await tokenFor(storeId, invoiceId);
  if (!token) return refused("not_issued");
  const hosted = await hostedFrame(storeId, doc.seller.country, doc.locale, hostedInvoicePath(token));
  if (!hosted) return refused("not_found");
  const frame: WorkEmailFrame = { ...hosted.frame, sellerName: doc.seller.legalName ?? hosted.storeName };
  const email = invoiceEmail(
    frame,
    {
      documentNumber: doc.documentNumber,
      dueOn: doc.dueOn,
      locale: doc.locale,
      currency: doc.currency,
      amountDueMinor: doc.payment.amountDueMinor,
    },
    cleanMessage(opts.message),
  );
  return deliver({
    storeId,
    invoiceId,
    kind: "work.invoice",
    eventKind: "invoice",
    to: address.address,
    email,
    fromName: hosted.storeName,
    replyTo: doc.seller.email ?? hosted.contactEmail,
    key: opts.resend ? null : `work-invoice:${invoiceId}`,
    by: opts.by ?? null,
    data: { resend: Boolean(opts.resend) },
  });
}

/** Emails a credit note to the client: its frozen buyer address (or `opts.to`), with a link to it on the invoice's hosted page. */
export async function sendCreditNoteEmail(
  storeId: string,
  creditNoteId: string,
  opts: WorkEmailOptions = {},
): Promise<WorkEmailResult> {
  if (!isUuid(storeId) || !isUuid(creditNoteId)) return refused("not_found");
  const doc = await creditNoteDocumentData(storeId, creditNoteId);
  if (!doc) return refused("not_found");
  const address = chooseAddress(opts.to, doc.buyer.email, await clientEmailOf(storeId, doc.invoiceId));
  if (!address.ok) return refused(address.reason);
  const token = await tokenFor(storeId, doc.invoiceId);
  if (!token) return refused("not_issued");
  const hosted = await hostedFrame(storeId, doc.seller.country, doc.locale, hostedInvoicePath(token, creditNoteId));
  if (!hosted) return refused("not_found");
  const frame: WorkEmailFrame = { ...hosted.frame, sellerName: doc.seller.legalName ?? hosted.storeName };
  const email = creditNoteEmail(
    frame,
    {
      documentNumber: doc.documentNumber,
      invoiceNumber: doc.invoiceNumber,
      locale: doc.locale,
      currency: doc.currency,
      totalMinor: doc.totals.totalMinor,
    },
    cleanMessage(opts.message),
  );
  return deliver({
    storeId,
    invoiceId: doc.invoiceId,
    kind: "work.credit_note",
    eventKind: "credit_note",
    to: address.address,
    email,
    fromName: hosted.storeName,
    replyTo: doc.seller.email ?? hosted.contactEmail,
    key: opts.resend ? null : `work-credit-note:${creditNoteId}`,
    by: opts.by ?? null,
    data: { resend: Boolean(opts.resend), documentNumber: doc.documentNumber },
  });
}

/**
 * A payment reminder for an invoice that is issued and still has something to pay (`not_open` otherwise). At most one a
 * day per invoice, so a double click or a retrying job never sends two.
 */
export async function sendPaymentReminderEmail(
  storeId: string,
  invoiceId: string,
  opts: WorkEmailOptions = {},
): Promise<WorkEmailResult> {
  if (!isUuid(storeId) || !isUuid(invoiceId)) return refused("not_found");
  const doc = await invoiceDocumentData(storeId, invoiceId);
  if (!doc) return refused("not_found");
  if (doc.imported) return refused("imported");
  if (!printableState(doc).printable || !doc.documentNumber) return refused("not_issued");
  if (doc.status !== "sent" || doc.payment.amountDueMinor <= 0) return refused("not_open");
  const address = chooseAddress(opts.to, doc.buyer.email, await clientEmailOf(storeId, invoiceId));
  if (!address.ok) return refused(address.reason);
  const token = await tokenFor(storeId, invoiceId);
  if (!token) return refused("not_issued");
  const hosted = await hostedFrame(storeId, doc.seller.country, doc.locale, hostedInvoicePath(token));
  if (!hosted) return refused("not_found");
  const frame: WorkEmailFrame = { ...hosted.frame, sellerName: doc.seller.legalName ?? hosted.storeName };
  const email = reminderEmail(
    frame,
    {
      documentNumber: doc.documentNumber,
      dueOn: doc.dueOn,
      locale: doc.locale,
      currency: doc.currency,
      amountDueMinor: doc.payment.amountDueMinor,
    },
    cleanMessage(opts.message),
  );
  return deliver({
    storeId,
    invoiceId,
    kind: "work.reminder",
    eventKind: "reminder",
    to: address.address,
    email,
    fromName: hosted.storeName,
    replyTo: doc.seller.email ?? hosted.contactEmail,
    key: `work-reminder:${invoiceId}:${new Date().toISOString().slice(0, 10)}`,
    by: opts.by ?? null,
  });
}

/** The invoice's hosted page as a full address, for staff to copy; null for a draft, another store's invoice or a store with no market. */
export async function hostedInvoiceUrl(storeId: string, invoiceId: string): Promise<string | null> {
  if (!isUuid(storeId) || !isUuid(invoiceId)) return null;
  const doc = await invoiceDocumentData(storeId, invoiceId);
  if (!doc || !printableState(doc).printable) return null;
  const token = await tokenFor(storeId, invoiceId);
  if (!token) return null;
  const hosted = await hostedFrame(storeId, doc.seller.country, doc.locale, hostedInvoicePath(token));
  return hosted?.frame.url ?? null;
}
