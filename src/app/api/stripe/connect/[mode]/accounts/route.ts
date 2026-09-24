import { revalidateTag } from "next/cache";

import { PAYMENT_MODES, type PaymentModeName } from "@/lib/stripe-account";
import { getPlatformWebhookSecret, refreshStripeAccount, storeForAccount } from "@/server/connect";
import { platformStripe } from "@/server/stripe";
import { storeTag } from "@/server/stores";

/**
 * Account events (Accounts v2 "thin" events) for stores' Stripe accounts:
 * Stripe needs information, or the account can now take payments. The
 * event only names the account, so its state is read back from Stripe.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/stripe/connect/[mode]/accounts">) {
  const { mode } = await params;
  if (!PAYMENT_MODES.includes(mode as PaymentModeName)) return new Response("Unknown mode", { status: 404 });
  const stripe = platformStripe(mode as PaymentModeName);

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const secret = await getPlatformWebhookSecret(mode as PaymentModeName, "thin");
  if (!stripe || !secret) return new Response("Webhook not configured", { status: 400 });

  const body = await request.text();
  let notification: ReturnType<typeof stripe.parseEventNotification>;
  try {
    notification = stripe.parseEventNotification(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const accountId =
    "related_object" in notification && notification.related_object?.type === "v2.core.account"
      ? notification.related_object.id
      : null;
  const store = accountId ? await storeForAccount(mode as PaymentModeName, accountId) : null;
  if (!store) return Response.json({ received: true, ignored: "not a Kaizen store" });

  const account = await refreshStripeAccount(store.storeId, mode as PaymentModeName);
  if (!account) return new Response("Could not read the account", { status: 500 });
  // Whether the storefront can take payments may have changed.
  revalidateTag(storeTag(store.slug), { expire: 0 });
  return Response.json({ received: true });
}
