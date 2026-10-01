import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { fetchBringLabel } from "./carriers/bring";
import { fetchPorterbuddyLabel } from "./carriers/porterbuddy";
import { carrierContext } from "./shipping-carriers";

/**
 * The PDF label of a shipment booked through a carrier's connection (Posten / Bring, Porterbuddy), fetched when it is
 * printed with the store's own agreement and never kept, for the store's staff only; null when there is none or the
 * carrier will not give it.
 */
export async function carrierLabel(storeId: string, orderId: string, shipmentId: string): Promise<Uint8Array | null> {
  const [row] = await db().execute<Record<string, unknown>>(sql`
    select carrier_id, label_url from commerce.shipments
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and id = ${shipmentId}::uuid and label_url is not null
  `);
  if (!row) return null;
  const carrier = String(row.carrier_id);
  if (carrier !== "bring" && carrier !== "porterbuddy") return null;
  const context = await carrierContext(storeId, carrier);
  if (!context) return null;
  return carrier === "bring" ? fetchBringLabel(context, String(row.label_url)) : fetchPorterbuddyLabel(context, String(row.label_url));
}
