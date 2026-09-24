import type Stripe from "stripe";

import { PAYMENT_MODES, type PaymentModeName } from "@/lib/stripe-account";
import { applySubscription } from "@/server/billing";
import { getPlatformWebhookSecret } from "@/server/connect";
import { stripeFor } from "@/server/stripe";

/**
 * Events about Kaizen's own subscriptions to stores (Stripe Billing on
 * Kaizen's account): started, renewed, overdue, cancelled. Only events
 * signed with the billing webhook's secret count.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/stripe/billing/[mode]">) {
  const { mode } = await params;
  if (!PAYMENT_MODES.includes(mode as PaymentModeName)) return new Response("Unknown mode", { status: 404 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const secret = await getPlatformWebhookSecret(mode as PaymentModeName, "billing");
  if (!secret) return new Response("Webhook not configured", { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripeFor("sk_unused_for_verification").webhooks.constructEvent(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  if (!event.type.startsWith("customer.subscription.")) return Response.json({ received: true });

  try {
    const known = await applySubscription(event.data.object as Stripe.Subscription, mode as PaymentModeName);
    return Response.json({ received: true, ...(known ? {} : { ignored: "not a Kaizen store" }) });
  } catch {
    // Stripe retries on errors, with backoff, for up to three days.
    return new Response("Could not process the event", { status: 500 });
  }
}
