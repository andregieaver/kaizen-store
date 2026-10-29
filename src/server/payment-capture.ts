import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import {
  captureAmountProblem,
  captureDeadline,
  captureModeFor,
  CAPTURE_WARNING_HOURS,
  isCaptureSetting,
  type CaptureMode,
  type CaptureProblem,
} from "@/lib/capture";
import type { PaymentModeName } from "@/lib/stripe-account";

import { audit } from "./auth";
import { cancelUnpaidOrder, type PlacedOrder } from "./checkout";
import { log } from "./log";
import { readPaymentFacts } from "./payment-facts";
import { uuidList } from "./sql-arrays";
import { platformStripe } from "./stripe";
import { modeOfAccount } from "./stripe-refunds";

type Row = Record<string, unknown>;

/**
 * Authorise now, capture later (wave 4 unit B, D289, `docs/wave-4-payments.md` 4). A store that takes the money when an order is sent or when staff
 * capture it (`order_settings.capture`) has its checkout sessions made with `capture_method: manual` for the orders that may wait (`captureModeFor()`):
 * the order keeps its own `capture_mode`, so a later change of the setting never changes it. A completed session whose PaymentIntent waits for its capture
 * makes the order `authorized` (`authorize_order_payment()`: stock held to the deadline, nothing a sale); `capturePayment()` charges it (the whole, or
 * less: the rest is a `release` refund with its credit note) and `complete_order_payment()` then makes it paid as at checkout; `voidAuthorization()`,
 * Stripe's `payment_intent.canceled` and the job past the deadline cancel it and release its stock. Stripe is called before the database is written,
 * and the database writes are the same functions every payment uses. Never charges a card that was not held, never more than it holds.
 */

export type CaptureDeps = {
  /** The Stripe client for a mode (tests); the platform's by default. */
  stripeFor?: (mode: PaymentModeName) => Stripe | null;
  now?: () => Date;
};

/** The store's setting, read per request. */
export async function captureSettingOf(storeId: string): Promise<"at_checkout" | "when_sent" | "by_hand"> {
  const [row] = await db().execute<Row>(sql`select capture from commerce.order_settings where store_id = ${storeId}::uuid`);
  return isCaptureSetting(row?.capture) ? row.capture : "at_checkout";
}

/**
 * The capture a placed order is checked out under, kept on the order (`capture_mode`) when it waits; null when it is captured at checkout. Only
 * `startCheckout()` asks: drafts, pay links, order changes, exchanges and weekly boxes are never held.
 */
export async function prepareCapture(storeId: string, order: Pick<PlacedOrder, "orderId" | "subscription" | "balanceMinor" | "hostId" | "ships" | "lines">): Promise<CaptureMode | null> {
  const setting = await captureSettingOf(storeId);
  if (setting === "at_checkout") return null;
  const [facts] = await db().execute<Row>(sql`
    select
      exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'digital') as digital,
      exists (select 1 from commerce.bookings b where b.store_id = o.store_id and b.order_id = o.id) as booking
    from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${order.orderId}::uuid
  `);
  const { mode } = captureModeFor(setting, {
    subscription: order.subscription !== null,
    booking: Boolean(facts?.booking),
    partial: order.balanceMinor > 0 || order.lines.some((l) => l.deposit),
    host: order.hostId !== null,
    digital: Boolean(facts?.digital),
    ships: order.ships,
  });
  if (mode) {
    await db().execute(sql`update commerce.orders set capture_mode = ${mode} where store_id = ${storeId}::uuid and id = ${order.orderId}::uuid and status = 'pending_payment'`);
  }
  return mode;
}

type HeldPayment = { orderId: string; paymentId: string; reference: string; account: string; mode: PaymentModeName; amountMinor: number; feeMinor: number; currency: string };

async function heldPayment(storeId: string, orderId: string): Promise<HeldPayment | null> {
  const [p] = await db().execute<Row>(sql`
    select p.id, p.provider_reference, p.provider_account, p.amount_minor, p.kaizen_fee_minor, p.currency
      from commerce.payments p
     where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.provider = 'stripe' and p.status = 'authorized'
     order by p.created_at desc limit 1
  `);
  if (!p?.provider_account) return null;
  const mode = await modeOfAccount(storeId, String(p.provider_account));
  if (!mode) return null;
  return {
    orderId,
    paymentId: String(p.id),
    reference: String(p.provider_reference),
    account: String(p.provider_account),
    mode,
    amountMinor: Number(p.amount_minor),
    feeMinor: Number(p.kaizen_fee_minor ?? 0),
    currency: String(p.currency).trim(),
  };
}

/** The PaymentIntent behind a session reference, with its latest charge. */
async function intentOfReference(stripe: Stripe, reference: string, account: string): Promise<Stripe.PaymentIntent | null> {
  const options = { stripeAccount: account };
  if (reference.startsWith("pi_")) return stripe.paymentIntents.retrieve(reference, { expand: ["latest_charge"] }, options);
  const session = await stripe.checkout.sessions.retrieve(reference, { expand: ["payment_intent.latest_charge"] }, options);
  const pi = session.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] }, options) : pi;
}

/** Stripe's `capture_before` of a held card, when its charge says it. */
function captureBeforeOf(pi: Stripe.PaymentIntent): number | null {
  const charge = pi.latest_charge;
  if (!charge || typeof charge === "string") return null;
  return charge.payment_method_details?.card?.capture_before ?? null;
}

/** What the order page shows of a held card: null unless the order is `authorized`. Stored rows only, no Stripe call. */
export type OrderCapture = { mode: CaptureMode; captureBefore: string; amountMinor: number; currency: string; warned: boolean };

export async function orderCapture(storeId: string, orderId: string): Promise<OrderCapture | null> {
  const [row] = await db().execute<Row>(sql`
    select o.capture_mode, o.capture_before, o.capture_warned_at is not null as warned, p.amount_minor, p.currency
      from commerce.orders o
      join commerce.payments p on p.store_id = o.store_id and p.order_id = o.id and p.provider = 'stripe' and p.status = 'authorized'
     where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and o.status = 'authorized'
     order by p.created_at desc limit 1
  `);
  if (!row || (row.capture_mode !== "when_sent" && row.capture_mode !== "by_hand") || !row.capture_before) return null;
  return {
    mode: row.capture_mode,
    captureBefore: new Date(String(row.capture_before)).toISOString(),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency).trim(),
    warned: Boolean(row.warned),
  };
}

export type AuthorizeOutcome = "authorized" | "not_held" | "already" | "voided";

/**
 * A completed session of an order checked out to be captured later: when its PaymentIntent waits for its capture (`requires_capture`), the order becomes
 * `authorized` with Stripe's deadline (seven days when Stripe gives none). An order cancelled before the hold arrived has its hold voided at once.
 */
export async function authorizeFromSession(
  storeId: string,
  session: Pick<Stripe.Checkout.Session, "id" | "payment_intent">,
  deps: CaptureDeps = {},
): Promise<AuthorizeOutcome> {
  const [row] = await db().execute<Row>(sql`
    select p.order_id, p.provider_account, o.status, o.capture_mode from commerce.payments p
      join commerce.orders o on o.store_id = p.store_id and o.id = p.order_id
     where p.store_id = ${storeId}::uuid and p.provider = 'stripe' and p.provider_reference = ${session.id}
  `);
  if (!row || !row.capture_mode || !row.provider_account) return "not_held";
  const account = String(row.provider_account);
  const mode = await modeOfAccount(storeId, account);
  const stripe = mode ? (deps.stripeFor ?? platformStripe)(mode) : null;
  if (!stripe) return "not_held";
  const expanded = session.payment_intent && typeof session.payment_intent !== "string" && session.payment_intent.latest_charge ? session.payment_intent : null;
  const pi = expanded ?? (await intentOfReference(stripe, session.id, account));
  if (!pi || pi.status !== "requires_capture") return "not_held";
  if (row.status === "cancelled") {
    await stripe.paymentIntents.cancel(pi.id, {}, { stripeAccount: account, idempotencyKey: `void-${pi.id}` }).catch(() => null);
    await db().execute(sql`update commerce.payments set status = 'cancelled', updated_at = now() where store_id = ${storeId}::uuid and provider_reference = ${session.id} and status in ('pending', 'authorized')`);
    return "voided";
  }
  const deadline = captureDeadline((deps.now ?? (() => new Date()))(), captureBeforeOf(pi));
  const [done] = await db().execute<Row>(sql`select commerce.authorize_order_payment(${String(row.order_id)}::uuid, ${session.id}, ${deadline.toISOString()}::timestamptz) as ok`);
  return done?.ok ? "authorized" : "already";
}

export type CaptureOutcome = { ok: true; capturedMinor: number; releasedMinor: number } | { ok: false; problem: CaptureProblem };

/**
 * Charges a held card: the whole, or `amountMinor` of it (the rest is released: a `release` refund, credited against the invoice). Stripe captures
 * first; the order is then paid by `complete_order_payment()`, as a payment at checkout is. Kaizena Flow's fee is the same share of what is captured.
 * Idempotent by the payment: a second press finds nothing held.
 */
export async function capturePayment(
  storeId: string,
  orderId: string,
  input: { amountMinor?: number | null; accountId: string | null },
  deps: CaptureDeps = {},
): Promise<CaptureOutcome> {
  const [order] = await db().execute<Row>(sql`
    select status, copied_from is not null as copied, capture_before from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid
  `);
  if (!order) return { ok: false, problem: "not_authorized" };
  if (order.copied) return { ok: false, problem: "copied" };
  if (order.status !== "authorized") return { ok: false, problem: "not_authorized" };
  const held = await heldPayment(storeId, orderId);
  if (!held) return { ok: false, problem: "not_authorized" };
  const amount = input.amountMinor ?? held.amountMinor;
  if (captureAmountProblem(amount, held.amountMinor)) return { ok: false, problem: "amount" };
  const stripe = (deps.stripeFor ?? platformStripe)(held.mode);
  if (!stripe) return { ok: false, problem: "stripe" };
  const options = { stripeAccount: held.account };
  let pi: Stripe.PaymentIntent | null;
  try {
    pi = await intentOfReference(stripe, held.reference, held.account);
  } catch {
    return { ok: false, problem: "stripe" };
  }
  if (!pi) return { ok: false, problem: "stripe" };
  if (pi.status === "canceled") {
    await cancelUnpaidOrder(orderId, "authorization ended");
    await setPaymentStatus(storeId, held.paymentId, "cancelled");
    return { ok: false, problem: "expired" };
  }
  const partial = amount < held.amountMinor;
  const fee = partial && held.feeMinor > 0 ? Math.round((held.feeMinor * amount) / held.amountMinor) : null;
  if (pi.status === "requires_capture") {
    try {
      await stripe.paymentIntents.capture(
        pi.id,
        { ...(partial ? { amount_to_capture: amount } : {}), ...(fee !== null ? { application_fee_amount: fee } : {}) },
        { ...options, idempotencyKey: `capture-${pi.id}-${amount}` },
      );
    } catch {
      return { ok: false, problem: "stripe" };
    }
  } else if (pi.status !== "succeeded") {
    return { ok: false, problem: "stripe" };
  }
  // Captured (now, or already in Stripe's Dashboard): the order is paid as at checkout, and what was not taken is released in the same transaction.
  const captured = pi.status === "succeeded" ? (pi.amount_received ?? held.amountMinor) : amount;
  const released = held.amountMinor - captured;
  await db().transaction(async (tx) => {
    await tx.execute(sql`select commerce.complete_order_payment(${orderId}::uuid, ${held.reference})`);
    await tx.execute(sql`
      update commerce.payments set status = 'captured', updated_at = now()${fee !== null ? sql`, kaizen_fee_minor = ${fee}` : sql``}
       where store_id = ${storeId}::uuid and id = ${held.paymentId}::uuid and status = 'authorized'
    `);
    if (released > 0) {
      await tx.execute(sql`
        insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind, created_by)
        values (${storeId}::uuid, ${held.paymentId}::uuid, ${released}, 'Not captured: the rest of the hold was released', 'succeeded', 'release', ${input.accountId}::uuid)
      `);
    }
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'payment.captured', ${JSON.stringify({ amount: captured, released, by: input.accountId })}::jsonb, ${input.accountId ? "staff" : "system"})
    `);
  });
  if (input.accountId) await audit(input.accountId, storeId, "order.captured", { orderId, captured, released }, { area: "orders", target: { type: "order", id: orderId } });
  await readPaymentFacts(storeId, held.reference, deps).catch(() => null);
  return { ok: true, capturedMinor: captured, releasedMinor: released };
}

async function setPaymentStatus(storeId: string, paymentId: string, status: string) {
  await db().execute(sql`update commerce.payments set status = ${status}, updated_at = now() where store_id = ${storeId}::uuid and id = ${paymentId}::uuid`);
}

/** Lets a held card go and cancels the order (its stock released): staff's *Cancel and release*. Stripe first; already ended at Stripe is ended here too. */
export async function voidAuthorization(storeId: string, orderId: string, accountId: string | null, deps: CaptureDeps = {}): Promise<{ ok: true } | { ok: false; problem: CaptureProblem }> {
  const held = await heldPayment(storeId, orderId);
  if (!held) return { ok: false, problem: "not_authorized" };
  const stripe = (deps.stripeFor ?? platformStripe)(held.mode);
  if (!stripe) return { ok: false, problem: "stripe" };
  try {
    const pi = await intentOfReference(stripe, held.reference, held.account);
    if (pi && pi.status === "requires_capture") await stripe.paymentIntents.cancel(pi.id, {}, { stripeAccount: held.account, idempotencyKey: `void-${pi.id}` });
    else if (pi && pi.status === "succeeded") return { ok: false, problem: "not_authorized" };
  } catch {
    return { ok: false, problem: "stripe" };
  }
  await cancelUnpaidOrder(orderId, "authorization released by staff");
  await setPaymentStatus(storeId, held.paymentId, "cancelled");
  if (accountId) await audit(accountId, storeId, "order.authorization_released", { orderId }, { area: "orders", target: { type: "order", id: orderId } });
  return { ok: true };
}

/** Stripe let a hold go (`payment_intent.canceled`, an expiry or a cancel in the Dashboard): an authorized order is cancelled and its stock released. */
export async function applyIntentCanceled(storeId: string, pi: Pick<Stripe.PaymentIntent, "id" | "status">, findPayment: (intent: string) => Promise<{ id: string; orderId: string } | null>): Promise<boolean> {
  if (pi.status !== "canceled") return false;
  const payment = await findPayment(pi.id);
  if (!payment) return false;
  const [order] = await db().execute<Row>(sql`select status from commerce.orders where store_id = ${storeId}::uuid and id = ${payment.orderId}::uuid`);
  if (order?.status !== "authorized") return false;
  await cancelUnpaidOrder(payment.orderId, "authorization ended");
  await setPaymentStatus(storeId, payment.id, "cancelled");
  return true;
}

/** Whether an order is waiting to be captured when it is sent (used before a parcel or a handover is recorded). */
export async function captureForSending(storeId: string, orderId: string, accountId: string | null, deps: CaptureDeps = {}): Promise<{ ok: true } | { ok: false; reason: "authorized" | "capture_failed" }> {
  const [order] = await db().execute<Row>(sql`select status, capture_mode from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
  if (order?.status !== "authorized") return { ok: true };
  if (order.capture_mode !== "when_sent") return { ok: false, reason: "authorized" };
  const captured = await capturePayment(storeId, orderId, { accountId }, deps);
  return captured.ok ? { ok: true } : { ok: false, reason: "capture_failed" };
}

export type CaptureJobRun = { warned: number; ended: number; captured: number };

/**
 * The five-minute job's part (never throws): staff are told once when a hold lapses within a day (`warn`), and a hold past its deadline is asked of
 * Stripe: ended, the order is cancelled and its stock released; captured meanwhile (in Stripe's Dashboard), the order is paid.
 */
export async function runCaptureJobs(
  options: { warn?: (storeId: string, orderId: string) => Promise<unknown>; storeIds?: readonly string[]; limit?: number } & CaptureDeps = {},
): Promise<CaptureJobRun> {
  const run: CaptureJobRun = { warned: 0, ended: 0, captured: 0 };
  const scope = options.storeIds ? sql`and o.store_id = any(${uuidList(options.storeIds)})` : sql``;
  try {
    const soon = await db().execute<Row>(sql`
      select o.id, o.store_id from commerce.orders o
       where o.status = 'authorized' and o.capture_warned_at is null and o.capture_before <= now() + make_interval(hours => ${CAPTURE_WARNING_HOURS}) and o.capture_before > now() ${scope}
       order by o.capture_before limit ${options.limit ?? 20}
    `);
    for (const r of soon) {
      const [claimed] = await db().execute<Row>(sql`
        update commerce.orders set capture_warned_at = now() where store_id = ${String(r.store_id)}::uuid and id = ${String(r.id)}::uuid and capture_warned_at is null returning id
      `);
      if (!claimed) continue;
      if (options.warn) await options.warn(String(r.store_id), String(r.id)).catch(() => null);
      else await import("./staff-alerts").then((m) => m.sendCaptureDueAlert(String(r.store_id), String(r.id))).catch(() => null);
      run.warned += 1;
    }
    const past = await db().execute<Row>(sql`
      select o.id, o.store_id from commerce.orders o where o.status = 'authorized' and o.capture_before < now() ${scope}
       order by o.capture_before limit ${options.limit ?? 20}
    `);
    for (const r of past) {
      const storeId = String(r.store_id);
      const orderId = String(r.id);
      const held = await heldPayment(storeId, orderId);
      const stripe = held ? (options.stripeFor ?? platformStripe)(held.mode) : null;
      if (!held || !stripe) continue;
      const pi = await intentOfReference(stripe, held.reference, held.account).catch(() => null);
      if (!pi) continue;
      if (pi.status === "canceled") {
        await cancelUnpaidOrder(orderId, "authorization ended");
        await setPaymentStatus(storeId, held.paymentId, "cancelled");
        run.ended += 1;
      } else if (pi.status === "succeeded") {
        const done = await capturePayment(storeId, orderId, { accountId: null }, options);
        if (done.ok) run.captured += 1;
      }
    }
  } catch (error) {
    log("error", "capture.job_failed", {}, error);
  }
  return run;
}
