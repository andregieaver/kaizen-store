import type { FormState } from "@/components/admin/action-form";
import { parseInvoiceQuery } from "@/lib/invoice-admin";
import type { DocumentListRow, FailingPdf, InvoiceCounts, OrderDocuments, WaitingCreditNote, WaitingInvoice } from "@/server/invoices";

/** What the invoices screens' tests draw: documents, queue rows and actions as do-nothings, so a screen can be seen without a server. */

export const TODAY = "2026-10-14";

export const query = (over: Record<string, string> = {}) => parseInvoiceQuery(over, TODAY);

export const counts = (over: Partial<InvoiceCounts> = {}): InvoiceCounts => ({ invoices: 12, creditNotes: 2, waiting: 0, overdue: 0, pdfFailing: 0, ...over });

export const row = (over: Partial<DocumentListRow> = {}): DocumentListRow => ({
  id: "22222222-2222-4222-8222-222222222222",
  type: "invoice",
  documentNumber: "F-17",
  issuedOn: "2026-10-05",
  orderId: "33333333-3333-4333-8333-333333333333",
  orderNumber: "1001",
  currency: "NOK",
  netMinor: 80_000,
  vatMinor: 20_000,
  totalMinor: 100_000,
  vatKind: "standard",
  buyerName: "Kari Nordmann",
  buyerCountry: "NO",
  hasPdf: true,
  anonymised: false,
  invoiceId: null,
  invoiceNumber: null,
  source: null,
  ...over,
});

export const noteRow = (over: Partial<DocumentListRow> = {}): DocumentListRow =>
  row({ id: "44444444-4444-4444-8444-444444444444", type: "credit_note", documentNumber: "K-3", issuedOn: "2026-10-09", totalMinor: 25_000, netMinor: 20_000, vatMinor: 5_000, invoiceId: "22222222-2222-4222-8222-222222222222", invoiceNumber: "F-17", source: "refund", ...over });

export const waiting = (over: Partial<WaitingInvoice> = {}): WaitingInvoice => ({
  orderId: "55555555-5555-4555-8555-555555555555",
  orderNumber: "1002",
  paidAt: "2026-10-06T10:00:00.000Z",
  paidOn: "2026-10-06",
  reason: "seller_details",
  words: "Complete your business details.",
  fixAt: "/settings/company",
  vatKind: "standard",
  totalMinor: 50_000,
  currency: "NOK",
  overdue: false,
  deadline: null,
  ...over,
});

export const note = (over: Partial<WaitingCreditNote> = {}): WaitingCreditNote => ({
  refundId: "66666666-6666-4666-8666-666666666666",
  returnId: null,
  orderId: "55555555-5555-4555-8555-555555555555",
  orderNumber: "1002",
  amountMinor: 10_000,
  currency: "NOK",
  state: "missing",
  ...over,
});

export const failing = (over: Partial<FailingPdf> = {}): FailingPdf => ({
  type: "invoice",
  id: "22222222-2222-4222-8222-222222222222",
  documentNumber: "F-17",
  orderId: "33333333-3333-4333-8333-333333333333",
  orderNumber: "1001",
  attempts: 5,
  lastError: "Chromium could not start",
  ...over,
});

export const noop = async (): Promise<FormState> => ({ status: "idle", messages: [] });
export const actions = { checkAgain: noop, retryPdf: noop };

export const orderDocuments = (over: Partial<OrderDocuments> = {}): OrderDocuments => ({
  eligibility: "ok",
  invoice: { id: "22222222-2222-4222-8222-222222222222", type: "invoice", documentNumber: "F-17", issuedOn: "2026-10-05", token: "inv_x", hasPdf: true, totalMinor: 100_000, currency: "NOK" },
  creditNotes: [],
  additionalInvoices: [],
  waiting: null,
  shopperNote: null,
  staffNote: null,
  ...over,
});

/** The visible text of rendered HTML: tags dropped, entities read, spaces joined. */
export const plain = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
