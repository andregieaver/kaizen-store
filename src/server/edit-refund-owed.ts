import "server-only";

import { sql } from "drizzle-orm";

/**
 * What a change's refund still owes the customer (review of wave 3 run 3, D174): a change with a lower total is applied when Stripe answers its refund
 * `pending` (a bank method: the money is on its way, 2.7), so if Stripe later reports that refund `failed` the order reads lower, its credit note stands and the
 * customer has not been paid back. Owed = the difference less the change's refunds that did not fail, less refunds staff made on the order afterwards (they
 * carry no change: an ordinary refund of the order made after the failure was reported), never below 0. A SQL fragment over an `order_edits` row aliased `e`.
 */
export const EDIT_REFUND_OWED_SQL = sql`(case when e.status = 'applied' and e.difference_minor < 0 then greatest(0,
  -e.difference_minor
  - coalesce((select sum(r.amount_minor) from commerce.refunds r where r.store_id = e.store_id and r.order_edit_id = e.id and r.status::text <> 'failed'), 0)
  - coalesce((select sum(r.amount_minor) from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
               where r.store_id = e.store_id and p.order_id = e.order_id and r.order_edit_id is null and r.status::text <> 'failed'
                 and r.created_at > (select max(ev.created_at) from commerce.order_events ev
                                      where ev.store_id = e.store_id and ev.order_id = e.order_id and ev.type = 'order.edit_refund_failed' and ev.data ->> 'edit' = e.id::text)), 0)
) else 0 end)`;
