import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { marketPath, storeOrigin } from "@/lib/paths";
import {
  checkoutMethods,
  MOLLIE_IDS,
  minorOfAmount,
  mollieAmount,
  mollieAnswer,
  mollieFee,
  mollieLocale,
  mollieRefundStatus,
  type MollieAmount,
  type MolliePayment,
  type PayerDetails,
  webhookPaymentId,
} from "@/lib/mollie";
import { siteUrl } from "@/lib/site";
import { saleFee, type PaymentModeName } from "@/lib/stripe-account";

import { storeFeeBps } from "../billing";
import type { CheckoutShop, PlacedOrder } from "../checkout";
import { activeMollieMethods, mollieCall, MollieError, mollieProfile } from "../mollie";
import { applyPaymentAnswer } from "../payment-outcome";
import { writeDispute } from "../payment-disputes";
import { excludedPaymentMethods } from "../payment-methods";
import { applyRefundReport, RefundNotRecordedYet } from "../stripe-refunds";

import { PaymentProviderRefusal, type ClosedPayment, type PaymentProvider, type StoredPayment } from "./types";

type Row = Record<string, unknown>;

/**
 * Mollie behind the payment-provider adapter (wave 4 unit E2, D292, `docs/wave-4-payments.md` 7). A payment is made through Mollie's Payments API (never
 * the Orders API) on the store's own Mollie account with Kaizena Flow's fee as `applicationFee`, and the shopper pays on Mollie's hosted page: card data
 * never reaches Kaizena Flow. Mollie's webhook carries only a payment's id, so every answer is fetched from Mollie with the store's token
 * (`applyMolliePayment()`), and its refunds and chargebacks are read with it.
 */

const modeOf = (payment: Pick<StoredPayment, "mode">): PaymentModeName => payment.mode ?? "live";

export type MollieOpenResult = { ok: true; url: string; sessionId: string } | { ok: false; problem: "payment_error" | "payments_off" };

/**
 * Opens a Mollie payment for a cart's order that is already placed, records the payment waiting for it, and gives the address of Mollie's hosted page.
 * The order's return address names the payment (`?session_id=tr_…`) once Mollie has made it, as Stripe's does. It never cancels the order: the caller
 * decides. Who pays was asked by Kaizena Flow before (`payer`) and is on the order.
 */
export async function openMolliePayment(
  shop: CheckoutShop,
  order: PlacedOrder,
  origin: string,
  mode: PaymentModeName,
  payer: PayerDetails,
  /** A balance paid later (D387: an order on terms) opens one payment per press and returns to the order, not the cart. */
  options: { idempotencyKey?: string; cancelPath?: string } = {},
): Promise<MollieOpenResult> {
  const profileId = await mollieProfile(shop.storeId);
  if (!profileId) return { ok: false, problem: "payments_off" };
  const amount = mollieAmount(order.dueNowMinor, order.currency);
  const locale = mollieLocale(shop.market.locale);
  // Kaizena Flow's fee, within what a Mollie payment can carry; its cap is said on the order.
  // Duties collected at checkout (DDP, D343) are part of the amount but carry no fee: they are passed on to customs.
  const fee = mollieFee(order.dueNowMinor, saleFee(order.dueNowMinor - (order.dutiesMinor ?? 0), await storeFeeBps(shop.storeId)));
  // What Mollie has on for this amount, less what this unit leaves out and what the owner switched off for the order's own country (D291).
  const active = await activeMollieMethods(shop.storeId, mode, amount, locale);
  const methods = checkoutMethods(active?.map((m) => m.id) ?? null, await excludedPaymentMethods(shop.storeId, shop.market.code, order.orderId));
  if (methods !== null && methods.length === 0) return { ok: false, problem: "payments_off" };
  const base = `${storeOrigin(shop.storeSlug) ?? origin}${marketPath(shop.storeSlug, shop.market.slug)}`;
  const site = siteUrl();
  let payment: MolliePayment;
  try {
    payment = await mollieCall<MolliePayment>(shop.storeId, mode, "POST", "/payments", {
      body: {
        amount,
        description: `Order ${order.number}`.slice(0, 255),
        redirectUrl: `${base}/order/${order.orderId}`,
        cancelUrl: `${base}${options.cancelPath ?? "/cart"}`,
        // Mollie only calls an address it can reach: a site on a local address reads the payment when the shopper returns.
        ...(site.startsWith("https://") ? { webhookUrl: `${site}/api/mollie/${mode}` } : {}),
        metadata: { order_id: order.orderId, order_number: order.number, store_id: shop.storeId },
        locale,
        billingAddress: { email: payer.email },
        ...(methods ? { method: methods } : {}),
        profileId,
        ...(fee ? { applicationFee: { amount: mollieAmount(fee.feeMinor, order.currency), description: `Kaizena Flow ${order.number}`.slice(0, 255) } } : {}),
      },
      idempotencyKey: options.idempotencyKey ?? `checkout-${order.orderId}`,
    });
  } catch {
    return { ok: false, problem: "payment_error" };
  }
  const checkout = payment._links?.checkout?.href;
  if (!MOLLIE_IDS.payment.test(payment.id) || !checkout) return { ok: false, problem: "payment_error" };
  // The return address names the payment, as the order page's key (Mollie gives its id only once it is made).
  try {
    await mollieCall(shop.storeId, mode, "PATCH", `/payments/${payment.id}`, { body: { redirectUrl: `${base}/order/${order.orderId}?session_id=${payment.id}` } });
  } catch {
    await mollieCall(shop.storeId, mode, "DELETE", `/payments/${payment.id}`).catch(() => null);
    return { ok: false, problem: "payment_error" };
  }
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${shop.storeId}::uuid, ${order.orderId}::uuid, 'payment.started',
            ${JSON.stringify({ ui: "hosted", provider: "mollie", methods: methods ?? [], ...(fee?.capped ? { feeCapped: fee.feeMinor } : {}) })}::jsonb, 'system')
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status, kaizen_fee_minor, test_mode)
    values (${shop.storeId}::uuid, ${order.orderId}::uuid, 'mollie', ${payment.id}, ${profileId}, ${order.dueNowMinor}, ${order.currency}, 'pending',
            ${fee?.feeMinor ?? 0}, ${mode === "test"})
    on conflict (store_id, provider, provider_reference) do nothing
  `);
  return { ok: true, url: checkout, sessionId: payment.id };
}

/** The store's payment Kaizena Flow keeps for a Mollie payment id, with its mode (kept on the row). */
export async function storedMolliePayment(storeId: string, reference: string): Promise<StoredPayment & { currency: string } | null> {
  const [row] = await db().execute<Row>(sql`
    select id, order_id, provider_account, test_mode, currency from commerce.payments
    where store_id = ${storeId}::uuid and provider = 'mollie' and provider_reference = ${reference}
  `);
  return row
    ? {
        id: String(row.id),
        orderId: String(row.order_id),
        provider: "mollie",
        reference,
        account: row.provider_account ? String(row.provider_account) : null,
        mode: row.test_mode ? "test" : "live",
        currency: String(row.currency).trim(),
      }
    : null;
}

/**
 * Brings the order behind a Mollie payment up to date with it, and its refunds and chargebacks with Mollie's: the webhook's work and the late read's. The
 * payment is always fetched from Mollie, never taken from a request's body.
 */
export async function applyMolliePayment(storeId: string, stored: StoredPayment & { currency: string }, payment?: MolliePayment): Promise<MolliePayment> {
  const mode = modeOf(stored);
  const current = payment ?? (await mollieCall<MolliePayment>(storeId, mode, "GET", `/payments/${stored.reference}`));
  await applyPaymentAnswer(storeId, mollieAnswer(current));
  if ((minorOfAmount(current.amountRefunded) ?? 0) > 0) await applyMollieRefunds(storeId, stored, mode);
  if ((minorOfAmount(current.amountChargedBack) ?? 0) > 0) await applyMollieChargebacks(storeId, stored, mode);
  return current;
}

type MollieRefund = { id: string; status: string; amount: MollieAmount; createdAt?: string; metadata?: { order_id?: string } | null };

/** Each refund Mollie has for the payment, recorded or brought up to date as Stripe's are (`applyRefundReport()`). A refund of Kaizena Flow's own waits for its row. */
async function applyMollieRefunds(storeId: string, stored: StoredPayment & { currency: string }, mode: PaymentModeName): Promise<void> {
  const listed = await mollieCall<{ _embedded?: { refunds?: MollieRefund[] } }>(storeId, mode, "GET", `/payments/${stored.reference}/refunds`, { query: { limit: "250" } });
  for (const refund of listed._embedded?.refunds ?? []) {
    if (!MOLLIE_IDS.refund.test(refund.id)) continue;
    const amountMinor = minorOfAmount(refund.amount);
    if (amountMinor === null || amountMinor <= 0) continue;
    try {
      await applyRefundReport(storeId, {
        provider: "mollie",
        reference: refund.id,
        status: mollieRefundStatus(refund.status),
        amountMinor,
        currency: refund.amount.currency,
        own: Boolean(refund.metadata?.order_id),
        createdAt: refund.createdAt ? Math.floor(Date.parse(refund.createdAt) / 1000) : Math.floor(Date.now() / 1000),
        payment: async () => ({ id: stored.id, orderId: stored.orderId, currency: stored.currency }),
        stillFailed: async () => mollieRefundStatus(refund.status) === "failed",
      });
    } catch (error) {
      // Kaizena Flow's own refund whose row is a moment away: the next webhook or read records it.
      if (!(error instanceof RefundNotRecordedYet)) throw error;
    }
  }
}

type MollieChargeback = { id: string; amount: MollieAmount; reason?: { code?: string; description?: string } | null; createdAt: string; reversedAt?: string | null };

/**
 * Each chargeback Mollie has for the payment, kept as a dispute (D288). Mollie takes a chargeback's money at once and the merchant contests it in Mollie's
 * Dashboard, so it is kept closed: lost, or won when Mollie reports it reversed before Kaizena Flow first saw it. A reversal after that is said on the order.
 */
async function applyMollieChargebacks(storeId: string, stored: StoredPayment & { currency: string }, mode: PaymentModeName): Promise<void> {
  const listed = await mollieCall<{ _embedded?: { chargebacks?: MollieChargeback[] } }>(storeId, mode, "GET", `/payments/${stored.reference}/chargebacks`, { query: { limit: "250" } });
  for (const chargeback of listed._embedded?.chargebacks ?? []) {
    if (!MOLLIE_IDS.chargeback.test(chargeback.id)) continue;
    const amountMinor = minorOfAmount(chargeback.amount);
    if (amountMinor === null || amountMinor <= 0) continue;
    const reversed = Boolean(chargeback.reversedAt);
    const applied = await writeDispute(storeId, "mollie", { id: stored.id, orderId: stored.orderId, currency: stored.currency }, {
      reference: chargeback.id,
      chargeReference: "",
      amountMinor,
      currency: chargeback.amount.currency.toUpperCase(),
      reason: chargeback.reason?.code?.slice(0, 80) ?? null,
      status: reversed ? "won" : "lost",
      evidenceDueBy: null,
      outcome: reversed ? "won" : "lost",
      fundsWithdrawnMinor: reversed ? 0 : amountMinor,
      feeMinor: null,
      testMode: mode === "test",
      openedAt: new Date(chargeback.createdAt),
    });
    if (reversed && applied.outcome === "updated") {
      const [said] = await db().execute<Row>(sql`
        select 1 from commerce.order_events where store_id = ${storeId}::uuid and order_id = ${stored.orderId}::uuid and type = 'dispute.reversed' and data->>'dispute' = ${applied.disputeId}
      `);
      if (!said) {
        await db().execute(sql`
          insert into commerce.order_events (store_id, order_id, type, data, actor)
          values (${storeId}::uuid, ${stored.orderId}::uuid, 'dispute.reversed', ${JSON.stringify({ dispute: applied.disputeId, amount: amountMinor })}::jsonb, 'mollie')
        `);
      }
    }
  }
}

export const mollieProvider: PaymentProvider = {
  id: "mollie",
  name: "Mollie",

  async refresh(storeId, payment) {
    const stored = await storedMolliePayment(storeId, payment.reference);
    if (!stored) return false;
    try {
      await applyMolliePayment(storeId, stored);
      return true;
    } catch {
      // Mollie is unreachable or slow: the webhook will follow.
      return false;
    }
  },

  async close(storeId, payment): Promise<ClosedPayment> {
    const stored = await storedMolliePayment(storeId, payment.reference);
    if (!stored) return "closed";
    const mode = modeOf(stored);
    let current: MolliePayment;
    try {
      current = await mollieCall<MolliePayment>(storeId, mode, "GET", `/payments/${stored.reference}`);
    } catch (error) {
      return error instanceof MollieError && error.status === 404 ? "closed" : "unknown";
    }
    if (current.status === "paid") {
      await applyMolliePayment(storeId, stored, current);
      return "paid";
    }
    if (current.status === "open" && current.isCancelable) {
      try {
        await mollieCall(storeId, mode, "DELETE", `/payments/${stored.reference}`);
        return "closed";
      } catch {
        return "unknown";
      }
    }
    // A card payment already under way cannot be cancelled: it ends by itself in minutes, and the caller waits for it.
    if (current.status === "open" || current.status === "pending" || current.status === "authorized") return "processing";
    return "closed";
  },

  async refund(storeId, payment, request) {
    const stored = await storedMolliePayment(storeId, payment.reference);
    if (!stored) throw new PaymentProviderRefusal("Mollie has no payment to refund for this order.");
    try {
      const refund = await mollieCall<MollieRefund>(storeId, modeOf(stored), "POST", `/payments/${stored.reference}/refunds`, {
        body: {
          amount: mollieAmount(request.amountMinor, stored.currency),
          description: `Order ${request.orderNumber}`.slice(0, 140),
          metadata: { order_id: request.orderId, order_number: request.orderNumber },
        },
        idempotencyKey: request.idempotencyKey,
      });
      return { reference: refund.id, status: mollieRefundStatus(refund.status) };
    } catch (error) {
      throw new PaymentProviderRefusal(error instanceof MollieError ? error.message : "Mollie could not make the refund.");
    }
  },
};

/**
 * Mollie's webhook (D292): the body names a payment and nothing else, so nothing in it is trusted. The payment is looked up among the stores' Mollie
 * payments in the mode the address names, fetched from Mollie with that store's token, and applied; the event is recorded once per state Mollie reports.
 * `unknown`: no store has it (Mollie is answered 200, so it stops). Throws when Mollie or the database fails, so Mollie calls again.
 */
export async function handleMollieWebhook(mode: PaymentModeName, body: string): Promise<"applied" | "unknown"> {
  const id = webhookPaymentId(body);
  if (!id) return "unknown";
  const [row] = await db().execute<Row>(sql`
    select store_id from commerce.payments where provider = 'mollie' and provider_reference = ${id} and test_mode = ${mode === "test"} limit 1
  `);
  if (!row) return "unknown";
  const storeId = String(row.store_id);
  const stored = await storedMolliePayment(storeId, id);
  if (!stored) return "unknown";
  const payment = await mollieCall<MolliePayment>(storeId, mode, "GET", `/payments/${id}`);
  const eventId = [id, payment.status, payment.amountRefunded?.value ?? "0", payment.amountChargedBack?.value ?? "0"].join(":");
  await db().execute(sql`
    insert into commerce.webhook_events (store_id, provider, event_id, type, payload)
    values (${storeId}::uuid, 'mollie', ${eventId}, ${`payment.${payment.status}`}, ${JSON.stringify({ id, status: payment.status })}::jsonb)
    on conflict (store_id, provider, event_id) do update set attempts = commerce.webhook_events.attempts + 1
  `);
  try {
    await applyMolliePayment(storeId, stored, payment);
  } catch (error) {
    await db().execute(sql`
      update commerce.webhook_events set last_error = ${error instanceof Error ? error.message.slice(0, 500) : "failed"}
      where store_id = ${storeId}::uuid and provider = 'mollie' and event_id = ${eventId}
    `);
    throw error;
  }
  await db().execute(sql`
    update commerce.webhook_events set processed_at = now(), last_error = null where store_id = ${storeId}::uuid and provider = 'mollie' and event_id = ${eventId}
  `);
  return "applied";
}
