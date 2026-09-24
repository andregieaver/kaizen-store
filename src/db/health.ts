import "server-only";

import { sql } from "drizzle-orm";

import { db } from "./client";

/**
 * Counts the template store's active markets: proves the connection works,
 * the schema is there and the template store exists.
 */
export async function countActiveMarkets(): Promise<number> {
  const rows = await db().execute<{ active: number }>(sql`
    select count(*)::int as active from commerce.markets m
    join commerce.stores s on s.id = m.store_id
    where s.is_template and m.active
  `);
  return rows[0].active;
}
