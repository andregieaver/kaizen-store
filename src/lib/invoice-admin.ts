import { countWords, fillWords } from "./admin-fill";
import { invoicesEn, type InvoicesMessages } from "./admin-messages/invoices.en";
import type { QueueReason } from "./invoice-readiness";

const EN = invoicesEn;
const lookup = (table: Record<string, string>, key: string): string | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/**
 * The words and addresses of the invoices screens in the admin (D159, `docs/wave-1b-invoices.md` 2.3): the three tabs, the period
 * and the search read from the address, the labels, and the sentences about what waits. Pure; the words are the `invoices` catalogue
 * (D312 A4), English unless another language's is passed. What a shopper reads is `invoice-text.ts`. Nothing here is legal advice.
 */

export const INVOICE_TABS = ["invoices", "credit-notes", "waiting"] as const;
export type InvoiceTab = (typeof INVOICE_TABS)[number];

export const TAB_LABELS: Record<InvoiceTab, string> = EN.labels.tabs;

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
/** A document as EN 16931 UBL (D403). */
export function documentXmlHref(base: string, type: "invoice" | "credit_note", id: string): string {
  return type === "invoice" ? `${base}/invoices/${id}/xml` : `${base}/invoices/credit-notes/${id}/xml`;
}
export function documentPrintHref(base: string, type: "invoice" | "credit_note", id: string): string {
  return type === "invoice" ? `${base}/invoices/${id}/print` : `${base}/invoices/credit-notes/${id}/print`;
}

/** What the order's VAT treatment is called in the lists. */
export const VAT_KIND_LABELS: Record<string, string> = EN.labels.vatKind;
export const vatKindLabel = (kind: string | null, w: InvoicesMessages = EN): string => (kind ? (lookup(w.labels.vatKind, kind) ?? kind) : "–");

/** Where a credit note came from. */
export const SOURCE_LABELS: Record<string, string> = EN.labels.source;
export const sourceLabel = (source: string | null, w: InvoicesMessages = EN): string => (source ? (lookup(w.labels.source, source) ?? source) : "–");

/** A country code as its name in a language (English unless given), or the code when the runtime does not know it. */
export function countryName(code: string | null, language = "en"): string {
  if (!code) return "–";
  try {
    return new Intl.DisplayNames([language], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The short reason shown beside a waiting order. */
export const WAITING_TITLES: Record<QueueReason, string> = EN.labels.waiting;

/** The one line above the lists: what needs a person first. */
export function countsSentence(counts: { waiting: number; overdue: number; pdfFailing: number }, w: InvoicesMessages = EN): string {
  const c = w.counts;
  const parts: string[] = [];
  if (counts.overdue > 0) parts.push(fillWords(c.overdue, { n: counts.overdue }));
  if (counts.waiting > 0) parts.push(countWords(counts.waiting, c.waiting));
  if (counts.pdfFailing > 0) parts.push(countWords(counts.pdfFailing, c.pdfFailing));
  return parts.length === 0 ? c.allDone : `${parts.join(", ")}.`;
}

/** The result of *Check again*, in words. */
export function checkAgainSentence(issued: number, creditNotes: number, w: InvoicesMessages = EN): string {
  const c = w.checkAgain;
  if (issued === 0 && creditNotes === 0) return c.nothing;
  const parts: string[] = [];
  if (issued > 0) parts.push(countWords(issued, c.invoices));
  if (creditNotes > 0) parts.push(countWords(creditNotes, c.creditNotes));
  return `${parts.join(c.and)}.`;
}

/** The result of sending a document again, in words. */
export function sentAgainSentence(type: "invoice" | "credit_note", outcome: string | null, w: InvoicesMessages = EN): { ok: boolean; message: string } {
  const words = w.sentAgain[type];
  if (outcome === "sent" || outcome === "logged") return { ok: true, message: words.sent };
  if (outcome === "duplicate") return { ok: false, message: words.duplicate };
  return { ok: false, message: words.failed };
}

/** A store day (YYYY-MM-DD) as the admin writes dates: "5 Oct 2026", the same in every runtime. A value that is not a day is shown as it is. */
export function dayLabel(day: string | null, w: InvoicesMessages = EN): string {
  if (!day || !isDay(day.slice(0, 10))) return day ?? "–";
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  return fillWords(w.labels.day, { date, month: w.labels.months[month - 1], year });
}

/** The seller's details an invoice needs, as the readiness list names them. */
export const SELLER_FIELD_LABELS: Record<string, string> = EN.labels.sellerFields;

/** A seller's field in words, or its key when it has none. */
export const sellerFieldLabel = (field: string, w: InvoicesMessages = EN): string => lookup(w.labels.sellerFields, field) ?? field;

/**
 * What an owner is told on the settings page, in plain English, for an accountant's eyes. Flagged for review (docs/wave-1b-invoices.md
 * section 8): nothing here is advice, and each line says what the system does, not what the law requires of this business.
 */
export const INVOICE_NOTES: string[] = EN.notes;

/** What the invoices page says when the CSV route sent the person back (`?export=`): fixed sentences, never text from the address. */
export const EXPORT_PROBLEMS: Record<"period" | "too_many", string> = EN.labels.exportProblems;

export const exportProblemOf = (value: string | undefined, w: InvoicesMessages = EN): string | null => (value ? (lookup(w.labels.exportProblems, value) ?? null) : null);
