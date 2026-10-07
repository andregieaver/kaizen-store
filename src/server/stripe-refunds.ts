import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { REFUND_REASON_DASHBOARD, REFUND_REASON_RECORDED } from "@/lib/refund-adopted";
import { editLabel } from "@/lib/order-edit-status";
import { FULFILMENT_EVENTS } from "@/lib/order-ops-events";
import type { PaymentModeName } from "@/lib/stripe-account";

import { reverseHostCommission } from "./host-payments";
import { sendCreditNoteNotice } from "./invoice-notices";
import { platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Refunds that Stripe reports (D159, `docs/wave-1b-invoices.md` 2.6, paths P6 and P7). Until now Kaizen wrote a refund row only when staff
 * made the refund and kept the status Stripe answered with, so a refund Stripe left `pending` (a bank method) never completed here and a
 * refund made in Stripe's Dashboard was unknown. `applyStripeRefund()` brings a row up to date with the refund Stripe sends in
 * `refund.created`, `refund.updated`, `refund.failed` or `charge.refund.updated` and, when the refund is not Kaizen's own, inserts it. It never makes the
 * credit note: the database does that at commit for any refund that becomes `succeeded` (`refunds_credit_note`); this module only writes
 * the row and then sends the shopper the stand-alone credit note email.
 *
 * - Idempotent by the refund's Stripe id (`provider_reference`, unique per store): a replayed or out-of-order event changes nothing it
 *   should not. A status never goes back: `succeeded` is final in the database. A refund Stripe later says failed after it succeeded is
 *   written once as the order event `refund.reversed_after_success` (shown by the store checkup) and changes no status.
 * - A refund Kaizen made itself carries `metadata.order_id` (`refundOrder()`); its row is written by the staff action a moment after Stripe
 *   answers, so an event for it that arrives first is refused (Stripe sends it again) and not inserted a second time. After two minutes
 *   it is written here, so a refund whose own row was lost is still recorded.
 * - A refund for a payment this store does not have is `unmatched` and changes nothing.
 */

export type RefundStatus = "pending" | "succeeded" | "failed";

/** Stripe's status for a refund in the database's three. `canceled` and `failed` are failed; anything not final is pending. */
export function refundStatusOf(status: string | null | undefined): RefundStatus {
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "canceled") return "failed";
  return "pending";
}

export type RefundApplied =
  | { outcome: "inserted" | "updated" | "unchanged"; refundId: string; status: RefundStatus; orderId: string }
  | { outcome: "unmatched"; reason: "no_payment" | "other_currency" };

export type RefundDeps = {
  /** The Stripe client for the store's mode (to find the payment of a refund made in the Dashboard); the real one by default. */
  stripe?: Stripe | null;
  /** The connected account the event came from. */
  account?: string | null;
  /** The clock, in milliseconds (tests). */
  now?: () => number;
  /** Sends the stand-alone credit note email (tests). */
  notify?: (storeId: string, creditNoteId: string) => Promise<unknown>;
};

/** A refund of Kaizen's own whose row is not there yet: the webhook is refused so Stripe sends the event again. */
export class RefundNotRecordedYet extends Error {
  constructor() {
    super("The refund is Kaizen's own and its row is not recorded yet.");
  }
}

/** How long Kaizen is given to record a refund it made itself before an event for it records it instead. */
const OWN_REFUND_GRACE_SECONDS = 120;

const idOf = (value: string | { id: string } | null | undefined): string | null => (typeof value === "string" ? value : (value?.id ?? null));

async function paymentFor(storeId: string, refund: Stripe.Refund, deps: RefundDeps): Promise<{ id: string; orderId: string; currency: string } | null> {
  const intent = idOf(refund.payment_intent);
  if (!intent) return null;
  const lookup = async (reference: string) => {
    const [p] = await db().execute<Row>(sql`
      select id, order_id, currency from commerce.payments
      where store_id = ${storeId}::uuid and provider = 'stripe' and provider_reference = ${reference}
      order by created_at limit 1
    `);
    return p ? { id: String(p.id), orderId: String(p.order_id), currency: String(p.currency).trim() } : null;
  };
  // A charge made on its own (a no-show fee, D66) is kept by its PaymentIntent.
  const direct = await lookup(intent);
  if (direct) return direct;
  const stripe = deps.stripe ?? null;
  const options = deps.account ? { stripeAccount: deps.account } : undefined;
  if (!stripe || !options) return null;
  try {
    // A Checkout payment is kept by its session.
    const sessions = await stripe.checkout.sessions.list({ payment_intent: intent, limit: 1 }, options);
    const session = sessions.data[0];
    if (session) {
      const found = await lookup(session.id);
      if (found) return found;
    }
  } catch {
    // Not a Checkout payment, or Stripe could not be asked: the invoice lookup is next.
  }
  try {
    // A subscription's renewal is kept by its invoice.
    const payments = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: intent }, limit: 1 }, options);
    const invoice = idOf(payments.data[0]?.invoice as string | { id: string } | null | undefined);
    if (invoice) return await lookup(invoice);
  } catch {
    // Unmatched.
  }
  return null;
}

async function event(storeId: string, orderId: string, type: string, data: Record<string, unknown>, actor: string) {
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${storeId}::uuid, ${orderId}::uuid, ${type}, ${JSON.stringify(data)}::jsonb, ${actor})
  `);
}

async function creditNoteOf(storeId: string, refundId: string): Promise<string | null> {
  const [c] = await db().execute<Row>(sql`select id from commerce.credit_notes where store_id = ${storeId}::uuid and refund_id = ${refundId}::uuid`);
  return c ? String(c.id) : null;
}

async function announce(storeId: string, refundId: string, deps: RefundDeps) {
  const noteId = await creditNoteOf(storeId, refundId);
  if (!noteId) return;
  try {
    await (deps.notify ?? sendCreditNoteNotice)(storeId, noteId);
  } catch {
    // The email is tried again by the five-minute job; the credit note stands.
  }
}

/** Whether Stripe, asked now, still reports the refund as failed; true when it cannot be asked (the event is then all there is). */
async function stillFailed(refund: Stripe.Refund, deps: RefundDeps): Promise<boolean> {
  if (!deps.stripe || !deps.account) return true;
  try {
    const current = await deps.stripe.refunds.retrieve(refund.id, {}, { stripeAccount: deps.account });
    return refundStatusOf(current.status) === "failed";
  } catch {
    return true;
  }
}

/**
 * A change with a lower total is applied on Stripe's `pending` answer to its refund (D174, 2.7: the money is on its way). When that refund then fails, the order
 * reads lower and the customer has not been paid back: the order says so once (`order.edit_refund_failed`), and the order page, the store checkup and the
 * control center show it (`EDIT_REFUND_OWED_SQL`) until staff refund the customer again. Nothing else changes (the change, its documents and the order stand).
 */
async function flagFailedEditRefund(storeId: string, orderId: string, refundId: string): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    select r.amount_minor, e.id as edit_id, e.seq from commerce.refunds r
    join commerce.order_edits e on e.store_id = r.store_id and e.id = r.order_edit_id
    where r.store_id = ${storeId}::uuid and r.id = ${refundId}::uuid and e.status = 'applied' and e.difference_minor < 0
  `);
  if (!row) return;
  const [said] = await db().execute<Row>(sql`
    select 1 as one from commerce.order_events where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and type = ${FULFILMENT_EVENTS.editRefundFailed} and data ->> 'refundId' = ${refundId}
  `);
  if (said) return;
  await event(storeId, orderId, FULFILMENT_EVENTS.editRefundFailed, { refundId, edit: String(row.edit_id), label: editLabel(Number(row.seq)), amount: Number(row.amount_minor) }, "stripe");
}

/** Brings the store's refund row for this Stripe refund up to date, or records it. */
export async function applyStripeRefund(storeId: string, refund: Stripe.Refund, deps: RefundDeps = {}): Promise<RefundApplied> {
  const status = refundStatusOf(refund.status);
  const [existing] = await db().execute<Row>(sql`
    select r.id, r.status, p.order_id from commerce.refunds r
    join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
    where r.store_id = ${storeId}::uuid and r.provider_reference = ${refund.id}
  `);

  if (existing) {
    const refundId = String(existing.id);
    const orderId = String(existing.order_id);
    const before = String(existing.status) as RefundStatus;
    if (before === status) return { outcome: "unchanged", refundId, status, orderId };
    // Stripe does not send events in order, and Kaizen refuses the first `refund.created` of its own refunds on purpose, so Stripe sends it
    // again later with the status it had then. `pending` is the first state of a refund: an event that says it never moves a row that is
    // already final, and is never a reversal.
    if (status === "pending") return { outcome: "unchanged", refundId, status: before, orderId };
    if (before === "succeeded") {
      // Final in the database: the credit note may stand for it. Only a refund Stripe itself still says failed is a reversal (an event
      // may be older than the row), confirmed with Stripe when it can be asked, and said once, for the checkup.
      if (!(await stillFailed(refund, deps))) return { outcome: "unchanged", refundId, status: "succeeded", orderId };
      const [said] = await db().execute<Row>(sql`
        select 1 as one from commerce.order_events
        where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and type = 'refund.reversed_after_success' and data ->> 'refundId' = ${refundId}
      `);
      if (!said) await event(storeId, orderId, "refund.reversed_after_success", { refundId, reportedStatus: status }, "stripe");
      return { outcome: "unchanged", refundId, status: "succeeded", orderId };
    }
    await db().execute(sql`
      update commerce.refunds set status = ${status}::commerce.refund_status
      where store_id = ${storeId}::uuid and id = ${refundId}::uuid and status = ${before}::commerce.refund_status
    `);
    await event(storeId, orderId, "refund.status_changed", { refundId, from: before, to: status }, "stripe");
    if (status === "succeeded") await announce(storeId, refundId, deps);
    if (status === "failed") await flagFailedEditRefund(storeId, orderId, refundId);
    return { outcome: "updated", refundId, status, orderId };
  }

  // Not a row of ours: a refund made in Stripe's Dashboard, or one of Kaizen's own whose row is not written yet.
  const own = Boolean(refund.metadata?.order_id);
  const now = (deps.now ?? Date.now)();
  if (own && now / 1000 - refund.created < OWN_REFUND_GRACE_SECONDS) throw new RefundNotRecordedYet();
  const payment = await paymentFor(storeId, refund, deps);
  if (!payment) return { outcome: "unmatched", reason: "no_payment" };
  if (refund.currency && refund.currency.toUpperCase() !== payment.currency.toUpperCase()) return { outcome: "unmatched", reason: "other_currency" };
  const [row] = await db().execute<Row>(sql`
    insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, restocked, created_by)
    values (${storeId}::uuid, ${payment.id}::uuid, ${refund.amount}, ${own ? REFUND_REASON_RECORDED : REFUND_REASON_DASHBOARD}, ${refund.id}, ${status}::commerce.refund_status, '[]'::jsonb, null)
    on conflict (store_id, provider_reference) do nothing
    returning id
  `);
  if (!row) {
    // Written by another request in the meantime: that one's outcome stands.
    const [again] = await db().execute<Row>(sql`select id, status from commerce.refunds where store_id = ${storeId}::uuid and provider_reference = ${refund.id}`);
    return { outcome: "unchanged", refundId: String(again?.id), status: refundStatusOf(String(again?.status)), orderId: payment.orderId };
  }
  const refundId = String(row.id);
  await event(storeId, payment.orderId, "order.refunded", { amount: refund.amount, reason: own ? REFUND_REASON_RECORDED : REFUND_REASON_DASHBOARD, restocked: [], ...(status === "failed" ? { status } : {}) }, "stripe");
  if (status !== "failed") await reverseHostCommission(storeId, payment.id).catch(() => undefined);
  if (status === "succeeded") await announce(storeId, refundId, deps);
  return { outcome: "inserted", refundId, status, orderId: payment.orderId };
}

/** Whether an event type carries a refund object this module understands. */
export const isRefundEvent = (type: string): boolean => ["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"].includes(type);

/** The connected account's mode (`test` or `live`), from the table of accounts, or null when the account is not known to this store. */
export async function modeOfAccount(storeId: string, account: string): Promise<PaymentModeName | null> {
  const [a] = await db().execute<Row>(sql`select mode from commerce.connected_accounts where store_id = ${storeId}::uuid and account_id = ${account} limit 1`);
  return a?.mode === "test" || a?.mode === "live" ? a.mode : null;
}

/** The Stripe client for an event's account (null: none configured, or the account is not this store's). */
export async function stripeForAccount(storeId: string, account: string | null | undefined): Promise<Stripe | null> {
  if (!account) return null;
  const mode = await modeOfAccount(storeId, account);
  return mode ? platformStripe(mode) : null;
}

export type ReconcileResult = { checked: number; updated: number; failed: number };

/**
 * The five-minute job's safety net for Kaizen's own refunds: a refund still `pending` is asked of Stripe (so a bank refund completes even
 * when the webhook is not set up for refund events). Refunds under two hours old are asked every run, older ones once an hour (a bucket
 * of the refund's id, so no state is kept). Never throws.
 */
export async function reconcilePendingRefunds(limit = 20, deps: { stripeFor?: (mode: PaymentModeName) => Stripe | null; now?: () => number } = {}): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, updated: 0, failed: 0 };
  const clock = deps.now ?? Date.now;
  const bucket = Math.floor(clock() / 300_000) % 12;
  let rows: Row[];
  try {
    rows = await db().execute<Row>(sql`
      select r.id, r.store_id, r.provider_reference, p.provider_account, a.mode
      from commerce.refunds r
      join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
      join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
      where r.status = 'pending' and r.provider_reference like 're\\_%' and r.created_at < now() - interval '10 minutes'
        and (r.created_at > now() - interval '2 hours' or abs(hashtext(r.id::text)) % 12 = ${bucket})
      order by r.created_at
      limit ${limit}
    `);
  } catch {
    return result;
  }
  for (const row of rows) {
    const stripe = (deps.stripeFor ?? platformStripe)(String(row.mode) as PaymentModeName);
    if (!stripe) continue;
    result.checked += 1;
    try {
      const refund = await stripe.refunds.retrieve(String(row.provider_reference), {}, { stripeAccount: String(row.provider_account) });
      const applied = await applyStripeRefund(String(row.store_id), refund, { stripe, account: String(row.provider_account), now: clock });
      if (applied.outcome === "updated") result.updated += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
