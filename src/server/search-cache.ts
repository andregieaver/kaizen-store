import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

type Row = Record<string, unknown>;

/**
 * The search cache (`commerce.search_cache`, D74, D75): answers from the
 * store's AI kept for the same search, so it is asked once, whichever
 * server instance serves the next one. Failures are never kept.
 */

export type CacheKind = "vector" | "filters";

/** Days an answer is kept; searches can hold personal data. */
export const SEARCH_CACHE_DAYS = 30;

/** The key: an md5 of everything the answer depends on, so a change to any of them asks again. */
export function cacheKey(...parts: string[]): string {
  return createHash("md5").update(parts.join("\u001f")).digest("hex");
}

/** The kept answer, or makes it with `make` and keeps it. */
export async function cached<T>(storeId: string, kind: CacheKind, key: string, make: () => Promise<T>): Promise<T> {
  const [hit] = await db().execute<Row>(sql`
    select value from commerce.search_cache
    where store_id = ${storeId}::uuid and kind = ${kind} and key = ${key}
      and created_at > now() - make_interval(days => ${SEARCH_CACHE_DAYS})
  `);
  if (hit) return hit.value as T;
  const value = await make();
  await db().execute(sql`
    insert into commerce.search_cache (store_id, kind, key, value)
    values (${storeId}::uuid, ${kind}, ${key}, ${JSON.stringify(value)}::jsonb)
    on conflict (store_id, kind, key) do update set value = excluded.value, created_at = now()
  `);
  return value;
}

/** Forgets answers older than `SEARCH_CACHE_DAYS`; from the five-minute cron. */
export async function pruneSearchCache(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.search_cache where created_at < now() - make_interval(days => ${SEARCH_CACHE_DAYS}) returning 1
  `);
  return rows.length;
}
