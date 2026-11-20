import type { BillingAddress } from "./work-input-schema";

export type { AssignmentInput, BillingAddress, ClientInput, InvoiceLineInput, NumberSeriesInput, WorkSettingsInput } from "./work-input-schema";

/**
 * What the Work forms send, shared by the browser (which builds it and shows
 * the messages) and the server (which checks it again before anything is
 * written), as the product editor's `productInput` is (docs/work.md 4.2, 7.2
 * WP2). Field names are the columns of 4.2 in camelCase; money is integer
 * minor units and time integer minutes, never text. Typed text ("1h30",
 * "1 249,50") is read first with `parseDuration`, `parseMoneyText` and
 * `parseQuantityText`, so these schemas only ever see numbers.
 *
 * What a document freezes (numbers, seller and buyer snapshots, VAT rates,
 * totals) is never an input: the server works those out.
 */

// --- Clients -------------------------------------------------------------------

export const CLIENT_NAME_MAX = 120;
export const NOTES_MAX = 4000;

/** An address as one text for the readiness check and the document: `Street, 0150 Oslo, NO`. */
export function addressText(address: Partial<BillingAddress> | null | undefined, countryCode?: string | null): string {
  if (!address) return "";
  const town = [address.postalCode, address.city]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return [address.line1, address.line2, town, countryCode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

// --- Assignments, tasks, time ----------------------------------------------------

export const ASSIGNMENT_STATUSES = ["active", "paused", "done"] as const;
export const BILLING_TYPES = ["hourly", "fixed_fee"] as const;

// --- Invoices ---------------------------------------------------------------------

export const MAX_INVOICE_LINES = 300;
export const LINE_DESCRIPTION_MAX = 500;
export const REFERENCE_MAX = 100;
export const LINE_UNITS = ["hour", "unit"] as const;

// --- Recurring templates ----------------------------------------------------------

// --- Settings ---------------------------------------------------------------------

export const NUMBER_SERIES = ["work_invoice", "work_credit_note"] as const;

// --- Payments and credit notes ------------------------------------------------------

/** How an owner records a payment by hand; `stripe` and `prepaid` are written only by the system. */
export const MANUAL_PAYMENT_METHODS = ["bank", "card", "cash", "other"] as const;

