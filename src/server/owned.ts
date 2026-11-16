import "server-only";

import { sql, type SQL } from "drizzle-orm";

/**
 * The one way to filter a store's rows, or Kaizena Flow's own: an equality the store indexes serve (`store_id = $1::uuid`) for a store,
 * `store_id is null` for the platform. The branch is in code because `store_id = null` matches nothing, and `is not distinct from` is not
 * answered from a btree index: it reads every store's rows. An empty id is the platform's, as the private copies this replaced behaved.
 * `column` names an aliased column (`sql\`p.store_id\``).
 */
export const owned = (storeId: string | null, column: SQL = sql`store_id`): SQL =>
  storeId ? sql`${column} = ${storeId}::uuid` : sql`${column} is null`;
