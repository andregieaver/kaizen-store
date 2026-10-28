"use client";

import { loadStripe, type StripeElementLocale, type StripePaymentMethodMessagingElementOptions } from "@stripe/stripe-js";
import { Elements, PaymentMethodMessagingElement } from "@stripe/react-stripe-js";
import { useMemo } from "react";

import type { KlarnaSetup } from "./klarna-message";

export type KlarnaElementProps = KlarnaSetup & { amountMinor: number };

/** Stripe's messaging element for Klarna (D373), loaded by `KlarnaMessage` only; the amount is the price as the page shows it. */
export function KlarnaElement({ publishableKey, stripeAccount, currency, country, locale, amountMinor }: KlarnaElementProps) {
  const stripe = useMemo(() => loadStripe(publishableKey, { stripeAccount, locale: locale as StripeElementLocale }), [publishableKey, stripeAccount, locale]);
  const options: StripePaymentMethodMessagingElementOptions = {
    amount: amountMinor,
    currency: currency.toUpperCase() as StripePaymentMethodMessagingElementOptions["currency"],
    countryCode: country.toUpperCase() as StripePaymentMethodMessagingElementOptions["countryCode"],
    paymentMethodTypes: ["klarna"],
  };
  return (
    <Elements stripe={stripe}>
      <PaymentMethodMessagingElement options={options} />
    </Elements>
  );
}
