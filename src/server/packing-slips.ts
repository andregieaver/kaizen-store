import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { giftOfRow, NO_GIFT, type GiftFields } from "@/lib/gift";
import { BULK_PRINT_MAX, slipSkip, type BulkRefusal, type BulkRequestProblem } from "@/lib/order-bulk";

import { fulfilmentOf, type OrderFulfilment } from "./fulfilment";
import { uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * What a packing slip prints, for one order or many (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.5). The slip has NO prices, no VAT, no totals and no payment, discount or invoice words
 * (D27): this data holds none, so no page built from it can print one. It is the order's number and date, the deliver-to address, the physical lines with quantity and SKU, and, for a
 * gift, the buyer's own words (`gift`: To, From and the message, drawn as text with `white-space: pre-line`, never as HTML). Each slip is in the ORDER's language. Copied history (D129) and
 * orders with nothing physical to ship are left out, with the reason; so are ids that are not this store's (no more than `not_found`). It changes no state.
 */

export type PackingSlip = {
  orderId: string;
  number: string;
  placedAt: string;
  /** The order's locale (`nb-NO`) and its language (`nb`): the words of the slip. */
  locale: string;
  lang: string;
  shipTo: { name: string | null; line1: string | null; line2: string | null; postalCode: string | null; city: string | null; country: string | null };
  lines: { quantity: number; title: string; sku: string }[];
  /** The buyer's gift (D173), null when the order is not one. */
  gift: GiftFields | null;
  /**
   * What the slip prints (D174, `docs/wave-3-fulfilment.md` 2.3): `to_send` the units still to send (the default), `reprint` every physical unit as sold for an order
   * with nothing left to send (the order's own slip, under *All items (already sent)*), `parcel` one shipment's lines. Absent on slips made before parcels named lines.
   */
  scope?: "to_send" | "reprint" | "parcel";
  /** The parcel this slip is of (`scope = 'parcel'`). */
  shipmentId?: string | null;
  /** Units of the order remain to send after what this slip holds: the slip says "More of this order follows in another parcel" (`m.slip.moreFollows`). */
  moreFollows?: boolean;
};

export type PackingSlipSet =
  | { ok: true; slips: PackingSlip[]; skipped: BulkRefusal[] }
  | { ok: false; problem: Extract<BulkRequestProblem, "empty" | "too_many"> };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/**
 * The slips of up to 100 orders, in the order asked, and why any order is not among them. Each prints the units still to send (D174: a partly sent order its remainder,
 * withdrawn units never); an order with nothing left is skipped as `already_sent` or `withdrawn_in_full`, unless `reprint` is asked (the order's own slip), which prints
 * every physical unit as sold.
 */
export async function packingSlipData(storeId: string, ids: readonly string[], options: { reprint?: boolean } = {}): Promise<PackingSlipSet> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id !== ""))];
  if (unique.length === 0) return { ok: false, problem: "empty" };
  if (unique.length > BULK_PRINT_MAX) return { ok: false, problem: "too_many" };
  const valid = unique.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)).map((id) => id.toLowerCase());
  const orders = valid.length
    ? await db().execute<Row>(sql`
        select o.id, o.number, o.placed_at, o.locale, o.shipping_address, o.copied_from is not null as copied, o.is_gift, o.gift_to, o.gift_from, o.gift_message,
          exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical') as physical
        from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = any(${uuidList(valid)})
      `)
    : [];
  const fulfilment = await fulfilmentOf(db(), storeId, orders.map((o) => String(o.id)));
  const byId = new Map(orders.map((o) => [String(o.id), o]));
  const slips: PackingSlip[] = [];
  const skipped: BulkRefusal[] = [];
  for (const id of unique) {
    const order = byId.get(id.toLowerCase());
    if (!order) {
      skipped.push({ id, number: null, reason: "not_found" });
      continue;
    }
    const state = fulfilment.get(String(order.id));
    const reprint = Boolean(options.reprint) && state?.state === "sent";
    const skip = slipSkip({ copied: Boolean(order.copied), physical: Boolean(order.physical), state: reprint ? undefined : state?.state });
    if (skip || !state) {
      skipped.push({ id: String(order.id), number: String(order.number), reason: skip ?? "nothing_to_ship" });
      continue;
    }
    const lines = reprint
      ? state.lines.filter((l) => l.physical).map((l) => ({ quantity: l.quantity, title: l.title, sku: l.sku }))
      : state.lines.filter((l) => l.toSend > 0).map((l) => ({ quantity: l.toSend, title: l.title, sku: l.sku }));
    slips.push({ ...slipHead(order), lines, scope: reprint ? "reprint" : "to_send", shipmentId: null, moreFollows: false });
  }
  return { ok: true, slips, skipped };
}

/** The parts of a slip that are the order's (number, date, language, address, gift). */
function slipHead(order: Row): Omit<PackingSlip, "lines"> {
  const a = (order.shipping_address ?? {}) as Record<string, unknown>;
  const gift = giftOfRow(order);
  return {
    orderId: String(order.id),
    number: String(order.number),
    placedAt: new Date(String(order.placed_at)).toISOString(),
    locale: String(order.locale),
    lang: String(order.locale).split("-")[0] || "en",
    shipTo: { name: text(a.name), line1: text(a.line1), line2: text(a.line2), postalCode: text(a.postalCode), city: text(a.city), country: text(a.country) },
    gift: gift === NO_GIFT ? null : gift,
  };
}

/**
 * One parcel's slip (D174, `?shipment={id}` on the order's slip page): that shipment's lines and quantities, with "more follows" when units of the order are still to
 * send. Null when the order is not this store's or the shipment is not the order's (the page answers 404), or the order is a copy. A legacy parcel prints what the
 * database back-filled for it (the order's first parcel: every physical unit; a later one: nothing, so null).
 */
export async function parcelSlipData(storeId: string, orderId: string, shipmentId: string): Promise<PackingSlip | null> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(orderId) || !uuid.test(shipmentId)) return null;
  const [order] = await db().execute<Row>(sql`
    select o.id, o.number, o.placed_at, o.locale, o.shipping_address, o.copied_from is not null as copied, o.is_gift, o.gift_to, o.gift_from, o.gift_message
    from commerce.orders o
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
      and exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.id = ${shipmentId}::uuid)
  `);
  if (!order || order.copied) return null;
  const rows = await db().execute<Row>(sql`
    select sl.quantity, ol.title, ol.sku from commerce.shipment_lines sl
    join commerce.order_lines ol on ol.store_id = sl.store_id and ol.id = sl.order_line_id
    where sl.store_id = ${storeId}::uuid and sl.shipment_id = ${shipmentId}::uuid and ol.order_id = ${orderId}::uuid
    order by ol.title, ol.sku, ol.id
  `);
  if (rows.length === 0) return null;
  const state: OrderFulfilment | undefined = (await fulfilmentOf(db(), storeId, [orderId])).get(orderId);
  return {
    ...slipHead(order),
    lines: rows.map((r) => ({ quantity: Number(r.quantity), title: String(r.title), sku: String(r.sku) })),
    scope: "parcel",
    shipmentId,
    moreFollows: (state?.unitsToSend ?? 0) > 0,
  };
}
