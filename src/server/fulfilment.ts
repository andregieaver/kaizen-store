import "server-only";

import { sql } from "drizzle-orm";

import { db, type Db } from "@/db/client";
import { fulfilmentState, shipmentProblems, shipmentProblemText, type FulfilmentLine, type FulfilmentState, type ParcelLine } from "@/lib/fulfilment";

import { uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;
type Runner = Pick<Db, "execute">;

/**
 * What is left to send of an order (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 1.3, 3.4 and 4.2): per line, what was ordered, what is in parcels, what was
 * withdrawn, what staff closed as not to be sent and what is still to send. The figures are the database's own (`commerce.line_shipped()`, `commerce.withdrawn_quantity()`,
 * `commerce.closed_quantity()`, `commerce.line_to_send()`), read
 * in one statement for many orders, so the order page, the slips, the pick list, the bulk send and the AI tools say one thing; the pure `unitsToSend()` of
 * `src/lib/fulfilment.ts` reads them the same way (`fulfilment.int.test.ts` holds the two equal). Every query names the store.
 */

/** A line as the fulfilment screens read it. `quantity` is what was ordered; `toSend` is the database's `line_to_send()`. */
export type ToSendLine = FulfilmentLine & {
  orderId: string;
  variantId: string | null;
  sku: string;
  title: string;
  delivery: string;
  /** Units staff closed as not to be sent (`commerce.closed_quantity()`). */
  closed: number;
  /** Units still to send (`commerce.line_to_send()`); equal to `unitsToSend(line)`. */
  toSend: number;
  /** Units sold on backorder (D172) and the days the buyer was told. */
  backordered: number;
  backorderDays: number | null;
};

/** One order's fulfilment as the screens read it. */
export type OrderFulfilment = {
  orderId: string;
  lines: ToSendLine[];
  hasShipment: boolean;
  /** A parcel from before parcels named their lines: everything counts as sent. */
  legacy: boolean;
  state: FulfilmentState;
  unitsToSend: number;
  /** A change waits for the customer's payment (D174): nothing is sent meanwhile. */
  editPending: boolean;
  /**
   * What the screen saw: the order's parcels, withdrawn units and closed units, as one string. `markSent()` compares it under the order's lock and answers `changed`
   * when another parcel, a withdrawal or a closure came in between (two staff sending at once).
   */
  basis: string;
};

/** The lines of these orders (physical or not), with what was sent, withdrawn and is left, grouped by order. Orders of another store are simply absent. */
export async function toSend(runner: Runner, storeId: string, orderIds: readonly string[]): Promise<Map<string, ToSendLine[]>> {
  const out = new Map<string, ToSendLine[]>();
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return out;
  const rows = await runner.execute<Row>(sql`
    select ol.order_id, ol.id, ol.variant_id, ol.sku, ol.title, ol.quantity, ol.delivery, ol.backorder_quantity, ol.backorder_days,
      (ol.delivery = 'physical' and ol.variant_id is not null) as physical,
      commerce.line_shipped(ol.id) as shipped, commerce.withdrawn_quantity(ol.id) as withdrawn, commerce.closed_quantity(ol.id) as closed,
      commerce.line_to_send(ol.id) as to_send
    from commerce.order_lines ol
    where ol.store_id = ${storeId}::uuid and ol.order_id = any(${uuidList(ids)})
    order by ol.order_id, ol.title, ol.sku, ol.id
  `);
  for (const r of rows) {
    const orderId = String(r.order_id);
    const line: ToSendLine = {
      orderId,
      lineId: String(r.id),
      variantId: r.variant_id ? String(r.variant_id) : null,
      sku: String(r.sku ?? ""),
      title: String(r.title ?? ""),
      delivery: String(r.delivery),
      quantity: Number(r.quantity),
      physical: Boolean(r.physical),
      shipped: Number(r.shipped ?? 0),
      withdrawn: Number(r.withdrawn ?? 0),
      closed: Number(r.closed ?? 0),
      toSend: Number(r.to_send ?? 0),
      backordered: Number(r.backorder_quantity ?? 0),
      backorderDays: r.backorder_days === null || r.backorder_days === undefined ? null : Number(r.backorder_days),
    };
    const list = out.get(orderId) ?? [];
    list.push(line);
    out.set(orderId, list);
  }
  return out;
}

/** The fulfilment of several orders of one store: their lines, parcels, state and the basis the screens send back. */
export async function fulfilmentOf(runner: Runner, storeId: string, orderIds: readonly string[]): Promise<Map<string, OrderFulfilment>> {
  const ids = [...new Set(orderIds)];
  const out = new Map<string, OrderFulfilment>();
  if (ids.length === 0) return out;
  const [lines, heads] = await Promise.all([
    toSend(runner, storeId, ids),
    runner.execute<Row>(sql`
      select o.id,
        (select count(*)::int from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id) as shipments,
        exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.legacy) as legacy,
        exists (select 1 from commerce.order_edits e where e.store_id = o.store_id and e.order_id = o.id and e.status = 'awaiting_payment') as edit_pending
      from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = any(${uuidList(ids)})
    `),
  ]);
  for (const head of heads) {
    const orderId = String(head.id);
    const own = lines.get(orderId) ?? [];
    const hasShipment = Number(head.shipments) > 0;
    const withdrawn = own.reduce((s, l) => s + l.withdrawn, 0);
    const closed = own.reduce((s, l) => s + (l.closed ?? 0), 0);
    out.set(orderId, {
      orderId,
      lines: own,
      hasShipment,
      legacy: Boolean(head.legacy),
      state: fulfilmentState(own, hasShipment),
      unitsToSend: own.reduce((s, l) => s + l.toSend, 0),
      editPending: Boolean(head.edit_pending),
      basis: `${Number(head.shipments)}:${withdrawn}:${closed}`,
    });
  }
  return out;
}

/** One order's fulfilment, or null when it is not this store's. */
export async function orderFulfilment(runner: Runner, storeId: string, orderId: string): Promise<OrderFulfilment | null> {
  return (await fulfilmentOf(runner, storeId, [orderId])).get(orderId) ?? null;
}

/**
 * Moves a paid order to `fulfilled` when it has a parcel and nothing is left to send (`commerce.refresh_fulfilment()`); never moves one back. Called by `markSent()`
 * and, after a confirmed withdrawal, by the withdrawal's own transaction. Returns whether it moved.
 */
export async function refreshFulfilment(runner: Runner, storeId: string, orderId: string): Promise<boolean> {
  const [row] = await runner.execute<Row>(sql`select commerce.refresh_fulfilment(${storeId}::uuid, ${orderId}::uuid) as moved`);
  return Boolean(row?.moved);
}

/** A parcel's lines: which order line and how many of its units, with the line's title and SKU as sold (a line taken off later keeps none: it cannot be, it was sent). */
export type ShipmentLineView = { lineId: string; sku: string; title: string; quantity: number };

/** The lines of each parcel of an order (empty for a legacy parcel that was not the order's first). */
export async function shipmentLinesFor(runner: Runner, storeId: string, orderId: string): Promise<Map<string, ShipmentLineView[]>> {
  const rows = await runner.execute<Row>(sql`
    select sl.shipment_id, sl.order_line_id, sl.quantity, ol.sku, ol.title
    from commerce.shipment_lines sl
    join commerce.shipments sh on sh.store_id = sl.store_id and sh.id = sl.shipment_id
    join commerce.order_lines ol on ol.store_id = sl.store_id and ol.id = sl.order_line_id
    where sl.store_id = ${storeId}::uuid and sh.order_id = ${orderId}::uuid
    order by sl.shipment_id, ol.title, ol.sku, ol.id
  `);
  const out = new Map<string, ShipmentLineView[]>();
  for (const r of rows) {
    const id = String(r.shipment_id);
    const list = out.get(id) ?? [];
    list.push({ lineId: String(r.order_line_id), sku: String(r.sku ?? ""), title: String(r.title ?? ""), quantity: Number(r.quantity) });
    out.set(id, list);
  }
  return out;
}

/** The shopper's view of an order's parcels (their lines) and what is still to come, for the order pages (D174 2.4). Server-rendered; no zod. */
export type ParcelView = {
  id: string;
  createdAt: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string | null;
  legacy: boolean;
  lines: ShipmentLineView[];
};

export type ShopperFulfilment = {
  state: FulfilmentState;
  parcels: ParcelView[];
  /** Units still to send, by line; backordered units carry their days (D172). */
  stillToCome: { lineId: string; sku: string; title: string; quantity: number; backordered: number; backorderDays: number | null }[];
};

/** What the order pages show of the parcels: each with its lines, and what is still to come. Null for an order that is not this store's. */
export async function shopperFulfilment(storeId: string, orderId: string, runner: Runner = db()): Promise<ShopperFulfilment | null> {
  const found = await orderFulfilment(runner, storeId, orderId);
  if (!found) return null;
  const [parcels, linesOf] = await Promise.all([
    runner.execute<Row>(sql`
      select id, carrier, tracking_number, tracking_url, created_at, legacy from commerce.shipments
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid order by created_at, id
    `),
    shipmentLinesFor(runner, storeId, orderId),
  ]);
  return {
    state: found.state,
    parcels: parcels.map((p) => ({
      id: String(p.id),
      createdAt: new Date(String(p.created_at)).toISOString(),
      carrier: String(p.carrier ?? ""),
      trackingNumber: String(p.tracking_number ?? ""),
      trackingUrl: p.tracking_url ? String(p.tracking_url) : null,
      legacy: Boolean(p.legacy),
      // A legacy parcel shows as before: carrier and tracking, no lines (its back-filled lines are a bookkeeping device, not what the shopper saw).
      lines: p.legacy ? [] : (linesOf.get(String(p.id)) ?? []),
    })),
    stillToCome: found.lines
      .filter((l) => l.toSend > 0)
      .map((l) => ({ lineId: l.lineId, sku: l.sku, title: l.title, quantity: l.toSend, backordered: Math.min(l.backordered, l.toSend), backorderDays: l.backorderDays })),
  };
}

/**
 * Before a carrier is paid to book a parcel (D134 to D138): whether the parcel could be recorded as it stands now (the same check `markSent()` makes again under the
 * order's lock). Null when it could; else the sentence staff read. Nothing is written.
 */
export async function parcelPrecheck(storeId: string, orderId: string, lines?: readonly ParcelLine[] | null): Promise<string | null> {
  const found = await orderFulfilment(db(), storeId, orderId);
  if (!found) return shipmentProblemText("not_found");
  if (found.editPending) return shipmentProblemText("edit_pending");
  const check = shipmentProblems(found.lines, lines ?? null, found.hasShipment);
  return check.ok ? null : shipmentProblemText(check.problems[0].code);
}
