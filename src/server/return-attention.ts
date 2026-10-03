import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { ReturnFigures } from "@/lib/control-center";

import { OVERDUE_SQL } from "./return-sql";

type Row = Record<string, unknown>;

/**
 * What waits in Returns for each of several stores (D153), for the control center and a store's Home: one query for them
 * all. A store with nothing waiting is not in the map. "Overdue" is the queue's own definition (`OVERDUE_SQL`); an
 * acknowledgement that was not sent is a confirmed withdrawal with no `acknowledged_at`; a request is a voluntary return
 * the store has not yet approved or declined.
 */
export async function returnAttention(storeIds: string[]): Promise<Map<string, ReturnFigures>> {
  if (storeIds.length === 0) return new Map();
  const ids = sql.join(storeIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db().execute<Row>(sql`
    select r.store_id,
      count(*) filter (where ${OVERDUE_SQL})::int as overdue,
      count(*) filter (where w.confirmed_at is not null and w.acknowledged_at is null)::int as unacknowledged,
      count(*) filter (where r.status::text = 'requested')::int as requested
    from commerce.returns r
    left join commerce.withdrawal_requests w on w.store_id = r.store_id and w.id = r.withdrawal_request_id
    where r.store_id in (${ids})
    group by r.store_id
  `);
  const found = new Map<string, ReturnFigures>();
  for (const row of rows) {
    const figures = { overdue: Number(row.overdue), unacknowledged: Number(row.unacknowledged), requested: Number(row.requested) };
    if (figures.overdue + figures.unacknowledged + figures.requested > 0) found.set(String(row.store_id), figures);
  }
  return found;
}
