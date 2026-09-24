import type Stripe from "stripe";
import { z } from "zod";

import { getWebhookSecrets } from "@/server/settings";
import { stripeFor } from "@/server/stripe";
import { handleStripeEvent } from "@/server/stripe-webhooks";

/**
 * Stripe calls this for each store's payments. The event is only trusted if
 * its signature matches one of the store's own webhook secrets (test or
 * live); anything else is refused.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/stripe/webhook/[storeId]">) {
  const { storeId } = await params;
  if (!z.uuid().safeParse(storeId).success) return new Response("Unknown store", { status: 404 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const body = await request.text();

  const secrets = await getWebhookSecrets(storeId);
  let event: Stripe.Event | null = null;
  const verifier = stripeFor("sk_unused_for_verification");
  for (const secret of secrets) {
    try {
      event = verifier.webhooks.constructEvent(body, signature, secret);
      break;
    } catch {
      // Try the store's other secret (test or live).
    }
  }
  if (!event) return new Response("Invalid signature", { status: 400 });

  try {
    await handleStripeEvent(storeId, event);
  } catch {
    // Stripe retries on errors, with backoff, for up to three days.
    return new Response("Could not process the event", { status: 500 });
  }
  return Response.json({ received: true });
}
