/**
 * Why an order has its VAT treatment, in staff's English (D157, bloat review step 2.50): beside `vat-treatment.ts`, which re-exports it for
 * `reasonStaffText()`, so the admin's `order` catalogue takes it from here and imports no code. Imports nothing but types.
 */
import type { VatReason } from "./vat-treatment";

/** The staff sentence of each reason, in English: the admin's catalogue (`order.vatTreatment.reasons`) says them in each language. */
export const VAT_STAFF_TEXT: Record<VatReason, string> = {
  host_order: "A host's order: the host is the seller, so the destination country's VAT applies as set for the listing.",
  consumer: "A private buyer: the destination country's VAT is charged.",
  ioss: "A consignment of at most 150 EUR from outside the EU to a private buyer: destination VAT charged, marked with the store's IOSS number.",
  ioss_over_limit: "A consignment above 150 EUR: not an IOSS sale. The buyer may pay import VAT at the border.",
  ioss_no_rate: "The order's currency has no euro rate in this store, so the 150 EUR limit cannot be checked: not marked as IOSS.",
  no_buyer_vat_number: "A business buyer without a VAT number: VAT is charged.",
  number_invalid: "VIES did not accept the buyer's VAT number: VAT is charged.",
  number_unavailable: "VIES could not be reached for the buyer's VAT number: VAT is charged and the sale went on.",
  number_stale: "The check of the buyer's VAT number was more than 24 hours old: VAT is charged.",
  number_not_eu: "The buyer's VAT number is not from an EU member state: VAT is charged.",
  number_other_country: "The buyer's VAT number is for another country than the one the goods go to: VAT is charged.",
  own_number: "The number is the store's own: VAT is charged.",
  same_country: "The goods go to the seller's own country: a domestic sale, VAT is charged.",
  seller_not_eu: "The store is not established in an EU member state: reverse charge is not used.",
  seller_not_registered: "The store has no VAT registration with a number: reverse charge is not used.",
  seller_number_unverified: "The store's own VAT number has not been checked valid: reverse charge is not used.",
  has_service: "The basket has a booking: services are charged VAT in full.",
  has_subscription: "The basket has a subscription: it is charged VAT in full.",
  dispatch_outside_eu: "The goods are sent from outside the EU: that is an import, not a supply to another member state, so reverse charge is not used.",
  dispatch_domestic: "The goods are sent from the buyer's own country: that is a domestic sale there, so reverse charge is not used.",
  nothing_taxable: "The order carries no VAT, so there is nothing to reverse.",
  reverse_charge: "Reverse charge: the buyer's VAT number was checked valid and the buyer accounts for the VAT in their own country.",
};
