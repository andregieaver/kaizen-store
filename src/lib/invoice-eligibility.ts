/**
 * When an order gets an invoice (D159, `docs/wave-1b-invoices.md` 2.1): a closed list of reasons, in the order they are
 * checked. `commerce.invoice_eligibility(order)` returns the first that fails, as a code from this list (a test compares the
 * array to the migration), and the admin and the shopper's pages say each in words.
 */

export const ELIGIBILITY_REASONS = ["copied", "host", "not_paid", "test_mode", "disabled", "zero_total", "ok"] as const;
export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

export type EligibilityFacts = {
  /** `copied_from is not null`: history copied from another store (D129), never invoiced. */
  copied: boolean;
  /** `host_id is not null`: the host is the seller (D71). */
  host: boolean;
  /** There is an `order.paid` event. */
  paid: boolean;
  /** Paid in Stripe's test mode (the order's payment is on a test account). */
  testMode: boolean;
  /** The store's invoicing is off. */
  invoicingOff: boolean;
  /** The order was paid before invoicing was switched on (`invoice_settings.enabled_from`). */
  paidBeforeStart: boolean;
  totalMinor: number;
};

export function eligibilityOf(f: EligibilityFacts): EligibilityReason {
  if (f.copied) return "copied";
  if (f.host) return "host";
  if (!f.paid) return "not_paid";
  if (f.testMode) return "test_mode";
  if (f.invoicingOff || f.paidBeforeStart) return "disabled";
  if (f.totalMinor === 0) return "zero_total";
  return "ok";
}

/** What the admin says of an order with no invoice, and what the shopper is told (null: nothing is said to the shopper). */
export const ELIGIBILITY_WORDS: Record<EligibilityReason, { staff: string; shopper: string | null }> = {
  copied: { staff: "History copied from another store is never invoiced.", shopper: null },
  host: { staff: "A host's order is invoiced by the host, not by the store.", shopper: null },
  not_paid: { staff: "The order has not been paid, so it has no invoice.", shopper: null },
  test_mode: { staff: "Paid in Stripe's test mode: a test order gets no invoice, so the legal numbers are not used up.", shopper: "Test order: no invoice." },
  disabled: { staff: "Invoicing is switched off for this store, or the order was paid before it was switched on.", shopper: null },
  zero_total: { staff: "The order's total is 0, so there is nothing to invoice.", shopper: null },
  ok: { staff: "The order is eligible for an invoice.", shopper: null },
};

/** The name of a document's file: its number, safe in a file name (a prefix may hold `/`). */
export function invoiceFileName(documentNumber: string): string {
  const safe = documentNumber.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return `${safe || "document"}.pdf`;
}
