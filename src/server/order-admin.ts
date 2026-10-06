import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { ORDER_OPS_EVENTS } from "@/lib/order-ops-events";
import type { Tag } from "@/lib/order-tags";
import { isAdoptedRefund } from "@/lib/refund-adopted";
import { restockRoom } from "@/lib/stock-restock";
import type { PaymentModeName } from "@/lib/stripe-account";

import { cancelUnpaidOrder } from "./checkout";
import { reverseHostCommission } from "./host-payments";
import { getOrder, type Address, type OrderView } from "./orders";
import { accountMayRecordOutside } from "./order-settings";
import { getOrderTags } from "./order-tags";
import { isDeliveryOrder } from "./standing-orders";
import { applyRestock, orderStockHistory, planRestock } from "./stock-restock";
import { platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Everything staff do with an order after it is paid (decision D27): send
 * it with tracking, refund all or part through Stripe (putting items back in
 * stock), cancel it, correct the address, and keep notes. Every change is
 * written to the order's history.
 */

export type OrderLineAdmin = OrderView["lines"][number] & {
  /** The market's list price as shown when a draft's line was added (D173), for staff only: a buyer is never shown a "was" price. Null for every other line. */
  listPriceMinor: number | null;
  /** Units already put back in stock. */
  restocked: number;
  /**
   * Units that can still be put back: the line's quantity less what went back, and never more than the order's own sale movements
   * took (a short draw, wave 3 D172: the hold expired and the stock was sold, so the order took less than it was for).
   */
  restockable: number;
};

export type Shipment = {
  id: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string | null;
  createdAt: string;
  /** Booked through a carrier's connection (D134): which, and whether its label can be fetched again. */
  carrierId: string | null;
  hasLabel: boolean;
};

export type RefundRow = {
  id: string;
  amountMinor: number;
  reason: string;
  status: string;
  restocked: { sku: string; quantity: number }[];
  createdAt: string;
  by: string | null;
};

/**
 * What a copied order (D129) answers to anything that would change it. The database refuses these too (triggers
 * on the order, its lines and everything that acts on an order), so this is the plain reason, not the only guard.
 */
export const COPIED_ORDER_MESSAGE = "This order is history copied from another store, so it is read-only.";

export type OrderAdmin = Omit<OrderView, "lines"> & {
  lines: OrderLineAdmin[];
  shipments: Shipment[];
  refunds: RefundRow[];
  /** Taken from the shopper, and what is left to refund. */
  paidMinor: number;
  refundedMinor: number;
  refundableMinor: number;
  /**
   * Kaizen can refund it: paid through Stripe Connect (the money goes back through Stripe), or taken outside Kaizen (D173, a payment recorded on a draft order): then
   * the refund is only RECORDED here, staff pay the customer back themselves (`refundOrder()`, no Stripe call).
   */
  canRefund: boolean;
  /** The money was taken outside Kaizen (D173): how, and when it was recorded. A refund of it is recorded, never sent. */
  paidOutside: { method: "cash" | "bank_transfer" | "other"; recordedAt: string } | null;
  /** Staff tags on the order (D173); staff text, never shown to a shopper. */
  tags: Tag[];
  /** Archived (D173): a visibility state only. */
  archivedAt: string | null;
  /** `draft` for a staff-made order (D173), with the draft it came from and who sent or paid it. */
  source: "checkout" | "draft";
  draft: { id: string; number: string | null } | null;
  madeBy: { id: string; email: string } | null;
};

export async function getOrderAdmin(storeId: string, orderId: string): Promise<OrderAdmin | null> {
  const order = await getOrder(storeId, orderId);
  if (!order) return null;
  const [restocks, shipments, refunds, [paid], tags, [origin], listPrices] = await Promise.all([
    db().execute<Row>(sql`
      select item ->> 'sku' as sku, sum((item ->> 'quantity')::int)::int as quantity
      from commerce.order_events e, jsonb_array_elements(e.data -> 'restocked') item
      where e.store_id = ${storeId}::uuid and e.order_id = ${orderId}::uuid
        and e.type in ('order.refunded', 'order.restocked')
      group by 1
    `),
    db().execute<Row>(sql`
      select id, carrier, tracking_number, tracking_url, created_at, carrier_id, label_url is not null as has_label from commerce.shipments
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid order by created_at
    `),
    db().execute<Row>(sql`
      select r.id, r.amount_minor, r.reason, r.status, r.restocked, r.created_at, a.email as by
      from commerce.refunds r
      join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
      left join commerce.accounts a on a.id = r.created_by
      where r.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid
      order by r.created_at
    `),
    db().execute<Row>(sql`
      select coalesce(sum(amount_minor) filter (where status = 'captured'), 0)::bigint as paid,
             -- Paid at the venue (D66) is paid back there too: only Stripe's, and a payment recorded outside Kaizen (D173, refunded by being recorded), can be refunded here.
             coalesce(sum(amount_minor) filter (where status = 'captured' and provider in ('stripe', 'manual')), 0)::bigint as online,
             bool_or(status = 'captured' and provider_account is not null) as connect,
             bool_or(status = 'captured' and provider = 'manual') as manual,
             (array_agg(method order by created_at) filter (where provider = 'manual' and status = 'captured'))[1] as manual_method,
             min(created_at) filter (where provider = 'manual' and status = 'captured') as manual_at
      from commerce.payments where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid
    `),
    getOrderTags(storeId, orderId),
    db().execute<Row>(sql`
      select o.archived_at, o.source, o.draft_id, d.number as draft_number, o.made_by, a.email as made_by_email
      from commerce.orders o
      left join commerce.draft_orders d on d.store_id = o.store_id and d.id = o.draft_id
      left join commerce.accounts a on a.id = o.made_by
      where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
    `),
    db().execute<Row>(sql`
      select id, list_price_minor from commerce.order_lines
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and list_price_minor is not null
    `),
  ]);
  const refundRows: RefundRow[] = refunds.map((r) => ({
    id: String(r.id),
    amountMinor: Number(r.amount_minor),
    reason: String(r.reason),
    status: String(r.status),
    restocked: (r.restocked ?? []) as { sku: string; quantity: number }[],
    createdAt: new Date(String(r.created_at)).toISOString(),
    by: r.by ? String(r.by) : null,
  }));
  const restockedBySku = new Map(restocks.map((r) => [String(r.sku), Number(r.quantity)]));
  const goods = order.lines.filter((l) => l.variantId && l.delivery === "physical");
  const history = await orderStockHistory(db(), storeId, orderId, [...new Set(goods.map((l) => String(l.variantId)))]);
  const room = restockRoom(
    goods.map((l) => ({ id: l.id, variantId: String(l.variantId), quantity: l.quantity, restocked: restockedBySku.get(l.sku) ?? 0 })),
    history,
  );
  const refunded = refundRows.filter((r) => r.status !== "failed").reduce((sum, r) => sum + r.amountMinor, 0);
  const paidMinor = Number(paid?.paid ?? 0);
  const onlineMinor = Number(paid?.online ?? 0);
  const listPriceOf = new Map(listPrices.map((l) => [String(l.id), Number(l.list_price_minor)]));
  return {
    ...order,
    lines: order.lines.map((line) => ({
      ...line,
      listPriceMinor: listPriceOf.get(line.id) ?? null,
      restocked: restockedBySku.get(line.sku) ?? 0,
      restockable: room.get(line.id) ?? 0,
    })),
    shipments: shipments.map((s) => ({
      id: String(s.id),
      carrier: String(s.carrier),
      trackingNumber: String(s.tracking_number),
      trackingUrl: s.tracking_url ? String(s.tracking_url) : null,
      createdAt: new Date(String(s.created_at)).toISOString(),
      carrierId: s.carrier_id ? String(s.carrier_id) : null,
      hasLabel: Boolean(s.has_label),
    })),
    refunds: refundRows,
    paidMinor,
    refundedMinor: refunded,
    refundableMinor: Math.max(0, onlineMinor - refunded),
    canRefund: Boolean(paid?.connect) || Boolean(paid?.manual),
    paidOutside: paid?.manual
      ? { method: String(paid.manual_method) as "cash" | "bank_transfer" | "other", recordedAt: new Date(String(paid.manual_at)).toISOString() }
      : null,
    tags,
    archivedAt: origin?.archived_at ? new Date(String(origin.archived_at)).toISOString() : null,
    source: origin?.source === "draft" ? "draft" : "checkout",
    draft: origin?.draft_id ? { id: String(origin.draft_id), number: origin.draft_number ? String(origin.draft_number) : null } : null,
    madeBy: origin?.made_by ? { id: String(origin.made_by), email: String(origin.made_by_email ?? "") } : null,
  };
}

async function event(storeId: string, orderId: string, type: string, data: Record<string, unknown>, actor: string) {
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${storeId}::uuid, ${orderId}::uuid, ${type}, ${JSON.stringify(data)}::jsonb, ${actor})
  `);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Carriers shoppers in Norway, Sweden and Denmark know, with their tracking pages. */
export const CARRIERS: { id: string; name: string; url: ((n: string) => string) | null }[] = [
  { id: "posten", name: "Posten", url: (n) => `https://sporing.posten.no/sporing/${encodeURIComponent(n)}` },
  { id: "bring", name: "Bring", url: (n) => `https://sporing.bring.no/sporing/${encodeURIComponent(n)}` },
  { id: "porterbuddy", name: "Porterbuddy", url: null },
  { id: "helthjem", name: "Helthjem", url: null },
  { id: "postnord", name: "PostNord", url: (n) => `https://tracking.postnord.com/tracking?id=${encodeURIComponent(n)}` },
  { id: "dhl", name: "DHL", url: (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encodeURIComponent(n)}` },
  { id: "ups", name: "UPS", url: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}` },
  { id: "other", name: "Other", url: null },
];

export type SendInput = { carrier: string; trackingNumber: string; trackingUrl: string | null };

/** The tracking page for a parcel: the one typed, else the carrier's own. */
export function trackingUrl(input: SendInput): string | null {
  if (input.trackingUrl) return /^https:\/\/\S+$/.test(input.trackingUrl) ? input.trackingUrl : null;
  const carrier = CARRIERS.find((c) => c.id === input.carrier);
  return carrier?.url && input.trackingNumber ? carrier.url(input.trackingNumber) : null;
}

type SentTx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Whether every physical unit of the order was withdrawn before anything was sent (D153): the consumer withdrew from the
 * contract, so the parcel is not sent. An order with a shipment already is never stopped (goods that are on their way, or a
 * replacement, are the store's business).
 */
export async function withdrawnInFull(tx: SentTx | ReturnType<typeof db>, storeId: string, orderId: string): Promise<boolean> {
  const [row] = await tx.execute<Row>(sql`
    select exists (select 1 from commerce.order_lines ol where ol.store_id = ${storeId}::uuid and ol.order_id = ${orderId}::uuid and ol.delivery = 'physical')
       and not exists (select 1 from commerce.order_lines ol
                       where ol.store_id = ${storeId}::uuid and ol.order_id = ${orderId}::uuid and ol.delivery = 'physical'
                         and commerce.returned_quantity(ol.id) < ol.quantity)
       and not exists (select 1 from commerce.shipments sh where sh.store_id = ${storeId}::uuid and sh.order_id = ${orderId}::uuid) as whole
  `);
  return Boolean(row?.whole);
}

/** Records the parcel and marks the order as sent. Null if the order is not paid, or every unit of it was withdrawn before sending. */
export async function markSent(
  storeId: string,
  orderId: string,
  input: SendInput,
  accountId: string | null,
  /** A shipment booked through a carrier's connection (D134): kept to fetch its label and follow it. */
  booking?: { carrierId: string; consignmentNumber: string | null; labelUrl: string | null },
): Promise<Shipment | null> {
  return db().transaction(async (tx) => {
    const [order] = await tx.execute<Row>(sql`
      select status, copied_from is not null as copied from commerce.orders
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update
    `);
    if (!order || Boolean(order.copied) || !["paid", "fulfilled"].includes(String(order.status))) return null;
    // Every unit was withdrawn before anything was sent (D153): there is nothing left to send.
    if (await withdrawnInFull(tx, storeId, orderId)) return null;
    const carrierName = CARRIERS.find((c) => c.id === input.carrier)?.name ?? input.carrier;
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.shipments (
        store_id, order_id, carrier, tracking_number, tracking_url, created_by, carrier_id, consignment_number, label_url
      )
      values (${storeId}::uuid, ${orderId}::uuid, ${input.carrier === "other" ? "" : carrierName},
              ${input.trackingNumber}, ${trackingUrl(input)}, ${accountId}::uuid,
              ${booking?.carrierId ?? null}, ${booking?.consignmentNumber ?? null}, ${booking?.labelUrl ?? null})
      returning id, carrier, tracking_number, tracking_url, created_at, carrier_id, label_url is not null as has_label
    `);
    // Goods sent in parts are received when the last part is (CRD Art. 9(2)(b)): a part sent after the receipt was recorded
    // means the receipt is not complete, so the date is taken back and the consumer's 14 days start again when it is recorded.
    const [reset] = await tx.execute<Row>(sql`
      update commerce.orders o set status = 'fulfilled', delivered_at = null
      from (select delivered_at from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid) before
      where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
      returning before.delivered_at as was_delivered_at
    `);
    if (reset?.was_delivered_at) {
      await tx.execute(sql`
        insert into commerce.order_events (store_id, order_id, type, data, actor)
        values (${storeId}::uuid, ${orderId}::uuid, 'order.delivery_reopened',
                ${JSON.stringify({ was: new Date(String(reset.was_delivered_at)).toISOString() })}::jsonb, 'system')
      `);
    }
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'order.sent',
              ${JSON.stringify({ carrier: row.carrier, tracking: row.tracking_number })}::jsonb, 'staff')
    `);
    return {
      id: String(row.id),
      carrier: String(row.carrier),
      trackingNumber: String(row.tracking_number),
      trackingUrl: row.tracking_url ? String(row.tracking_url) : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
      carrierId: row.carrier_id ? String(row.carrier_id) : null,
      hasLabel: Boolean(row.has_label),
    };
  });
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export type RefundInput = {
  amountMinor: number;
  reason: string;
  /**
   * Units to put back in stock, per order line. Without a `locationId` they go back to the location(s) they were taken from (wave 3,
   * D172: `restockPlan()`); with one, to that active location of the store.
   */
  restock: { lineId: string; quantity: number; locationId?: string | null }[];
};

export type RefundOutcome =
  | { ok: true; refundId: string; amountMinor: number; unpaid?: boolean; status?: string }
  | { ok: false; problem: string };

/**
 * What a caller that refunds for a reason of its own, such as a return (D153), may add to `refundOrder()`: it never
 * duplicates the Stripe code, it only hooks into it.
 */
export type RefundOptions = {
  /** Stripe's idempotency key for the refund; the default is made from the order and its refunds so far. */
  idempotencyKey?: string;
  /**
   * Runs in the same transaction that records the refund and puts the stock back, with the refund's id (empty when no
   * money was sent) and its status, so the caller's own record of the refund is written or not with it.
   */
  inTransaction?: (tx: Tx, result: { refundId: string; status: string }) => Promise<void>;
  /** More data on the order's history event, such as the return's id. */
  eventData?: Record<string, unknown>;
  /** The return this refund is for (D153): the units go back as `return_restock` movements that carry its id. */
  returnId?: string;
  /**
   * The money is refunded outside Kaizen's Stripe (the order was paid some other way): nothing is sent from here, only the
   * stock goes back and the order's history says so. The amount must be 0.
   */
  outside?: boolean;
};

/** The Stripe payment behind an order's payment row: its PaymentIntent, on the store's account. */
async function paymentIntentFor(
  stripe: Stripe,
  reference: string,
  stripeAccount: string,
): Promise<string | null> {
  const options = { stripeAccount };
  const id = (value: string | { id: string } | null | undefined) =>
    typeof value === "string" ? value : (value?.id ?? null);
  let invoiceId: string | null = null;
  // A charge made on its own, such as a no-show fee (D66).
  if (reference.startsWith("pi_")) return reference;
  if (reference.startsWith("cs_")) {
    const session = await stripe.checkout.sessions.retrieve(reference, {}, options);
    if (session.payment_intent) return id(session.payment_intent);
    invoiceId = id(session.invoice);
  } else if (reference.startsWith("in_")) {
    invoiceId = reference;
  }
  if (!invoiceId) return null;
  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] }, options);
  const payment = invoice.payments?.data?.find((p) => p.status === "paid") ?? invoice.payments?.data?.[0];
  return id(payment?.payment?.payment_intent);
}

/**
 * Stripe's idempotency key for a refund staff make: the order, the refunds Kaizen itself made so far and the amount, so a retry after a
 * failed write replays the same Stripe refund and a deliberate second refund of the same amount gets a new key. Rows the webhook
 * recorded for refunds made in Stripe (`isAdoptedRefund`) are not counted: one written for the very refund of an earlier try would
 * otherwise change the key of the retry, and Stripe would make the refund a second time (D159).
 */
export function refundKey(orderId: string, refunds: readonly Pick<RefundRow, "reason">[], amountMinor: number): string {
  return `refund-${orderId}-${refunds.filter((r) => !isAdoptedRefund(r.reason)).length}-${amountMinor}`;
}

/**
 * Refunds part or all of what was paid, through Stripe on the store's
 * account (Kaizen's fee on the refunded part goes back to the store), and
 * puts the chosen items back in stock.
 */
export async function refundOrder(
  storeId: string,
  orderId: string,
  input: RefundInput,
  accountId: string | null,
  options: RefundOptions = {},
): Promise<RefundOutcome> {
  const order = await getOrderAdmin(storeId, orderId);
  if (!order) return { ok: false, problem: "This order no longer exists." };
  if (order.copied) return { ok: false, problem: COPIED_ORDER_MESSAGE };
  if (options.outside && input.amountMinor !== 0) return { ok: false, problem: "Nothing is sent from here for a refund made outside Stripe." };
  if (!order.canRefund && !options.outside) return { ok: false, problem: "This order was not paid through Kaizen's Stripe, so refund it in Stripe." };
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0 || input.amountMinor > order.refundableMinor) {
    return { ok: false, problem: "The amount is more than is left to refund." };
  }
  const restock: { sku: string; quantity: number; variantId: string; chosen: string | null }[] = [];
  for (const item of input.restock) {
    const line = order.lines.find((l) => l.id === item.lineId);
    if (!line || item.quantity <= 0) continue;
    if (!line.variantId || line.delivery !== "physical") continue;
    if (item.quantity > line.restockable) {
      return { ok: false, problem: `Only ${line.restockable} of ${line.title} can go back in stock.` };
    }
    restock.push({ sku: line.sku, quantity: item.quantity, variantId: line.variantId, chosen: item.locationId ?? null });
  }
  if (input.amountMinor === 0 && restock.length === 0) return { ok: false, problem: "Enter an amount to refund." };
  // Where the units go back is settled before any money moves: a place that is not the store's, or more units than the order took, refuses the whole refund.
  if (restock.length > 0) {
    const planned = await planRestock(db(), storeId, orderId, restock);
    if (!planned.ok) return { ok: false, problem: planned.problem };
  }

  const [payment] = options.outside
    ? []
    : await db().execute<Row>(sql`
        select p.id, p.provider_reference, p.provider_account, a.mode
        from commerce.payments p
        join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
        where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.status = 'captured' and p.provider = 'stripe'
        order by p.created_at limit 1
      `);
  // Money taken outside Kaizen (D173, a draft order paid by bank transfer or in cash) is refunded outside too: the refund is RECORDED here, as `succeeded`, with no call to
  // Stripe, and the credit note follows from the refund by the database's own trigger (D159). Staff pay the customer back themselves.
  const [manual] =
    options.outside || payment
      ? []
      : await db().execute<Row>(sql`
          select p.id from commerce.payments p
          where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.status = 'captured' and p.provider = 'manual'
          order by p.created_at limit 1
        `);
  const recorded = Boolean(manual);
  // Who may record a refund of money taken outside Kaizen is who may record the payment: the owner, or staff when the owner allows it (D173). A refund through Stripe is any staff member's.
  if (recorded && !(await accountMayRecordOutside(storeId, accountId))) {
    return { ok: false, problem: "Only the owner can record a refund of a payment taken outside Kaizen, unless the owner has allowed staff to." };
  }
  const refundPayment = payment ?? manual;
  const stripe = payment ? platformStripe(payment.mode as PaymentModeName) : null;
  if (!options.outside && !recorded && (!payment || !stripe)) return { ok: false, problem: "Stripe cannot be reached for this store right now." };

  let providerReference: string | null = null;
  let status = "succeeded";
  if (input.amountMinor > 0 && recorded) {
    providerReference = `manual_refund_${randomUUID()}`;
  } else if (input.amountMinor > 0) {
    try {
      const stripeAccount = String(payment.provider_account);
      const paymentIntent = await paymentIntentFor(stripe!, String(payment.provider_reference), stripeAccount);
      if (!paymentIntent) return { ok: false, problem: "Stripe has no payment to refund for this order." };
      const refund = await stripe!.refunds.create(
        {
          payment_intent: paymentIntent,
          amount: input.amountMinor,
          reason: "requested_by_customer",
          refund_application_fee: true,
          metadata: { order_id: orderId, order_number: order.number },
        },
        { stripeAccount, idempotencyKey: options.idempotencyKey ?? refundKey(orderId, order.refunds, input.amountMinor) },
      );
      providerReference = refund.id;
      status = refund.status === "failed" || refund.status === "canceled" ? "failed" : refund.status === "succeeded" ? "succeeded" : "pending";
    } catch (error) {
      return {
        ok: false,
        problem: error instanceof Error && "type" in error ? `Stripe said: ${error.message}` : "Stripe could not make the refund.",
      };
    }
  }

  let refundId: string;
  try {
  refundId = await db().transaction(async (tx) => {
    let id = "";
    // Money taken outside Kaizen has no Stripe to stop a refund above what was paid, so the cap is held HERE, under the order's row lock: two refunds at the same moment (two staff, a double click) are
    // serialised, and the second sees the first (the amount read before the transaction, in `getOrderAdmin()`, is only for the form). The database refuses the same sum too (`commerce.refunds_manual_cap()`).
    if (recorded && input.amountMinor > 0) {
      await tx.execute(sql`select id from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update`);
      const [left] = await tx.execute<Row>(sql`
        select (select coalesce(sum(p.amount_minor), 0) from commerce.payments p
                where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.status = 'captured' and p.provider in ('stripe', 'manual'))
             - (select coalesce(sum(r.amount_minor), 0) from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
                where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and r.status <> 'failed') as left_minor
      `);
      if (input.amountMinor > Number(left?.left_minor ?? 0)) throw new RefundOverCap();
    }
    // The webhook may have recorded this very refund already (a refund Stripe accepted whose row an earlier try failed to write: its event
    // writes the row after a grace period). The same key then gave back the same refund, and its row is claimed here, never made twice.
    let adopted = false;
    if (input.amountMinor > 0) {
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, restocked, created_by)
        values (${storeId}::uuid, ${String(refundPayment!.id)}::uuid, ${input.amountMinor}, ${input.reason},
                ${providerReference}, ${status}::commerce.refund_status,
                ${JSON.stringify(restock.map(({ sku, quantity }) => ({ sku, quantity })))}::jsonb, ${accountId}::uuid)
        on conflict (store_id, provider_reference) do nothing
        returning id
      `);
      if (row) {
        id = String(row.id);
      } else {
        const [existing] = await tx.execute<Row>(sql`
          update commerce.refunds set reason = ${input.reason}, created_by = ${accountId}::uuid,
            restocked = ${JSON.stringify(restock.map(({ sku, quantity }) => ({ sku, quantity })))}::jsonb
          where store_id = ${storeId}::uuid and provider_reference = ${providerReference} and payment_id = ${String(refundPayment!.id)}::uuid
          returning id
        `);
        if (!existing) throw new Error("The refund's Stripe id belongs to another payment.");
        id = String(existing.id);
        adopted = true;
      }
    }
    // The units go back inside this transaction, each change a movement that says why (D172); planned again here, under the locks, from what the order took.
    let restockedParts: { sku: string; quantity: number; locationId: string }[] = [];
    if (restock.length > 0) {
      const fresh = await planRestock(tx, storeId, orderId, restock);
      if (!fresh.ok) throw new Error(fresh.problem);
      await applyRestock(tx, storeId, fresh.items, {
        reason: options.returnId ? "return_restock" : "order_restock",
        source: options.returnId ? "return" : "order",
        accountId,
        orderId,
        returnId: options.returnId ?? null,
      });
      restockedParts = fresh.items.flatMap((item) => item.parts.map((part) => ({ sku: item.sku, quantity: part.quantity, locationId: part.locationId })));
    }
    // An adopted refund has its `order.refunded` event already (written by the webhook); only the stock going back is new.
    if (!adopted || restock.length > 0) {
      await tx.execute(sql`
        insert into commerce.order_events (store_id, order_id, type, data, actor)
        values (${storeId}::uuid, ${orderId}::uuid, ${input.amountMinor > 0 && !adopted ? "order.refunded" : "order.restocked"},
                ${JSON.stringify({
                  amount: adopted ? 0 : input.amountMinor,
                  reason: input.reason,
                  restocked: restockedParts,
                  // A refund Stripe reported as failed is kept as a row too; a caller that retries (a return) counts these.
                  ...(input.amountMinor > 0 && status === "failed" ? { status } : {}),
                  ...options.eventData,
                })}::jsonb, 'staff')
      `);
    }
    // A refund recorded outside Kaizen (D173) also says so in the order's history, in words that name no one: `data.note` is the reason (the one free-text key the erasure removes).
    if (recorded && input.amountMinor > 0) {
      await tx.execute(sql`
        insert into commerce.order_events (store_id, order_id, type, data, actor)
        values (${storeId}::uuid, ${orderId}::uuid, ${ORDER_OPS_EVENTS.refundedOutside}, ${JSON.stringify({ amount: input.amountMinor, note: input.reason })}::jsonb, 'staff')
      `);
    }
    await options.inTransaction?.(tx, { refundId: id, status });
    return id;
  });
  } catch (error) {
    if (error instanceof RefundOverCap) return { ok: false, problem: "The amount is more than is left to refund." };
    throw error;
  }
  // A host's order (D71): the store gives back the refunded share of its commission.
  if (input.amountMinor > 0 && status !== "failed" && payment) await reverseHostCommission(storeId, String(payment.id));
  return { ok: true, refundId, amountMinor: input.amountMinor, status };
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** A refund of money taken outside Kaizen that would take the refunds above what was paid (found under the order's lock). */
class RefundOverCap extends Error {}

/**
 * Cancels a paid order that has not been sent: refunds what is left, puts
 * every item back in stock and stops its download links.
 */
export async function cancelOrder(
  storeId: string,
  orderId: string,
  reason: string,
  accountId: string | null,
): Promise<RefundOutcome> {
  const order = await getOrderAdmin(storeId, orderId);
  if (!order) return { ok: false, problem: "This order no longer exists." };
  if (order.copied) return { ok: false, problem: COPIED_ORDER_MESSAGE };
  // A weekly delivery not yet sent (D102) is not charged yet: cancelling it lets its stock go.
  if (order.status === "pending_payment" && (await isDeliveryOrder(storeId, orderId))) {
    await cancelUnpaidOrder(orderId, `cancelled by staff: ${reason}`);
    await event(storeId, orderId, "order.cancelled_by_staff", { reason, refunded: 0 }, "staff");
    return { ok: true, refundId: "", amountMinor: 0, unpaid: true };
  }
  if (order.status !== "paid") {
    return { ok: false, problem: order.status === "fulfilled" ? "The order is already sent: refund it instead." : "Only paid orders can be cancelled." };
  }
  const restock = order.lines
    .filter((l) => l.variantId && l.delivery === "physical" && l.restockable > 0)
    .map((l) => ({ lineId: l.id, quantity: l.restockable }));
  if (order.refundableMinor > 0 || restock.length > 0) {
    const refunded = await refundOrder(storeId, orderId, { amountMinor: order.refundableMinor, reason, restock }, accountId);
    if (!refunded.ok) return refunded;
  }
  await db().execute(sql`
    update commerce.orders set status = 'cancelled', balance_minor = 0 where store_id = ${storeId}::uuid and id = ${orderId}::uuid
  `);
  await db().execute(sql`
    update commerce.order_downloads set expires_at = now()
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and (expires_at is null or expires_at > now())
  `);
  await event(storeId, orderId, "order.cancelled_by_staff", { reason, refunded: order.refundableMinor }, "staff");
  return { ok: true, refundId: "", amountMinor: order.refundableMinor };
}

// ---------------------------------------------------------------------------
// Details and notes
// ---------------------------------------------------------------------------

export async function updateOrderContact(
  storeId: string,
  orderId: string,
  input: { email: string; shippingAddress: Address },
): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    update commerce.orders set email = ${input.email},
      shipping_address = shipping_address || ${JSON.stringify(input.shippingAddress)}::jsonb
    where store_id = ${storeId}::uuid and id = ${orderId}::uuid and status <> 'pending_payment' and copied_from is null
      and anonymised_at is null
    returning id
  `);
  if (!row) return false;
  await event(storeId, orderId, "order.edited", { fields: ["email", "shipping_address"] }, "staff");
  return true;
}

export async function addOrderNote(storeId: string, orderId: string, note: string, by: string): Promise<void> {
  const [copied] = await db().execute<Row>(sql`
    select 1 from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid and copied_from is not null
  `);
  if (copied) throw new Error(COPIED_ORDER_MESSAGE);
  await event(storeId, orderId, "note.added", { note, by }, "staff");
}

export const VENUE_METHODS = ["card", "cash", "other"] as const;
export type VenueMethod = (typeof VENUE_METHODS)[number];

/**
 * Records what was left to pay at the venue as paid (D66): an order paid
 * entirely there keeps its one payment, now taken; after a deposit, the rest
 * is a payment of its own. False if nothing was left to pay.
 */
export async function markBalancePaid(
  storeId: string,
  orderId: string,
  method: VenueMethod,
  accountId: string | null,
): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [order] = await tx.execute<Row>(sql`
      select balance_minor, currency from commerce.orders
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid and status in ('paid', 'fulfilled') and balance_minor > 0
        and copied_from is null
      for update
    `);
    if (!order) return false;
    const balance = Number(order.balance_minor);
    const [waiting] = await tx.execute<Row>(sql`
      update commerce.payments set status = 'captured', amount_minor = ${balance}, updated_at = now()
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'venue' and status = 'pending'
      returning id
    `);
    if (!waiting) {
      await tx.execute(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
        values (${storeId}::uuid, ${orderId}::uuid, 'venue', ${`venue_${orderId}_${Date.now()}`}, ${balance},
                ${String(order.currency)}, 'captured')
      `);
    }
    await tx.execute(sql`
      update commerce.orders set balance_minor = 0 where store_id = ${storeId}::uuid and id = ${orderId}::uuid
    `);
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'order.balance_paid',
              ${JSON.stringify({ amount: balance, method, by: accountId })}::jsonb, 'staff')
    `);
    return true;
  });
}
