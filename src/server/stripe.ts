import "server-only";

import Stripe from "stripe";

/** A Stripe client for one store's own account (its secret key). */
export function stripeFor(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    maxNetworkRetries: 2,
    timeout: 15_000,
    appInfo: { name: "Kaizen" },
  });
}

/** The events Kaizen's webhook listens to. */
export const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
];

/** Where Stripe sends a store's events. */
export function webhookUrl(origin: string, storeId: string): string {
  return `${origin}/api/stripe/webhook/${storeId}`;
}

/**
 * Creates (or recreates) Kaizen's webhook in the store's Stripe account and
 * returns its signing secret, so owners never have to copy one by hand.
 */
export async function connectWebhook(
  secretKey: string,
  origin: string,
  storeId: string,
): Promise<{ ok: true; secret: string } | { ok: false; problem: string }> {
  const stripe = stripeFor(secretKey);
  const url = webhookUrl(origin, storeId);
  try {
    // One endpoint per store and mode: drop an earlier one for the same URL.
    for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
      if (endpoint.url === url) await stripe.webhookEndpoints.del(endpoint.id);
    }
    const created = await stripe.webhookEndpoints.create({
      url,
      enabled_events: WEBHOOK_EVENTS,
      description: "Kaizen: order payments",
      metadata: { store_id: storeId },
    });
    if (!created.secret) return { ok: false, problem: "Stripe did not return a signing secret." };
    return { ok: true, secret: created.secret };
  } catch (error) {
    const message = error instanceof Stripe.errors.StripeError ? error.message : "Stripe could not be reached.";
    return { ok: false, problem: message };
  }
}
