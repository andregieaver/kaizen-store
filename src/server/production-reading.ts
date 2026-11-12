import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";

import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * Production's own statistics, read once a day (bloat review step 0.2): the only writer of `commerce.platform_readings`. One row per
 * commerce table, one per schema and the app's role's costliest and most-called statements (Postgres has already replaced their values),
 * kept `READING_KEEP_DAYS`. No person, store or account.
 */

export const READING_KEEP_DAYS = 90;
export const READING_STATEMENTS = 40;

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** Writes the day's reading; a day already read is left as it is. Table and schema rows come first, the statements only where the view can be read. */
export async function recordProductionReading(now: Date = new Date()): Promise<{ tables: number; schemas: number; statements: number }> {
  const day = utcDay(now);
  return db().transaction(async (tx) => {
    const tables = await tx.execute(sql`
      insert into commerce.platform_readings (day, kind, name, figures)
      select ${day}::date, 'table', relname, jsonb_build_object(
        'rows', n_live_tup, 'bytes', pg_total_relation_size(relid), 'seq_scan', seq_scan, 'seq_tup_read', seq_tup_read,
        'idx_scan', coalesce(idx_scan, 0), 'inserted', n_tup_ins, 'updated', n_tup_upd, 'deleted', n_tup_del)
      from pg_stat_user_tables where schemaname = 'commerce'
      on conflict (day, kind, name) do nothing
      returning 1
    `);
    const schemas = await tx.execute(sql`
      insert into commerce.platform_readings (day, kind, name, figures)
      select ${day}::date, 'schema', n.nspname, jsonb_build_object('bytes', coalesce(sum(pg_total_relation_size(c.oid)), 0), 'tables', count(*))
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'm') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
      group by n.nspname
      on conflict (day, kind, name) do nothing
      returning 1
    `);
    let statements = 0;
    try {
      statements = await tx.transaction(async (inner) => {
        const found = await typedRows(
          z.object({ schema: col.text }),
          sql`select n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_stat_statements'`,
          inner,
        );
        if (found.length === 0) return 0;
        const schema = found[0].schema;
        if (!/^[a-z_]+$/.test(schema)) return 0;
        const view = sql`${sql.identifier(schema)}.${sql.identifier("pg_stat_statements")}`;
        const rows = await inner.execute(sql`
          with mine as (
            select s.queryid::text as id, s.calls, s.total_exec_time, s.mean_exec_time, s.rows, left(s.query, 2000) as query
            from ${view} s
            where s.userid = (select oid from pg_roles where rolname = current_user) and s.queryid is not null
          ),
          by_time as (select id from mine order by total_exec_time desc limit ${READING_STATEMENTS}),
          by_calls as (select id from mine order by calls desc limit ${READING_STATEMENTS})
          insert into commerce.platform_readings (day, kind, name, figures, query)
          select ${day}::date, 'statement', m.id, jsonb_build_object(
            'calls', m.calls, 'total_ms', round(m.total_exec_time::numeric, 1), 'mean_ms', round(m.mean_exec_time::numeric, 3), 'rows', m.rows,
            'top', case when m.id in (select id from by_time) and m.id in (select id from by_calls) then 'both'
                        when m.id in (select id from by_time) then 'time' else 'calls' end), m.query
          from mine m where m.id in (select id from by_time union select id from by_calls)
          on conflict (day, kind, name) do nothing
          returning 1
        `);
        return rows.length;
      });
    } catch (error) {
      log("warn", "production_reading.statements_failed", {}, error);
      statements = 0;
    }
    return { tables: tables.length, schemas: schemas.length, statements };
  });
}

/** Deletes readings older than `READING_KEEP_DAYS` (the daily job). Never throws: what it managed is returned. */
export async function pruneProductionReadings(now: Date = new Date()): Promise<number> {
  try {
    const rows = await db().execute(sql`
      delete from commerce.platform_readings where day < ${utcDay(now)}::date - ${READING_KEEP_DAYS}::int returning 1
    `);
    return rows.length;
  } catch (error) {
    log("warn", "production_reading.prune_failed", {}, error);
    return 0;
  }
}
