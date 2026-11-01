import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";

import { db } from "@/db/client";
import { draftEvidence, EVIDENCE_FIELDS, EVIDENCE_MESSAGES_MAX, evidenceInput, returnsOften, stripeEvidence, type Evidence, type EvidenceFacts } from "@/lib/dispute-evidence";
import { normaliseEmail } from "@/lib/email-address";
import { formatMoney } from "@/lib/money";
import { disputeNeedsResponse, isDisputeStatus, type DisputeStatus } from "@/lib/payment-facts";

import { audit } from "./auth";
import { termsForOrder } from "./checkout-terms";
import { log } from "./log";
import { getReturnSettings } from "./return-settings";
import { stripeForAccount } from "./stripe-refunds";
import { col, typedRow } from "./typed-rows";

/**
 * The chargeback assistant (D417, `src/lib/dispute-evidence.ts`): the facts the store holds about a disputed order, the evidence drafted from them,
 * the owner's own version kept as a draft (`commerce.dispute_evidence`, written only here), and the evidence sent to Stripe when, and only when, a
 * person with `orders:write` ticks that they have read it and presses Send. Nothing is sent by itself, by the AI manager or by the autopilot. A
 * send is claimed in the row first, so two presses cannot send twice; a refusal from Stripe gives the claim back and keeps the draft.
 *
 * And who returns a lot (`customerReturns()`): a customer's paid orders in the last year and how many of them had a return or a refund, for the
 * chip on the order and customer pages and the line on the evidence page.
 */

const DISPUTE = z.object({
  id: col.uuid,
  order_id: col.uuid,
  provider: col.text,
  provider_reference: col.text,
  amount_minor: col.minor,
  currency: col.currency,
  reason: col.textOrNull,
  status: col.text,
  evidence_due_by: col.timestampOrNull,
  test_mode: col.bool,
  closed_at: col.timestampOrNull,
  account: col.textOrNull,
  fields: z.record(z.string(), z.unknown()).nullable(),
  saved_at: col.timestampOrNull,
  submitted_at: col.timestampOrNull,
  anonymised: col.bool,
});

export type EvidenceDispute = {
  id: string;
  orderId: string;
  provider: string;
  reference: string;
  amountMinor: number;
  currency: string;
  reason: string | null;
  status: DisputeStatus;
  evidenceDueBy: string | null;
  testMode: boolean;
  closed: boolean;
  /** Evidence can be sent from here: a Stripe dispute that still asks for an answer and has none from here yet. */
  answerable: boolean;
};

async function disputeRow(storeId: string, orderId: string, disputeId: string) {
  if (!z.uuid().safeParse(orderId).success || !z.uuid().safeParse(disputeId).success) return null;
  const row = await typedRow(
    DISPUTE,
    sql`
      select d.id, d.order_id, d.provider, d.provider_reference, d.amount_minor, d.currency, d.reason, d.status, d.evidence_due_by, d.test_mode, d.closed_at,
        p.provider_account as account, e.fields, e.updated_at as saved_at, e.submitted_at, o.anonymised_at is not null as anonymised
      from commerce.payment_disputes d
      join commerce.orders o on o.store_id = d.store_id and o.id = d.order_id
      left join commerce.payments p on p.store_id = d.store_id and p.id = d.payment_id
      left join commerce.dispute_evidence e on e.store_id = d.store_id and e.dispute_id = d.id
      where d.store_id = ${storeId}::uuid and d.order_id = ${orderId}::uuid and d.id = ${disputeId}::uuid
    `,
  );
  if (!row || !isDisputeStatus(row.status)) return null;
  return { ...row, status: row.status };
}

function disputeOf(row: NonNullable<Awaited<ReturnType<typeof disputeRow>>>): EvidenceDispute {
  return {
    id: row.id,
    orderId: row.order_id,
    provider: row.provider,
    reference: row.provider_reference,
    amountMinor: row.amount_minor,
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    evidenceDueBy: row.evidence_due_by,
    testMode: row.test_mode,
    closed: row.closed_at !== null,
    answerable: row.provider === "stripe" && row.closed_at === null && disputeNeedsResponse(row.status) && row.submitted_at === null && !row.anonymised,
  };
}

const ADDRESS = z.object({ name: z.string().nullish(), line1: z.string().nullish(), line2: z.string().nullish(), postalCode: z.string().nullish(), city: z.string().nullish(), country: z.string().nullish() }).nullable();

const FACTS = z.object({
  number: col.text,
  currency: col.currency,
  total_minor: col.minor,
  placed_at: col.timestamp,
  email: col.text,
  customer_id: col.uuid.nullable(),
  billing: z.unknown(),
  shipping: z.unknown(),
  delivered_at: col.timestampOrNull,
  delivered_source: col.textOrNull,
  lines: z.array(z.object({ t: z.string(), q: z.number() })),
  parcels: z.array(z.object({ c: z.string().nullable(), n: z.string().nullable(), at: z.string(), d: z.string().nullable() })),
  refunds: z.array(z.object({ a: z.number(), at: z.string() })),
  earlier: col.int,
  earlier_disputes: col.int,
  messages: z.array(z.object({ at: z.string(), b: z.string() })),
});

const addressText = (value: unknown): { name: string; text: string } => {
  const parsed = ADDRESS.safeParse(value ?? null);
  const a = parsed.success ? parsed.data : null;
  if (!a) return { name: "", text: "" };
  const parts = [a.name, a.line1, a.line2, `${a.postalCode ?? ""} ${a.city ?? ""}`.trim(), a.country].map((p) => (p ?? "").trim()).filter(Boolean);
  return { name: (a.name ?? "").trim(), text: parts.join(", ") };
};

/** Money in the evidence: written for a bank in English, as Stripe passes it on. */
const evidenceMoney = (minor: number, currency: string) => formatMoney(minor, currency, "en-IE");

/** What the store holds about the order that bears on the dispute; null when the order is not the store's. */
export async function evidenceFacts(storeId: string, orderId: string, reason: string | null): Promise<EvidenceFacts | null> {
  const [row, terms, returns] = await Promise.all([
    typedRow(
      FACTS,
      sql`
        select o.number, o.currency, o.total_minor, o.placed_at, o.email, o.customer_id, o.billing_address as billing, o.shipping_address as shipping,
          o.delivered_at, o.delivered_source,
          coalesce((select jsonb_agg(jsonb_build_object('t', ol.title, 'q', ol.quantity) order by ol.title, ol.id)
            from commerce.order_lines ol where ol.store_id = o.store_id and ol.order_id = o.id), '[]'::jsonb) as lines,
          coalesce((select jsonb_agg(jsonb_build_object('c', sh.carrier, 'n', sh.tracking_number, 'at', sh.created_at, 'd', t.delivered_at) order by sh.created_at, sh.id)
            from commerce.shipments sh left join commerce.shipment_tracking t on t.store_id = sh.store_id and t.shipment_id = sh.id
            where sh.store_id = o.store_id and sh.order_id = o.id and sh.method = 'parcel' and sh.undone_at is null), '[]'::jsonb) as parcels,
          coalesce((select jsonb_agg(jsonb_build_object('a', r.amount_minor, 'at', r.created_at) order by r.created_at)
            from commerce.refunds r join commerce.payments rp on rp.store_id = r.store_id and rp.id = r.payment_id
            where r.store_id = o.store_id and rp.order_id = o.id and r.status = 'succeeded'), '[]'::jsonb) as refunds,
          (select count(*)::int from commerce.orders e
            where e.store_id = o.store_id and e.id <> o.id and e.placed_at < o.placed_at and e.copied_from is null
              and e.status in ('paid', 'fulfilled', 'closed') and e.restricted_at is null and e.anonymised_at is null
              and ((o.customer_id is not null and e.customer_id = o.customer_id) or (o.email <> '' and lower(e.email) = lower(o.email)))) as earlier,
          (select count(distinct d.order_id)::int from commerce.payment_disputes d join commerce.orders e on e.store_id = d.store_id and e.id = d.order_id
            where d.store_id = o.store_id and e.id <> o.id and e.placed_at < o.placed_at and not d.test_mode
              and e.restricted_at is null and e.anonymised_at is null
              and ((o.customer_id is not null and e.customer_id = o.customer_id) or (o.email <> '' and lower(e.email) = lower(o.email)))) as earlier_disputes,
          coalesce((select jsonb_agg(jsonb_build_object('at', m.created_at, 'b', m.body) order by m.created_at) from (
            select m.created_at, m.body from commerce.support_messages m
            join commerce.support_conversations c on c.id = m.conversation_id
            where c.store_id = o.store_id and m.store_id = o.store_id and m.author = 'customer' and c.anonymised_at is null and m.body <> ''
              and ((o.customer_id is not null and c.customer_id = o.customer_id) or (o.email <> '' and lower(c.contact_email) = lower(o.email)))
            order by m.created_at desc limit ${EVIDENCE_MESSAGES_MAX}) m), '[]'::jsonb) as messages
        from commerce.orders o
        where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and o.copied_from is null
      `,
    ),
    termsForOrder(storeId, orderId),
    getReturnSettings(storeId),
  ]);
  if (!row) return null;
  const billing = addressText(row.billing);
  const shipping = addressText(row.shipping);
  const source = row.delivered_source;
  return {
    reason,
    orderNumber: row.number,
    placedAt: row.placed_at,
    total: evidenceMoney(row.total_minor, row.currency),
    customerName: shipping.name || billing.name,
    email: row.email,
    billing: billing.text,
    shipping: shipping.text,
    lines: row.lines.map((l) => ({ title: l.t, quantity: l.q })),
    parcels: row.parcels.map((p) => ({ carrier: (p.c ?? "").trim(), tracking: (p.n ?? "").trim(), sentAt: new Date(p.at).toISOString(), deliveredAt: p.d ? new Date(p.d).toISOString() : null })),
    delivered: row.delivered_at && (source === "carrier" || source === "staff" || source === "handover") ? { at: row.delivered_at, by: source } : null,
    terms: terms ? { acceptedAt: terms.acceptedAt.toISOString(), mode: terms.mode, titles: terms.snapshots.map((s) => s.title) } : null,
    returnDays: returns.windowDays,
    refunds: row.refunds.map((r) => ({ amount: evidenceMoney(r.a, row.currency), at: new Date(r.at).toISOString() })),
    earlierOrders: row.earlier,
    earlierDisputes: row.earlier_disputes,
    messages: row.messages.map((m) => ({ at: new Date(m.at).toISOString(), text: m.b })),
  };
}

export type CustomerReturns = { orders: number; returned: number; often: boolean };

const RETURNS = z.object({ orders: col.int, returned: col.int });

/**
 * A customer's paid orders in the last year and how many had a return (not cancelled) or a refund, found by their account or their email (D417).
 * Orders copied from another store are no sale here, and a restricted or anonymised order is no longer the person's: neither is counted.
 */
export async function customerReturns(storeId: string, who: { customerId: string | null; email: string }): Promise<CustomerReturns> {
  const email = normaliseEmail(who.email);
  if (!who.customerId && !email) return { orders: 0, returned: 0, often: false };
  const row = await typedRow(
    RETURNS,
    sql`
      select count(*)::int as orders,
        count(*) filter (where exists (select 1 from commerce.returns r where r.store_id = o.store_id and r.order_id = o.id and r.status <> 'cancelled')
          or exists (select 1 from commerce.refunds f join commerce.payments p on p.store_id = f.store_id and p.id = f.payment_id
            where f.store_id = o.store_id and p.order_id = o.id and f.status = 'succeeded'))::int as returned
      from commerce.orders o
      where o.store_id = ${storeId}::uuid and o.copied_from is null and o.status in ('paid', 'fulfilled', 'closed', 'cancelled')
        and o.restricted_at is null and o.anonymised_at is null
        and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured')
        and o.placed_at > now() - interval '365 days'
        and (${who.customerId}::uuid is not null and o.customer_id = ${who.customerId}::uuid or ${email} <> '' and lower(o.email) = ${email})
    `,
  );
  const history = { orders: row?.orders ?? 0, returned: row?.returned ?? 0 };
  return { ...history, often: returnsOften(history) };
}

export type DisputeEvidenceView = {
  dispute: EvidenceDispute;
  /** What the page shows in the fields: the owner's saved draft, else the draft from the facts. */
  fields: Evidence;
  /** The draft from the facts, for "Start again from the order". */
  drafted: Evidence;
  savedAt: string | null;
  submittedAt: string | null;
  customer: CustomerReturns;
};

const savedFields = (value: Record<string, unknown> | null): Evidence | null => {
  if (!value) return null;
  return Object.fromEntries(EVIDENCE_FIELDS.map((f) => [f, typeof value[f] === "string" ? value[f] : ""])) as Evidence;
};

/** The evidence page's data; null when the dispute is not the order's or the order not the store's. */
export async function disputeEvidence(storeId: string, orderId: string, disputeId: string): Promise<DisputeEvidenceView | null> {
  const row = await disputeRow(storeId, orderId, disputeId);
  if (!row) return null;
  const facts = await evidenceFacts(storeId, orderId, row.reason);
  if (!facts) return null;
  const [who] = await db().execute<{ customer_id: string | null; email: string }>(sql`select customer_id, email from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
  const customer = await customerReturns(storeId, { customerId: who?.customer_id ? String(who.customer_id) : null, email: String(who?.email ?? "") });
  const drafted = draftEvidence(facts);
  return { dispute: disputeOf(row), fields: savedFields(row.fields) ?? drafted, drafted, savedAt: row.saved_at, submittedAt: row.submitted_at, customer };
}

export type EvidenceSaved =
  | { ok: true; sent: boolean }
  | { ok: false; reason: "gone" | "sent_before" | "not_answerable" | "not_connected" | "stripe_refused"; detail?: string }
  | { ok: false; reason: "invalid"; fields: Record<string, string> };

export type EvidenceDeps = { stripeFor?: (storeId: string, account: string | null) => Promise<Pick<Stripe, "disputes"> | null> };

/**
 * Keeps the owner's evidence (`orders:write` is checked by the caller) and, with `send`, sends it to Stripe and submits it: Stripe's answer is final,
 * so the page asks for a tick first. A send needs a Stripe dispute that still asks for an answer; it is claimed in the row before Stripe is asked, and
 * given back when Stripe refuses, so the draft stays and can be sent again.
 */
export async function saveDisputeEvidence(
  storeId: string,
  accountId: string,
  orderId: string,
  disputeId: string,
  input: Record<string, unknown>,
  options: { send: boolean },
  deps: EvidenceDeps = {},
): Promise<EvidenceSaved> {
  const row = await disputeRow(storeId, orderId, disputeId);
  // An anonymised order's personal data is gone, and evidence would bring it back.
  if (!row || row.anonymised) return { ok: false, reason: "gone" };
  if (row.submitted_at) return { ok: false, reason: "sent_before" };
  const parsed = evidenceInput.safeParse(Object.fromEntries(EVIDENCE_FIELDS.map((f) => [f, typeof input[f] === "string" ? input[f] : ""])));
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "uncategorized_text")] ??= issue.message;
    return { ok: false, reason: "invalid", fields };
  }
  const fields = parsed.data as Evidence;
  const [kept] = await db().execute<{ dispute_id: string }>(sql`
    insert into commerce.dispute_evidence (dispute_id, store_id, fields, saved_by)
    values (${disputeId}::uuid, ${storeId}::uuid, ${JSON.stringify(fields)}::jsonb, ${accountId}::uuid)
    on conflict (dispute_id) do update set fields = excluded.fields, saved_by = excluded.saved_by, updated_at = now()
      where commerce.dispute_evidence.submitted_at is null
    returning dispute_id
  `);
  if (!kept) return { ok: false, reason: "sent_before" };
  if (!options.send) return { ok: true, sent: false };

  if (!disputeOf(row).answerable) return { ok: false, reason: "not_answerable" };
  const stripe = await (deps.stripeFor ?? stripeForAccount)(storeId, row.account);
  if (!stripe || !row.account) return { ok: false, reason: "not_connected" };
  // Claimed before Stripe is asked: a second press finds it taken.
  const [claimed] = await db().execute<{ dispute_id: string }>(sql`
    update commerce.dispute_evidence set submitted_at = now(), submitted_by = ${accountId}::uuid
    where store_id = ${storeId}::uuid and dispute_id = ${disputeId}::uuid and submitted_at is null
    returning dispute_id
  `);
  if (!claimed) return { ok: false, reason: "sent_before" };
  const evidence = stripeEvidence(fields);
  try {
    await stripe.disputes.update(row.provider_reference, { evidence, submit: true }, { stripeAccount: row.account });
  } catch (error) {
    await db().execute(sql`update commerce.dispute_evidence set submitted_at = null, submitted_by = null where store_id = ${storeId}::uuid and dispute_id = ${disputeId}::uuid`);
    log("warn", "dispute.evidence_refused", { storeId, disputeId }, error);
    // Stripe's own words for why (a closed dispute, a field it does not take), shown to the person who pressed Send.
    return { ok: false, reason: "stripe_refused", detail: error instanceof Error ? error.message.slice(0, 300) : undefined };
  }
  const sent = Object.keys(evidence);
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${storeId}::uuid, ${orderId}::uuid, 'dispute.evidence_sent', ${JSON.stringify({ dispute: disputeId, amount: row.amount_minor, fields: sent.length })}::jsonb, 'staff')
  `);
  await audit(accountId, storeId, "order.dispute_evidence_sent", { dispute: disputeId, fields: sent }, { target: { type: "order", id: orderId } });
  return { ok: true, sent: true };
}
