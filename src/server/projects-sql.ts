import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { uuidList } from "./sql-arrays";

/**
 * The `set` list of a projects or checklists update (D903): only the columns a patch gives (an `undefined` value is left out, a `null`
 * clears), then `updated_at`. The schema is never loaded at run time (`schema-import.scan.test.ts`), so the columns are written here.
 */
export function setList(columns: readonly (readonly [SQL, unknown])[], touch = true): SQL | null {
  const given = columns.filter(([, value]) => value !== undefined).map(([column, value]) => sql`${column} = ${value}`);
  if (given.length === 0) return null;
  return sql.join(touch ? [...given, sql`updated_at = now()`] : given, sql`, `);
}

/** An instant for a `timestamptz` column, or none. */
export const at = (iso: string | null | undefined): Date | null | undefined => (iso === undefined ? undefined : iso ? new Date(iso) : null);

/**
 * Rows put in the order given (`sort_order` 0, 1, …): only the store's, and only those `within` says (a parent's, written on `t`). `touch`
 * marks them changed where the table keeps when.
 */
export function reorderSql(table: SQL, storeId: string, ids: readonly string[], within: SQL = sql`true`, options: { idColumn?: SQL; touch?: boolean } = {}): SQL {
  const touch = options.touch ?? true ? sql`, updated_at = now()` : sql``;
  return sql`
    update ${table} t set sort_order = o.n - 1${touch}
    from unnest(${uuidList(ids)}) with ordinality as o (id, n)
    where t.store_id = ${storeId}::uuid and t.${options.idColumn ?? sql`id`} = o.id and ${within}
  `;
}

/** Whether `ids` name every one of `known` exactly once. */
export const everyOnce = (ids: readonly string[], known: readonly string[]): boolean =>
  ids.length === known.length && new Set(ids).size === ids.length && ids.every((id) => known.includes(id));
