import { after } from "next/server";
import type Stripe from "stripe";

import { PAYMENT_MODES, type PaymentModeName } from "@/lib/stripe-account";
import { applySubscription } from "@/server/billing";
import { getPlatformWebhookSecret } from "@/server/connect";
import { handleReferralEvent } from "@/server/referral-billing";
import { stripeFor } from "@/server/stripe";
import { applyDomainInvoiceEvent, registerPaidDomains } from "@/server/domain-purchases";
import { applyThemeInvoiceEvent } from "@/server/theme-prices";
import { applyPlatformSaleEvent } from "@/server/platform-sales";
import { log } from "@/server/log";

/** A payment provider's event is answered within a minute, or the function stops and the provider sends it again (code review 1.5, FD9). */
export const maxDuration = 60;

/**
 * Events about Kaizen's own subscriptions to stores (Stripe Billing on
 * Kaizen's account): started, renewed, overdue, cancelled; and about their
 * invoices and credit notes, for the referral program (D131): commission when
 * a referred store pays, credit on a referrer's draft invoice, both undone by
 * voiding and credit notes; and for premium themes (D286): a theme's invoice
 * paid or voided; and every paid invoice kept as what Kaizena Flow sold (D507). Only events signed with the billing webhook's secret count.
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
  if (event.type.startsWith("invoice.") || event.type.startsWith("credit_note.")) {
    try {
      const theme = await applyThemeInvoiceEvent(mode as PaymentModeName, event);
      // A domain's invoice paid (D315): the registration starts at once, after the answer.
      const domain = await applyDomainInvoiceEvent(event);
      if (domain.detail === "domain paid") after(() => registerPaidDomains().then(() => undefined));
      const result = await handleReferralEvent(mode as PaymentModeName, event);
      // What Kaizena Flow sold (D507): a paid invoice kept as a sale, a credit note's amount on it.
      const sale = await applyPlatformSaleEvent(mode as PaymentModeName, event);
      return Response.json({ received: true, ...(result.handled || theme.handled || domain.handled || sale ? {} : { ignored: event.type }) });
    } catch (error) {
      log("error", "stripe.platform_webhook_failed", { mode, eventId: event.id, type: event.type }, error);
      // Stripe retries on errors, with backoff, for up to three days; every step is safe to repeat.
      return new Response("Could not process the event", { status: 500 });
    }
  }
  if (!event.type.startsWith("customer.subscription.")) return Response.json({ received: true });

  try {
    const known = await applySubscription(event.data.object as Stripe.Subscription, mode as PaymentModeName);
    return Response.json({ received: true, ...(known ? {} : { ignored: "not a Kaizena Flow store" }) });
  } catch (error) {
    log("error", "stripe.platform_webhook_failed", { mode, eventId: event.id, type: event.type }, error);
    // Stripe retries on errors, with backoff, for up to three days.
    return new Response("Could not process the event", { status: 500 });
  }
}
