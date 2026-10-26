import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { paymentFate, type PaymentAnswer, type PaymentPurpose, type ShopperAddress, type ShopperDetails } from "@/lib/payment-providers";

import { markCheckoutRecovered } from "./cart-reminders";
import { sendReferrerRewardEmail } from "./affiliate-emails";
import { cancelUnpaidOrder, completeOrderPayment } from "./checkout";
import { linkOrderToCustomer, openCheckoutAccount } from "./customers";
import { flagDeliveryMismatch } from "./delivery-options";
import { recordHostCommission } from "./host-payments";
import { completeEditPayment, markEditSessionEnded } from "./order-edits";
import { sendBookingStaffNotices, sendOrderConfirmation, sendWelcomeForOrder } from "./shopper-emails";
import { isDeliveryOrder } from "./standing-orders";

type Row = Record<string, unknown>;

/**
 * What only the provider that took the payment can do with it (wave 4 unit E, D292). Each is optional: a provider that cannot hold a card or wait for a
 * bank leaves them out, and an `unsettled` answer then waits for its next answer.
 */
export type AnswerHooks = {
  /** A card held to be captured later (D289): true when the order is now authorized. */
  hold?: () => Promise<boolean>;
  /** A bank payment on its way (D291): true when the order now waits for the bank (the first time). */
  awaitBank?: () => Promise<boolean>;
  /** After the order is completed and its payment captured: what the payment was, a subscription, a delivery's saved card. */
  afterPaid?: (order: { orderId: string; delivery: boolean }) => Promise<void>;
};

/**
 * Brings the order behind a payment up to date with the provider's answer (D292: the one function that decides an order's fate, whichever provider
 * answered). Used for webhooks and when the shopper returns before the webhook has arrived; applying the same answer twice does nothing more.
 */
export async function applyPaymentAnswer(storeId: string, answer: PaymentAnswer, hooks: AnswerHooks = {}): Promise<void> {
  const [payment] = await db().execute<Row>(sql`
    select p.order_id, p.order_edit_id, p.exchange_id,
      exists (select 1 from commerce.order_payment_terms t where t.store_id = p.store_id and t.order_id = p.order_id) as on_terms
    from commerce.payments p
    where p.store_id = ${storeId}::uuid and p.provider = ${answer.provider} and p.provider_reference = ${answer.reference}
  `);
  if (!payment) return; // Not a payment this store started.
  const orderId = String(payment.order_id);
  // An order on payment terms (D293) was confirmed without a payment: any payment made on it later is its balance.
  const purpose: PaymentPurpose = payment.order_edit_id ? "edit" : payment.exchange_id ? "exchange" : payment.on_terms ? "terms" : "order";

  // The difference of an order change (D174) on a paid order: the change is applied (or the money given back), the order is never completed again and never
  // cancelled, and its addresses are never taken from this payment. An exchange's difference (D239) the same, and the balance of an order on terms (D293).
  // A payment that lapses or fails marks only its row.
  if (purpose !== "order") {
    const fate = paymentFate(answer.state, purpose, { delivery: false, draft: false });
    if (fate.kind !== "settle_change") return;
    if (purpose === "terms") {
      const { endTermsSession, settleTerms } = await import("./payment-terms");
      if (fate.outcome !== "pay") await endTermsSession(storeId, answer.reference, fate.outcome);
      else if ((await settleTerms(storeId, answer.reference)) && hooks.afterPaid) await hooks.afterPaid({ orderId, delivery: false });
    } else if (purpose === "edit") {
      if (fate.outcome === "pay") await completeEditPayment(storeId, answer.reference);
      else await markEditSessionEnded(storeId, answer.reference, fate.outcome);
    } else {
      const { completeExchangePayment, markExchangeSessionEnded } = await import("./exchanges");
      if (fate.outcome === "pay") await completeExchangePayment(storeId, answer.reference);
      else await markExchangeSessionEnded(storeId, answer.reference, fate.outcome);
    }
    return;
  }

  // A weekly delivery paid by link (D102): its address and contact are the list's, and it stays when the link lapses.
  const delivery = await isDeliveryOrder(storeId, orderId);
  if (answer.shopper && !delivery) {
    await saveCustomer(storeId, orderId, answer.shopper);
    // The postal code a delivery was priced for is the shopper's typing; the address is the provider's (D237 2.7): a difference is flagged, never re-charged.
    await flagDeliveryMismatch(storeId, orderId);
  }

  const fate = paymentFate(answer.state, purpose, { delivery, draft: answer.state === "failed" || answer.state === "expired" ? await isDraftOrder(storeId, orderId) : false });

  if (fate.kind === "unsettled") {
    // A card held to be captured later (D289): the order is authorized, not paid; the shopper is told it is confirmed, nothing is a sale yet.
    if (hooks.hold && (await hooks.hold())) {
      await markCheckoutRecovered(storeId, orderId);
      const opened = await openCheckoutAccount(storeId, orderId);
      await linkOrderToCustomer(storeId, orderId);
      await sendOrderConfirmation(storeId, orderId);
      if (opened === "created") await sendWelcomeForOrder(storeId, orderId);
      return;
    }
    // A bank payment that arrives days later (D291): the order waits for the bank with its stock held; nothing is a sale yet, and the provider's next answer settles it.
    if (hooks.awaitBank && (await hooks.awaitBank())) {
      await markCheckoutRecovered(storeId, orderId);
      await linkOrderToCustomer(storeId, orderId);
    }
    return;
  }

  if (fate.kind === "paid") {
    await completeOrderPayment(orderId, answer.reference);
    await setPaymentStatus(storeId, answer, "captured");
    if (hooks.afterPaid) await hooks.afterPaid({ orderId, delivery });
    // A host's booking (D71): the store's commission is owed to it now.
    await recordHostCommission(storeId, orderId);
    // Paid: no reminders about this cart, or others with the same email (D33).
    await markCheckoutRecovered(storeId, orderId);
    // The account asked for at checkout opens now, with the paid email (D32).
    const opened = await openCheckoutAccount(storeId, orderId);
    // The order joins the customer's account, if they have one (D28).
    await linkOrderToCustomer(storeId, orderId);
    // Once per order, however many times the payment is applied (D26).
    await sendOrderConfirmation(storeId, orderId);
    // Staff with an email hear of their new appointments (D65), once each.
    await sendBookingStaffNotices(storeId, orderId);
    // The customer whose link led to this order hears of the credits it earned them (D131), once per order.
    await sendReferrerRewardEmail(storeId, orderId).catch(() => null);
    if (opened === "created") await sendWelcomeForOrder(storeId, orderId);
    return;
  }

  if (fate.kind === "ended") {
    // A staff-made order (D173) lives until its draft expires: a payment that lapses (Stripe's sessions last at most a day, the link a week or more) or a bank payment that
    // failed leaves the order and its held stock as they are, and the pay link makes a new payment on the next press. `expireDrafts()` cancels it at the draft's expiry.
    if (fate.cancel) await cancelUnpaidOrder(orderId, fate.status === "failed" ? "payment failed" : "checkout expired");
    await setPaymentStatus(storeId, answer, fate.status);
  }
}

/**
 * An order that lives until an expiry of its own: one made from a draft order (D173, `draft_id` set, `expireDrafts()`) or a company's order approved and
 * waiting for its buyer to pay (D321 C.2, `expireApprovals()`). A lapsed payment leaves it as it is.
 */
async function isDraftOrder(storeId: string, orderId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid and (draft_id is not null or approval = 'approved')
  `);
  return Boolean(row);
}

async function setPaymentStatus(storeId: string, answer: Pick<PaymentAnswer, "provider" | "reference">, status: string) {
  await db().execute(sql`
    update commerce.payments set status = ${status}, updated_at = now()
    where store_id = ${storeId}::uuid and provider = ${answer.provider} and provider_reference = ${answer.reference}
  `);
}

/** Copies who bought and where it goes from the provider's payment page onto the order. */
async function saveCustomer(storeId: string, orderId: string, shopper: ShopperDetails) {
  const address = (a: ShopperAddress | null | undefined, name: string | null | undefined) =>
    a ? { name: name ?? null, line1: a.line1, line2: a.line2, postalCode: a.postalCode, city: a.city, country: a.country } : {};
  const shipped = shopper.shipping ?? (shopper.billing ? { name: shopper.name, address: shopper.billing } : null);
  await db().execute(sql`
    update commerce.orders set
      email = coalesce(nullif(${shopper.email ?? ""}, ''), email),
      billing_address = ${JSON.stringify({ ...address(shopper.billing, shopper.name), phone: shopper.phone ?? null })}::jsonb,
      -- Collected at the store's place (D237): no address is shipped to, so none is kept as one.
      shipping_address = case when delivery_method = 'pickup' then '{}'::jsonb
        else ${JSON.stringify(address(shipped?.address, shipped?.name))}::jsonb end
    where store_id = ${storeId}::uuid and id = ${orderId}::uuid
      -- An order whose person was erased (D162) stays without them, even when its payment arrives afterwards: the payment still completes it.
      and anonymised_at is null
  `);
}
