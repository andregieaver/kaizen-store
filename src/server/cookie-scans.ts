import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  consentCookieName,
  consentVersion,
  encodeConsent,
  FULL_CONSENT,
  parseTracking,
} from "@/lib/cookie-consent";
import { parseScannedItems, type ScannedItem, type ScanTarget } from "@/lib/cookie-scan";
import { toMarket } from "@/lib/markets";
import { marketPath, storeBase } from "@/lib/paths";
import { siteUrl } from "@/lib/site";

import { audit, type Account } from "./auth";
import { siteCookies } from "./site-cookies";

/**
 * Cookie scans (D58): queued by an owner's Scan now or by the weekly
 * schedule, run one at a time by `/api/cron/cookie-scan` in a real browser
 * (`cookie-scan-runner.ts`, kept apart so only that route carries Chromium),
 * and read by the admin and the cookie pages.
 */

type Row = Record<string, unknown>;

/** A site's scans are one row per site at a time: the null store (Kaizen) as a fixed id. */
const NO_STORE = "00000000-0000-0000-0000-000000000000";

/** How often each open site is scanned without being asked. */
const SCAN_EVERY = "7 days";
/** How long after a failed scan the schedule tries the site again. */
const RETRY_AFTER = "1 hour";

export type ScanStatus = "queued" | "running" | "done" | "failed";

export type CookieScan = {
  id: string;
  status: ScanStatus;
  /** Who asked, or null for the schedule. */
  requestedBy: string | null;
  pages: string[];
  items: ScannedItem[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

/**
 * Asks for a scan of a site now: false when one is already waiting or
 * running, which will do as well.
 */
export async function requestScan(account: Account, storeId: string | null): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    insert into commerce.cookie_scans (store_id, requested_by)
    values (${storeId}::uuid, ${account.id}::uuid)
    on conflict (coalesce(store_id, ${NO_STORE}::uuid)) where status in ('queued', 'running') do nothing
    returning id
  `);
  if (rows.length > 0) await audit(account.id, storeId, "cookies.scan_requested");
  return rows.length > 0;
}

/**
 * Takes the next scan to run: one an owner asked for, else the open site
 * whose last finished scan is oldest, once that is a week old (a failed
 * one is tried again after an hour). Scans left running by
 * a stopped function count as failed after ten minutes.
 */
export async function claimScan(): Promise<{ id: string; storeId: string | null } | null> {
  await db().execute(sql`
    update commerce.cookie_scans set status = 'failed', finished_at = now(), error = 'The scan stopped before it finished.'
    where status = 'running' and started_at < now() - interval '10 minutes'
  `);
  const [asked] = await db().execute<Row>(sql`
    update commerce.cookie_scans set status = 'running', started_at = now()
    where id = (
      select id from commerce.cookie_scans where status = 'queued'
      order by created_at limit 1 for update skip locked
    )
    returning id, store_id
  `);
  const [due] = asked
    ? [asked]
    : await db().execute<Row>(sql`
        with sites as (
          select null::uuid as store_id
          union all
          select s.id from commerce.stores s
          where s.status = 'active' and (s.is_template or s.setup_completed_at is not null)
            and exists (select 1 from commerce.markets m where m.store_id = s.id and m.active)
        ), last as (
          select sites.store_id,
            (select max(c.finished_at) from commerce.cookie_scans c
              where c.store_id is not distinct from sites.store_id and c.status = 'done') as done_at,
            (select max(c.created_at) from commerce.cookie_scans c where c.store_id is not distinct from sites.store_id) as tried_at
          from sites
        )
        insert into commerce.cookie_scans (store_id, status, started_at)
        select store_id, 'running', now() from last
        where (done_at is null or done_at < now() - ${SCAN_EVERY}::interval)
          -- A scan that failed is tried again after an hour, not every minute.
          and (tried_at is null or tried_at < now() - ${RETRY_AFTER}::interval)
        order by done_at nulls first, tried_at nulls first
        limit 1
        on conflict (coalesce(store_id, ${NO_STORE}::uuid)) where status in ('queued', 'running') do nothing
        returning id, store_id
      `);
  return due ? { id: String(due.id), storeId: due.store_id ? String(due.store_id) : null } : null;
}

/** What to open for a site, or null when it is not on the web (closed, or no market). */
export async function scanTarget(storeId: string | null): Promise<ScanTarget | null> {
  let starts: string[];
  let within: (path: string) => boolean;
  let tracking;
  if (storeId === null) {
    const [row] = await db().execute<Row>(sql`select tracking from commerce.platform_settings`);
    tracking = parseTracking(row?.tracking);
    starts = ["/"];
    within = (path) => !path.startsWith("/s/");
  } else {
    const [row] = await db().execute<Row>(sql`
      select s.slug, s.tracking,
        coalesce(json_agg(json_build_object('code', m.code, 'currency', m.currency, 'defaultLocale', m.default_locale)
          order by (m.code = s.country) desc nulls last, m.created_at, m.code) filter (where m.code is not null), '[]') as markets
      from commerce.stores s
      left join commerce.markets m on m.store_id = s.id and m.active
      where s.id = ${storeId}::uuid and s.status = 'active'
      group by s.id
    `);
    const markets = row ? (row.markets as { code: string; currency: string; defaultLocale: string }[]).map(toMarket) : [];
    if (!row || markets.length === 0) return null;
    const slug = String(row.slug);
    tracking = parseTracking(row.tracking);
    starts = markets.slice(0, 3).map((market) => marketPath(slug, market.slug));
    within = (path) => path.startsWith(`${storeBase(slug)}/`);
  }
  const { categories } = await siteCookies(storeId, tracking);
  return {
    origin: siteUrl(),
    starts,
    within,
    consent:
      categories.length === 0
        ? null
        : {
            name: consentCookieName(storeId),
            value: encodeConsent({ visitor: randomUUID(), version: consentVersion(categories), choices: FULL_CONSENT }),
          },
    maxPages: 6,
  };
}

function toScan(row: Row): CookieScan {
  return {
    id: String(row.id),
    status: row.status as ScanStatus,
    requestedBy: row.requested_by_name ? String(row.requested_by_name) : row.requested_by ? "Someone" : null,
    pages: Array.isArray(row.pages) ? row.pages.map(String) : [],
    items: parseScannedItems(row.items),
    error: row.error ? String(row.error) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
  };
}

/** A site's newest scans, newest first. */
export async function listScans(storeId: string | null, limit = 5): Promise<CookieScan[]> {
  const rows = await db().execute<Row>(sql`
    select c.*, coalesce(a.name, a.email) as requested_by_name
    from commerce.cookie_scans c
    left join commerce.accounts a on a.id = c.requested_by
    where c.store_id is not distinct from ${storeId}::uuid
    order by c.created_at desc
    limit ${limit}
  `);
  return rows.map(toScan);
}

/** What the site's latest finished scan found, or null before the first. */
export async function latestFindings(storeId: string | null): Promise<CookieScan | null> {
  const [row] = await db().execute<Row>(sql`
    select c.*, null as requested_by_name from commerce.cookie_scans c
    where c.store_id is not distinct from ${storeId}::uuid and c.status = 'done'
    order by c.finished_at desc
    limit 1
  `);
  return row ? toScan(row) : null;
}
