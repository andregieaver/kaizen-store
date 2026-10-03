import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { dayIn, noonOf } from "@/lib/work-dates";

import { guarded, refusal, type Refused } from "./return-errors";

type Row = Record<string, unknown>;

/**
 * *Mark delivered* (D153): the day the consumer received the goods, the last of them when they came in parts. It is
 * what starts the 14 days of the right of withdrawal (CRD Art. 9(2)(b)), so it is only ever written by staff (or a
 * carrier's confirmed delivery), never estimated from the date a parcel was sent. Until it is written the right stays
 * open and the window says so. A later shipment takes it back (`markSent()`), because the goods are then not all received.
 */
export const markDeliveredInput = z.object({
  orderId: z.uuid(),
  /** The store day (`YYYY-MM-DD`) the goods were received; empty is today. */
  on: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the day as year-month-day.")
    .or(z.literal(""))
    .nullish()
    .transform((value) => value || null),
});

export type DeliveredDone = { ok: true; deliveredAt: string } | Refused;

export async function markDelivered(storeId: string, input: unknown, accountId: string | null, now = new Date()): Promise<DeliveredDone> {
  const parsed = markDeliveredInput.safeParse(input);
  if (!parsed.success) return refusal("invalid", parsed.error.issues[0]?.message ?? "Check the day and try again.");
  const { orderId, on } = parsed.data;
  return guarded(() =>
    db().transaction(async (tx): Promise<DeliveredDone> => {
      const [order] = await tx.execute<Row>(sql`
        select o.status, o.copied_from is not null as copied, o.placed_at, s.time_zone,
          (select min(sh.created_at) from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id) as first_sent
        from commerce.orders o join commerce.stores s on s.id = o.store_id
        where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid for update of o
      `);
      if (!order) return refusal("not_found", "This order no longer exists.");
      if (Boolean(order.copied) || !["paid", "fulfilled", "closed"].includes(String(order.status))) {
        return refusal("not_deliverable", "Only a paid order that has been sent can be marked as delivered.");
      }
      if (!order.first_sent) return refusal("not_sent", "Mark the order as sent before marking it delivered.");
      const zone = String(order.time_zone ?? "Europe/Oslo");
      const day = on ?? dayIn(now, zone);
      let at = noonOf(day, zone);
      if (at.getTime() > now.getTime()) {
        if (on) return refusal("future", "The goods cannot have been received in the future.");
        at = now;
      }
      if (day < dayIn(new Date(String(order.placed_at)), zone)) return refusal("before_order", "The goods cannot have been received before the order was placed.");
      await tx.execute(sql`
        update commerce.orders set delivered_at = ${at.toISOString()}::timestamptz
        where store_id = ${storeId}::uuid and id = ${orderId}::uuid
      `);
      await tx.execute(sql`
        insert into commerce.order_events (store_id, order_id, type, data, actor)
        values (${storeId}::uuid, ${orderId}::uuid, 'order.delivered',
                ${JSON.stringify({ on: day, by: accountId })}::jsonb, 'staff')
      `);
      return { ok: true, deliveredAt: at.toISOString() };
    }),
  ) as Promise<DeliveredDone>;
}
