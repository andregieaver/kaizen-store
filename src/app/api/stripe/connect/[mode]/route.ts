import type Stripe from "stripe";

import { PAYMENT_MODES, type PaymentModeName } from "@/lib/stripe-account";
import { getPlatformWebhookSecret, storeForAccount } from "@/server/connect";
import { stripeFor } from "@/server/stripe";
import { handleStripeEvent } from "@/server/stripe-webhooks";

/**
 * Payment events from stores' own Stripe accounts (Stripe Connect), sent to
 * Kaizen's platform webhook. `event.account` says which store's account the
 * payment was taken on. Only events signed with the webhook's secret count.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/stripe/connect/[mode]">) {
  const { mode } = await params;
  if (!PAYMENT_MODES.includes(mode as PaymentModeName)) return new Response("Unknown mode", { status: 404 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const secret = await getPlatformWebhookSecret(mode as PaymentModeName, "snapshot");
  if (!secret) return new Response("Webhook not configured", { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripeFor("sk_unused_for_verification").webhooks.constructEvent(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const store = event.account ? await storeForAccount(mode as PaymentModeName, event.account) : null;
  if (!store) return Response.json({ received: true, ignored: "not a Kaizen store" });

  try {
    await handleStripeEvent(store.storeId, event);
  } catch {
    // Stripe retries on errors, with backoff, for up to three days.
    return new Response("Could not process the event", { status: 500 });
  }
  return Response.json({ received: true });
}
