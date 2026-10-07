import { sql } from "drizzle-orm";

/**
 * A withdrawal is overdue when its legal deadline for the refund has passed and nothing was refunded (D153): the queue's
 * *Overdue* mark, its filter and the counts of the control center all use this one condition, on `commerce.returns r`.
 * No `server-only`: it is only a fragment of SQL.
 */
export const OVERDUE_SQL = sql`r.refund_deadline is not null and r.refund_deadline < now() and r.refund_minor is null
  and r.status::text in ('approved', 'in_transit', 'received', 'inspected')`;

/**
 * A withdrawal with nothing to send back, on `commerce.returns r` (D153, refined by D174 `docs/wave-3-fulfilment.md` 4.2): withdrawn units are taken from the
 * units that were not sent first, so for every line of the withdrawal the units withdrawn from that line by the counting withdrawals made up to and including
 * this one are at most the line's quantity less its units in parcels made before this withdrawal was confirmed (a legacy parcel counts as every unit). Then the
 * consumer has nothing to send back and the store has nothing to hold a refund against (CRD Art. 13(3)). "Withdrew 1 of 3, 1 sent" has nothing to send back;
 * "withdrew 2 of 3, 2 sent" has one unit. A parcel recorded after the declaration does not change that: the consumer withdrew from goods that had not been sent.
 * Units staff closed as not to be sent before it was confirmed (D174 3.16, `commerce.unsent_closures`) are not units the withdrawal can take: they were put back
 * and never delivered, so "1 of 3 sent, 2 closed, withdrew 1" asks the sent unit back. Only a withdrawal can be one. `src/lib/fulfilment.ts` (`unitsToSendBack()`) says the same in code.
 */
export const NOTHING_SENT_SQL = sql`(r.kind = 'withdrawal' and not exists (
  select 1 from commerce.return_lines rl
  join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
  cross join lateral (
    select coalesce(
      (select w0.confirmed_at from commerce.withdrawal_requests w0 where w0.store_id = r.store_id and w0.id = r.withdrawal_request_id),
      r.created_at
    ) as at
  ) conf
  where rl.store_id = r.store_id and rl.return_id = r.id and rl.decision = 'accept'
    and ol.delivery = 'physical' and ol.variant_id is not null
    and (
      select coalesce(sum(rl2.quantity), 0) from commerce.return_lines rl2
      join commerce.returns r2 on r2.store_id = rl2.store_id and r2.id = rl2.return_id
      where rl2.store_id = rl.store_id and rl2.order_line_id = rl.order_line_id and rl2.decision = 'accept'
        and r2.kind = 'withdrawal' and r2.status not in ('declined', 'cancelled')
        and (r2.created_at, r2.id) <= (r.created_at, r.id)
    ) > ol.quantity - (
      case
        when exists (
          select 1 from commerce.shipments sh
          where sh.store_id = r.store_id and sh.order_id = r.order_id and sh.legacy and sh.created_at <= conf.at
        ) then ol.quantity
        else least(ol.quantity, coalesce((
          select sum(sl.quantity) from commerce.shipment_lines sl
          join commerce.shipments sh on sh.store_id = sl.store_id and sh.id = sl.shipment_id
          where sl.store_id = rl.store_id and sl.order_line_id = rl.order_line_id and sh.created_at <= conf.at
        ), 0))
      end
    ) - coalesce((
      select sum(c.quantity) from commerce.unsent_closures c
      where c.store_id = rl.store_id and c.order_line_id = rl.order_line_id and c.created_at <= conf.at
    ), 0)
))`;

/**
 * A return whose goods are settled, on `commerce.returns r`: they are back (received, inspected, closed), the refund was
 * made, or there was nothing to send back. The delivery is refunded with the withdrawal that completes the order, and an
 * earlier or later withdrawal counts towards that only once its goods are settled.
 */
export const SETTLED_SQL = sql`(r.status::text in ('received', 'inspected', 'closed') or r.refund_minor is not null or ${NOTHING_SENT_SQL})`;
