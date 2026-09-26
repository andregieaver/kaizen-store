import type { CheckoutLabels } from "@/components/checkout-button";

import type { Messages } from "./i18n";

/** The checkout button's texts, shared by the cart and the checkout page. */
export function checkoutLabels(m: Messages, action: string = m.checkout): CheckoutLabels {
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
    },
  };
}
