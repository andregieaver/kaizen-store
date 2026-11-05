import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { isCarrierId, carrierInfo } from "@/lib/shipping-carriers";

import { audit } from "./auth";
import { adapterFor } from "./carriers";
import { log } from "./log";
import { carrierContext } from "./shipping-carriers";
import { col, typedRow } from "./typed-rows";
import { db } from "@/db/client";

export type CarrierCancelled = { ok: true } | { ok: false; problem: string };

/**
 * Cancels at the carrier the booking of a parcel staff have just undone (D459), for a carrier whose connection can (`cancel` in its `available`
 * features): the parcel must be this order's, booked through a connection and undone. The carrier is asked with the store's own agreement; what it
 * answers is staff's to read, and the parcel stays undone either way. A label kept for the parcel (`carrier_labels`) goes, as the booking it belongs to
 * is gone. Null when there was nothing to ask: a parcel recorded by hand, or a carrier without a cancel call. Never throws.
 */
export async function cancelAtCarrier(storeId: string, orderId: string, shipmentId: string, accountId: string | null): Promise<CarrierCancelled | null> {
  try {
    const row = await typedRow(
      z.object({ carrier_id: col.textOrNull, tracking_number: col.text, consignment_number: col.textOrNull }),
      sql`select carrier_id, tracking_number, consignment_number from commerce.shipments
          where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and id = ${shipmentId}::uuid and undone_at is not null`,
    );
    const carrier = row?.carrier_id ?? null;
    if (!row || !carrier || !isCarrierId(carrier) || !carrierInfo(carrier)?.available.includes("cancel")) return null;
    const [context, adapter] = [await carrierContext(storeId, carrier), adapterFor(carrier)];
    if (!adapter?.cancel) return null;
    if (!context) return { ok: false, problem: `${carrierInfo(carrier)?.name ?? carrier} is no longer set up` };
    let result: CarrierCancelled;
    try {
      result = await adapter.cancel(context, { trackingNumber: row.tracking_number, consignmentNumber: row.consignment_number });
    } catch (error) {
      result = { ok: false, problem: error instanceof Error ? error.message : "the carrier did not answer" };
    }
    if (result.ok) await db().execute(sql`delete from commerce.carrier_labels where store_id = ${storeId}::uuid and shipment_id = ${shipmentId}::uuid`);
    await audit(accountId, storeId, "shipping.booking_cancelled", { orderId, shipment: shipmentId, carrier, ok: result.ok }, { target: { type: "order", id: orderId } });
    return result;
  } catch (error) {
    log("warn", "carrier.cancel_failed", {}, error);
    return { ok: false, problem: "the cancellation could not be asked for" };
  }
}
