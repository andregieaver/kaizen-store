import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { coldStartRows, INSTANCE_KINDS, type ColdStartRow } from "@/lib/instance-start";

import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * Cold starts as the platform's production figure (bloat review step 1.16): the rows `src/server/instance-start.ts` writes, one for each
 * instance, read for Platform, Usage and limits, and deleted after `INSTANCE_START_KEEP_DAYS`. A row holds the kind, times, memory and the
 * bytes of translated text read at start, and nothing of any request.
 */

export const INSTANCE_START_KEEP_DAYS = 30;

/** Cold starts of the last `days` UTC days, by kind: a day, the median and the 95th percentile of the time to the first answer. */
export async function coldStartReport(days = 7): Promise<{ days: number; total: number; rows: ColdStartRow[] }> {
  const rows = await typedRows(
    z.object({ day: col.text, kind: z.enum(INSTANCE_KINDS), first_ms: col.int }),
    sql`
      select day::text as day, kind, first_ms
      from commerce.instance_starts
      where day > (now() at time zone 'utc')::date - ${days}::int
    `,
  );
  return { days, total: rows.length, rows: coldStartRows(rows.map((r) => ({ day: r.day, kind: r.kind, firstMs: r.first_ms }))) };
}

/** The most translated text any instance read at start on the last day that has a start (0 when none). */
export async function latestUiBytes(): Promise<number> {
  const rows = await typedRows(
    z.object({ bytes: col.int }),
    sql`
      select coalesce(max(ui_bytes), 0)::int as bytes
      from commerce.instance_starts
      where day = (select max(day) from commerce.instance_starts)
    `,
  );
  return rows[0]?.bytes ?? 0;
}

/** Deletes starts older than `INSTANCE_START_KEEP_DAYS` (the daily job). Never throws: what it managed is returned. */
export async function pruneInstanceStarts(): Promise<number> {
  try {
    const rows = await db().execute(sql`
      delete from commerce.instance_starts where day < (now() at time zone 'utc')::date - ${INSTANCE_START_KEEP_DAYS}::int returning 1
    `);
    return rows.length;
  } catch (error) {
    log("warn", "instance_starts.prune_failed", {}, error);
    return 0;
  }
}
