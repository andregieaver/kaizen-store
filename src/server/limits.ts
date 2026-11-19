import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { effectiveLimit, LIMIT_KEYS, LIMITS, type LimitKey, type LimitOrigin, type LimitSource, widestSource, wouldPass } from "@/lib/limits";
import { ON_PLAN_STATUSES } from "@/lib/plans";
import { limitRefusal } from "@/lib/usage-format";
import { monthFigure, monthOf, utcDay, type UsageMetric } from "@/lib/usage-metrics";

import { col, typedRow } from "./typed-rows";
import { dayBounds } from "./usage-meter";
import { aiCostSql, domainsSql, emailsSql, productsSql, recordingsSql, staffSql } from "./usage-sql";

/**
 * A store's and an owner's limits (D314, `docs/capacity.md` 4, steps 2.3 and 2.4): the store's override that has not ended, else its
 * plan's while the store is on it (`ON_PLAN_STATUSES`, the same rule as Kaizena Flow's fee), else the platform default, else unlimited.
 * Templates and demo stores are never limited. Numbers are rows the platform admin edits, read here and nowhere else.
 *
 * An account billed through its account (D748 step E4, `commerce.store_plans.by_account`) has one set of limits for all its stores: its
 * plan's numbers against what its stores use together, its stores' overrides taken at their widest, and `stores_owned` counting its stores.
 * An account billed store by store keeps each store's own, as before.
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
/**
 * `account`: the store's account is billed through its account, and its limits are the account's: `stores` are the account's open stores
 * whose use counts together (never templates, demo or Kaizena Flow's own). Null: the store's limits are its own.
 */
export type StoreLimits = { exempt: boolean; limits: Record<LimitKey, ResolvedLimit>; account: { organisationId: string; stores: string[] } | null };

/** Every limit of a store, resolved, with where each comes from. */
export async function storeLimits(storeId: string, now = Date.now()): Promise<StoreLimits> {
  const kept = memo.get(storeId);
  if (kept && now - kept.at < LIMITS_FRESH_MS) return kept.value;
  const value = await readStoreLimits(storeId);
  memo.set(storeId, { at: now, value });
  return value;
}

/** The stores of an account that count towards its limits: open ones, never templates, demo stores or Kaizena Flow's own. */
const COUNTED = sql`s2.status <> 'closed' and not (s2.is_template or s2.starter or s2.sandbox or s2.house)`;

async function readStoreLimits(storeId: string): Promise<StoreLimits> {
  const rows = await db().execute<Row>(sql`
    select 'store' as kind, s.is_template or s.starter or s.house as exempt, null as key, null as value,
           case when p.by_account then s.organisation_id end as store_id
      from commerce.stores s join commerce.store_plans p on p.store_id = s.id where s.id = ${storeId}::uuid
    union all
    select 'override', null, o.key, o.value, o.store_id from commerce.limit_overrides o
     where (o.expires_at is null or o.expires_at > now())
       and (o.store_id = ${storeId}::uuid or o.store_id in (
             select s2.id from commerce.stores s
               join commerce.organisation_billing ob on ob.organisation_id = s.organisation_id
               join commerce.stores s2 on s2.organisation_id = s.organisation_id
              where s.id = ${storeId}::uuid))
    union all
    select 'plan', null, l.key, l.value, null from commerce.store_plans b
      join commerce.plan_limits l on l.plan_id = b.plan_id
     where b.store_id = ${storeId}::uuid and b.status in (${onPlan})
    union all
    select 'platform', null, l.key, l.value, null from commerce.plan_limits l where l.plan_id is null
    union all
    select 'counted', null, null, null, s2.id from commerce.stores s
      join commerce.organisation_billing ob on ob.organisation_id = s.organisation_id
      join commerce.stores s2 on s2.organisation_id = s.organisation_id and ${COUNTED}
     where s.id = ${storeId}::uuid
  `);
  const own = rows.find((r) => r.kind === "store");
  const exempt = own?.exempt === true;
  const organisationId = own?.store_id ? String(own.store_id) : null;
  const pick = (kind: string, key: LimitKey) => sourceOf(rows.find((r) => r.kind === kind && r.key === key));
  // Billed through its account: every store's override of the account counts, at its widest.
  const override = (key: LimitKey) =>
    organisationId ? widestSource(rows.filter((r) => r.kind === "override" && r.key === key).map(sourceOf)) : pick("override", key);
  const limits = Object.fromEntries(
    LIMIT_KEYS.map((key) => [
      key,
      exempt ? { value: null, origin: "none" as const } : effectiveLimit({ override: override(key), plan: pick("plan", key), platform: pick("platform", key) }),
    ]),
  ) as Record<LimitKey, ResolvedLimit>;
  const stores = rows.filter((r) => r.kind === "counted").map((r) => String(r.store_id));
  return { exempt, limits, account: organisationId && !exempt ? { organisationId, stores: stores.length > 0 ? stores : [storeId] } : null };
}

/** One limit of a store; null is unlimited. */
export async function limitFor(storeId: string, key: LimitKey): Promise<number | null> {
  return (await storeLimits(storeId)).limits[key].value;
}

/**
 * The account a person's new store goes into (`commerce.account_organisation()`: the first one they own), when it is billed through its
 * account; else null.
 */
const BILLED_ACCOUNT = (accountId: string) => sql`
  select f.organisation_id from (
    select m.organisation_id from commerce.organisation_members m
      join commerce.organisations o on o.id = m.organisation_id and not o.platform
     where m.account_id = ${accountId}::uuid and m.role = 'owner'
     order by m.created_at, m.organisation_id limit 1
  ) f where exists (select 1 from commerce.organisation_billing ob where ob.organisation_id = f.organisation_id)
`;

/**
 * An owner-wide limit (`scope: "owner"`): the account's override, else the largest of the plans of the open stores it owns (any
 * unlimited wins), else the platform default, else unlimited. A person whose account is billed through its account (D748 E4) has that
 * account's plan instead of its stores'.
 */
export async function ownerLimitFor(accountId: string, key: LimitKey): Promise<ResolvedLimit> {
  const rows = await db().execute<Row>(sql`
    with billed as (${BILLED_ACCOUNT(accountId)})
    select 'override' as kind, o.value, null::uuid as store_id from commerce.limit_overrides o
     where o.account_id = ${accountId}::uuid and o.key = ${key} and (o.expires_at is null or o.expires_at > now())
    union all
    select 'store', null, s.id from commerce.store_members m
      join commerce.stores s on s.id = m.store_id and s.status <> 'closed' and not (s.is_template or s.starter or s.sandbox or s.house)
     where m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null and not exists (select 1 from billed)
    union all
    select 'plan', l.value, b.store_id from commerce.store_billing b
      join commerce.plan_limits l on l.plan_id = b.plan_id and l.key = ${key}
      join commerce.store_members m on m.store_id = b.store_id and m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null
     where b.status in (${onPlan}) and not exists (select 1 from billed)
    union all
    select 'account', null, b.organisation_id from billed b
    union all
    select 'account_plan', l.value, null from billed b
      join commerce.organisation_billing ob on ob.organisation_id = b.organisation_id and ob.status in (${onPlan})
      join commerce.plan_limits l on l.plan_id = ob.plan_id and l.key = ${key}
    union all
    select 'platform', l.value, null from commerce.plan_limits l where l.plan_id is null and l.key = ${key}
  `);
  const override = rows.find((r) => r.kind === "override");
  if (override) return { value: override.value == null ? null : Number(override.value), origin: "override" };
  const platform = sourceOf(rows.find((r) => r.kind === "platform"));
  if (rows.some((r) => r.kind === "account")) return effectiveLimit({ plan: sourceOf(rows.find((r) => r.kind === "account_plan")), platform });
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

/**
 * The stores that count towards `stores_owned`: open ones, never templates; those the person owns, or, when their account is billed
 * through its account, the account's.
 */
export async function ownedStoreCount(accountId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    with billed as (${BILLED_ACCOUNT(accountId)})
    select case when exists (select 1 from billed) then (
             select count(*)::int from commerce.stores s2 where s2.organisation_id = (select organisation_id from billed) and ${COUNTED})
           else (
             select count(distinct s.id)::int from commerce.store_members m
               join commerce.stores s on s.id = m.store_id and s.status <> 'closed' and not (s.is_template or s.starter or s.sandbox or s.house)
              where m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null)
           end as n
  `);
  return Number(row?.n ?? 0);
}

/** AI cost this month per store, kept a minute per instance: `aiFor()` asks it often. */
const aiMemo = new Map<string, { at: number; value: number }>();

/** A month counter's measured days: their sum, and the last day they cover (null: none, the live count covers the whole month). */
const MEASURED_ROW = z.object({ measured: col.minor, latest: col.text.nullable() });

/**
 * A month counter of a store (`ai_cost_micros`, `marketing_emails`) as the days `measureDay()` wrote plus a live count of the rest, so a
 * check sums a few days of calls, not the whole month's (bloat review step 0.21). A day's row counts only when it was measured after the
 * day ended: the usage job measures today too, and a day it measured while it was still going (today's row, or yesterday's before the
 * night's run, or one whose next run failed) is partial. The measured part ends at the last whole day before the first partial one,
 * and the live part (`live(from)`) counts every call from the next day to now, so a call is counted once. The measured part also ends
 * before the first day the job did not measure whole for every store (`ran`): the job writes no row for a store that used nothing, so a
 * missing row is read as nothing only on a day the job is known to have measured.
 */
async function measuredPlusLive(storeId: string, metric: "ai_cost_micros" | "marketing_emails", now: Date, live: (from: Date) => Promise<number>): Promise<number> {
  const month = monthOf(now).start;
  const row = await typedRow(
    MEASURED_ROW,
    sql`
      with r as (
        select day, value, updated_at >= ((day + 1)::timestamp at time zone 'UTC') as whole
        from commerce.store_usage_daily
        where store_id = ${storeId}::uuid and metric = ${metric} and day >= ${month}::date and day < ${utcDay(now)}::date
      ), ran as (
        -- Whether the usage job measured a day whole for every store: it writes the three counters of all stores in one transaction,
        -- so one whole counter row of any store that day proves the run. A day without one (the job down, or nothing used anywhere)
        -- ends the measured part, so a store's day that has no row because it was never measured is counted live, not lost.
        select d.day, exists (
          select 1 from commerce.store_usage_daily u
          where u.day = d.day and u.metric in ('emails', 'marketing_emails', 'ai_cost_micros')
            and u.updated_at >= ((d.day + 1)::timestamp at time zone 'UTC')
        ) as ok
        from (select generate_series(${month}::date, ${utcDay(now)}::date - 1, interval '1 day')::date as day) d
      ), l as (
        select least(
          (select max(day) from r where whole),
          (select min(day) - 1 from r where not whole),
          (select min(day) - 1 from ran where not ok)
        ) as day
      )
      select coalesce((select sum(r.value) from r, l where r.whole and r.day <= l.day), 0)::bigint as measured, (select day::text from l) as latest
    `,
  );
  const latest = row?.latest ?? null;
  // The day after the last one measured whole; never before the month's first (a partial row on the 1st puts `latest` in the month before).
  const from = latest && latest >= month ? dayBounds(latest).to : new Date(`${month}T00:00:00Z`);
  return (row?.measured ?? 0) + (await live(from));
}

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
      return measuredPlusLive(storeId, "marketing_emails", now, (from) => first(emailsSql(from, now, true, storeId)));
    case "emails":
      return first(emailsSql(month, now, false, storeId));
    case "recordings":
      // Counted live from the month's start (recordings_store_started_idx), never through measuredPlusLive(): its days would count twice.
      return first(recordingsSql(month, now, storeId));
    case "ai_cost_micros": {
      const memo = aiMemo.get(storeId);
      if (memo && now.getTime() - memo.at < 60_000) return memo.value;
      const value = await measuredPlusLive(storeId, "ai_cost_micros", now, (from) => first(aiCostSql(from, now, storeId)));
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

/**
 * What a store uses now of what a limit compares; for a store whose account is billed through its account, what the account's stores use
 * together (each store's own count, summed: a month counter's measured days are kept per store).
 */
export async function usageNow(storeId: string, key: LimitKey, now: Date = new Date()): Promise<number> {
  const metric = LIMITS[key].metric;
  if (metric === null) return 0;
  const { account } = await storeLimits(storeId);
  if (!account) return liveValue(storeId, metric, now);
  const each = await Promise.all(account.stores.map((store) => liveValue(store, metric, now)));
  return each.reduce((sum, n) => sum + n, 0);
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
