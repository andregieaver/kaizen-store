import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { LIMITS, type LimitKey } from "@/lib/limits";
import { monthOf, USAGE_METRIC_IDS, USAGE_METRICS, type UsageMetric } from "@/lib/usage-metrics";
import { usageLine, type UsageLine } from "@/lib/usage-view";

import { ownedStores } from "./ai-usage";
import { storeLimits, usageNow } from "./limits";

/**
 * Reading usage for people (D314, `docs/capacity.md` step 1.5): a store's lines against its limits (its Billing page, the owner's page),
 * every store's month for the platform, and a metric's days for the details. Gauges are read live (as the checks read them); counters
 * are the month's measured days. A metric no source has written is *not measured*, never zero.
 */

type Row = Record<string, unknown>;

/** The metrics an owner reads, each with the limit that compares it. */
export const OWNER_LINES: readonly { metric: UsageMetric; key: LimitKey }[] = [
  { metric: "storage_bytes", key: "storage_bytes" },
  { metric: "products", key: "products" },
  { metric: "staff_seats", key: "staff_seats" },
  { metric: "custom_domains", key: "custom_domains" },
  { metric: "requests", key: "requests_month" },
  { metric: "egress_bytes", key: "egress_bytes_month" },
  { metric: "marketing_emails", key: "marketing_emails_month" },
  { metric: "ai_cost_micros", key: "ai_cost_month_micros" },
];

/** Which counter metrics anything wrote this month, for a store (traffic needs the drain: a store with no row is not measured). */
async function measuredCounters(storeId: string, now: Date): Promise<{ measured: Set<string>; estimated: Set<string> }> {
  const { start, end } = monthOf(now);
  const rows = await db().execute<Row>(sql`
    select metric, bool_or(estimated) as estimated from commerce.store_usage_daily
    where store_id = ${storeId}::uuid and day between ${start}::date and ${end}::date group by metric
  `);
  return { measured: new Set(rows.map((r) => String(r.metric))), estimated: new Set(rows.filter((r) => r.estimated === true).map((r) => String(r.metric))) };
}

/** Whether the drain has written anything for any site in the last two days: without it, traffic is not measured anywhere. */
export async function drainConnected(now: Date = new Date()): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select exists (select 1 from commerce.store_usage_daily where metric = 'requests' and day >= ${new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10)}::date) as on
  `);
  return row?.on === true;
}

/** A store's usage this month against each of its limits. */
export async function storeUsageLines(storeId: string, now: Date = new Date()): Promise<UsageLine[]> {
  const [{ limits }, counted, drain] = await Promise.all([storeLimits(storeId), measuredCounters(storeId, now), drainConnected(now)]);
  return Promise.all(
    OWNER_LINES.map(async ({ metric, key }) => {
      const traffic = USAGE_METRICS[metric].source === "traffic";
      const measured = USAGE_METRICS[metric].kind === "gauge" || (traffic ? drain && counted.measured.has(metric) : true);
      const used = measured ? await usageNow(storeId, key, now) : 0;
      return usageLine({ metric, key, used, measured, estimated: counted.estimated.has(metric), limit: limits[key].value, origin: limits[key].origin, enforce: LIMITS[key].enforce });
    }),
  );
}

export type OwnerUsage = { stores: { id: string; slug: string; name: string; lines: UsageLine[] }[] };

/** The owner's stores, each with its lines. */
export async function ownerUsage(accountId: string, now: Date = new Date()): Promise<OwnerUsage> {
  const stores = await ownedStores(accountId);
  return { stores: await Promise.all(stores.map(async (s) => ({ ...s, lines: await storeUsageLines(s.id, now) }))) };
}

export type PlatformUsageRow = { storeId: string | null; slug: string | null; name: string | null; plan: string | null; status: string | null; values: Partial<Record<UsageMetric, number>>; estimated: boolean };

/** Every store's month (and Kaizena Flow's own site first): gauges the latest measured day, counters summed. */
export async function platformUsage(month: string): Promise<PlatformUsageRow[]> {
  const { start, end } = monthOf(new Date(`${month}-01T00:00:00Z`));
  const gauges = USAGE_METRIC_IDS.filter((m) => USAGE_METRICS[m].kind === "gauge");
  const rows = await db().execute<Row>(sql`
    with figures as (
      select u.store_id, u.metric,
             case when u.metric in (${sql.join(gauges.map((g) => sql`${g}`), sql`, `)})
                  then (array_agg(u.value order by u.day desc))[1] else sum(u.value) end as value,
             bool_or(u.estimated) as estimated
      from commerce.store_usage_daily u
      where u.day between ${start}::date and ${end}::date
      group by u.store_id, u.metric
    )
    select f.store_id, s.slug, s.name, s.status, p.name as plan,
           jsonb_object_agg(f.metric, f.value) as values, bool_or(f.estimated) as estimated
    from figures f
    left join commerce.stores s on s.id = f.store_id
    left join commerce.store_billing b on b.store_id = f.store_id
    left join commerce.plans p on p.id = b.plan_id
    where f.store_id is null or not (s.is_template or s.starter)
    group by f.store_id, s.slug, s.name, s.status, p.name
    order by f.store_id is not null, s.name
  `);
  return rows.map((r) => ({
    storeId: r.store_id ? String(r.store_id) : null,
    slug: r.slug ? String(r.slug) : null,
    name: r.name ? String(r.name) : null,
    plan: r.plan ? String(r.plan) : null,
    status: r.status ? String(r.status) : null,
    values: Object.fromEntries(Object.entries((r.values ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v)])) as Partial<Record<UsageMetric, number>>,
    estimated: r.estimated === true,
  }));
}

/** A metric's measured days, newest last, for Lisa's details. */
export async function usageHistory(storeId: string, metric: UsageMetric, days = 90, now: Date = new Date()): Promise<{ day: string; value: number }[]> {
  const from = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db().execute<Row>(sql`
    select day::text as day, value from commerce.store_usage_daily
    where store_id = ${storeId}::uuid and metric = ${metric} and day >= ${from}::date order by day
  `);
  return rows.map((r) => ({ day: String(r.day), value: Number(r.value) }));
}

/** The database at a glance, for the platform's page: active connections and its size in bytes. */
export async function databaseGlance(): Promise<{ active: number; bytes: number }> {
  const [row] = await db().execute<Row>(sql`
    select (select count(*)::int from pg_stat_activity where state = 'active') as active, pg_database_size(current_database())::bigint as bytes
  `);
  return { active: Number(row?.active ?? 0), bytes: Number(row?.bytes ?? 0) };
}

/** A store's measured days of every metric, newest first, for the details under its usage. */
export async function usageDays(storeId: string, days = 30, now: Date = new Date()): Promise<{ day: string; values: Partial<Record<UsageMetric, number>> }[]> {
  const from = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db().execute<Row>(sql`
    select day::text as day, jsonb_object_agg(metric, value) as values from commerce.store_usage_daily
    where store_id = ${storeId}::uuid and day >= ${from}::date group by day order by day desc
  `);
  return rows.map((r) => ({ day: String(r.day), values: Object.fromEntries(Object.entries((r.values ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v)])) }));
}

/** How many hard limits a store has used up, for the control center; 0 at once when its plan sets none. */
export async function limitsReachedCount(storeId: string, now: Date = new Date()): Promise<number> {
  const { limits } = await storeLimits(storeId);
  if (!OWNER_LINES.some(({ key }) => LIMITS[key].enforce === "hard" && limits[key].value !== null)) return 0;
  const lines = await storeUsageLines(storeId, now);
  return lines.filter((l) => l.enforce === "hard" && (l.state === "reached" || l.state === "over")).length;
}
