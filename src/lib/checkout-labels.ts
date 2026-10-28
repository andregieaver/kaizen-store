import type { CheckoutLabels } from "@/components/checkout-button";

import { customsText } from "./customs-text";
import type { Messages } from "./i18n";

/** The checkout button's texts, shared by the cart and the checkout page. */
export function checkoutLabels(m: Messages, action: string = m.checkout, lang: string = "en"): CheckoutLabels {
  return {
    checkout: action,
    startingPayment: m.startingPayment,
    problems: {
      empty: m.problemEmpty,
      unavailable: m.problemUnavailable,
      stock: m.problemStock,
      no_shipping: m.problemShipping,
      payments_off: m.checkoutUnavailable,
      payment_error: m.problemPayment,
      already_paid: m.problemPaid,
      processing: m.problemProcessing,
      consent: m.problemConsent,
      subscription_consent: m.problemSubscriptionConsent,
      plans: m.problemPlans,
      discount: m.problemDiscount,
      company: m.problemCompany,
      company_number: m.problemCompanyNumber,
      slot_taken: m.booking.problem,
      contact: m.booking.problemContact,
      pay_later_mix: m.booking.problemMixed,
      host_mix: m.stay.problemHosts,
      host_payments_off: m.stay.problemHostPayments,
      payer: m.payer.problem,
      terms: m.paymentTerms.problem,
      location: m.companyAccount.problemLocation,
      po_number: m.companyAccount.problemPoNumber,
      approval: m.companyAccount.problemApproval,
      quantity: m.problemQuantity,
      unregistered: m.producer.problem,
      // Customs and duties (D343): hand-written in the four languages (`customs-text.ts`), for legal review.
      customs: customsText(lang).problem,
      // Checkout rules and fields (D357).
      checkout_rule: m.problemCheckoutRule,
      checkout_fields: m.checkoutQuestions.problem,
      // Customer accounts required (D365).
      sign_in_required: m.problemSignIn,
      // A store not opened yet (D369).
      not_open: m.problemNotOpen,
    },
  };
}
