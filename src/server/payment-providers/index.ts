import "server-only";

import { isPaymentProvider, type PaymentProviderId } from "@/lib/payment-providers";

import { mollieProvider } from "./mollie";
import { stripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export { PaymentProviderRefusal, type ClosedPayment, type PaymentProvider, type ProviderRefund, type StoredPayment } from "./types";

/**
 * The providers, read when one is asked for, not when this file loads: `./mollie` imports this file back through
 * payment-outcome, so a request that loads `./mollie` first (Mollie's webhook) finds its provider not yet made while this file
 * runs. A map built at the top would keep that empty entry for good (bloat review step 0.6).
 */
const providers = (): Record<PaymentProviderId, PaymentProvider> => ({
  stripe: stripeProvider,
  mollie: mollieProvider,
});

/** The provider that took a payment, or null for a payment no provider took (`manual`, `venue`, `exchange`). */
export function providerOf(id: unknown): PaymentProvider | null {
  return isPaymentProvider(id) ? providers()[id] : null;
}
