import "server-only";

import { sql } from "drizzle-orm";

import type { Db } from "@/db/client";

/**
 * Who does something to an order (wave 3, run 2, D173): a staff member (`accountId` set) or the system (the five-minute job, a return starting). Every write of
 * order operations carries one, so each order's history says who, and the audit log names the account (never an email or a name).
 */
export type OrderActor = { accountId: string | null; kind: "staff" | "system" };

export const staffActor = (accountId: string | null): OrderActor => ({ accountId, kind: "staff" });
export const SYSTEM_ACTOR: OrderActor = { accountId: null, kind: "system" };

/** Writes one event of an order's history (append-only). Its free text is `data.reason` and `data.note`, the two keys an erasure removes (D162). */
export async function writeOrderEvent(
  tx: Pick<Db, "execute">,
  storeId: string,
  orderId: string,
  type: string,
  data: Record<string, unknown>,
  actor: string,
): Promise<void> {
  await tx.execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${storeId}::uuid, ${orderId}::uuid, ${type}, ${JSON.stringify(data)}::jsonb, ${actor})
  `);
}
