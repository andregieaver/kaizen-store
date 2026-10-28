import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { BulkReason } from "@/lib/order-bulk";
import { carrierInfo, type CarrierId } from "@/lib/shipping-carriers";

import { bringBook } from "./bring-shipping";
import { helthjemBook } from "./helthjem-shipping";
import type { Shipment } from "./order-admin";
import { getOrder } from "./orders";
import { porterbuddyBook } from "./porterbuddy-shipping";
import { carrierContext } from "./shipping-carriers";
import { uuidList } from "./sql-arrays";
import { col, typedRows } from "./typed-rows";

/**
 * *Book labels* on the Orders list (wave 10 unit K, D374): for one order, a parcel of everything still to send booked with its carrier through the same
 * function the order page's booking form calls (`bringBook()`, `helthjemBook()`, `porterbuddyBook()`, never a second path), so the test environment, the
 * one-booking-at-a-time lock (D372), the parcel's checks and `markSent()` are theirs. The carrier is the one the customer chose at checkout
 * (`orders.delivery`); an order without one goes with Posten / Bring's home parcel (`BULK_BRING_SERVICE`) when Bring is connected. The parcel's weight is
 * worked out from the variants of what is still to send, and an order with something of no weight is left to the order page, where staff enter it.
 * `runBulk()` calls it one order after another and reports each refusal with its reason, the carrier's own sentence included.
 */

/** The Bring service booked for an order whose customer chose no carrier at checkout: a parcel delivered to the door (D134's `BRING_PRODUCTS`). */
export const BULK_BRING_SERVICE = "5600";

/** The carriers that book labels (D133: `labels` in their `available` features and a `book()` built). */
const BOOKING_CARRIERS = ["bring", "porterbuddy", "helthjem"] as const satisfies readonly CarrierId[];
type BookingCarrier = (typeof BOOKING_CARRIERS)[number];

export type LabelOutcome =
  | { ok: true; shipment: Shipment; carrier: string }
  | { ok: false; reason: Extract<BulkReason, "no_carrier" | "carrier_cannot_book" | "no_weight" | "test_booking" | "carrier_refused" | "not_found">; detail?: string };

/** Which booking carriers the store has connected with complete details, read once for a batch. */
export async function connectedBookingCarriers(storeId: string): Promise<ReadonlySet<BookingCarrier>> {
  const found = await Promise.all(BOOKING_CARRIERS.map(async (id) => ((await carrierContext(storeId, id)) ? id : null)));
  return new Set(found.filter((id): id is BookingCarrier => id !== null));
}

/**
 * The weight in grams of what is still to send of each order (`commerce.line_to_send()` units times the variant's weight), or null for an order with a unit
 * still to send whose variant has no weight. Every statement names the store.
 */
export async function remainingWeights(storeId: string, orderIds: readonly string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (orderIds.length === 0) return out;
  const rows = await typedRows(
    z.object({ order_id: col.uuid, grams: col.minor, unweighed: col.int }),
    sql`
      select l.order_id, coalesce(sum(l.to_send * coalesce(v.weight_grams, 0)), 0)::bigint as grams,
        count(*) filter (where l.to_send > 0 and (v.weight_grams is null or v.weight_grams <= 0))::int as unweighed
      from (
        select ol.store_id, ol.order_id, ol.variant_id, commerce.line_to_send(ol.id) as to_send
        from commerce.order_lines ol
        where ol.store_id = ${storeId}::uuid and ol.order_id = any(${uuidList(orderIds)}) and ol.delivery = 'physical' and ol.variant_id is not null
      ) l
      left join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
      group by l.order_id
    `,
  );
  for (const row of rows) out.set(row.order_id, row.unweighed > 0 ? null : row.grams);
  return out;
}

/** Books one order's remaining units with its carrier. The order's own blocks (paid, copied, held for stock, pickup) are the caller's (`markSentBlock()`). */
export async function bookOrderLabel(
  storeId: string,
  accountId: string,
  orderId: string,
  facts: { connected: ReadonlySet<BookingCarrier>; grams: number | null | undefined },
): Promise<LabelOutcome> {
  const order = await getOrder(storeId, orderId);
  if (!order) return { ok: false, reason: "not_found" };
  const chosen = order.delivery;
  let carrier: BookingCarrier;
  if (chosen) {
    if (!(BOOKING_CARRIERS as readonly string[]).includes(chosen.carrier)) return { ok: false, reason: "carrier_cannot_book" };
    carrier = chosen.carrier as BookingCarrier;
  } else {
    carrier = "bring";
  }
  if (!facts.connected.has(carrier)) return { ok: false, reason: "no_carrier" };
  if (!facts.grams || facts.grams <= 0) return { ok: false, reason: "no_weight" };
  const parcel = { weightGrams: facts.grams };
  const booked =
    carrier === "bring"
      ? await bringBook(accountId, storeId, orderId, {
          serviceId: chosen?.carrier === "bring" ? chosen.serviceId : BULK_BRING_SERVICE,
          pickupPointId: chosen?.carrier === "bring" ? chosen.pickupPoint?.id : undefined,
          parcel,
        })
      : carrier === "helthjem"
        ? await helthjemBook(accountId, storeId, orderId, { parcel })
        : await porterbuddyBook(accountId, storeId, orderId, { parcel });
  if (!booked.ok) return { ok: false, reason: "carrier_refused", detail: booked.problem };
  if (booked.test) return { ok: false, reason: "test_booking" };
  return { ok: true, shipment: booked.shipment, carrier: carrierInfo(carrier)?.name ?? carrier };
}

/** A label to print on the labels page: the order, its parcel and the carrier. */
export type LabelToPrint = { orderId: string; number: string; shipmentId: string; carrier: string; trackingNumber: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The labels of these parcels, in the order given (the order *Book labels* booked them): only this store's parcels booked with a carrier that keeps a
 * label and not undone. Each label itself is fetched from the carrier's own host when it is printed (`carrierLabel()` through the order's label route)
 * and never kept. `missing` counts the ids left out.
 */
export async function labelsToPrint(storeId: string, shipmentIds: readonly string[]): Promise<{ labels: LabelToPrint[]; missing: number }> {
  const asked = [...new Set(shipmentIds.map((id) => id.trim().toLowerCase()).filter(Boolean))];
  const ids = asked.filter((id) => UUID.test(id));
  const rows =
    ids.length === 0
      ? []
      : await typedRows(
          z.object({ id: col.uuid, order_id: col.uuid, number: col.text, carrier: col.text, tracking_number: col.text }),
          sql`
            select s.id, s.order_id, o.number, s.carrier, s.tracking_number
            from commerce.shipments s
            join commerce.orders o on o.store_id = s.store_id and o.id = s.order_id
            where s.store_id = ${storeId}::uuid and s.id = any(${uuidList(ids)}) and s.label_url is not null and s.undone_at is null
              and s.carrier_id in ('bring', 'porterbuddy', 'helthjem')
          `,
        );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const labels = ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ orderId: row.order_id, number: row.number, shipmentId: row.id, carrier: row.carrier, trackingNumber: row.tracking_number }] : [];
  });
  return { labels, missing: asked.length - labels.length };
}
