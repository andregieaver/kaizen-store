import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { shipmentProblems, shipmentProblemText, type ParcelLine, type ShipmentProblemCode } from "@/lib/fulfilment";
import { editLabel } from "@/lib/order-edit-status";
import { formatMoney } from "@/lib/money";
import { FULFILMENT_EVENTS, ORDER_OPS_EVENTS } from "@/lib/order-ops-events";
import type { Tag } from "@/lib/order-tags";
import { isAdoptedRefund } from "@/lib/refund-adopted";
import { splitRefund, type RefundPart } from "@/lib/refund-split";
import { restockRoom } from "@/lib/stock-restock";
import type { PaymentModeName } from "@/lib/stripe-account";

import { cancelUnpaidOrder } from "./checkout";
import { EDIT_REFUND_OWED_SQL } from "./edit-refund-owed";
import { reverseHostCommission } from "./host-payments";
import { orderFulfilment, refreshFulfilment, shipmentLinesFor, type OrderFulfilment, type ShipmentLineView } from "./fulfilment";
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
  /** Recorded before parcels named their lines (D174): counts as everything sent. */
  legacy: boolean;
  /** What is in it (D174): empty for a legacy parcel that was not the order's first. */
  lines: ShipmentLineView[];
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
  /** What is sent, withdrawn and left to send of each line, the order's state, and the basis a parcel form sends back (D174). */
  fulfilment: OrderFulfilment;
  /** The order's changes after purchase (D174), newest last; never staff's note. */
  edits: OrderEditSummary[];
};

/** A change of an order as the order page lists it (D174). */
export type OrderEditSummary = {
  id: string;
  seq: number;
  label: string;
  status: "awaiting_payment" | "applied" | "cancelled" | "expired";
  reason: string;
  differenceMinor: number;
  totalBeforeMinor: number;
  totalAfterMinor: number;
  documents: string;
  expiresAt: string | null;
  createdAt: string;
  appliedAt: string | null;
  endedAt: string | null;
  madeBy: string | null;
  /** What the change's refund still owes the customer after Stripe reported it failed (`EDIT_REFUND_OWED_SQL`); 0 when nothing is owed. */
  refundOwedMinor: number;
};

export async function getOrderAdmin(storeId: string, orderId: string): Promise<OrderAdmin | null> {
  const order = await getOrder(storeId, orderId);
  if (!order) return null;
  const [restocks, shipments, refunds, [paid], tags, [origin], listPrices, fulfilment, shipmentLines, edits] = await Promise.all([
    db().execute<Row>(sql`
      select item ->> 'sku' as sku, sum((item ->> 'quantity')::int)::int as quantity
      from commerce.order_events e, jsonb_array_elements(e.data -> 'restocked') item
      where e.store_id = ${storeId}::uuid and e.order_id = ${orderId}::uuid
        and e.type in ('order.refunded', 'order.restocked')
      group by 1
    `),
    db().execute<Row>(sql`
      select id, carrier, tracking_number, tracking_url, created_at, carrier_id, label_url is not null as has_label, legacy from commerce.shipments
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid order by created_at, id
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
    orderFulfilment(db(), storeId, orderId),
    shipmentLinesFor(db(), storeId, orderId),
    db().execute<Row>(sql`
      select e.id, e.seq, e.status, e.reason, e.difference_minor, e.total_before, e.total_after, e.documents, e.expires_at, e.created_at, e.applied_at, e.ended_at,
        a.email as made_by, ${EDIT_REFUND_OWED_SQL} as refund_owed
      from commerce.order_edits e left join commerce.accounts a on a.id = e.made_by
      where e.store_id = ${storeId}::uuid and e.order_id = ${orderId}::uuid order by e.seq
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
      legacy: Boolean(s.legacy),
      lines: shipmentLines.get(String(s.id)) ?? [],
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
    fulfilment: fulfilment ?? { orderId, lines: [], hasShipment: false, legacy: false, state: "none", unitsToSend: 0, editPending: false, basis: "0:0" },
    edits: edits.map((e) => ({
      id: String(e.id),
      seq: Number(e.seq),
      label: editLabel(Number(e.seq)),
      status: String(e.status) as OrderEditSummary["status"],
      reason: String(e.reason),
      differenceMinor: Number(e.difference_minor),
      totalBeforeMinor: Number(e.total_before),
      totalAfterMinor: Number(e.total_after),
      documents: String(e.documents),
      expiresAt: e.expires_at ? new Date(String(e.expires_at)).toISOString() : null,
      createdAt: new Date(String(e.created_at)).toISOString(),
      appliedAt: e.applied_at ? new Date(String(e.applied_at)).toISOString() : null,
      endedAt: e.ended_at ? new Date(String(e.ended_at)).toISOString() : null,
      madeBy: e.made_by ? String(e.made_by) : null,
      refundOwedMinor: Number(e.refund_owed ?? 0),
    })),
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
                         and commerce.withdrawn_quantity(ol.id) < ol.quantity)
       and not exists (select 1 from commerce.shipments sh where sh.store_id = ${storeId}::uuid and sh.order_id = ${orderId}::uuid) as whole
  `);
  return Boolean(row?.whole);
}

/** Why a parcel was not recorded (`SHIPMENT_PROBLEMS` has the words). */
export type SendRefusal = ShipmentProblemCode;

export type SendOutcome = { ok: true; shipment: Shipment; /** Units still to send after this parcel. */ left: number } | { ok: false; reason: SendRefusal; lineId?: string };

/** What a parcel holds (D174): the chosen lines and units, or nothing for "everything still to send" (the meaning of every caller from before parcels named their lines). */
export type ParcelChoice = {
  lines?: readonly ParcelLine[] | null;
  /**
   * The order's fulfilment as the screen saw it (`OrderFulfilment.basis`): when it is given and the order has another parcel or withdrawal now, the parcel is refused as
   * `changed` (two staff sending at once; the second looks again).
   */
  seen?: string | null;
};

/**
 * Records a parcel and what is in it (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.1, 3.4 and 4.2). In one transaction under the order's row lock: the order is paid
 * (or sent already), not a copy, has no change waiting for payment and something left to send; the chosen lines are checked against what is left (`shipmentProblems()`:
 * goods only, no more than is left, withdrawn units never); the shipment and its lines are written (no lines chosen = everything still to send); the order becomes
 * `fulfilled` only when nothing is left (`refresh_fulfilment()`), and stays `paid` while it is partly sent. A recorded receipt is taken back (the goods are not all received,
 * CRD Art. 9(2)(b)). A weekly box (D102) is sent whole. This is the only writer of `commerce.shipments` (a scan test).
 */
export async function markSent(
  storeId: string,
  orderId: string,
  input: SendInput,
  accountId: string | null,
  /** A shipment booked through a carrier's connection (D134): kept to fetch its label and follow it. */
  booking?: { carrierId: string; consignmentNumber: string | null; labelUrl: string | null } | null,
  parcel: ParcelChoice = {},
): Promise<SendOutcome> {
  type Done = SendOutcome;
  return db().transaction(async (tx): Promise<Done> => {
    const [order] = await tx.execute<Row>(sql`
      select status, copied_from is not null as copied from commerce.orders
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update
    `);
    if (!order) return { ok: false, reason: "not_found" };
    if (order.copied) return { ok: false, reason: "copied" };
    if (!["paid", "fulfilled"].includes(String(order.status))) return { ok: false, reason: "unpaid" };
    const found = await orderFulfilment(tx, storeId, orderId);
    if (!found) return { ok: false, reason: "not_found" };
    if (found.editPending) return { ok: false, reason: "edit_pending" };
    if (parcel.seen && parcel.seen !== found.basis) return { ok: false, reason: "changed" };
    const chosen = parcel.lines ?? null;
    const check = shipmentProblems(found.lines, chosen, found.hasShipment);
    if (!check.ok) {
      const first = check.problems[0];
      return { ok: false, reason: first.code, ...(first.lineId ? { lineId: first.lineId } : {}) };
    }
    // A weekly box is paid as it is sent and sent whole (D102): a part of it is refused.
    if (check.left > 0) {
      const [box] = await tx.execute<Row>(sql`select 1 from commerce.standing_deliveries where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid`);
      if (box) return { ok: false, reason: "delivery_box_whole" };
    }
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
    for (const line of check.parcel) {
      await tx.execute(sql`
        insert into commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity)
        values (${storeId}::uuid, ${String(row.id)}::uuid, ${line.lineId}::uuid, ${line.quantity})
      `);
    }
    await refreshFulfilment(tx, storeId, orderId);
    // Goods sent in parts are received when the last part is (CRD Art. 9(2)(b)): a part sent after the receipt was recorded
    // means the receipt is not complete, so the date is taken back and the consumer's 14 days start again when it is recorded.
    const [reset] = await tx.execute<Row>(sql`
      update commerce.orders o set delivered_at = null
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
    const units = check.parcel.reduce((sum, l) => sum + l.quantity, 0);
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'order.sent',
              ${JSON.stringify({ carrier: row.carrier, tracking: row.tracking_number, shipment: String(row.id), units, left: check.left, lines: check.parcel })}::jsonb, 'staff')
    `);
    return {
      ok: true,
      left: check.left,
      shipment: {
        id: String(row.id),
        carrier: String(row.carrier),
        trackingNumber: String(row.tracking_number),
        trackingUrl: row.tracking_url ? String(row.tracking_url) : null,
        createdAt: new Date(String(row.created_at)).toISOString(),
        carrierId: row.carrier_id ? String(row.carrier_id) : null,
        hasLabel: Boolean(row.has_label),
        legacy: false,
        lines: check.parcel.map((p) => {
          const line = found.lines.find((l) => l.lineId === p.lineId);
          return { lineId: p.lineId, sku: line?.sku ?? "", title: line?.title ?? "", quantity: p.quantity };
        }),
      },
    };
  });
}

/** The sentence staff read for a refused parcel. */
export const sendRefusalText = (reason: SendRefusal): string => shipmentProblemText(reason);

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
  /**
   * The units put back were never sent (D174, `docs/wave-3-fulfilment.md` "Closing units that will not be sent"): each restocked unit of a physical line is first
   * taken from that line's units still to send (`min(restocked, line_to_send)`) and recorded in `commerce.unsent_closures` with the refund, in the transaction that
   * writes the refund, so the order no longer waits to send them (a partly sent order with nothing left becomes sent). Without it, a restock is stock going back
   * and nothing more (a sent unit that came back, as before). Only staff's refund form passes it.
   */
  notSent?: boolean;
};

export type RefundOutcome =
  | {
      ok: true;
      refundId: string;
      /** Every refund row made (an amount split over more than one payment, D174). */
      refundIds?: string[];
      amountMinor: number;
      unpaid?: boolean;
      status?: string;
      /** Units taken off what is still to send (`notSent`). */
      closedUnits?: number;
    }
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
   * money was sent; the first when the amount was split over more than one payment, D174, with all of them in `refundIds`) and its status (`failed` when
   * any part failed, `pending` when any part is on its way), so the caller's own record of the refund is written or not with it.
   */
  inTransaction?: (tx: Tx, result: { refundId: string; refundIds: string[]; status: string }) => Promise<void>;
  /** More data on the order's history event, such as the return's id. */
  eventData?: Record<string, unknown>;
  /** The return this refund is for (D153): the units go back as `return_restock` movements that carry its id. */
  returnId?: string;
  /**
   * The money is refunded outside Kaizen's Stripe (the order was paid some other way): nothing is sent from here, only the
   * stock goes back and the order's history says so. The amount must be 0.
   */
  outside?: boolean;
  /**
   * Refund this payment of the order (D174: an edit's payment that arrived too late to apply is refunded in full, from itself). Without it, the order's first captured
   * payment is refunded, as before.
   */
  paymentId?: string;
  /** Refund even while a change waits for the customer's payment (D174: the refund of a late edit payment, and the refund of a claimed lower-total change). */
  whileEditPending?: boolean;
  /**
   * Record the refund inside the caller's own open transaction (a savepoint of it) instead of a transaction of its own (D174: a change with a lower total is
   * written and checked under the order's lock FIRST, then Stripe is asked, then the refund is recorded, all in one transaction, so two presses of the same
   * change or a stock shortage can never refuse after money moved). The caller commits; a host's commission is not touched (a host's order is never changed).
   */
  within?: Tx;
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
  // A change waiting for the customer's payment (D174) keeps the order as it was sold until it is paid, cancelled or expired: no refund meanwhile.
  if (order.fulfilment.editPending && !options.whileEditPending) return { ok: false, problem: "A change to this order waits for the customer's payment: cancel the change, or wait for it, before refunding." };
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0 || input.amountMinor > order.refundableMinor) {
    return { ok: false, problem: "The amount is more than is left to refund." };
  }
  const restock: { sku: string; quantity: number; variantId: string; chosen: string | null }[] = [];
  // The lines whose restocked units may close units still to send (`notSent`): how many are closed is decided in the transaction, under the order's lock.
  const notSent: NotSentCandidate[] = [];
  for (const item of input.restock) {
    const line = order.lines.find((l) => l.id === item.lineId);
    if (!line || item.quantity <= 0) continue;
    if (!line.variantId || line.delivery !== "physical") continue;
    if (item.quantity > line.restockable) {
      return { ok: false, problem: `Only ${line.restockable} of ${line.title} can go back in stock.` };
    }
    restock.push({ sku: line.sku, quantity: item.quantity, variantId: line.variantId, chosen: item.locationId ?? null });
    if (input.notSent) {
      const same = notSent.find((c) => c.lineId === line.id);
      if (same) same.quantity += item.quantity;
      else notSent.push({ lineId: line.id, sku: line.sku, title: line.title, quantity: item.quantity });
    }
  }
  if (input.amountMinor === 0 && restock.length === 0) return { ok: false, problem: "Enter an amount to refund." };
  // Where the units go back is settled before any money moves: a place that is not the store's, or more units than the order took, refuses the whole refund.
  if (restock.length > 0) {
    const planned = await planRestock(db(), storeId, orderId, restock);
    if (!planned.ok) return { ok: false, problem: planned.problem };
  }

  // Where the money goes back (D174): an order can carry more than one captured payment (its own and each change paid through its link or recorded outside
  // Kaizen; a deposit and a no-show fee, D66), and each can give back only what it took less what was already refunded from it (Stripe refuses more than the
  // charge). So the amount is split over them in the order they were made (`splitRefund()`), one refund per payment: Stripe's through Stripe, money taken
  // outside Kaizen (D173, a draft order paid by bank transfer or in cash) by being RECORDED here as `succeeded`, with no call to Stripe (staff pay the customer
  // back themselves); the credit note follows from each refund by the database's own trigger (D159).
  const payments = options.outside
    ? []
    : await db().execute<Row>(sql`
        select p.id, p.provider, p.provider_reference, p.provider_account, a.mode,
          p.amount_minor - coalesce((select sum(r.amount_minor) from commerce.refunds r
                                      where r.store_id = p.store_id and r.payment_id = p.id and r.status::text <> 'failed'), 0) as left_minor
        from commerce.payments p
        left join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
        where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.status = 'captured'
          and (p.provider = 'manual' or (p.provider = 'stripe' and a.mode is not null))
          and (${options.paymentId ?? null}::uuid is null or p.id = ${options.paymentId ?? null}::uuid)
        order by p.created_at, p.id
      `);
  const byId = new Map(payments.map((p) => [String(p.id), p]));
  const parts = options.outside
    ? []
    : splitRefund(
        payments.map((p) => ({ id: String(p.id), provider: p.provider === "manual" ? ("manual" as const) : ("stripe" as const), leftMinor: Number(p.left_minor) })),
        input.amountMinor,
      );
  if (!options.outside && payments.length === 0) return { ok: false, problem: "Stripe cannot be reached for this store right now." };
  if (parts === null) return { ok: false, problem: "The amount is more than is left to refund." };
  // Who may record a refund of money taken outside Kaizen is who may record the payment: the owner, or staff when the owner allows it (D173). A refund through Stripe is any staff member's.
  if (parts.some((part) => part.provider === "manual") && !(await accountMayRecordOutside(storeId, accountId))) {
    return { ok: false, problem: "Only the owner can record a refund of a payment taken outside Kaizen, unless the owner has allowed staff to." };
  }

  // Stripe first, part by part (each with its own idempotency key: the caller's for the first, the same key and the payment for the others), then the database.
  const baseKey = options.idempotencyKey ?? refundKey(orderId, order.refunds, input.amountMinor);
  const made: MadeRefund[] = [];
  for (const [i, part] of parts.entries()) {
    const payment = byId.get(part.paymentId)!;
    if (part.provider === "manual") {
      made.push({ part, providerReference: `manual_refund_${randomUUID()}`, status: "succeeded", recorded: true });
      continue;
    }
    try {
      const stripe = platformStripe(payment.mode as PaymentModeName);
      if (!stripe) throw new RefundRefused("Stripe cannot be reached for this store right now.");
      const stripeAccount = String(payment.provider_account);
      const paymentIntent = await paymentIntentFor(stripe, String(payment.provider_reference), stripeAccount);
      if (!paymentIntent) throw new RefundRefused("Stripe has no payment to refund for this order.");
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntent,
          amount: part.amountMinor,
          reason: "requested_by_customer",
          refund_application_fee: true,
          metadata: { order_id: orderId, order_number: order.number },
        },
        { stripeAccount, idempotencyKey: i === 0 ? baseKey : `${baseKey}:${part.paymentId}` },
      );
      made.push({
        part,
        providerReference: refund.id,
        status: refund.status === "failed" || refund.status === "canceled" ? "failed" : refund.status === "succeeded" ? "succeeded" : "pending",
        recorded: false,
      });
    } catch (error) {
      const said =
        error instanceof RefundRefused
          ? error.message
          : error instanceof Error && "type" in error
            ? `Stripe said: ${error.message}`
            : "Stripe could not make the refund.";
      // Nothing moved yet: nothing is written. Stripe already gave back the earlier parts: they are recorded as refunds of the order (never lost), without the
      // caller's own record or the stock, and staff are told what went back.
      const moved = made.filter((m) => !m.recorded && m.status !== "failed");
      if (moved.length === 0) return { ok: false, problem: said };
      await writeRefunds(storeId, orderId, input.reason, accountId, moved, [], options.eventData, undefined, undefined, options.within);
      const back = moved.reduce((sum, m) => sum + m.part.amountMinor, 0);
      return {
        ok: false,
        problem: `Stripe gave back ${formatMoney(back, order.currency, "en-GB")} of ${formatMoney(input.amountMinor, order.currency, "en-GB")} and refused the rest; what went back is recorded on the order. ${said}`,
      };
    }
  }

  let written: { ids: string[]; closed: number };
  try {
    written = await writeRefunds(storeId, orderId, input.reason, accountId, made, restock, options.eventData, options.returnId, options.inTransaction, options.within, notSent);
  } catch (error) {
    if (error instanceof RefundOverCap) return { ok: false, problem: "The amount is more than is left to refund." };
    throw error;
  }
  const status = made.length === 0 ? "succeeded" : made.some((m) => m.status === "failed") ? "failed" : made.every((m) => m.status === "succeeded") ? "succeeded" : "pending";
  // A host's order (D71): the store gives back the refunded share of its commission, per Stripe payment refunded (after the commit; never inside a caller's own transaction).
  if (!options.within) for (const m of made) if (!m.recorded && m.status !== "failed") await reverseHostCommission(storeId, m.part.paymentId);
  return { ok: true, refundId: written.ids[0] ?? "", refundIds: written.ids, amountMinor: input.amountMinor, status, ...(written.closed > 0 ? { closedUnits: written.closed } : {}) };
}

/** A line whose restocked units may be closed as not to be sent (`RefundInput.notSent`): at most `quantity`, never more than the line has still to send. */
type NotSentCandidate = { lineId: string; sku: string; title: string; quantity: number };

/**
 * Takes restocked units off what is still to send (D174), inside the refund's transaction and under the order's row lock (the lock `markSent()` takes): for
 * each line, `min(restocked, line_to_send)` units go into `commerce.unsent_closures` with the refund, then one `order.unsent_closed` event names the lines. Every
 * condition the database's `unsent_closures_rules()` holds is read here first and a line that does not meet it is skipped, so the trigger never refuses after
 * Stripe gave the money back: a paid order (not sent in full, not cancelled), not a copy, no change waiting for payment, a physical line of this order. The
 * order becomes `fulfilled` by the table's own trigger when it has a parcel and nothing is left. Returns the units closed.
 */
async function closeUnsent(tx: Tx, storeId: string, orderId: string, refundId: string | null, accountId: string | null, candidates: readonly NotSentCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
  const [order] = await tx.execute<Row>(sql`
    select o.status::text as status, o.copied_from is not null as copied,
      exists (select 1 from commerce.order_edits e where e.store_id = o.store_id and e.order_id = o.id and e.status = 'awaiting_payment') as edit_pending
    from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid for update
  `);
  if (!order || order.status !== "paid" || order.copied || order.edit_pending) return 0;
  const closed: { lineId: string; sku: string; title: string; quantity: number }[] = [];
  for (const candidate of candidates) {
    const [line] = await tx.execute<Row>(sql`
      select commerce.line_to_send(ol.id) as to_send from commerce.order_lines ol
      where ol.store_id = ${storeId}::uuid and ol.order_id = ${orderId}::uuid and ol.id = ${candidate.lineId}::uuid
        and ol.delivery = 'physical' and ol.variant_id is not null
    `);
    const quantity = Math.min(candidate.quantity, Number(line?.to_send ?? 0));
    if (quantity <= 0) continue;
    await tx.execute(sql`
      insert into commerce.unsent_closures (store_id, order_id, order_line_id, quantity, refund_id, created_by)
      values (${storeId}::uuid, ${orderId}::uuid, ${candidate.lineId}::uuid, ${quantity}, ${refundId}::uuid, ${accountId}::uuid)
    `);
    closed.push({ ...candidate, quantity });
  }
  const units = closed.reduce((sum, c) => sum + c.quantity, 0);
  if (units > 0) {
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, ${FULFILMENT_EVENTS.unsentClosed},
              ${JSON.stringify({ units, lines: closed.map((c) => ({ lineId: c.lineId, sku: c.sku, title: c.title, quantity: c.quantity })), ...(refundId ? { refundId } : {}) })}::jsonb, 'staff')
    `);
  }
  return units;
}

/** One part of a refund once Stripe answered (or, for money taken outside Kaizen, once it is to be recorded). */
type MadeRefund = { part: RefundPart; providerReference: string; status: "succeeded" | "pending" | "failed"; recorded: boolean };

/** Kaizen could not ask Stripe for a part of a refund (no Stripe for the mode, or no PaymentIntent behind the payment): the words for staff. */
class RefundRefused extends Error {}

/**
 * Records the parts of a refund in ONE transaction: a `refunds` row per part (adopting a row the webhook already wrote for the same Stripe refund), the stock
 * going back (D172), the order's history, and the caller's own record (`inTransaction`), so either all of it is written or none.
 */
async function writeRefunds(
  storeId: string,
  orderId: string,
  reason: string,
  accountId: string | null,
  made: readonly MadeRefund[],
  restock: readonly { sku: string; quantity: number; variantId: string; chosen: string | null }[],
  eventData: Record<string, unknown> | undefined,
  returnId: string | undefined,
  inTransaction: RefundOptions["inTransaction"],
  within?: Tx,
  notSent: readonly NotSentCandidate[] = [],
): Promise<{ ids: string[]; closed: number }> {
  const restockJson = JSON.stringify(restock.map(({ sku, quantity }) => ({ sku, quantity })));
  const run = <T,>(body: (tx: Tx) => Promise<T>): Promise<T> => (within ? within.transaction(body) : db().transaction(body));
  return run(async (tx) => {
    const ids: string[] = [];
    // Money taken outside Kaizen has no Stripe to stop a refund above what was paid, so the cap is held HERE, under the order's row lock: two refunds at the same moment (two staff, a double click) are
    // serialised, and the second sees the first (the amount read before the transaction, in `getOrderAdmin()`, is only for the form). The database refuses the same sum too (`commerce.refunds_manual_cap()`).
    const manual = made.filter((m) => m.recorded);
    if (manual.length > 0) {
      await tx.execute(sql`select id from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update`);
      for (const m of manual) {
        const [left] = await tx.execute<Row>(sql`
          select p.amount_minor - coalesce((select sum(r.amount_minor) from commerce.refunds r where r.store_id = p.store_id and r.payment_id = p.id and r.status <> 'failed'), 0) as left_minor
          from commerce.payments p where p.store_id = ${storeId}::uuid and p.id = ${m.part.paymentId}::uuid
        `);
        if (m.part.amountMinor > Number(left?.left_minor ?? 0)) throw new RefundOverCap();
      }
    }
    // The webhook may have recorded this very refund already (a refund Stripe accepted whose row an earlier try failed to write: its event
    // writes the row after a grace period). The same key then gave back the same refund, and its row is claimed here, never made twice.
    let fresh = 0;
    for (const m of made) {
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, restocked, created_by)
        values (${storeId}::uuid, ${m.part.paymentId}::uuid, ${m.part.amountMinor}, ${reason},
                ${m.providerReference}, ${m.status}::commerce.refund_status, ${ids.length === 0 ? restockJson : "[]"}::jsonb, ${accountId}::uuid)
        on conflict (store_id, provider_reference) do nothing
        returning id
      `);
      if (row) {
        ids.push(String(row.id));
        fresh += m.part.amountMinor;
      } else {
        const [existing] = await tx.execute<Row>(sql`
          update commerce.refunds set reason = ${reason}, created_by = ${accountId}::uuid, restocked = ${ids.length === 0 ? restockJson : "[]"}::jsonb
          where store_id = ${storeId}::uuid and provider_reference = ${m.providerReference} and payment_id = ${m.part.paymentId}::uuid
          returning id
        `);
        if (!existing) throw new Error("The refund's Stripe id belongs to another payment.");
        ids.push(String(existing.id));
      }
    }
    const amount = made.reduce((sum, m) => sum + m.part.amountMinor, 0);
    const adopted = made.length > 0 && fresh === 0;
    // The units go back inside this transaction, each change a movement that says why (D172); planned again here, under the locks, from what the order took.
    let restockedParts: { sku: string; quantity: number; locationId: string }[] = [];
    if (restock.length > 0) {
      const planned = await planRestock(tx, storeId, orderId, [...restock]);
      if (!planned.ok) throw new Error(planned.problem);
      await applyRestock(tx, storeId, planned.items, {
        reason: returnId ? "return_restock" : "order_restock",
        source: returnId ? "return" : "order",
        accountId,
        orderId,
        returnId: returnId ?? null,
      });
      restockedParts = planned.items.flatMap((item) => item.parts.map((part) => ({ sku: item.sku, quantity: part.quantity, locationId: part.locationId })));
    }
    const failed = made.some((m) => m.status === "failed");
    // Units never sent that are put back (D174): taken off what is still to send, as the stock went back. The refund is named when money went back with them (a refund
    // Stripe reported as failed is not: staff refund the money again, and the units stay closed, since they are back in stock).
    const closed = restock.length > 0 ? await closeUnsent(tx, storeId, orderId, failed ? null : (ids[0] ?? null), accountId, notSent) : 0;
    // An adopted refund has its `order.refunded` event already (written by the webhook); only the stock going back is new.
    if (!adopted || restock.length > 0) {
      await tx.execute(sql`
        insert into commerce.order_events (store_id, order_id, type, data, actor)
        values (${storeId}::uuid, ${orderId}::uuid, ${amount > 0 && !adopted ? "order.refunded" : "order.restocked"},
                ${JSON.stringify({
                  amount: adopted ? 0 : fresh,
                  reason,
                  restocked: restockedParts,
                  // A refund Stripe reported as failed is kept as a row too; a caller that retries (a return) counts these.
                  ...(amount > 0 && failed ? { status: "failed" } : {}),
                  // Split over more than one payment (D174): how many refunds it took.
                  ...(made.length > 1 ? { parts: made.length } : {}),
                  ...eventData,
                })}::jsonb, 'staff')
      `);
    }
    // A refund recorded outside Kaizen (D173) also says so in the order's history, in words that name no one: `data.note` is the reason (the one free-text key the erasure removes).
    const outsideAmount = manual.reduce((sum, m) => sum + m.part.amountMinor, 0);
    if (outsideAmount > 0) {
      await tx.execute(sql`
        insert into commerce.order_events (store_id, order_id, type, data, actor)
        values (${storeId}::uuid, ${orderId}::uuid, ${ORDER_OPS_EVENTS.refundedOutside}, ${JSON.stringify({ amount: outsideAmount, note: reason })}::jsonb, 'staff')
      `);
    }
    const status = made.length === 0 ? "succeeded" : failed ? "failed" : made.every((m) => m.status === "succeeded") ? "succeeded" : "pending";
    await inTransaction?.(tx, { refundId: ids[0] ?? "", refundIds: ids, status });
    return { ids, closed };
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** A refund of money taken outside Kaizen that would take the refunds above what was paid (found under the order's lock). */
class RefundOverCap extends Error {}

/** Why a partly sent order is not cancelled, and what to do instead (D174). */
export const PARTLY_SENT_CANCEL =
  "Some of this order is already sent, so it cannot be cancelled. Refund the units that are not sent: put them back in stock and tick “These units were not sent”, and the order counts as sent.";

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
  // Partly sent (D174): some goods are on their way, so the order is not cancelled; what is not sent is refunded instead, put back in stock with "not sent"
  // ticked, which takes it off what is still to send (`RefundInput.notSent`).
  if (order.shipments.length > 0) return { ok: false, problem: PARTLY_SENT_CANCEL };
  // A change waiting for the customer's payment (D174) is cancelled first, so no payment can arrive for an order that is gone.
  if (order.fulfilment.editPending) return { ok: false, problem: "A change to this order waits for the customer's payment: cancel the change first." };
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
