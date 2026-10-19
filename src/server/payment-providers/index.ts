import "server-only";

import { isPaymentProvider, type PaymentProviderId } from "@/lib/payment-providers";

import { stripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export { PaymentProviderRefusal, type ClosedPayment, type PaymentProvider, type ProviderRefund, type StoredPayment } from "./types";

const PROVIDERS: Record<PaymentProviderId, PaymentProvider | null> = {
  stripe: stripeProvider,
  // Unit E2 (D292).
  mollie: null,
};

/** The provider that took a payment, or null for a payment no provider took (`manual`, `venue`, `exchange`) or one not built here yet. */
export function providerOf(id: unknown): PaymentProvider | null {
  return isPaymentProvider(id) ? PROVIDERS[id] : null;
}
