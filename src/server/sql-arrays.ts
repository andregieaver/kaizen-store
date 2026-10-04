import { sql, type SQL } from "drizzle-orm";

/**
 * Lists as one query value (drizzle spreads a plain array into `($1, $2)`, which `= any(...)` cannot take): a Postgres array literal
 * with the cast, so an empty list is `'{}'::uuid[]` and matches nothing. A uuid is checked, never trusted; text is quoted.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidList(ids: readonly string[]): SQL {
  for (const id of ids) if (!UUID.test(id)) throw new Error("uuidList: not a uuid");
  return sql`${`{${ids.join(",")}}`}::uuid[]`;
}

export function textList(values: readonly string[]): SQL {
  const quoted = values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return sql`${`{${quoted.join(",")}}`}::text[]`;
}
