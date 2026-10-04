import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { isDocumentToken, kindOfToken, type DocumentKind } from "@/lib/document-token";
import { ELIGIBILITY_REASONS, ELIGIBILITY_WORDS, type EligibilityReason } from "@/lib/invoice-eligibility";
import { isOverdue, WAITING_WORDS, type QueueReason } from "@/lib/invoice-readiness";
import type { CreditNoteSnapshot } from "@/lib/credit-allocation";
import type { OrderInvoiceSnapshot } from "@/lib/invoice-snapshot";

type Row = Record<string, unknown>;

/**
 * Reading invoices and credit notes (D159, `docs/wave-1b-invoices.md` 5.2): the lists the admin shows, one document, a document by
 * its token, what an order's page shows, and the queue of orders still waiting for an invoice. Every query takes the store id. Nothing
 * here writes: documents are made only by `commerce.issue_order_invoice()` and `commerce.issue_credit_note()`.
 *
 * What may leave this module for a shopper is `getOrderDocuments()` (numbers, dates, amounts and the token) and a document found by
 * its token (the snapshot, for the hosted page). The lists and `getInvoice()` are for staff: they show a buyer's name, country and email.
 */

export type { DocumentKind };

const day = (value: unknown): string => String(value).slice(0, 10);
const text = (value: unknown): string | null => (value === null || value === undefined || value === "" ? null : String(value));
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** `%` and `_` in what a person typed are text, not wildcards. */
const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export type DocumentListRow = {
  id: string;
  type: DocumentKind;
  documentNumber: string;
  /** The store day it was issued (YYYY-MM-DD). */
  issuedOn: string;
  orderId: string;
  orderNumber: string;
  currency: string;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  /** An invoice's treatment; a credit note's is its invoice's. */
  vatKind: string | null;
  buyerName: string | null;
  buyerCountry: string | null;
  hasPdf: boolean;
  anonymised: boolean;
  /** A credit note: the invoice it credits, and where it came from (`refund` or `return_outside`). */
  invoiceId: string | null;
  invoiceNumber: string | null;
  source: string | null;
};

export type DocumentFilter = {
  /** First and last store day (inclusive, YYYY-MM-DD); anything else is ignored. */
  from?: string | null;
  to?: string | null;
  /** A document number, an order number or a buyer's email. */
  q?: string | null;
  limit?: number;
  offset?: number;
};

export type DocumentPage = { rows: DocumentListRow[]; total: number };

const PAGE = 50;
const MAX_PAGE = 500;

function window(filter: DocumentFilter) {
  const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(filter.limit ?? PAGE)));
  const offset = Math.max(0, Math.floor(filter.offset ?? 0));
  return { limit, offset };
}

function toRow(type: DocumentKind, r: Row): DocumentListRow {
  return {
    id: String(r.id),
    type,
    documentNumber: String(r.document_number),
    issuedOn: day(r.issued_on),
    orderId: String(r.order_id),
    orderNumber: String(r.order_number),
    currency: String(r.currency).trim(),
    netMinor: Number(r.net_minor),
    vatMinor: Number(r.tax_minor),
    totalMinor: Number(r.total_minor),
    vatKind: text(r.vat_kind),
    buyerName: text(r.buyer_name),
    buyerCountry: text(r.buyer_country),
    hasPdf: r.has_pdf === true,
    anonymised: r.anonymised === true,
    invoiceId: text(r.invoice_id),
    invoiceNumber: text(r.invoice_number),
    source: text(r.source),
  };
}

/** The store's invoices, newest first, with a period (store days), a search and paging. For staff with `orders:read`. */
export async function listInvoices(storeId: string, filter: DocumentFilter = {}): Promise<DocumentPage> {
  const { limit, offset } = window(filter);
  const q = filter.q?.trim() ? filter.q.trim().slice(0, 100) : null;
  const rows = await db().execute<Row>(sql`
    select i.id, i.document_number, i.issued_on, i.order_id, o.number as order_number, i.currency, i.net_minor, i.tax_minor, i.total_minor,
           i.vat_kind, i.snapshot -> 'buyer' ->> 'name' as buyer_name, i.snapshot -> 'buyer' -> 'address' ->> 'country' as buyer_country,
           i.pdf_path is not null as has_pdf, i.anonymised_at is not null as anonymised,
           null::uuid as invoice_id, null::text as invoice_number, null::text as source,
           count(*) over() as total
    from commerce.invoices i
    join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
    where i.store_id = ${storeId}::uuid
      ${isDay(filter.from) ? sql`and i.issued_on >= ${filter.from}::date` : sql``}
      ${isDay(filter.to) ? sql`and i.issued_on <= ${filter.to}::date` : sql``}
      ${q ? sql`and (i.document_number ilike ${`%${likeEscape(q)}%`} or o.number ilike ${`%${likeEscape(q)}%`} or lower(i.snapshot -> 'buyer' ->> 'email') = ${q.toLowerCase()})` : sql``}
    order by i.issued_on desc, i.number desc
    limit ${limit} offset ${offset}
  `);
  return { rows: rows.map((r) => toRow("invoice", r)), total: Number(rows[0]?.total ?? 0) };
}

/** The store's credit notes, newest first, with the same period, search and paging. */
export async function listCreditNotes(storeId: string, filter: DocumentFilter = {}): Promise<DocumentPage> {
  const { limit, offset } = window(filter);
  const q = filter.q?.trim() ? filter.q.trim().slice(0, 100) : null;
  const rows = await db().execute<Row>(sql`
    select c.id, c.document_number, c.issued_on, i.order_id, o.number as order_number, c.currency, c.net_minor, c.tax_minor, c.total_minor,
           i.vat_kind, c.snapshot -> 'buyer' ->> 'name' as buyer_name, c.snapshot -> 'buyer' -> 'address' ->> 'country' as buyer_country,
           c.pdf_path is not null as has_pdf, c.anonymised_at is not null as anonymised,
           c.invoice_id, i.document_number as invoice_number, c.source,
           count(*) over() as total
    from commerce.credit_notes c
    join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
    join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
    where c.store_id = ${storeId}::uuid
      ${isDay(filter.from) ? sql`and c.issued_on >= ${filter.from}::date` : sql``}
      ${isDay(filter.to) ? sql`and c.issued_on <= ${filter.to}::date` : sql``}
      ${q ? sql`and (c.document_number ilike ${`%${likeEscape(q)}%`} or i.document_number ilike ${`%${likeEscape(q)}%`} or o.number ilike ${`%${likeEscape(q)}%`} or lower(c.snapshot -> 'buyer' ->> 'email') = ${q.toLowerCase()})` : sql``}
    order by c.issued_on desc, c.number desc
    limit ${limit} offset ${offset}
  `);
  return { rows: rows.map((r) => toRow("credit_note", r)), total: Number(rows[0]?.total ?? 0) };
}

export type DocumentDetail<S> = {
  id: string;
  documentNumber: string;
  issuedOn: string;
  orderId: string;
  orderNumber: string;
  currency: string;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  publicToken: string | null;
  pdfPath: string | null;
  anonymised: boolean;
  snapshot: S;
};

export type InvoiceDetail = DocumentDetail<OrderInvoiceSnapshot> & { vatKind: string; supplyDate: string; creditNotes: { id: string; documentNumber: string; issuedOn: string; totalMinor: number }[] };
export type CreditNoteDetail = DocumentDetail<CreditNoteSnapshot> & { invoiceId: string; invoiceNumber: string; source: string };

/** One invoice, for staff (the print view, the PDF route and the order page). Null for another store's. */
export async function getInvoice(storeId: string, invoiceId: string): Promise<InvoiceDetail | null> {
  const [i] = await db().execute<Row>(sql`
    select i.id, i.document_number, i.issued_on, i.supply_date, i.order_id, o.number as order_number, i.currency, i.net_minor, i.tax_minor,
           i.total_minor, i.vat_kind, i.public_token, i.pdf_path, i.anonymised_at is not null as anonymised, i.snapshot
    from commerce.invoices i join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
    where i.store_id = ${storeId}::uuid and i.id = ${invoiceId}::uuid
  `);
  if (!i) return null;
  const notes = await db().execute<Row>(sql`
    select id, document_number, issued_on, total_minor from commerce.credit_notes
    where store_id = ${storeId}::uuid and invoice_id = ${invoiceId}::uuid order by number
  `);
  return {
    id: String(i.id),
    documentNumber: String(i.document_number),
    issuedOn: day(i.issued_on),
    supplyDate: day(i.supply_date),
    orderId: String(i.order_id),
    orderNumber: String(i.order_number),
    currency: String(i.currency).trim(),
    netMinor: Number(i.net_minor),
    vatMinor: Number(i.tax_minor),
    totalMinor: Number(i.total_minor),
    vatKind: String(i.vat_kind),
    publicToken: text(i.public_token),
    pdfPath: text(i.pdf_path),
    anonymised: i.anonymised === true,
    snapshot: i.snapshot as OrderInvoiceSnapshot,
    creditNotes: notes.map((n) => ({ id: String(n.id), documentNumber: String(n.document_number), issuedOn: day(n.issued_on), totalMinor: Number(n.total_minor) })),
  };
}

/** One credit note, for staff. Null for another store's. */
export async function getCreditNote(storeId: string, creditNoteId: string): Promise<CreditNoteDetail | null> {
  const [c] = await db().execute<Row>(sql`
    select c.id, c.document_number, c.issued_on, c.invoice_id, i.document_number as invoice_number, i.order_id, o.number as order_number, c.currency,
           c.net_minor, c.tax_minor, c.total_minor, c.source, c.public_token, c.pdf_path, c.anonymised_at is not null as anonymised, c.snapshot
    from commerce.credit_notes c
    join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
    join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
    where c.store_id = ${storeId}::uuid and c.id = ${creditNoteId}::uuid
  `);
  if (!c) return null;
  return {
    id: String(c.id),
    documentNumber: String(c.document_number),
    issuedOn: day(c.issued_on),
    orderId: String(c.order_id),
    orderNumber: String(c.order_number),
    currency: String(c.currency).trim(),
    netMinor: Number(c.net_minor),
    vatMinor: Number(c.tax_minor),
    totalMinor: Number(c.total_minor),
    publicToken: text(c.public_token),
    pdfPath: text(c.pdf_path),
    anonymised: c.anonymised === true,
    snapshot: c.snapshot as CreditNoteSnapshot,
    invoiceId: String(c.invoice_id),
    invoiceNumber: String(c.invoice_number),
    source: String(c.source),
  };
}

export type HostedDocument =
  | { kind: "invoice"; id: string; storeId: string; orderId: string; documentNumber: string; pdfPath: string | null; snapshot: OrderInvoiceSnapshot }
  | { kind: "credit_note"; id: string; storeId: string; orderId: string; documentNumber: string; pdfPath: string | null; snapshot: CreditNoteSnapshot };

/**
 * A document by its token, for the hosted page and its PDF route. The token is the whole access, so a token of another store, a
 * malformed one and an anonymised document (whose token is gone) are all the same `null`: the same 404.
 */
export async function findDocumentByToken(storeId: string, token: unknown): Promise<HostedDocument | null> {
  if (!isDocumentToken(token)) return null;
  if (kindOfToken(token) === "invoice") {
    const [r] = await db().execute<Row>(sql`
      select id, order_id, document_number, pdf_path, snapshot from commerce.invoices
      where store_id = ${storeId}::uuid and public_token = ${token} and anonymised_at is null
    `);
    return r
      ? { kind: "invoice", id: String(r.id), storeId, orderId: String(r.order_id), documentNumber: String(r.document_number), pdfPath: text(r.pdf_path), snapshot: r.snapshot as OrderInvoiceSnapshot }
      : null;
  }
  const [r] = await db().execute<Row>(sql`
    select c.id, i.order_id, c.document_number, c.pdf_path, c.snapshot
    from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
    where c.store_id = ${storeId}::uuid and c.public_token = ${token} and c.anonymised_at is null
  `);
  return r
    ? { kind: "credit_note", id: String(r.id), storeId, orderId: String(r.order_id), documentNumber: String(r.document_number), pdfPath: text(r.pdf_path), snapshot: r.snapshot as CreditNoteSnapshot }
    : null;
}

export type DocumentLink = {
  id: string;
  type: DocumentKind;
  documentNumber: string;
  issuedOn: string;
  /** The hosted page's token: null once the document is anonymised. */
  token: string | null;
  hasPdf: boolean;
  totalMinor: number;
  currency: string;
};

export type OrderDocuments = {
  /** Why the order has no invoice, or `ok`. */
  eligibility: EligibilityReason;
  invoice: DocumentLink | null;
  /** In the order they were issued. */
  creditNotes: DocumentLink[];
  /** An eligible order with no invoice yet: why it waits. For staff; the shopper is told nothing about a waiting invoice. */
  waiting: QueueReason | null;
  /** What the shopper's page says when there is no invoice (a test order), else null. */
  shopperNote: string | null;
  /** What staff are told when there is no invoice. */
  staffNote: string | null;
};

/**
 * What an order's pages show of its documents, in one read: the invoice and its credit notes with the hosted page's token, or why there
 * is none. The one reader the shopper's order page, My account and the staff's order page call. Null documents for another store's order.
 */
export async function getOrderDocuments(storeId: string, orderId: string): Promise<OrderDocuments> {
  const [order] = await db().execute<Row>(sql`select 1 as one from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
  if (!order) return { eligibility: "not_paid", invoice: null, creditNotes: [], waiting: null, shopperNote: null, staffNote: null };
  const [[inv], notes, [elig]] = await Promise.all([
    db().execute<Row>(sql`
      select id, document_number, issued_on, public_token, pdf_path is not null as has_pdf, total_minor, currency
      from commerce.invoices where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid
    `),
    db().execute<Row>(sql`
      select c.id, c.document_number, c.issued_on, c.public_token, c.pdf_path is not null as has_pdf, c.total_minor, c.currency
      from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
      where c.store_id = ${storeId}::uuid and i.order_id = ${orderId}::uuid order by c.number
    `),
    db().execute<Row>(sql`select commerce.invoice_eligibility(${orderId}::uuid) as reason`),
  ]);
  const link = (type: DocumentKind, r: Row): DocumentLink => ({
    id: String(r.id),
    type,
    documentNumber: String(r.document_number),
    issuedOn: day(r.issued_on),
    token: text(r.public_token),
    hasPdf: r.has_pdf === true,
    totalMinor: Number(r.total_minor),
    currency: String(r.currency).trim(),
  });
  const reason = (ELIGIBILITY_REASONS as readonly string[]).includes(String(elig?.reason)) ? (String(elig.reason) as EligibilityReason) : "not_paid";
  let waiting: QueueReason | null = null;
  if (!inv && reason === "ok") {
    const [ready] = await db().execute<Row>(sql`select commerce.invoice_readiness(${orderId}::uuid) as reason`);
    waiting = ready?.reason === "ready" ? "invoice_failed" : (String(ready?.reason) as QueueReason);
  }
  return {
    eligibility: reason,
    invoice: inv ? link("invoice", inv) : null,
    creditNotes: notes.map((n) => link("credit_note", n)),
    waiting,
    shopperNote: inv ? null : ELIGIBILITY_WORDS[reason].shopper,
    staffNote: inv ? null : waiting ? WAITING_WORDS[waiting].staff : ELIGIBILITY_WORDS[reason].staff,
  };
}

export type WaitingInvoice = {
  orderId: string;
  orderNumber: string;
  paidAt: string;
  /** The payment's store day: the day of supply, as it will be on the invoice. */
  paidOn: string;
  reason: QueueReason;
  /** What to tell the owner, and the page that fixes it (a path under the store's admin). */
  words: string;
  fixAt: string | null;
  vatKind: "standard" | "reverse_charge" | "ioss";
  totalMinor: number;
  currency: string;
  /** A reverse-charge order waiting past the 15th of the month after the payment (Directive Art. 222): the day it was due. */
  overdue: boolean;
  deadline: string | null;
};

/** The eligible orders that have no invoice, oldest first, with why each waits. `today` (a store day) is for tests. */
export async function waitingInvoices(storeId: string, today?: string): Promise<WaitingInvoice[]> {
  const [rows, [now]] = await Promise.all([
    db().execute<Row>(sql`
      select w.order_id, w.order_number, w.paid_at, commerce.store_day(${storeId}::uuid, w.paid_at)::text as paid_on, w.reason, w.vat_kind, w.total_minor, w.currency
      from commerce.waiting_invoices(${storeId}::uuid) w
    `),
    db().execute<Row>(sql`select commerce.store_day(${storeId}::uuid, now())::text as today`),
  ]);
  const todayIs = today ?? String(now?.today);
  return rows.map((r) => {
    const reason = String(r.reason) as QueueReason;
    const words = WAITING_WORDS[reason] ?? WAITING_WORDS.invoice_failed;
    const kind = (["standard", "reverse_charge", "ioss"].includes(String(r.vat_kind)) ? String(r.vat_kind) : "standard") as WaitingInvoice["vatKind"];
    const paidOn = String(r.paid_on);
    const { overdue, deadline } = isOverdue({ kind, paidOn, today: todayIs });
    return {
      orderId: String(r.order_id),
      orderNumber: String(r.order_number),
      paidAt: new Date(String(r.paid_at)).toISOString(),
      paidOn,
      reason,
      words: words.staff,
      fixAt: words.fixAt,
      vatKind: kind,
      totalMinor: Number(r.total_minor),
      currency: String(r.currency).trim(),
      overdue,
      deadline,
    };
  });
}

export type WaitingCreditNote = {
  /** The refund (or the return, for one refunded outside Kaizen) that has no credit note, or only a part of one. */
  refundId: string | null;
  returnId: string | null;
  orderId: string;
  orderNumber: string;
  /** `missing`: the refund (`amountMinor`) has no credit note yet. `short`: the invoice had less left than the refund, so the credit note covers part of it and `amountMinor` is the part left uncredited. */
  amountMinor: number;
  currency: string;
  state: "missing" | "short";
};

/**
 * Succeeded refunds (and returns refunded outside) with no credit note, which should never last, and the refunds that were larger than what
 * their invoice had left (credited in part, written once as the order event `credit_note.short`). The Waiting tab lists both.
 */
export async function waitingCreditNotes(storeId: string): Promise<WaitingCreditNote[]> {
  const rows = await db().execute<Row>(sql`
    select x.refund_id, x.return_id, x.order_id, o.number as order_number, x.amount_minor, o.currency, x.state, x.at
    from (
      select rf.id as refund_id, null::uuid as return_id, p.order_id, rf.amount_minor, 'missing'::text as state, rf.created_at as at
        from commerce.refunds rf join commerce.payments p on p.store_id = rf.store_id and p.id = rf.payment_id
        join commerce.invoices i on i.store_id = rf.store_id and i.order_id = p.order_id
       where rf.store_id = ${storeId}::uuid and rf.status = 'succeeded'
         and not exists (select 1 from commerce.credit_notes c where c.store_id = rf.store_id and c.refund_id = rf.id)
         and not exists (select 1 from commerce.order_events e where e.store_id = rf.store_id and e.order_id = p.order_id and e.type in ('credit_note.short', 'credit_note.not_invoiced') and e.data ->> 'key' = rf.id::text)
      union all
      select null::uuid, rt.id, rt.order_id, rt.refund_minor, 'missing', coalesce(rt.refunded_at, rt.created_at)
        from commerce.returns rt join commerce.invoices i on i.store_id = rt.store_id and i.order_id = rt.order_id
       where rt.store_id = ${storeId}::uuid and rt.refund_outside and rt.refund_id is null and coalesce(rt.refund_minor, 0) > 0
         and not exists (select 1 from commerce.credit_notes c where c.store_id = rt.store_id and c.return_id = rt.id and c.source = 'return_outside')
         and not exists (select 1 from commerce.order_events e where e.store_id = rt.store_id and e.order_id = rt.order_id and e.type in ('credit_note.short', 'credit_note.not_invoiced') and e.data ->> 'key' = rt.id::text)
      union all
      select rf.id, null::uuid, e.order_id, (e.data ->> 'shortMinor')::bigint, 'short', e.created_at
        from commerce.order_events e join commerce.refunds rf on rf.store_id = e.store_id and rf.id::text = e.data ->> 'key'
       where e.store_id = ${storeId}::uuid and e.type = 'credit_note.short'
      union all
      select null::uuid, rt.id, e.order_id, (e.data ->> 'shortMinor')::bigint, 'short', e.created_at
        from commerce.order_events e join commerce.returns rt on rt.store_id = e.store_id and rt.id::text = e.data ->> 'key'
       where e.store_id = ${storeId}::uuid and e.type = 'credit_note.short'
    ) x join commerce.orders o on o.store_id = ${storeId}::uuid and o.id = x.order_id
    order by x.at
  `);
  return rows.map((r) => ({
    refundId: text(r.refund_id),
    returnId: text(r.return_id),
    orderId: String(r.order_id),
    orderNumber: String(r.order_number),
    amountMinor: Number(r.amount_minor),
    currency: String(r.currency).trim(),
    state: r.state === "short" ? "short" : "missing",
  }));
}

export type InvoiceCounts = {
  invoices: number;
  creditNotes: number;
  waiting: number;
  overdue: number;
  /** Documents whose PDF failed five times: the job stopped trying. */
  pdfFailing: number;
};

/** Counts for the Orders section's tab, the store's Home and the control center. */
export async function invoiceCounts(storeId: string, today?: string): Promise<InvoiceCounts> {
  const [[c], waiting] = await Promise.all([
    db().execute<Row>(sql`
      select (select count(*) from commerce.invoices where store_id = ${storeId}::uuid) as invoices,
             (select count(*) from commerce.credit_notes where store_id = ${storeId}::uuid) as credit_notes,
             (select count(*) from commerce.document_pdf_state s where s.store_id = ${storeId}::uuid and s.attempts >= ${PDF_ATTEMPTS}
                and ((s.document_type = 'invoice' and exists (select 1 from commerce.invoices i where i.store_id = s.store_id and i.id = s.document_id and i.pdf_path is null))
                  or (s.document_type = 'credit_note' and exists (select 1 from commerce.credit_notes c where c.store_id = s.store_id and c.id = s.document_id and c.pdf_path is null)))) as pdf_failing
    `),
    waitingInvoices(storeId, today),
  ]);
  return {
    invoices: Number(c?.invoices ?? 0),
    creditNotes: Number(c?.credit_notes ?? 0),
    waiting: waiting.length,
    overdue: waiting.filter((w) => w.overdue).length,
    pdfFailing: Number(c?.pdf_failing ?? 0),
  };
}

export type FailingPdf = {
  type: DocumentKind;
  id: string;
  documentNumber: string;
  orderId: string;
  orderNumber: string;
  attempts: number;
  /** The renderer's error, cut to 200 characters; never a name. */
  lastError: string | null;
};

/** Documents whose PDF failed `PDF_ATTEMPTS` times and still has none: the Waiting tab lists them with a *Try again* button. */
export async function failingPdfs(storeId: string): Promise<FailingPdf[]> {
  const rows = await db().execute<Row>(sql`
    select 'invoice'::text as type, i.id, i.document_number, i.order_id, o.number as order_number, s.attempts, s.last_error, i.issued_at as at
      from commerce.document_pdf_state s
      join commerce.invoices i on i.store_id = s.store_id and i.id = s.document_id
      join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
     where s.store_id = ${storeId}::uuid and s.document_type = 'invoice' and s.attempts >= ${PDF_ATTEMPTS} and i.pdf_path is null
    union all
    select 'credit_note', c.id, c.document_number, i.order_id, o.number, s.attempts, s.last_error, c.issued_at
      from commerce.document_pdf_state s
      join commerce.credit_notes c on c.store_id = s.store_id and c.id = s.document_id
      join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
      join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
     where s.store_id = ${storeId}::uuid and s.document_type = 'credit_note' and s.attempts >= ${PDF_ATTEMPTS} and c.pdf_path is null
    order by at
    limit 100
  `);
  return rows.map((r) => ({
    type: r.type === "credit_note" ? "credit_note" : "invoice",
    id: String(r.id),
    documentNumber: String(r.document_number),
    orderId: String(r.order_id),
    orderNumber: String(r.order_number),
    attempts: Number(r.attempts),
    lastError: text(r.last_error),
  }));
}

/** How many times a PDF is tried before the job stops (the Waiting tab then shows "PDF not made" with a button). */
export const PDF_ATTEMPTS = 5;

export type DocumentAudit = { series: "invoice" | "credit_note"; documents: number; firstNumber: number | null; lastNumber: number | null; missing: number; firstMissing: number | null; offFormat: number; nextNumber: number | null; ok: boolean };

/** The two series checked as one unbroken run each (`commerce.document_audit()`, as `order_number_audit()` does for orders). */
export async function documentAudit(storeId: string): Promise<DocumentAudit[]> {
  const rows = await db().execute<Row>(sql`select * from commerce.document_audit(${storeId}::uuid)`);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => ({
    series: String(r.series) as DocumentAudit["series"],
    documents: Number(r.documents ?? 0),
    firstNumber: num(r.first_number),
    lastNumber: num(r.last_number),
    missing: Number(r.missing ?? 0),
    firstMissing: num(r.first_missing),
    offFormat: Number(r.off_format ?? 0),
    nextNumber: num(r.next_number),
    ok: r.ok === true,
  }));
}

export type CheckupFinding = { code: "invoice_numbers_broken" | "invoices_waiting" | "credit_note_missing" | "credit_note_short" | "refund_reversed_after_success" | "pdf_failing"; message: string };

/**
 * What the store checkup says about documents (`store_checkup`, docs 2.4): a broken number series, invoices waiting, a succeeded refund
 * with no credit note or one that could only be credited in part, a refund Stripe later reported as failed after it had succeeded, and
 * PDFs that could not be made. Plain sentences for the owner, never a buyer's name.
 */
export async function invoiceCheckupFindings(storeId: string): Promise<CheckupFinding[]> {
  const [audit, waiting, creditNotes, [reversed], counts] = await Promise.all([
    documentAudit(storeId),
    waitingInvoices(storeId),
    waitingCreditNotes(storeId),
    db().execute<Row>(sql`select count(*)::int as n from commerce.order_events where store_id = ${storeId}::uuid and type = 'refund.reversed_after_success'`),
    invoiceCounts(storeId),
  ]);
  const findings: CheckupFinding[] = [];
  for (const a of audit) {
    if (a.ok) continue;
    const what = a.series === "invoice" ? "Invoice" : "Credit note";
    findings.push({
      code: "invoice_numbers_broken",
      message: `${what} numbering is not in sequence${a.firstMissing !== null ? `: number ${a.firstMissing} is missing` : a.offFormat > 0 ? `: ${a.offFormat} document(s) do not match the series' prefix` : ""}.`,
    });
  }
  if (waiting.length > 0) {
    const overdue = waiting.filter((w) => w.overdue).length;
    findings.push({
      code: "invoices_waiting",
      message: `${waiting.length} paid order(s) are waiting for an invoice${overdue > 0 ? `, ${overdue} of them past the deadline for a reverse-charge invoice` : ""}: ${WAITING_WORDS[waiting[0].reason].staff}`,
    });
  }
  const missing = creditNotes.filter((c) => c.state === "missing").length;
  const short = creditNotes.filter((c) => c.state === "short").length;
  if (missing > 0) findings.push({ code: "credit_note_missing", message: `${missing} refund(s) have no credit note yet; they are tried again every five minutes.` });
  if (short > 0) findings.push({ code: "credit_note_short", message: `${short} refund(s) were larger than what their invoice had left, so the credit note covers only part of them.` });
  if (Number(reversed?.n ?? 0) > 0) {
    findings.push({ code: "refund_reversed_after_success", message: `Stripe reported ${reversed.n} refund(s) as failed after they had succeeded. Their credit notes stand; check the refunds in Stripe.` });
  }
  if (counts.pdfFailing > 0) findings.push({ code: "pdf_failing", message: `${counts.pdfFailing} document(s) have no PDF after several tries. Open the Waiting tab and try again.` });
  return findings;
}

/**
 * What waits for an invoice in several stores at once, for the control center and a store's Home (D159, docs 5.5): only stores with a paid
 * order that is eligible and has no invoice are asked in full (`waitingInvoices()`, the queue the Invoices page shows), so a store with
 * nothing waiting costs one `exists`. A store with nothing waiting is not in the map. The caller passes only the stores whose owner is
 * asking: the figures are for owners.
 */
export async function invoiceAttention(storeIds: string[]): Promise<Map<string, { waiting: number; overdue: number }>> {
  const found = new Map<string, { waiting: number; overdue: number }>();
  if (storeIds.length === 0) return found;
  const ids = sql.join(storeIds.map((id) => sql`${id}::uuid`), sql`, `);
  const candidates = await db().execute<Row>(sql`
    select s.id
    from commerce.stores s
    where s.id in (${ids})
      and exists (
        select 1 from commerce.orders o
        where o.store_id = s.id and o.copied_from is null and o.host_id is null
          and exists (select 1 from commerce.order_events e where e.store_id = o.store_id and e.order_id = o.id and e.type = 'order.paid')
          and not exists (select 1 from commerce.invoices i where i.store_id = o.store_id and i.order_id = o.id)
          and commerce.invoice_eligibility(o.id) = 'ok'
      )
  `);
  const queues = await Promise.all(candidates.map(async (c) => [String(c.id), await waitingInvoices(String(c.id))] as const));
  for (const [id, queue] of queues) {
    if (queue.length > 0) found.set(id, { waiting: queue.length, overdue: queue.filter((w) => w.overdue).length });
  }
  return found;
}
