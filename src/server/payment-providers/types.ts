import type { PaymentProviderId } from "@/lib/payment-providers";
import type { PaymentModeName } from "@/lib/stripe-account";

/**
 * A payment as Kaizena Flow keeps it (`commerce.payments`), with what its provider needs to reach it: the account it was taken on and the mode. Mode is
 * null when the account is no longer known to Kaizena Flow (a payment taken with a store's own keys before Stripe Connect).
 */
export type StoredPayment = {
  id: string;
  orderId: string;
  provider: PaymentProviderId;
  reference: string;
  account: string | null;
  mode: PaymentModeName | null;
};

/** Where a payment that should not be paid any more ends up once its provider is asked to close it. */
export type ClosedPayment =
  /** It can no longer be paid. */
  | "closed"
  /** It was paid meanwhile: the order is completed (the answer applied); the caller must not cancel or change it. */
  | "paid"
  /** The shopper finished and the money is on its way: the caller waits for the provider's next answer. */
  | "processing"
  /** The provider could not be asked: nothing proves the shopper cannot still pay, so the caller waits too. */
  | "unknown";

export type ProviderRefund = { reference: string; status: "succeeded" | "pending" | "failed" };

/** A provider refused, or could not be asked: the message is for staff, in plain words. */
export class PaymentProviderRefusal extends Error {}

/**
 * What every payment provider does for Kaizena Flow (wave 4 unit E, D292, `docs/wave-4-payments.md` 7). Everything already paid stays with the provider that
 * took it: the order page's late read, closing a payment that must not be paid any more and refunds always go to the payment's own provider.
 */
export interface PaymentProvider {
  id: PaymentProviderId;
  /** The provider's name as staff read it. */
  name: string;
  /** Asks the provider for the payment and applies its answer to the order (`applyPaymentAnswer()`). False when it could not be asked. */
  refresh(storeId: string, payment: StoredPayment): Promise<boolean>;
  /** Closes a payment still open, so it cannot be paid any more. */
  close(storeId: string, payment: StoredPayment): Promise<ClosedPayment>;
  /**
   * Gives back part of a payment through the provider. `idempotencyKey` replays the same refund on a retry. Throws `PaymentProviderRefusal` with a sentence for
   * staff when the provider refuses or cannot be reached.
   */
  refund(storeId: string, payment: StoredPayment, request: { amountMinor: number; idempotencyKey: string; orderId: string; orderNumber: string }): Promise<ProviderRefund>;
}
