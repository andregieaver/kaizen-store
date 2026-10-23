import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { effectiveLimit, LIMIT_KEYS, LIMITS, type LimitKey, type LimitOrigin, type LimitSource, wouldPass } from "@/lib/limits";
import { ON_PLAN_STATUSES } from "@/lib/plans";
import { limitRefusal } from "@/lib/usage-format";
import { monthFigure, monthOf, type UsageMetric } from "@/lib/usage-metrics";

import { aiCostSql, domainsSql, emailsSql, productsSql, staffSql } from "./usage-sql";

/**
 * A store's and an owner's limits (D314, `docs/capacity.md` 4, steps 2.3 and 2.4): the store's override that has not ended, else its
 * plan's while the store is on it (`ON_PLAN_STATUSES`, the same rule as Kaizena Flow's fee), else the platform default, else unlimited.
 * Templates and demo stores are never limited. Numbers are rows the platform admin edits, read here and nowhere else.
 */

type Row = Record<string, unknown>;

/**
 * Limits are read at most once a minute per store and server instance: they change rarely (a plan, an override, the editor), and the
 * instance that changes them forgets them at once (`forgetLimits()`); another instance follows within the minute.
 */
const LIMITS_FRESH_MS = 60_000;
const memo = new Map<string, { at: number; value: StoreLimits }>();

/** After a change to a store's plan or overrides, or to the plans' limits (no store): read again on the next ask. */
export function forgetLimits(storeId?: string): void {
  if (storeId) memo.delete(storeId);
  else memo.clear();
}

const onPlan = sql.raw(ON_PLAN_STATUSES.map((s) => `'${s}'`).join(", "));
const sourceOf = (row: Row | undefined): LimitSource => (row ? { value: row.value == null ? null : Number(row.value) } : undefined);

export type ResolvedLimit = { value: number | null; origin: LimitOrigin };
export type StoreLimits = { exempt: boolean; limits: Record<LimitKey, ResolvedLimit> };

/** Every limit of a store, resolved, with where each comes from. */
export async function storeLimits(storeId: string, now = Date.now()): Promise<StoreLimits> {
  const kept = memo.get(storeId);
  if (kept && now - kept.at < LIMITS_FRESH_MS) return kept.value;
  const value = await readStoreLimits(storeId);
  memo.set(storeId, { at: now, value });
  return value;
}

async function readStoreLimits(storeId: string): Promise<StoreLimits> {
  const rows = await db().execute<Row>(sql`
    select 'store' as kind, s.is_template or s.starter as exempt, null as key, null as value from commerce.stores s where s.id = ${storeId}::uuid
    union all
    select 'override', null, o.key, o.value from commerce.limit_overrides o
     where o.store_id = ${storeId}::uuid and (o.expires_at is null or o.expires_at > now())
    union all
    select 'plan', null, l.key, l.value from commerce.store_billing b
      join commerce.plan_limits l on l.plan_id = b.plan_id
     where b.store_id = ${storeId}::uuid and b.status in (${onPlan})
    union all
    select 'platform', null, l.key, l.value from commerce.plan_limits l where l.plan_id is null
  `);
  const exempt = rows.some((r) => r.kind === "store" && r.exempt === true);
  const pick = (kind: string, key: LimitKey) => sourceOf(rows.find((r) => r.kind === kind && r.key === key));
  const limits = Object.fromEntries(
    LIMIT_KEYS.map((key) => [
      key,
      exempt ? { value: null, origin: "none" as const } : effectiveLimit({ override: pick("override", key), plan: pick("plan", key), platform: pick("platform", key) }),
    ]),
  ) as Record<LimitKey, ResolvedLimit>;
  return { exempt, limits };
}

/** One limit of a store; null is unlimited. */
export async function limitFor(storeId: string, key: LimitKey): Promise<number | null> {
  return (await storeLimits(storeId)).limits[key].value;
}

/**
 * An owner-wide limit (`scope: "owner"`): the account's override, else the largest of the plans of the open stores it owns (any
 * unlimited wins), else the platform default, else unlimited.
 */
export async function ownerLimitFor(accountId: string, key: LimitKey): Promise<ResolvedLimit> {
  const rows = await db().execute<Row>(sql`
    select 'override' as kind, o.value, null::uuid as store_id from commerce.limit_overrides o
     where o.account_id = ${accountId}::uuid and o.key = ${key} and (o.expires_at is null or o.expires_at > now())
    union all
    select 'store', null, s.id from commerce.store_members m
      join commerce.stores s on s.id = m.store_id and s.status <> 'closed' and not (s.is_template or s.starter)
     where m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null
    union all
    select 'plan', l.value, b.store_id from commerce.store_billing b
      join commerce.plan_limits l on l.plan_id = b.plan_id and l.key = ${key}
      join commerce.store_members m on m.store_id = b.store_id and m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null
     where b.status in (${onPlan})
    union all
    select 'platform', l.value, null from commerce.plan_limits l where l.plan_id is null and l.key = ${key}
  `);
  const override = rows.find((r) => r.kind === "override");
  if (override) return { value: override.value == null ? null : Number(override.value), origin: "override" };
  const platform = sourceOf(rows.find((r) => r.kind === "platform"));
  const stores = rows.filter((r) => r.kind === "store").map((r) => String(r.store_id));
  if (stores.length === 0) return effectiveLimit({ platform });
  let best: ResolvedLimit | null = null;
  for (const store of stores) {
    const each = effectiveLimit({ plan: sourceOf(rows.find((r) => r.kind === "plan" && String(r.store_id) === store)), platform });
    if (each.value === null) return each;
    if (!best || (best.value !== null && each.value > best.value)) best = each;
  }
  return best ?? { value: null, origin: "none" };
}

/** The stores an account owns that count towards `stores_owned`: open ones, never templates. */
export async function ownedStoreCount(accountId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(distinct s.id)::int as n from commerce.store_members m
      join commerce.stores s on s.id = m.store_id and s.status <> 'closed' and not (s.is_template or s.starter)
     where m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null
  `);
  return Number(row?.n ?? 0);
}

/** AI cost this month per store, kept a minute per instance: `aiFor()` asks it often. */
const aiMemo = new Map<string, { at: number; value: number }>();

async function liveValue(storeId: string, metric: UsageMetric, now: Date): Promise<number> {
  const month = new Date(`${monthOf(now).start}T00:00:00Z`);
  const first = async (query: ReturnType<typeof productsSql>) => Number((await db().execute<Row>(query))[0]?.value ?? 0);
  switch (metric) {
    case "products":
      return first(productsSql(storeId));
    case "staff_seats":
      return first(staffSql(storeId));
    case "custom_domains":
      return first(domainsSql(storeId));
    case "marketing_emails":
      return first(emailsSql(month, now, true, storeId));
    case "emails":
      return first(emailsSql(month, now, false, storeId));
    case "ai_cost_micros": {
      const memo = aiMemo.get(storeId);
      if (memo && now.getTime() - memo.at < 60_000) return memo.value;
      const value = await first(aiCostSql(month, now, storeId));
      aiMemo.set(storeId, { at: now.getTime(), value });
      return value;
    }
    case "storage_bytes": {
      // The last measured size, and what the library gained since (a refusal must not wait for the night's measuring).
      const [row] = await db().execute<Row>(sql`
        select coalesce((select value from commerce.store_usage_daily where store_id = ${storeId}::uuid and metric = 'storage_bytes' order by day desc limit 1), 0)
             + coalesce((select sum(m.size_bytes) from commerce.media m
                          where m.store_id = ${storeId}::uuid
                            and m.created_at > coalesce((select updated_at from commerce.store_usage_daily where store_id = ${storeId}::uuid and metric = 'storage_bytes' order by day desc limit 1), '-infinity'::timestamptz)), 0) as value
      `);
      return Number(row?.value ?? 0);
    }
    default: {
      const { start, end } = monthOf(now);
      const rows = await db().execute<Row>(sql`
        select day::text as day, value from commerce.store_usage_daily
         where store_id = ${storeId}::uuid and metric = ${metric} and day between ${start}::date and ${end}::date
      `);
      return monthFigure(rows.map((r) => ({ day: String(r.day), value: Number(r.value) })), metric);
    }
  }
}

/** What a store uses now of what a limit compares. */
export async function usageNow(storeId: string, key: LimitKey, now: Date = new Date()): Promise<number> {
  const metric = LIMITS[key].metric;
  if (metric === null) return 0;
  return liveValue(storeId, metric, now);
}

export type LimitCheck = { ok: true } | { ok: false; key: LimitKey; limit: number; used: number };

/** Whether adding `adding` stays within a store's hard limit; soft limits and unlimited ones always pass. */
export async function checkLimit(storeId: string, key: LimitKey, adding = 1, now: Date = new Date()): Promise<LimitCheck> {
  if (LIMITS[key].enforce === "soft") return { ok: true };
  const limit = await limitFor(storeId, key);
  if (limit === null) return { ok: true };
  const used = await usageNow(storeId, key, now);
  return wouldPass(key, used, limit, adding) ? { ok: false, key, limit, used } : { ok: true };
}

/** Whether an owner may have one more store. */
export async function checkOwnerStores(accountId: string): Promise<LimitCheck> {
  const { value } = await ownerLimitFor(accountId, "stores_owned");
  if (value === null) return { ok: true };
  const used = await ownedStoreCount(accountId);
  return wouldPass("stores_owned", used, value, 1) ? { ok: false, key: "stores_owned", limit: value, used } : { ok: true };
}

/** For tests: forget every memo. */
export function forgetLimitMemos(): void {
  aiMemo.clear();
  memo.clear();
}

/**
 * Why an upload of `bytes` must be refused (the store's storage limit), or null. For uploads a person makes; the platform's own copies
 * (templates, themes, demo content, store copies, Compress) are never refused, only counted the next night. Kaizena Flow's own site
 * (`platform`) is never limited.
 */
export async function storageRefusal(storeId: string | null, bytes: number): Promise<string | null> {
  if (!storeId || !/^[0-9a-f-]{36}$/i.test(storeId)) return null;
  const check = await checkLimit(storeId, "storage_bytes", Math.max(1, bytes));
  return check.ok ? null : limitRefusal("storage_bytes", check.limit);
}
