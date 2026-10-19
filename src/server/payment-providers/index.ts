import "server-only";

import { isPaymentProvider, type PaymentProviderId } from "@/lib/payment-providers";

import { mollieProvider } from "./mollie";
import { stripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export { PaymentProviderRefusal, type ClosedPayment, type PaymentProvider, type ProviderRefund, type StoredPayment } from "./types";

const PROVIDERS: Record<PaymentProviderId, PaymentProvider> = {
  stripe: stripeProvider,
  mollie: mollieProvider,
};

/** The provider that took a payment, or null for a payment no provider took (`manual`, `venue`, `exchange`). */
export function providerOf(id: unknown): PaymentProvider | null {
  return isPaymentProvider(id) ? PROVIDERS[id] : null;
}
