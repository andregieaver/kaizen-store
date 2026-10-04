import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";

import { cancelUnpaidOrder, completeOrderPayment } from "./checkout";
import { adoptDeliveryCard, isDeliveryOrder } from "./standing-orders";
import { markCheckoutRecovered } from "./cart-reminders";
import { sendReferrerRewardEmail } from "./affiliate-emails";
import { linkOrderToCustomer, openCheckoutAccount } from "./customers";
import { recordHostCommission } from "./host-payments";
import { sendBookingStaffNotices, sendOrderConfirmation, sendWelcomeForOrder } from "./shopper-emails";
import { applyStripeRefund, isRefundEvent, stripeForAccount } from "./stripe-refunds";
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
    isRefundEvent(event.type);
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
 * Brings the order behind a Checkout session up to date with it. Used for
 * webhooks and when the shopper returns before the webhook has arrived.
 */
export async function applySession(
  storeId: string,
  session: Stripe.Checkout.Session,
  eventType?: string,
): Promise<void> {
  const [payment] = await db().execute<Row>(sql`
    select order_id from commerce.payments
    where store_id = ${storeId}::uuid and provider = 'stripe' and provider_reference = ${session.id}
  `);
  if (!payment) return; // Not a session this store created.
  const orderId = String(payment.order_id);
  // A weekly delivery paid by link (D102): its address and contact are the list's, and it stays when the link lapses.
  const delivery = await isDeliveryOrder(storeId, orderId);

  if (session.status === "complete" && !delivery) await saveCustomer(storeId, orderId, session);

  const failed = eventType === "checkout.session.async_payment_failed";
  const expired = session.status === "expired" || eventType === "checkout.session.expired";

  if (session.status === "complete" && session.payment_status !== "unpaid" && !failed) {
    await completeOrderPayment(orderId, session.id);
    await setPaymentStatus(storeId, session.id, "captured");
    if (session.mode === "subscription") await activateSubscription(storeId, orderId, session);
    if (delivery) await adoptDeliveryCard(storeId, orderId, session);
    // A host's booking (D71): the store's commission is owed to it now.
    await recordHostCommission(storeId, orderId);
    // Paid: no reminders about this cart, or others with the same email (D33).
    await markCheckoutRecovered(storeId, orderId);
    // The account asked for at checkout opens now, with the paid email (D32).
    const opened = await openCheckoutAccount(storeId, orderId);
    // The order joins the customer's account, if they have one (D28).
    await linkOrderToCustomer(storeId, orderId);
    // Once per order, however many times the session is applied (D26).
    await sendOrderConfirmation(storeId, orderId);
    // Staff with an email hear of their new appointments (D65), once each.
    await sendBookingStaffNotices(storeId, orderId);
    // The customer whose link led to this order hears of the credits it earned them (D131), once per order.
    await sendReferrerRewardEmail(storeId, orderId).catch(() => null);
    if (opened === "created") await sendWelcomeForOrder(storeId, orderId);
  } else if (failed || expired) {
    if (!delivery) await cancelUnpaidOrder(orderId, failed ? "payment failed" : "checkout expired");
    await setPaymentStatus(storeId, session.id, failed ? "failed" : "cancelled");
  }
}

async function setPaymentStatus(storeId: string, sessionId: string, status: string) {
  await db().execute(sql`
    update commerce.payments set status = ${status}, updated_at = now()
    where store_id = ${storeId}::uuid and provider = 'stripe' and provider_reference = ${sessionId}
  `);
}

/** Copies who bought and where it goes from the session onto the order. */
async function saveCustomer(storeId: string, orderId: string, session: Stripe.Checkout.Session) {
  const details = session.customer_details;
  const shipping = session.collected_information?.shipping_details;
  const address = (a: Stripe.Address | null | undefined, name: string | null | undefined) =>
    a
      ? {
          name: name ?? null,
          line1: a.line1,
          line2: a.line2,
          postalCode: a.postal_code,
          city: a.city,
          country: a.country,
        }
      : {};
  await db().execute(sql`
    update commerce.orders set
      email = coalesce(nullif(${details?.email ?? ""}, ''), email),
      billing_address = ${JSON.stringify({ ...address(details?.address, details?.name), phone: details?.phone ?? null })}::jsonb,
      shipping_address = ${JSON.stringify(address(shipping?.address ?? details?.address, shipping?.name ?? details?.name))}::jsonb
    where store_id = ${storeId}::uuid and id = ${orderId}::uuid
  `);
}
