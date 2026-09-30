/**
 * Kaizen's plan invoices and the referral program (D131, `docs/referrals.md`): which of Stripe's invoices count, what they
 * earn the referrer and how much credit may go on one. Pure, so the webhook's rules are tested without Stripe; shapes are
 * the parts of Stripe's objects that are read.
 */

export type InvoiceShape = {
  id: string;
  status?: string | null;
  currency: string;
  total: number;
  subtotal?: number | null;
  total_excluding_tax?: number | null;
  subtotal_excluding_tax?: number | null;
  total_taxes?: { amount: number; tax_behavior?: string | null }[] | null;
  customer_account?: string | null;
  billing_reason?: string | null;
  number?: string | null;
  created?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
  parent?: { type?: string | null; subscription_details?: { metadata?: Record<string, string> | null } | null } | null;
};

export type CreditNoteShape = {
  id: string;
  invoice: string | { id: string };
  currency: string;
  total: number;
  total_excluding_tax?: number | null;
  subtotal_excluding_tax?: number | null;
  status?: string | null;
};

/** What the invoice's line says, and what marks the line as Kaizen's own. */
export const REFERRAL_CREDIT_DESCRIPTION = "Referral credit";
export const REFERRAL_CREDIT_METADATA = "kaizen_referral_credit";

/** An invoice of a plan: made by a subscription. Anything else Kaizen might send a store is not a plan fee. */
export function isPlanInvoice(invoice: InvoiceShape): boolean {
  return invoice.parent?.type === "subscription_details" || Boolean(invoice.billing_reason?.startsWith("subscription"));
}

/**
 * What the invoice is for without VAT, after discounts: what Kaizen earns from it (and what the referrer's commission
 * is worked out on). Stripe's own figure, else the total less tax Stripe added on top.
 */
export function invoiceExTaxMinor(invoice: InvoiceShape): number {
  if (typeof invoice.total_excluding_tax === "number") return Math.max(0, invoice.total_excluding_tax);
  const added = (invoice.total_taxes ?? []).filter((t) => t.tax_behavior !== "inclusive").reduce((sum, t) => sum + t.amount, 0);
  return Math.max(0, invoice.total - added);
}

/** When the invoice was paid: Stripe's time, else the time the event says. */
export function invoicePaidAt(invoice: InvoiceShape, eventCreated: number): Date {
  return new Date((invoice.status_transitions?.paid_at ?? eventCreated) * 1000);
}

/** The store an invoice is for, when Kaizen put it in the subscription's metadata. */
export const invoiceStoreMetadata = (invoice: InvoiceShape): string | null => invoice.parent?.subscription_details?.metadata?.kaizen_store_id ?? null;

/** The invoice a credit note is for. */
export const creditNoteInvoiceId = (note: CreditNoteShape): string => (typeof note.invoice === "string" ? note.invoice : note.invoice.id);

/** The amount of a credit note that takes fee back: without VAT. */
export function creditNoteExTaxMinor(note: CreditNoteShape): number {
  return Math.max(0, note.total_excluding_tax ?? note.subtotal_excluding_tax ?? note.total);
}

/**
 * How much credit an invoice may take: at most what is usable now and at most the invoice's amount without VAT, so the
 * invoice is never made negative. 0 when there is nothing to take.
 */
export function creditForInvoice(availableMinor: number, invoiceExTax: number): number {
  if (!Number.isFinite(availableMinor) || !Number.isFinite(invoiceExTax)) return 0;
  return Math.max(0, Math.min(Math.floor(availableMinor), Math.floor(invoiceExTax)));
}
