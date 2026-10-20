import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { disputeRecord, reminderDue, type DisputeLike, type DisputeRecord, type DisputeStatus } from "@/lib/payment-facts";

import { readMissingPaymentFacts } from "./payment-facts";
import { paymentOfIntent } from "./stripe-refunds";
import { sendDisputeAlert } from "./staff-alerts";

type Row = Record<string, unknown>;

/**
 * Disputes (wave 4 unit A, D288, `docs/wave-4-payments.md` 3): the connected account's `charge.dispute.*` events kept as `commerce.payment_disputes`,
 * one row per dispute, the only writer of that table. A dispute is found by its PaymentIntent (`paymentOfIntent()`, as refunds are) or its charge;
 * one on a payment this store does not have is `unmatched` and changes nothing. Staff are emailed once when it opens and once when its deadline is near
 * (`sendDueDisputeReminders()`, the five-minute job). A lost dispute is money out in the finance analytics in the period it closed, never a refund
 * (no credit note, no restock).
 */

export const DISPUTE_EVENTS = [
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
] as const;

export const isDisputeEvent = (type: string): boolean => (DISPUTE_EVENTS as readonly string[]).includes(type);

export type DisputeDeps = {
  stripe?: Stripe | null;
  account?: string | null;
  /** Sends a staff email (tests). */
  alert?: typeof sendDisputeAlert;
};

export type DisputeApplied =
  | { outcome: "inserted" | "updated"; disputeId: string; orderId: string; status: DisputeStatus }
  | { outcome: "unmatched"; reason: "no_payment" | "unknown_status" };

async function paymentOfCharge(storeId: string, charge: string): Promise<{ id: string; orderId: string; currency: string } | null> {
  if (!charge) return null;
  const [p] = await db().execute<Row>(sql`
    select id, order_id, currency from commerce.payments where store_id = ${storeId}::uuid and provider = 'stripe' and charge_reference = ${charge} limit 1
  `);
  return p ? { id: String(p.id), orderId: String(p.order_id), currency: String(p.currency).trim() } : null;
}

async function orderEvent(storeId: string, orderId: string, type: string, data: Record<string, unknown>, actor: "stripe" | "mollie" = "stripe") {
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${storeId}::uuid, ${orderId}::uuid, ${type}, ${JSON.stringify(data)}::jsonb, ${actor})
  `);
}

/** Brings a dispute's row up to date with what Stripe sent (idempotent by the dispute's id); a closed dispute keeps how it closed. */
export async function applyStripeDispute(storeId: string, dispute: DisputeLike, deps: DisputeDeps = {}): Promise<DisputeApplied> {
  const record = disputeRecord(dispute);
  if (!record) return { outcome: "unmatched", reason: "unknown_status" };
  const payment =
    (await paymentOfCharge(storeId, record.chargeReference)) ??
    (record.intent ? await paymentOfIntent(storeId, record.intent, { stripe: deps.stripe ?? null, account: deps.account ?? null }) : null);
  return writeDispute(storeId, "stripe", payment, record, deps);
}

/**
 * Keeps a dispute a provider reported on the store's payment it names (idempotent by the provider and its id); a closed dispute keeps how it closed. The
 * one writer of `payment_disputes`, for Stripe's disputes and Mollie's chargebacks (D292) alike.
 */
export async function writeDispute(
  storeId: string,
  provider: "stripe" | "mollie",
  payment: { id: string; orderId: string; currency: string } | null,
  record: Omit<DisputeRecord, "intent">,
  deps: Pick<DisputeDeps, "alert"> = {},
): Promise<DisputeApplied> {
  if (!payment || payment.currency !== record.currency) return { outcome: "unmatched", reason: "no_payment" };
  const [row] = await db().execute<Row>(sql`
    insert into commerce.payment_disputes (store_id, order_id, payment_id, provider, provider_reference, charge_reference, amount_minor, currency, reason,
      status, evidence_due_by, outcome, funds_withdrawn_minor, fee_minor, test_mode, opened_at, closed_at)
    values (${storeId}::uuid, ${payment.orderId}::uuid, ${payment.id}::uuid, ${provider}, ${record.reference}, ${record.chargeReference || null},
      ${record.amountMinor}, ${record.currency}, ${record.reason}, ${record.status}, ${record.evidenceDueBy?.toISOString() ?? null}::timestamptz,
      ${record.outcome}, ${record.fundsWithdrawnMinor}, ${record.feeMinor}, ${record.testMode}, ${record.openedAt.toISOString()}::timestamptz,
      ${record.outcome ? sql`now()` : sql`null`})
    on conflict (store_id, provider, provider_reference) do update set
      status = case when commerce.payment_disputes.closed_at is null then excluded.status else commerce.payment_disputes.status end,
      reason = coalesce(excluded.reason, commerce.payment_disputes.reason),
      evidence_due_by = coalesce(excluded.evidence_due_by, commerce.payment_disputes.evidence_due_by),
      amount_minor = excluded.amount_minor,
      outcome = coalesce(commerce.payment_disputes.outcome, excluded.outcome),
      closed_at = coalesce(commerce.payment_disputes.closed_at, excluded.closed_at),
      funds_withdrawn_minor = coalesce(excluded.funds_withdrawn_minor, commerce.payment_disputes.funds_withdrawn_minor),
      fee_minor = coalesce(excluded.fee_minor, commerce.payment_disputes.fee_minor)
    returning id, (xmax = 0) as inserted, status, outcome, closed_at
  `);
  const disputeId = String(row.id);
  const inserted = Boolean(row.inserted);
  const data = { dispute: disputeId, amount: record.amountMinor, currency: record.currency, reason: record.reason };
  if (inserted) {
    await orderEvent(storeId, payment.orderId, "dispute.opened", data, provider);
    // One email per recipient, however often Stripe sends the event (the email's key).
    await (deps.alert ?? sendDisputeAlert)(storeId, disputeId, "opened").catch(() => null);
  }
  // Closed now (by this event, or by the first one Kaizena Flow saw): written once in the order's history.
  if (row.outcome && (inserted || record.outcome)) {
    const [seen] = await db().execute<Row>(sql`
      select 1 from commerce.order_events where store_id = ${storeId}::uuid and order_id = ${payment.orderId}::uuid and type = 'dispute.closed' and data->>'dispute' = ${disputeId}
    `);
    if (!seen) await orderEvent(storeId, payment.orderId, "dispute.closed", { ...data, outcome: String(row.outcome) }, provider);
  }
  return { outcome: inserted ? "inserted" : "updated", disputeId, orderId: payment.orderId, status: String(row.status) as DisputeStatus };
}

/** Emails staff once for each open dispute whose evidence is due within three days (the five-minute job). Never throws. */
export async function sendDueDisputeReminders(options: { now?: Date; alert?: typeof sendDisputeAlert; limit?: number } = {}): Promise<{ sent: number }> {
  const now = options.now ?? new Date();
  let sent = 0;
  let rows: Row[];
  try {
    rows = await db().execute<Row>(sql`
      select d.id, d.store_id, d.status, d.evidence_due_by
        from commerce.payment_disputes d
       where d.closed_at is null and d.reminded_at is null and d.evidence_due_by is not null
         and d.evidence_due_by > ${now.toISOString()}::timestamptz and d.evidence_due_by <= ${now.toISOString()}::timestamptz + interval '3 days'
         and commerce.store_is_active(d.store_id)
       order by d.evidence_due_by limit ${options.limit ?? 20}
    `);
  } catch {
    return { sent };
  }
  for (const r of rows) {
    const due = reminderDue({ status: String(r.status) as DisputeStatus, evidenceDueBy: new Date(String(r.evidence_due_by)), remindedAt: null, now });
    if (!due) continue;
    try {
      const result = await (options.alert ?? sendDisputeAlert)(String(r.store_id), String(r.id), "due");
      if (result && !result.ok) continue;
      await db().execute(sql`update commerce.payment_disputes set reminded_at = now() where store_id = ${String(r.store_id)}::uuid and id = ${String(r.id)}::uuid and reminded_at is null`);
      sent += 1;
    } catch {
      // Tried again on the next run (the email's key keeps it once).
    }
  }
  return { sent };
}

/** The five-minute job's part for payments (D288, never throws): facts of captured Stripe payments still unread, and disputes' deadline reminders. */
export async function runPaymentJobs(): Promise<{
  facts: number;
  reminders: number;
  holds: { warned: number; ended: number; captured: number };
  payouts: { stores: number; payouts: number; lines: number; failed: number };
  terms: { reminded: number; overdue: number };
}> {
  const { runCaptureJobs } = await import("./payment-capture");
  const { runPayoutJobs } = await import("./payouts");
  const { runTermsJobs } = await import("./payment-terms");
  const [facts, reminders, holds, payouts, terms] = await Promise.all([
    readMissingPaymentFacts().catch(() => ({ read: 0 })),
    sendDueDisputeReminders().catch(() => ({ sent: 0 })),
    // Held cards (D289): staff told a day before a hold ends, and a hold past its deadline settled from what Stripe says.
    runCaptureJobs(),
    // Payouts (D290): each store's read back once a day, a few stores a run, and paid payouts whose lines are unread.
    runPayoutJobs(),
    // Payment terms (D293): the reminder three days before an invoice is due and the notice the day after.
    runTermsJobs().catch(() => ({ reminded: 0, overdue: 0 })),
  ]);
  return { facts: facts.read, reminders: reminders.sent, holds, payouts, terms };
}

export type OrderPaymentView = {
  id: string;
  provider: string;
  amountMinor: number;
  currency: string;
  status: string;
  methodType: string | null;
  wallet: string | null;
  cardBrand: string | null;
  manualMethod: string | null;
  riskLevel: string | null;
  riskScore: number | null;
  /** Whether Kaizena Flow has read the payment's charge (a Stripe payment not read yet is *Unknown*). */
  read: boolean;
};

export type OrderDisputeView = {
  id: string;
  reference: string;
  amountMinor: number;
  currency: string;
  reason: string | null;
  status: DisputeStatus;
  evidenceDueBy: string | null;
  outcome: "won" | "lost" | null;
  feeMinor: number | null;
  testMode: boolean;
  openedAt: string;
  closedAt: string | null;
};

/** An order's payments with what they were, and its disputes (D288), for the order page. */
export async function orderPaymentFacts(storeId: string, orderId: string): Promise<{ payments: OrderPaymentView[]; disputes: OrderDisputeView[] }> {
  const [payments, rows] = await Promise.all([
    db().execute<Row>(sql`
      select id, provider, amount_minor, currency, status, method_type, wallet, card_brand, method, risk_level, risk_score, facts_read_at is not null as read
        from commerce.payments where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and status in ('captured', 'authorized')
       order by created_at
    `),
    db().execute<Row>(sql`
      select id, provider_reference, amount_minor, currency, reason, status, evidence_due_by, outcome, fee_minor, test_mode, opened_at, closed_at
        from commerce.payment_disputes where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid order by opened_at
    `),
  ]);
  const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
  return {
    payments: payments.map((p) => ({
      id: String(p.id),
      provider: String(p.provider),
      amountMinor: Number(p.amount_minor),
      currency: String(p.currency).trim(),
      status: String(p.status),
      methodType: p.method_type ? String(p.method_type) : null,
      wallet: p.wallet ? String(p.wallet) : null,
      cardBrand: p.card_brand ? String(p.card_brand) : null,
      manualMethod: p.method ? String(p.method) : null,
      riskLevel: p.risk_level ? String(p.risk_level) : null,
      riskScore: p.risk_score === null || p.risk_score === undefined ? null : Number(p.risk_score),
      read: Boolean(p.read),
    })),
    disputes: rows.map((d) => ({
      id: String(d.id),
      reference: String(d.provider_reference),
      amountMinor: Number(d.amount_minor),
      currency: String(d.currency).trim(),
      reason: d.reason ? String(d.reason) : null,
      status: String(d.status) as DisputeStatus,
      evidenceDueBy: iso(d.evidence_due_by),
      outcome: d.outcome === "won" || d.outcome === "lost" ? d.outcome : null,
      feeMinor: d.fee_minor === null || d.fee_minor === undefined ? null : Number(d.fee_minor),
      testMode: Boolean(d.test_mode),
      openedAt: iso(d.opened_at)!,
      closedAt: iso(d.closed_at),
    })),
  };
}
