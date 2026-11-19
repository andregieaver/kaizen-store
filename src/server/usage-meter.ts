import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import type { UsageMetric } from "@/lib/usage-metrics";

import { pruneCacheEvents } from "./cache-events";
import { log } from "./log";
import { aiCostSql, contractsSql, domainsSql, emailsSql, productsSql, recordingsSql, staffSql } from "./usage-sql";

/**
 * The daily measuring of D314 (`docs/capacity.md` 3, step 1.3): what every store (templates and demo stores too) and Kaizena Flow's own
 * site (store null) used on a UTC day, written to `commerce.store_usage_daily`. Gauges are measured as they are now; counters are
 * counted over the day. Running a day again gives the same rows. The drain's metrics (requests, bandwidth, errors) are never written
 * here: they are added up by `usage-traffic.ts`.
 */

export const dayBounds = (day: string) => {
  const from = new Date(`${day}T00:00:00Z`);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
};

/** One metric's rows (`store_id`, `value`) written for a day, replacing what was there. */
const write = (day: string, metric: UsageMetric, rows: SQL) => sql`
  insert into commerce.store_usage_daily (store_id, day, metric, value)
  select r.store_id, ${day}::date, ${metric}, r.value from (${rows}) r
  on conflict (store_id, day, metric) do update set value = excluded.value, estimated = false, updated_at = now()`;

/** Gauges, as they are at the time of the run, for `day`. */
function gauges(day: string): SQL[] {
  return [
    write(day, "storage_bytes", sql`select store_id, bytes as value from commerce.storage_bytes_by_store()`),
    write(day, "products", productsSql()),
    write(day, "staff_seats", staffSql()),
    write(day, "custom_domains", domainsSql()),
  ];
}

/** Counters over `day`. */
function counters(day: string): SQL[] {
  const { from, to } = dayBounds(day);
  return [
    write(day, "emails", emailsSql(from, to, false)),
    write(day, "marketing_emails", emailsSql(from, to, true)),
    write(day, "ai_cost_micros", aiCostSql(from, to)),
    write(day, "recordings", recordingsSql(from, to)),
    write(day, "contracts_sent", contractsSql(from, to)),
  ];
}

export type MeasureResult = { day: string; written: number };

/**
 * Measures `day`: its gauges when `gaugesToo`, and its counters. A store that used nothing of a counter gets no row (a month's figure
 * reads a missing day as nothing). One transaction, with a statement time of its own: the job may read every store at once.
 */
export async function measureDay(day: string, gaugesToo: boolean): Promise<MeasureResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Not a day: ${day}`);
  const statements = [...(gaugesToo ? gauges(day) : []), ...counters(day)];
  const result = await db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', '120s', true)`);
    let written = 0;
    for (const statement of statements) {
      const rows = await tx.execute(sql`with w as (${statement} returning 1) select count(*)::int as n from w`);
      written += Number(rows[0]?.n ?? 0);
    }
    return { day, written };
  });
  // The cache events keep 90 days (bloat review step 1.25).
  await pruneCacheEvents().catch((error: unknown) => log("warn", "cache.events_prune_failed", {}, error));
  return result;
}

/** Usage rows older than 25 months go (D314), and hourly traffic older than 35 days (D669); never throws. */
export async function pruneUsageDaily(now: Date = new Date()): Promise<number> {
  try {
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 25, 1)).toISOString().slice(0, 10);
    const rows = await db().execute(sql`with d as (delete from commerce.store_usage_daily where day < ${cutoff}::date returning 1) select count(*)::int as n from d`);
    // Each store's hours (F4, D669) go after 35 days: the watch reads four weeks back.
    const hours = await db().execute(sql`with d as (delete from commerce.store_traffic_hourly where hour < ${now.toISOString()}::timestamptz - interval '35 days' returning 1) select count(*)::int as n from d`);
    return Number(rows[0]?.n ?? 0) + Number(hours[0]?.n ?? 0);
  } catch (error) {
    log("error", "usage.prune_failed", {}, error);
    return 0;
  }
}
