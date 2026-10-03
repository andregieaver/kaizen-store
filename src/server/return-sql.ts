import { sql } from "drizzle-orm";

/**
 * A withdrawal is overdue when its legal deadline for the refund has passed and nothing was refunded (D153): the queue's
 * *Overdue* mark, its filter and the counts of the control center all use this one condition, on `commerce.returns r`.
 * No `server-only`: it is only a fragment of SQL.
 */
export const OVERDUE_SQL = sql`r.refund_deadline is not null and r.refund_deadline < now() and r.refund_minor is null
  and r.status::text in ('approved', 'in_transit', 'received', 'inspected')`;

/**
 * A withdrawal that was made before the goods were sent, on `commerce.returns r` (D153): the order had no shipment when the
 * store was informed, so there is nothing for the consumer to send back and the store has nothing to hold a refund against
 * (CRD Art. 13(3)). A shipment recorded after the declaration does not change that: the consumer withdrew from goods that
 * had not been sent. Only a withdrawal can be one.
 */
export const NOTHING_SENT_SQL = sql`(r.kind = 'withdrawal' and not exists (
  select 1 from commerce.shipments sh
  where sh.store_id = r.store_id and sh.order_id = r.order_id
    and sh.created_at <= coalesce(
      (select w0.confirmed_at from commerce.withdrawal_requests w0 where w0.store_id = r.store_id and w0.id = r.withdrawal_request_id),
      r.created_at
    )
))`;

/**
 * A return whose goods are settled, on `commerce.returns r`: they are back (received, inspected, closed), the refund was
 * made, or there was nothing to send back. The delivery is refunded with the withdrawal that completes the order, and an
 * earlier or later withdrawal counts towards that only once its goods are settled.
 */
export const SETTLED_SQL = sql`(r.status::text in ('received', 'inspected', 'closed') or r.refund_minor is not null or ${NOTHING_SENT_SQL})`;
