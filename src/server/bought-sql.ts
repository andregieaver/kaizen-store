import "server-only";
import { sql } from "drizzle-orm";

/**
 * An order that was paid, even if it was cancelled and refunded later (the order's alias is `o`). An order copied from
 * another store (D129) is history, not something this store sold, so it is never counted.
 */
export const bought = sql`(o.copied_from is null and (o.status in ('paid', 'fulfilled', 'closed')
  or (o.status = 'cancelled' and exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured'))))`;
