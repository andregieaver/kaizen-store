/**
 * Whether an order that may be invoiced can be invoiced now (D159, `docs/wave-1b-invoices.md` 2.1): a closed list of reasons it
 * waits, in the order they are checked, the same list the SQL function `commerce.invoice_readiness()` returns. A waiting order
 * is issued as soon as the cause is gone (the five-minute job), with the later day as its issue date and the payment day as its
 * supply date. Never waiting, never refused: the payment.
 */
import { homeVatState, sellerVatNumberOf, type InvoiceFxFacts, type InvoiceProfileFacts, type InvoiceTreatmentFacts } from "./invoice-snapshot";

export const WAITING_REASONS = ["seller_details", "tax_profile_missing", "vat_charged_not_registered", "no_exchange_rate"] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

/** What the queue shows for an order that is eligible and has no invoice: a waiting reason, or an invoice that failed. */
export type QueueReason = WaitingReason | "invoice_failed";

export const SELLER_FIELDS = ["legal_name", "postal_address", "organisation_number", "country"] as const;
export type SellerField = (typeof SELLER_FIELDS)[number] | "vat_number";

export type SellerDetails = { legalName: string | null; postalAddress: string | null; organisationNumber: string | null; country: string | null };

const present = (v: string | null | undefined) => typeof v === "string" && v.trim() !== "";

/** The seller's details an invoice needs that the store has not given (Art. 226 points 3 and 5: name, address, and a VAT number when registered). */
export function sellerReadiness(details: SellerDetails, profile: InvoiceProfileFacts, treatment: InvoiceTreatmentFacts = null): SellerField[] {
  const missing: SellerField[] = [];
  if (!present(details.legalName)) missing.push("legal_name");
  if (!present(details.postalAddress)) missing.push("postal_address");
  if (!present(details.organisationNumber)) missing.push("organisation_number");
  if (!present(details.country)) missing.push("country");
  if (profile?.vatRegistered && !present(sellerVatNumberOf(treatment, profile))) missing.push("vat_number");
  return missing;
}

export type ReadinessFacts = {
  details: SellerDetails;
  profile: InvoiceProfileFacts;
  treatment: InvoiceTreatmentFacts;
  /** The VAT the order charged, and its currency. */
  vatMinor: number;
  currency: string;
  fx: InvoiceFxFacts;
};

/** The first reason an eligible order waits, or null when it is ready. */
export function waitingReason(f: ReadinessFacts): WaitingReason | null {
  // The seller's own details come first; the VAT number is only part of them once the profile is known.
  if (sellerReadiness(f.details, f.profile, f.treatment).length > 0) return "seller_details";
  if (f.profile === null) return "tax_profile_missing";
  // Unit 1a charges the destination's VAT whatever the registration says; a seller who is not registered may not state VAT (Denmark's momsloven § 52 a, read).
  if (!f.profile.vatRegistered && f.vatMinor > 0) return "vat_charged_not_registered";
  if (homeVatState({ fx: f.fx, seller: { ...emptySeller, country: f.details.country }, currency: f.currency, vatMinor: f.vatMinor }) === "no_rate") return "no_exchange_rate";
  return null;
}

const emptySeller = { legalName: null, organisationNumber: null, postalAddress: null, country: null, email: null, footerNote: null };

/** What the admin tells the owner for each reason, and where to fix it (a path under the store's admin). */
export const WAITING_WORDS: Record<QueueReason, { staff: string; fixAt: string | null }> = {
  seller_details: { staff: "Complete your business details (legal name, address, organisation number, country, and a VAT number when you are registered).", fixAt: "/settings/company" },
  tax_profile_missing: { staff: "Save your tax profile, so it is known whether you are registered for VAT.", fixAt: "/settings/tax" },
  vat_charged_not_registered: {
    staff: "The order charged VAT, but your tax profile says you are not registered for VAT, and an invoice may not state VAT then. Correct the tax profile, or ask your accountant.",
    fixAt: "/settings/tax",
  },
  no_exchange_rate: { staff: "The invoice needs the VAT in your country's currency, and the store has no rate between the two currencies.", fixAt: "/settings/localization" },
  invoice_failed: { staff: "Making the invoice failed; it is tried again every five minutes. The error is in the order's history.", fixAt: null },
};

/**
 * The last day an invoice for a reverse-charge supply may be issued: the 15th of the month after the chargeable event
 * (Directive Art. 222, read 2026-10-04). The chargeable event is taken as the payment day (the spec's default). National limits
 * for other supplies were not read and are not applied.
 */
export function reverseChargeDeadline(paidOn: string): string {
  const year = Number(paidOn.slice(0, 4));
  const month = Number(paidOn.slice(5, 7));
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return `${String(next.y).padStart(4, "0")}-${String(next.m).padStart(2, "0")}-15`;
}

/** Whether a waiting invoice is past its deadline on a store day (`today`): only reverse-charge orders have one here. */
export function isOverdue(input: { kind: "standard" | "reverse_charge" | "ioss"; paidOn: string; today: string }): { overdue: boolean; deadline: string | null } {
  if (input.kind !== "reverse_charge") return { overdue: false, deadline: null };
  const deadline = reverseChargeDeadline(input.paidOn);
  return { overdue: input.today > deadline, deadline };
}
