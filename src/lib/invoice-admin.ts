import type { QueueReason } from "./invoice-readiness";

/**
 * The words and addresses of the invoices screens in the admin (D159, `docs/wave-1b-invoices.md` 2.3): the three tabs, the period
 * and the search read from the address, the labels, and the sentences about what waits. Pure and English only (the admin is English
 * only); what a shopper reads is `invoice-text.ts`. Nothing here is legal advice.
 */

export const INVOICE_TABS = ["invoices", "credit-notes", "waiting"] as const;
export type InvoiceTab = (typeof INVOICE_TABS)[number];

export const TAB_LABELS: Record<InvoiceTab, string> = { invoices: "Invoices", "credit-notes": "Credit notes", waiting: "Waiting" };

/** Documents on a page of the lists (the server's own page size). */
export const DOCUMENTS_PER_PAGE = 50;

export type InvoiceQuery = {
  tab: InvoiceTab;
  /** First and last store day shown (YYYY-MM-DD), or null for no limit. */
  from: string | null;
  to: string | null;
  /** The search: a document number, an order number or a buyer's email. */
  q: string;
  /** Every period, not just this month. */
  all: boolean;
  page: number;
};

const isDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** The first day of the month a store day is in. */
export const monthStart = (today: string): string => `${today.slice(0, 7)}-01`;

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * What the address asks for. The period is this month (to `today`, a store day) unless the address gives its own days or asks for every
 * period; a first day after the last is put right by swapping them, never refused.
 */
export function parseInvoiceQuery(query: Record<string, string | string[] | undefined>, today: string): InvoiceQuery {
  const tabText = first(query.tab);
  const tab = (INVOICE_TABS as readonly string[]).includes(tabText ?? "") ? (tabText as InvoiceTab) : "invoices";
  const all = first(query.all) === "1";
  const fromText = first(query.from);
  const toText = first(query.to);
  let from = all ? null : isDay(fromText) ? fromText : monthStart(today);
  let to = all ? null : isDay(toText) ? toText : today;
  if (from && to && from > to) [from, to] = [to, from];
  const page = /^\d{1,6}$/.test(first(query.page) ?? "") ? Math.max(1, Number(first(query.page))) : 1;
  return { tab, from, to, q: (first(query.q) ?? "").trim().slice(0, 100), all, page };
}

/** The list's address for a query: only what differs from the default is written. */
export function invoicesHref(base: string, query: Partial<InvoiceQuery>, today?: string): string {
  const search = new URLSearchParams();
  if (query.tab && query.tab !== "invoices") search.set("tab", query.tab);
  if (query.all) search.set("all", "1");
  else {
    if (query.from && (!today || query.from !== monthStart(today))) search.set("from", query.from);
    if (query.to && (!today || query.to !== today)) search.set("to", query.to);
  }
  if (query.q) search.set("q", query.q);
  if (query.page && query.page > 1) search.set("page", String(query.page));
  const text = search.toString();
  return text ? `${base}?${text}` : base;
}

/** Where a document's PDF and its printable view are, for staff. */
export function documentPdfHref(base: string, type: "invoice" | "credit_note", id: string): string {
  return type === "invoice" ? `${base}/invoices/${id}/pdf` : `${base}/invoices/credit-notes/${id}/pdf`;
}
export function documentPrintHref(base: string, type: "invoice" | "credit_note", id: string): string {
  return type === "invoice" ? `${base}/invoices/${id}/print` : `${base}/invoices/credit-notes/${id}/print`;
}

/** What the order's VAT treatment is called in the lists. */
export const VAT_KIND_LABELS: Record<string, string> = { standard: "Standard", reverse_charge: "Reverse charge", ioss: "IOSS" };
export const vatKindLabel = (kind: string | null): string => (kind ? (VAT_KIND_LABELS[kind] ?? kind) : "–");

/** Where a credit note came from. */
export const SOURCE_LABELS: Record<string, string> = { refund: "Refund", return_outside: "Return refunded outside Kaizen" };
export const sourceLabel = (source: string | null): string => (source ? (SOURCE_LABELS[source] ?? source) : "–");

/** A country code as its English name, or the code when the runtime does not know it. */
export function countryName(code: string | null): string {
  if (!code) return "–";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The short reason shown beside a waiting order. */
export const WAITING_TITLES: Record<QueueReason, string> = {
  seller_details: "Business details missing",
  tax_profile_missing: "Tax profile missing",
  vat_charged_not_registered: "VAT charged, store not VAT-registered",
  no_exchange_rate: "No exchange rate",
  invoice_failed: "Making the invoice failed",
};

/** The one line above the lists: what needs a person first. */
export function countsSentence(counts: { waiting: number; overdue: number; pdfFailing: number }): string {
  const parts: string[] = [];
  if (counts.overdue > 0) parts.push(`${counts.overdue} past the deadline for a reverse-charge invoice`);
  if (counts.waiting > 0) parts.push(`${counts.waiting} paid ${counts.waiting === 1 ? "order is" : "orders are"} waiting for an invoice`);
  if (counts.pdfFailing > 0) parts.push(`${counts.pdfFailing} ${counts.pdfFailing === 1 ? "PDF was" : "PDFs were"} not made`);
  return parts.length === 0 ? "Every paid order has its invoice." : `${parts.join(", ")}.`;
}

/** The result of *Check again*, in words. */
export function checkAgainSentence(issued: number, creditNotes: number): string {
  if (issued === 0 && creditNotes === 0) return "Nothing new could be issued. What still waits is listed here with the reason.";
  const parts: string[] = [];
  if (issued > 0) parts.push(`${issued} ${issued === 1 ? "invoice" : "invoices"} issued`);
  if (creditNotes > 0) parts.push(`${creditNotes} ${creditNotes === 1 ? "credit note" : "credit notes"} issued`);
  return `${parts.join(" and ")}.`;
}

/** The result of sending a document again, in words. */
export function sentAgainSentence(type: "invoice" | "credit_note", outcome: string | null): { ok: boolean; message: string } {
  const what = type === "invoice" ? "invoice" : "credit note";
  if (outcome === "sent" || outcome === "logged") return { ok: true, message: `The ${what} was sent to the order's email address.` };
  if (outcome === "duplicate") return { ok: false, message: `The ${what} was already sent just now.` };
  return { ok: false, message: `The ${what} could not be sent: the order has no email address, or the email could not be handed over.` };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A store day (YYYY-MM-DD) as the admin writes dates: "5 Oct 2026", the same in every runtime. A value that is not a day is shown as it is. */
export function dayLabel(day: string | null): string {
  if (!day || !isDay(day.slice(0, 10))) return day ?? "–";
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/** The seller's details an invoice needs, as the readiness list names them. */
export const SELLER_FIELD_LABELS: Record<string, string> = {
  legal_name: "Legal name of the business",
  postal_address: "Postal address",
  organisation_number: "Organisation number",
  country: "Country",
  vat_number: "VAT number (the store is registered for VAT)",
};

/**
 * What an owner is told on the settings page, in plain English, for an accountant's eyes. Flagged for review (docs/wave-1b-invoices.md
 * section 8): nothing here is advice, and each line says what the system does, not what the law requires of this business.
 */
export const INVOICE_NOTES: string[] = [
  "Invoices follow the content list of the EU VAT Directive (Article 226) and what was read of the rules of Norway, Sweden, Denmark and Germany on 4 October 2026. The rules of other countries were not read. Have your accountant check a sample before you rely on them.",
  "An invoice is made automatically for every paid consumer and business order, also when the buyer gave no street address (the document is marked incomplete and nothing is invented). Whether that is enough for a sale to a consumer is a question for your accountant.",
  "When the invoice is not in your country's currency, it shows the VAT in your country's currency at the store's own exchange rate for the day. That rate comes from your store's rate table, so check how you keep it under Languages and currencies.",
  "A credit note is made for each refund that succeeds, never above what the invoice has left per VAT rate. A deduction for diminished value and return postage the customer pays reduce the credit as the system treats them by default.",
  "A subscription started with a free trial is invoiced for what is due now; each renewal gets its own invoice when it is paid.",
  "Orders paid in Stripe's test mode, history copied from another store and a host's own orders get no invoice. Orders paid before invoicing was switched on are not invoiced afterwards.",
  "Not built yet: your own invoice layout and logo, structured e-invoices (XRechnung, Peppol, EHF), corrective invoices and manual credit notes, and other languages than Norwegian, Swedish, Danish and English (the document then shows English).",
];

/** What the invoices page says when the CSV route sent the person back (`?export=`): fixed sentences, never text from the address. */
export const EXPORT_PROBLEMS = {
  period: "Choose a period: a first and a last day, the first not after the last.",
  too_many: "That period holds more than 20,000 documents, too many for one file. Choose a shorter period.",
} as const;

export const exportProblemOf = (value: string | undefined): string | null => (value && Object.hasOwn(EXPORT_PROBLEMS, value) ? EXPORT_PROBLEMS[value as keyof typeof EXPORT_PROBLEMS] : null);
