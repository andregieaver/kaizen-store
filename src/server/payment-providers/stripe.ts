import "server-only";

import type Stripe from "stripe";

import { getStripeSecrets } from "../settings";
import { platformStripe, stripeFor } from "../stripe";
import { applySession } from "../stripe-webhooks";

import { PaymentProviderRefusal, type ClosedPayment, type PaymentProvider } from "./types";

/**
 * Stripe behind the payment-provider adapter (D292): every store's default provider. A payment's reference is a Checkout session (`cs_`), a Stripe
 * invoice (`in_`, a subscription's renewal) or a payment intent (`pi_`, a no-show fee charged on its own, D66); its account is the store's or a host's
 * connected account (D17, D71).
 */
export const stripeProvider: PaymentProvider = {
  id: "stripe",
  name: "Stripe",

  async refresh(storeId, payment) {
    const apply = async (fetch: () => Promise<Stripe.Checkout.Session>) => {
      try {
        await applySession(storeId, await fetch());
        return true;
      } catch {
        // Stripe is unreachable or slow: the webhook will follow.
        return false;
      }
    };
    const stripe = payment.mode ? platformStripe(payment.mode) : null;
    if (stripe && payment.account) {
      const stripeAccount = payment.account;
      return apply(() => stripe.checkout.sessions.retrieve(payment.reference, {}, { stripeAccount }));
    }
    // A payment taken with the store's own keys, before Stripe Connect.
    for (const secret of await getStripeSecrets(storeId)) {
      if (await apply(() => stripeFor(secret).checkout.sessions.retrieve(payment.reference))) return true;
    }
    return false;
  },

  async close(storeId, payment) {
    const stripe = payment.mode ? platformStripe(payment.mode) : null;
    // A failure to ask (a network error, a rate limit, no client for the mode) is NOT proof the buyer cannot pay it: the caller waits.
    if (!stripe || !payment.account) return "unknown";
    const stripeAccount = payment.account;
    let state: ClosedPayment = "unknown";
    for (let attempt = 0; attempt < 2 && state === "unknown"; attempt += 1) {
      try {
        const session = await stripe.checkout.sessions.retrieve(payment.reference, {}, { stripeAccount });
        if (session.status === "complete") {
          if (session.payment_status === "unpaid") return "processing";
          await applySession(storeId, session);
          return "paid";
        }
        if (session.status === "open") {
          // Expiring can fail because the buyer finished meanwhile: the next look tells which.
          await stripe.checkout.sessions.expire(payment.reference, {}, { stripeAccount });
        }
        state = "closed";
      } catch (error) {
        // Only a session Stripe says does not exist is closed by an error.
        if (isMissingSession(error)) state = "closed";
      }
    }
    return state;
  },

  async refund(_storeId, payment, request) {
    const stripe = payment.mode ? platformStripe(payment.mode) : null;
    if (!stripe || !payment.account) throw new PaymentProviderRefusal("Stripe cannot be reached for this store right now.");
    const stripeAccount = payment.account;
    try {
      const paymentIntent = await paymentIntentFor(stripe, payment.reference, stripeAccount);
      if (!paymentIntent) throw new PaymentProviderRefusal("Stripe has no payment to refund for this order.");
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntent,
          amount: request.amountMinor,
          reason: "requested_by_customer",
          // Kaizena Flow's fee on the refunded part goes back to the store.
          refund_application_fee: true,
          metadata: { order_id: request.orderId, order_number: request.orderNumber },
        },
        { stripeAccount, idempotencyKey: request.idempotencyKey },
      );
      return {
        reference: refund.id,
        status: refund.status === "failed" || refund.status === "canceled" ? "failed" : refund.status === "succeeded" ? "succeeded" : "pending",
      };
    } catch (error) {
      if (error instanceof PaymentProviderRefusal) throw error;
      throw new PaymentProviderRefusal(error instanceof Error && "type" in error ? `Stripe said: ${error.message}` : "Stripe could not make the refund.");
    }
  },
};

/** The payment intent behind a payment's reference: a session's, a renewal invoice's, or the intent itself. */
async function paymentIntentFor(stripe: Stripe, reference: string, stripeAccount: string): Promise<string | null> {
  const options = { stripeAccount };
  const id = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : (value?.id ?? null));
  let invoiceId: string | null = null;
  // A charge made on its own, such as a no-show fee (D66).
  if (reference.startsWith("pi_")) return reference;
  if (reference.startsWith("cs_")) {
    const session = await stripe.checkout.sessions.retrieve(reference, {}, options);
    if (session.payment_intent) return id(session.payment_intent);
    invoiceId = id(session.invoice);
  } else if (reference.startsWith("in_")) {
    invoiceId = reference;
  }
  if (!invoiceId) return null;
  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] }, options);
  const paid = invoice.payments?.data?.find((p) => p.status === "paid") ?? invoice.payments?.data?.[0];
  return id(paid?.payment?.payment_intent);
}

/** Stripe's answer for a session that does not exist (or is not this account's): the only error that proves nothing can be paid there. */
function isMissingSession(error: unknown): boolean {
  const e = error as { code?: string; statusCode?: number } | null;
  return e?.code === "resource_missing" || e?.statusCode === 404;
}
