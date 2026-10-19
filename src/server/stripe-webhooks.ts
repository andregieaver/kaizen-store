import "server-only";

import { sql } from "drizzle-orm";
import { after } from "next/server";
import type Stripe from "stripe";

import { db } from "@/db/client";

import type { PaymentAnswer, PaymentState, ShopperAddress, ShopperDetails } from "@/lib/payment-providers";

import { applyPaymentAnswer } from "./payment-outcome";
import { adoptDeliveryCard } from "./standing-orders";
import { sendOrderConfirmation } from "./shopper-emails";
import { applyIntentCanceled, authorizeFromSession } from "./payment-capture";
import { applyStripeDispute, isDisputeEvent } from "./payment-disputes";
import { applyPayout } from "./payouts";
import { awaitBankPayment } from "./payment-methods";
import { isPayoutEvent } from "@/lib/payouts";
import { readPaymentFacts } from "./payment-facts";
import { applyStripeRefund, isRefundEvent, paymentOfIntent, stripeForAccount } from "./stripe-refunds";
import { activateSubscription, renewSubscription, syncSubscription } from "./subscriptions";

type Row = Record<string, unknown>;

/**
 * Records a Stripe event for a store, once. Returns false for an event that
 * was already processed (Stripe retries and may send duplicates).
 */
async function recordEvent(storeId: string, event: Stripe.Event): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.webhook_events (store_id, provider, event_id, type, payload)
    values (${storeId}::uuid, 'stripe', ${event.id}, ${event.type}, ${JSON.stringify(event)}::jsonb)
    on conflict (store_id, provider, event_id) do update set attempts = commerce.webhook_events.attempts + 1
    returning processed_at
  `);
  return row.processed_at === null;
}

async function markProcessed(storeId: string, eventId: string, error?: string) {
  await db().execute(sql`
    update commerce.webhook_events
       set processed_at = ${error ? null : sql`now()`}, last_error = ${error ?? null}
     where store_id = ${storeId}::uuid and provider = 'stripe' and event_id = ${eventId}
  `);
}

/** Applies a verified Stripe event to the store's orders and subscriptions. */
export async function handleStripeEvent(storeId: string, event: Stripe.Event): Promise<void> {
  const handled =
    event.type.startsWith("checkout.session.") ||
    event.type === "invoice.paid" ||
    event.type.startsWith("customer.subscription.") ||
    // Refunds (D159): a pending one completing, one made in Stripe's Dashboard.
    isRefundEvent(event.type) ||
    // Disputes (D288).
    isDisputeEvent(event.type) ||
    // A held card's hold ended (D289): its order is cancelled and its stock released.
    event.type === "payment_intent.canceled" ||
    // The store's payouts (D290).
    isPayoutEvent(event.type);
  if (!handled) return;
  if (!(await recordEvent(storeId, event))) return;
  try {
    if (event.type === "invoice.paid") {
      const orderId = await renewSubscription(storeId, event.data.object as Stripe.Invoice);
      if (orderId) await sendOrderConfirmation(storeId, orderId);
    } else if (event.type.startsWith("customer.subscription.")) {
      await syncSubscription(storeId, event.data.object as Stripe.Subscription);
    } else if (isRefundEvent(event.type)) {
      const refund = event.data.object as Stripe.Refund;
      // The credit note is the database's (a trigger at commit); this brings the refund row up to date, or records the refund.
      await applyStripeRefund(storeId, refund, { account: event.account ?? null, stripe: await stripeForAccount(storeId, event.account) });
    } else if (event.type === "payment_intent.canceled") {
      const stripe = await stripeForAccount(storeId, event.account);
      await applyIntentCanceled(storeId, event.data.object as Stripe.PaymentIntent, (intent) => paymentOfIntent(storeId, intent, { stripe, account: event.account ?? null }));
    } else if (isPayoutEvent(event.type)) {
      await applyPayout(storeId, event.data.object as Stripe.Payout, event.account);
    } else if (isDisputeEvent(event.type)) {
      await applyStripeDispute(storeId, event.data.object as Stripe.Dispute, { account: event.account ?? null, stripe: await stripeForAccount(storeId, event.account) });
    } else {
      await applySession(storeId, event.data.object as Stripe.Checkout.Session, event.type);
    }
    await markProcessed(storeId, event.id);
  } catch (error) {
    await markProcessed(storeId, event.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Brings the order behind a Checkout session up to date with it. Used for webhooks and when the shopper returns before the webhook has arrived. Stripe's
 * session is turned into a provider's answer (`stripeAnswer()`); what becomes of the order is decided by `applyPaymentAnswer()` for every provider (D292).
 */
export async function applySession(
  storeId: string,
  session: Stripe.Checkout.Session,
  eventType?: string,
): Promise<void> {
  await applyPaymentAnswer(storeId, stripeAnswer(session, eventType), {
    hold: async () => (await authorizeFromSession(storeId, session)) === "authorized",
    awaitBank: () => awaitBankPayment(storeId, session.id),
    afterPaid: async ({ orderId, delivery }) => {
      // What the payment was (D288): its method, wallet and Stripe's risk outcome, read once after the reply; the five-minute job reads any it missed.
      try {
        after(() => readPaymentFacts(storeId, session.id));
      } catch {
        // Not in a request (scripts, tests): the five-minute job reads it.
      }
      if (session.mode === "subscription") await activateSubscription(storeId, orderId, session);
      if (delivery) await adoptDeliveryCard(storeId, orderId, session);
    },
  });
}

/**
 * A Checkout session as a provider's answer (D292): failed when Stripe says the bank payment failed, expired when the session is, paid once the money is in,
 * unsettled when the shopper finished but the money is not in yet (a held card, D289, or a bank payment on its way, D291), and who paid once it is complete.
 */
export function stripeAnswer(session: Stripe.Checkout.Session, eventType?: string): PaymentAnswer {
  const complete = session.status === "complete";
  const state: PaymentState =
    eventType === "checkout.session.async_payment_failed"
      ? "failed"
      : session.status === "expired" || eventType === "checkout.session.expired"
        ? "expired"
        : complete
          ? session.payment_status === "unpaid"
            ? "unsettled"
            : "paid"
          : "open";
  return { provider: "stripe", reference: session.id, state, shopper: complete ? stripeShopper(session) : null };
}

function stripeShopper(session: Stripe.Checkout.Session): ShopperDetails {
  const details = session.customer_details;
  const shipping = session.collected_information?.shipping_details;
  const address = (a: Stripe.Address | null | undefined): ShopperAddress | null =>
    a ? { line1: a.line1, line2: a.line2, postalCode: a.postal_code, city: a.city, country: a.country } : null;
  const billing = address(details?.address);
  const shipped = address(shipping?.address);
  return {
    email: details?.email ?? null,
    name: details?.name ?? null,
    phone: details?.phone ?? null,
    billing,
    shipping: shipped ? { name: shipping?.name ?? details?.name ?? null, address: shipped } : null,
  };
}
