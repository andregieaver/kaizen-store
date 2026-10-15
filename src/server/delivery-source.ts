import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

export type DeliverySource = "staff" | "handover" | "carrier";

/**
 * Who recorded an order's receipt (wave 3, D238, `docs/wave-3-notifications.md` 3.1), for the staff order page: `carrier` (a verified *delivered* event,
 * `commerce.record_carrier_delivery()`), `handover` (*Collected* or the store's driver), `staff` (*Mark delivered*); a date written before the column
 * existed has no source and reads as `staff`. Null when no receipt is recorded or the order is not the store's.
 */
export async function deliverySourceOf(storeId: string, orderId: string): Promise<{ source: DeliverySource; at: string } | null> {
  const [row] = await db().execute<Record<string, unknown>>(sql`
    select delivered_at, delivered_source from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid and delivered_at is not null
  `);
  if (!row) return null;
  const source = row.delivered_source === "carrier" || row.delivered_source === "handover" ? row.delivered_source : "staff";
  return { source, at: new Date(String(row.delivered_at)).toISOString() };
}
