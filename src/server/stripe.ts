import "server-only";

import Stripe from "stripe";

import { PAYMENT_MODES, platformKey, type PaymentModeName } from "@/lib/stripe-account";

const OPTIONS: Stripe.StripeConfig = {
  maxNetworkRetries: 2,
  timeout: 15_000,
  appInfo: { name: "Kaizen" },
};

/** A Stripe client for a store's own secret key (payments before Connect). */
export function stripeFor(secretKey: string): Stripe {
  return new Stripe(secretKey, OPTIONS);
}

const clients = new Map<string, Stripe>();

/**
 * Kaizen's own Stripe account (the Connect platform) for a mode, from
 * STRIPE_SECRET_KEY_TEST / STRIPE_SECRET_KEY_LIVE. Null if not configured.
 * Calls for a store pass `{ stripeAccount }` so they run on its account.
 */
export function platformStripe(mode: PaymentModeName): Stripe | null {
  const key = platformKey(
    "secret",
    mode,
    mode === "test" ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY_LIVE,
  );
  if (!key) return null;
  let client = clients.get(key);
  if (!client) {
    client = new Stripe(key, OPTIONS);
    clients.set(key, client);
  }
  return client;
}

/** The platform's publishable key for a mode, for Stripe's embedded components. */
export function platformPublishableKey(mode: PaymentModeName): string | null {
  return platformKey(
    "publishable",
    mode,
    mode === "test" ? process.env.STRIPE_PUBLISHABLE_KEY_TEST : process.env.STRIPE_PUBLISHABLE_KEY_LIVE,
  );
}

/** The modes Kaizen can take payments in: both of the mode's keys are configured. */
export function platformModes(): PaymentModeName[] {
  return PAYMENT_MODES.filter((mode) => platformStripe(mode) && platformPublishableKey(mode));
}

/** Payment events from stores' accounts that Kaizen listens to. */
export const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  // Subscriptions (D25): renewals and changes made in Stripe.
  "invoice.paid",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

/** Account (v2) events: a store's Stripe account needs something, or changed. */
export const ACCOUNT_EVENTS = [
  "v2.core.account[requirements].updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
];

/** Kaizen's own subscriptions to stores (Stripe Billing on Kaizen's account). */
export const BILLING_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

export type WebhookKind = "snapshot" | "thin" | "billing";

export const WEBHOOK_KINDS: readonly WebhookKind[] = ["snapshot", "thin", "billing"];

/** Where Stripe sends the platform's events, per mode and kind. */
export function connectWebhookUrl(origin: string, mode: PaymentModeName, kind: WebhookKind): string {
  if (kind === "billing") return `${origin}/api/stripe/billing/${mode}`;
  return `${origin}/api/stripe/connect/${mode}${kind === "thin" ? "/accounts" : ""}`;
}

export type CreatedWebhook = { kind: WebhookKind; endpointId: string; url: string; secret: string };

/**
 * Creates Kaizen's three webhooks in its own Stripe account, replacing
 * earlier ones at the same addresses, and returns their signing secrets:
 * payment events from stores' accounts (snapshot), account events (thin,
 * Accounts v2), and Kaizen's own subscription events (billing).
 */
export async function createPlatformWebhooks(
  mode: PaymentModeName,
  origin: string,
): Promise<{ ok: true; webhooks: CreatedWebhook[] } | { ok: false; problem: string }> {
  const stripe = platformStripe(mode);
  if (!stripe) return { ok: false, problem: `No ${mode} secret key is configured.` };
  const snapshotUrl = connectWebhookUrl(origin, mode, "snapshot");
  const thinUrl = connectWebhookUrl(origin, mode, "thin");
  const billingUrl = connectWebhookUrl(origin, mode, "billing");
  try {
    for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
      if (endpoint.url === snapshotUrl || endpoint.url === billingUrl) {
        await stripe.webhookEndpoints.del(endpoint.id);
      }
    }
    for await (const destination of stripe.v2.core.eventDestinations.list({ include: ["webhook_endpoint.url"] })) {
      if (destination.webhook_endpoint?.url === thinUrl) await stripe.v2.core.eventDestinations.del(destination.id);
    }

    const snapshot = await stripe.webhookEndpoints.create({
      url: snapshotUrl,
      connect: true,
      enabled_events: WEBHOOK_EVENTS,
      description: "Kaizen: payments in stores' accounts",
    });
    const billing = await stripe.webhookEndpoints.create({
      url: billingUrl,
      enabled_events: BILLING_EVENTS,
      description: "Kaizen: stores' plans",
    });
    const thin = await stripe.v2.core.eventDestinations.create({
      name: "Kaizen: stores' Stripe accounts",
      type: "webhook_endpoint",
      event_payload: "thin",
      events_from: ["other_accounts"],
      enabled_events: ACCOUNT_EVENTS,
      webhook_endpoint: { url: thinUrl },
      include: ["webhook_endpoint.signing_secret"],
    });
    const thinSecret = thin.webhook_endpoint?.signing_secret;
    if (!snapshot.secret || !billing.secret || !thinSecret) {
      return { ok: false, problem: "Stripe did not return a signing secret." };
    }
    return {
      ok: true,
      webhooks: [
        { kind: "snapshot", endpointId: snapshot.id, url: snapshotUrl, secret: snapshot.secret },
        { kind: "thin", endpointId: thin.id, url: thinUrl, secret: thinSecret },
        { kind: "billing", endpointId: billing.id, url: billingUrl, secret: billing.secret },
      ],
    };
  } catch (error) {
    return {
      ok: false,
      problem: error instanceof Stripe.errors.StripeError ? error.message : "Stripe could not be reached.",
    };
  }
}
