import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { MARKETING_EMAIL_KINDS } from "@/lib/usage-metrics";

import { costMicrosSql, priceFor } from "./ai-price-sql";

/**
 * The counts behind the gauges and counters of D314 (`docs/capacity.md` 3), written once: the daily measuring
 * (`usage-meter.ts`) and the live checks before an action (`limits.ts`) both read them, so they can never count differently. Each
 * gives rows of `(store_id, value)`, for every store or, with `storeId`, for one.
 */

const only = (column: SQL, storeId?: string) => (storeId ? sql`and ${column} = ${storeId}::uuid` : sql``);

/** Products not archived. */
export const productsSql = (storeId?: string) => sql`
  select p.store_id, count(*)::bigint as value from commerce.products p
  where p.status <> 'archived' ${only(sql`p.store_id`, storeId)}
  group by p.store_id`;

/** Members not disabled, and collaborators whose time has not run out (as `getMembership()` reads them). */
export const staffSql = (storeId?: string) => sql`
  select m.store_id, count(*)::bigint as value from commerce.store_members m
  where m.disabled_at is null and (m.expires_at is null or m.expires_at > now()) ${only(sql`m.store_id`, storeId)}
  group by m.store_id`;

/** The store's own domains, waiting or active. */
export const domainsSql = (storeId?: string) => sql`
  select d.store_id, count(*)::bigint as value from commerce.store_domains d
  where true ${only(sql`d.store_id`, storeId)}
  group by d.store_id`;

/** Emails of a time span. Rows only logged (no email service) or failed never reached anyone and are not counted. */
export const emailsSql = (from: Date, to: Date, marketing: boolean, storeId?: string) => sql`
  select e.store_id, count(*)::bigint as value from commerce.email_messages e
  where e.created_at >= ${from.toISOString()}::timestamptz and e.created_at < ${to.toISOString()}::timestamptz
    and e.status not in ('logged', 'failed')
    ${marketing ? sql`and e.kind in (${sql.join(MARKETING_EMAIL_KINDS.map((k) => sql`${k}`), sql`, `)})` : sql``}
    ${only(sql`e.store_id`, storeId)}
  group by e.store_id`;

/** What the AI cost on Kaizena Flow's key in a time span, in millionths of a dollar; a call with no price counts nothing. */
export const aiCostSql = (from: Date, to: Date, storeId?: string) => sql`
  select u.store_id, coalesce(sum(coalesce(${costMicrosSql}, 0)), 0)::bigint as value from commerce.ai_usage u
  ${priceFor}
  where u.source = 'platform' and u.created_at >= ${from.toISOString()}::timestamptz and u.created_at < ${to.toISOString()}::timestamptz
    ${only(sql`u.store_id`, storeId)}
  group by u.store_id`;
