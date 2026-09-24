import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import type { PaymentModeName } from "@/lib/stripe-account";

import { getOrder, type Address, type OrderView } from "./orders";
import { platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Everything staff do with an order after it is paid (decision D27): send
 * it with tracking, refund all or part through Stripe (putting items back in
 * stock), cancel it, correct the address, and keep notes. Every change is
 * written to the order's history.
 */

export type OrderLineAdmin = OrderView["lines"][number] & {
  /** Units already put back in stock. */
  restocked: number;
};

export type Shipment = {
  id: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string | null;
  createdAt: string;
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

export type OrderAdmin = Omit<OrderView, "lines"> & {
  lines: OrderLineAdmin[];
  shipments: Shipment[];
  refunds: RefundRow[];
  /** Taken from the shopper, and what is left to refund. */
  paidMinor: number;
  refundedMinor: number;
  refundableMinor: number;
  /** Paid through Stripe Connect, so Kaizen can refund it. */
  canRefund: boolean;
};

export async function getOrderAdmin(storeId: string, orderId: string): Promise<OrderAdmin | null> {
  const order = await getOrder(storeId, orderId);
  if (!order) return null;
  const [restocks, shipments, refunds, [paid]] = await Promise.all([
    db().execute<Row>(sql`
      select item ->> 'sku' as sku, sum((item ->> 'quantity')::int)::int as quantity
      from commerce.order_events e, jsonb_array_elements(e.data -> 'restocked') item
      where e.store_id = ${storeId}::uuid and e.order_id = ${orderId}::uuid
        and e.type in ('order.refunded', 'order.restocked')
      group by 1
    `),
    db().execute<Row>(sql`
      select id, carrier, tracking_number, tracking_url, created_at from commerce.shipments
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
             bool_or(status = 'captured' and provider_account is not null) as connect
      from commerce.payments where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid
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
  const refunded = refundRows.filter((r) => r.status !== "failed").reduce((sum, r) => sum + r.amountMinor, 0);
  const paidMinor = Number(paid?.paid ?? 0);
  return {
    ...order,
    lines: order.lines.map((line) => ({ ...line, restocked: restockedBySku.get(line.sku) ?? 0 })),
    shipments: shipments.map((s) => ({
      id: String(s.id),
      carrier: String(s.carrier),
      trackingNumber: String(s.tracking_number),
      trackingUrl: s.tracking_url ? String(s.tracking_url) : null,
      createdAt: new Date(String(s.created_at)).toISOString(),
    })),
    refunds: refundRows,
    paidMinor,
    refundedMinor: refunded,
    refundableMinor: Math.max(0, paidMinor - refunded),
    canRefund: Boolean(paid?.connect),
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

/** Records the parcel and marks the order as sent. False if the order is not paid. */
export async function markSent(
  storeId: string,
  orderId: string,
  input: SendInput,
  accountId: string | null,
): Promise<Shipment | null> {
  return db().transaction(async (tx) => {
    const [order] = await tx.execute<Row>(sql`
      select status from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update
    `);
    if (!order || !["paid", "fulfilled"].includes(String(order.status))) return null;
    const carrierName = CARRIERS.find((c) => c.id === input.carrier)?.name ?? input.carrier;
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.shipments (store_id, order_id, carrier, tracking_number, tracking_url, created_by)
      values (${storeId}::uuid, ${orderId}::uuid, ${input.carrier === "other" ? "" : carrierName},
              ${input.trackingNumber}, ${trackingUrl(input)}, ${accountId}::uuid)
      returning id, carrier, tracking_number, tracking_url, created_at
    `);
    await tx.execute(sql`
      update commerce.orders set status = 'fulfilled' where store_id = ${storeId}::uuid and id = ${orderId}::uuid
    `);
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
    };
  });
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export type RefundInput = {
  amountMinor: number;
  reason: string;
  /** Units to put back in stock, per order line. */
  restock: { lineId: string; quantity: number }[];
};

export type RefundOutcome =
  | { ok: true; refundId: string; amountMinor: number }
  | { ok: false; problem: string };

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
 * Refunds part or all of what was paid, through Stripe on the store's
 * account (Kaizen's fee on the refunded part goes back to the store), and
 * puts the chosen items back in stock.
 */
export async function refundOrder(
  storeId: string,
  orderId: string,
  input: RefundInput,
  accountId: string | null,
): Promise<RefundOutcome> {
  const order = await getOrderAdmin(storeId, orderId);
  if (!order) return { ok: false, problem: "This order no longer exists." };
  if (!order.canRefund) return { ok: false, problem: "This order was not paid through Kaizen's Stripe, so refund it in Stripe." };
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0 || input.amountMinor > order.refundableMinor) {
    return { ok: false, problem: "The amount is more than is left to refund." };
  }
  const restock: { sku: string; quantity: number; variantId: string }[] = [];
  for (const item of input.restock) {
    const line = order.lines.find((l) => l.id === item.lineId);
    if (!line || item.quantity <= 0) continue;
    if (!line.variantId || line.delivery === "digital") continue;
    if (item.quantity > line.quantity - line.restocked) {
      return { ok: false, problem: `Only ${line.quantity - line.restocked} of ${line.title} can go back in stock.` };
    }
    restock.push({ sku: line.sku, quantity: item.quantity, variantId: line.variantId });
  }
  if (input.amountMinor === 0 && restock.length === 0) return { ok: false, problem: "Enter an amount to refund." };

  const [payment] = await db().execute<Row>(sql`
    select p.id, p.provider_reference, p.provider_account, a.mode
    from commerce.payments p
    join commerce.stripe_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
    where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.status = 'captured'
    order by p.created_at limit 1
  `);
  const stripe = payment ? platformStripe(payment.mode as PaymentModeName) : null;
  if (!payment || !stripe) return { ok: false, problem: "Stripe cannot be reached for this store right now." };

  let providerReference: string | null = null;
  let status = "succeeded";
  if (input.amountMinor > 0) {
    try {
      const stripeAccount = String(payment.provider_account);
      const paymentIntent = await paymentIntentFor(stripe, String(payment.provider_reference), stripeAccount);
      if (!paymentIntent) return { ok: false, problem: "Stripe has no payment to refund for this order." };
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntent,
          amount: input.amountMinor,
          reason: "requested_by_customer",
          refund_application_fee: true,
          metadata: { order_id: orderId, order_number: order.number },
        },
        { stripeAccount, idempotencyKey: `refund-${orderId}-${order.refunds.length}-${input.amountMinor}` },
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

  const refundId = await db().transaction(async (tx) => {
    let id = "";
    if (input.amountMinor > 0) {
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, restocked, created_by)
        values (${storeId}::uuid, ${String(payment.id)}::uuid, ${input.amountMinor}, ${input.reason},
                ${providerReference}, ${status}::commerce.refund_status,
                ${JSON.stringify(restock.map(({ sku, quantity }) => ({ sku, quantity })))}::jsonb, ${accountId}::uuid)
        returning id
      `);
      id = String(row.id);
    }
    for (const item of restock) await putBack(tx, storeId, item.variantId, item.quantity);
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, ${input.amountMinor > 0 ? "order.refunded" : "order.restocked"},
              ${JSON.stringify({
                amount: input.amountMinor,
                reason: input.reason,
                restocked: restock.map(({ sku, quantity }) => ({ sku, quantity })),
              })}::jsonb, 'staff')
    `);
    return id;
  });
  return { ok: true, refundId, amountMinor: input.amountMinor };
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** Puts units back at the store's first active location. */
async function putBack(tx: Tx, storeId: string, variantId: string, quantity: number) {
  const [level] = await tx.execute<Row>(sql`
    select l.location_id from commerce.inventory_levels l
    join commerce.inventory_locations loc on loc.id = l.location_id and loc.active
    where l.store_id = ${storeId}::uuid and l.variant_id = ${variantId}::uuid
    order by loc.created_at limit 1
  `);
  if (level) {
    await tx.execute(sql`
      update commerce.inventory_levels set on_hand = on_hand + ${quantity}, updated_at = now()
      where variant_id = ${variantId}::uuid and location_id = ${String(level.location_id)}::uuid
    `);
    return;
  }
  await tx.execute(sql`
    insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
    select ${storeId}::uuid, ${variantId}::uuid, id, ${quantity}
    from commerce.inventory_locations where store_id = ${storeId}::uuid and active
    order by created_at limit 1
  `);
}

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
  if (order.status !== "paid") {
    return { ok: false, problem: order.status === "fulfilled" ? "The order is already sent: refund it instead." : "Only paid orders can be cancelled." };
  }
  const restock = order.lines
    .filter((l) => l.variantId && l.delivery === "physical" && l.quantity > l.restocked)
    .map((l) => ({ lineId: l.id, quantity: l.quantity - l.restocked }));
  if (order.refundableMinor > 0 || restock.length > 0) {
    const refunded = await refundOrder(storeId, orderId, { amountMinor: order.refundableMinor, reason, restock }, accountId);
    if (!refunded.ok) return refunded;
  }
  await db().execute(sql`
    update commerce.orders set status = 'cancelled' where store_id = ${storeId}::uuid and id = ${orderId}::uuid
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
    where store_id = ${storeId}::uuid and id = ${orderId}::uuid and status <> 'pending_payment'
    returning id
  `);
  if (!row) return false;
  await event(storeId, orderId, "order.edited", { fields: ["email", "shipping_address"] }, "staff");
  return true;
}

export async function addOrderNote(storeId: string, orderId: string, note: string, by: string): Promise<void> {
  await event(storeId, orderId, "note.added", { note, by }, "staff");
}
