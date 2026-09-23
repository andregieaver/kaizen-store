import "server-only";

import { sql } from "drizzle-orm";

import { db } from "./client";

/** Counts active markets: proves the connection works and the schema is there. */
export async function countActiveMarkets(): Promise<number> {
  const rows = await db().execute<{ active: number }>(
    sql`select count(*)::int as active from commerce.markets where active`,
  );
  return rows[0].active;
}
