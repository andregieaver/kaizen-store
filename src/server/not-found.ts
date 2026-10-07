import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { areaOfAction } from "@/lib/audit";
import { writeCsv, type Cell } from "@/lib/csv";
import {
  NOT_FOUND_CSV_ROWS,
  NOT_FOUND_DAY_CAP,
  NOT_FOUND_IGNORED_MAX,
  NOT_FOUND_KEEP_DAYS,
  NOT_FOUND_SCREEN_ROWS,
  NOT_FOUND_SUGGESTIONS,
  NOT_FOUND_THROTTLE_MS,
  NOT_FOUND_WINDOWS,
} from "@/lib/data-limits";
import { lastPartOf, recordablePath, suggestTargets, wordsOf, type Candidate, type Suggestion } from "@/lib/not-found";
import { normalisePath } from "@/lib/redirect-path";

import { type Membership } from "./auth";
import { NO_ACCESS, memberCan } from "./permissions";
import { pgTextArray } from "./pg-arrays";
import { lockRedirects, createRedirect, type RedirectFailure, type SavedRedirect } from "./redirects";
import { OFFERED } from "./product-conditions";

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * The 404 report (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.3, 3.2, 4.5, 4.6): what shoppers and robots asked for that the store did not have,
 * counted per address and day, with a suggested target and a one-click redirect. It keeps the ADDRESS, the day and counts only: never an IP address, a user
 * agent, a cookie, a referrer or a query string, and never an address that could hold a person's data (`recordablePath()` decides, in `src/lib/not-found.ts`).
 * `recordNotFound()` is the only writer (the one SQL function `commerce.record_not_found()`, `redirect-writers.test.ts` scans for another). A count is a lower
 * bound: a request answered from a cache is not seen, and a write that is throttled or dropped is not counted.
 */

const WRITE = "website:write" as const;
const READ = "website:read" as const;

/** What the report must say about the robots' share: a flag from the request, known only where the request itself is (the proxy), never a user agent text. */
export const CRAWLER_NOTE = "Robots are counted only for addresses without a country (such as an old shop's /collections/…), where the request itself is seen. Other counts are shoppers and robots together.";

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const lastWritten = new Map<string, number>();
const THROTTLE_MAX = 5_000;

/** Whether this build's database must not be written to: a prerender at build time is not a visitor. */
const building = (): boolean => process.env.NEXT_PHASE === "phase-production-build";

/**
 * Counts one request for a missing address (`path` in the normal form, no query: the caller reads nothing else of the request). Refused addresses are not
 * recorded (`recordablePath()`); a flood of one address is written once a second at most per server instance; any failure is logged and dropped. Never throws.
 * `crawler` is a flag taken from the request by the caller, never stored as text. True when a row was written.
 */
export async function recordNotFound(storeId: string, path: string, crawler = false, now: number = Date.now()): Promise<boolean> {
  try {
    if (building()) return false;
    const normal = normalisePath(path, 200);
    if (normal === null || !recordablePath(normal)) return false;
    const key = `${storeId}|${normal}`;
    const before = lastWritten.get(key);
    if (before !== undefined && now - before < NOT_FOUND_THROTTLE_MS) return false;
    if (lastWritten.size >= THROTTLE_MAX) lastWritten.clear();
    lastWritten.set(key, now);
    await db().execute(sql`select commerce.record_not_found(${storeId}::uuid, ${normal}, ${crawler === true}, ${NOT_FOUND_DAY_CAP})`);
    return true;
  } catch (error) {
    console.error("[not-found] a miss could not be recorded", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Forgets the throttle (tests). */
export const resetNotFoundThrottle = (): void => lastWritten.clear();

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type ReportWindow = (typeof NOT_FOUND_WINDOWS)[number];
export const isWindow = (days: unknown): days is ReportWindow => NOT_FOUND_WINDOWS.includes(days as ReportWindow);

export type MissingAddress = {
  /** Market-less, in the normal form, as stored. */
  path: string;
  requests: number;
  crawlers: number;
  lastAsked: string;
  /** A redirect from this address exists now. */
  covered: boolean;
  ignored: boolean;
  /** Up to three live addresses it may be sent to, found in code (never a model); only for the rows that lead the list. */
  suggestions: Suggestion[];
};

export type NotFoundReport = {
  days: ReportWindow;
  rows: MissingAddress[];
  /** Different addresses in the window (before the screen's limit and the filters of covered and ignored). */
  distinct: number;
  /** Requests for addresses that were not counted by address (a day's cap of different addresses was reached), and on how many days. */
  uncounted: { requests: number; days: number };
  note: string;
};

/** The rows that carry suggestions: reading a pool of live addresses is the costly part of the report, so the leading rows only. */
export const SUGGESTED_ROWS = 100;

/** Live addresses of the store that share a word with the missing ones, as candidates for `suggestTargets()`: a few thousand at most, never the whole catalogue. */
async function candidatesFor(storeId: string, paths: readonly string[]): Promise<Candidate[]> {
  const words = [...new Set(paths.flatMap((p) => wordsOf(lastPartOf(p))))].slice(0, 300);
  if (words.length === 0) return [];
  const like = pgTextArray(words.map((w) => `%${w.replace(/[\\%_]/g, "\\$&")}%`));
  const rows = await db().execute<Row>(sql`
    select * from (
      select 'product' as kind, '/p/' || p.handle as path, p.handle as slug, coalesce(t.title, p.handle) as title
        from commerce.products p
        left join lateral (select title from commerce.product_translations x where x.product_id = p.id order by x.locale limit 1) t on true
       where p.store_id = ${storeId}::uuid and p.status = 'active' and ${OFFERED} and (p.handle ilike any(${like}::text[]) or t.title ilike any(${like}::text[]))
      union all
      select t.kind, '/' || t.kind || '/' || t.slug, t.slug, t.name from commerce.terms t
       where t.store_id = ${storeId}::uuid and t.content_type = 'product' and (t.slug ilike any(${like}::text[]) or t.name ilike any(${like}::text[]))
      union all
      select pg.type, case when pg.type = 'article' then '/blog/' || lower(pg.slug) else '/' || lower(pg.slug) end, lower(pg.slug), coalesce(nullif(pg.published ->> 'title', ''), pg.slug)
        from commerce.pages pg
       where pg.store_id = ${storeId}::uuid and pg.published_at is not null and pg.type in ('page', 'article')
         and (pg.slug ilike any(${like}::text[]) or (pg.published ->> 'title') ilike any(${like}::text[]))
    ) c limit 3000
  `);
  return rows.map((r) => ({ kind: String(r.kind) as Candidate["kind"], path: String(r.path), slug: String(r.slug), title: String(r.title ?? "") }));
}

export type ReportOptions = { days?: number; showCovered?: boolean; showIgnored?: boolean; limit?: number };

/**
 * The report (2.3): addresses requested and not found in the last 7, 30 or 90 days (30 by default), most requested first (a tie by address), at most 500 on
 * screen. A row already covered by a redirect, or hidden by staff, is left out unless asked for. `website:read`.
 */
export async function notFoundReport(member: Membership, options: ReportOptions = {}): Promise<NotFoundReport | null> {
  if (!memberCan(member, READ)) return null;
  return reportOf(member.store.id, options);
}

/** The same for a caller that has checked the key (the CSV, the assistant). */
export async function reportOf(storeId: string, options: ReportOptions = {}): Promise<NotFoundReport> {
  const days: ReportWindow = isWindow(options.days) ? options.days : NOT_FOUND_WINDOWS[0];
  const limit = Math.min(Math.max(1, options.limit ?? NOT_FOUND_SCREEN_ROWS), NOT_FOUND_CSV_ROWS);
  const since = sql`((now() at time zone 'utc')::date - ${days - 1}::int)`;
  const hide = sql`
    ${options.showCovered ? sql`` : sql`and not exists (select 1 from commerce.redirects r where r.store_id = h.store_id and r.source = h.path)`}
    ${options.showIgnored ? sql`` : sql`and not exists (select 1 from commerce.not_found_ignored i where i.store_id = h.store_id and i.path = h.path)`}`;
  const rows = await db().execute<Row>(sql`
    select h.path, sum(h.hits)::int as requests, sum(h.crawler_hits)::int as crawlers, max(h.last_seen_at) as last_asked,
      exists (select 1 from commerce.redirects r where r.store_id = h.store_id and r.source = h.path) as covered,
      exists (select 1 from commerce.not_found_ignored i where i.store_id = h.store_id and i.path = h.path) as ignored
    from commerce.not_found_hits h
    where h.store_id = ${storeId}::uuid and h.day >= ${since} and h.path is not null ${hide}
    group by h.store_id, h.path
    order by requests desc, h.path
    limit ${limit}
  `);
  const [distinct] = await db().execute<Row>(sql`select count(distinct h.path)::int as n from commerce.not_found_hits h where h.store_id = ${storeId}::uuid and h.day >= ${since} and h.path is not null ${hide}`);
  const [over] = await db().execute<Row>(sql`
    select coalesce(sum(h.hits), 0)::int as requests, count(*)::int as days
    from commerce.not_found_hits h where h.store_id = ${storeId}::uuid and h.day >= ${since} and h.path is null
  `);
  const leading = rows.slice(0, SUGGESTED_ROWS).map((r) => String(r.path));
  const pool = await candidatesFor(storeId, leading).catch((error) => {
    console.error("[not-found] the suggestions could not be read", error instanceof Error ? error.message : error);
    return [] as Candidate[];
  });
  return {
    days,
    rows: rows.map((r, i): MissingAddress => ({
      path: String(r.path),
      requests: Number(r.requests),
      crawlers: Number(r.crawlers),
      lastAsked: new Date(String(r.last_asked)).toISOString(),
      covered: Boolean(r.covered),
      ignored: Boolean(r.ignored),
      suggestions: i < SUGGESTED_ROWS && !r.covered ? suggestTargets(String(r.path), pool, NOT_FOUND_SUGGESTIONS) : [],
    })),
    distinct: Number(distinct?.n ?? 0),
    uncounted: { requests: Number(over?.requests ?? 0), days: Number(over?.days ?? 0) },
    note: CRAWLER_NOTE,
  };
}

/** The report as a file (up to 5,000 rows, through the one CSV writer): address, requests, crawlers, last asked, redirect. `website:read`. */
export async function notFoundCsv(member: Membership, options: ReportOptions = {}): Promise<{ filename: string; csv: string; rows: number } | null> {
  if (!memberCan(member, READ)) return null;
  const report = await reportOf(member.store.id, { ...options, limit: NOT_FOUND_CSV_ROWS });
  const table: Cell[][] = [
    ["address", "requests", "of_which_robots", "last_asked", "redirect"],
    ...report.rows.map((r): Cell[] => [r.path, r.requests, r.crawlers, r.lastAsked.slice(0, 10), r.covered ? "yes" : "no"]),
  ];
  return { filename: `404-report-${report.days}-days-${new Date().toISOString().slice(0, 10)}.csv`, csv: writeCsv(table, "standard"), rows: report.rows.length };
}

// ---------------------------------------------------------------------------
// Acting on a row
// ---------------------------------------------------------------------------

export type ReportFailure = { ok: false; problems: string[] };
const refuse = (problem: string): ReportFailure => ({ ok: false, problems: [problem] });

async function auditIn(tx: Tx, member: Pick<Membership, "account" | "store">, action: string, details: Record<string, unknown>): Promise<void> {
  await tx.execute(sql`
    insert into commerce.audit_log (account_id, store_id, action, details, area, target_type, target_id)
    values (${member.account.id}::uuid, ${member.store.id}::uuid, ${action}, ${JSON.stringify(details)}::jsonb, ${areaOfAction(action)}, 'not_found', ${String(details.path ?? "")})
  `);
}

/** Hides an address from the report's default view for good (at most 1,000 a store). `website:write`. */
export async function ignoreAddress(member: Membership, path: string): Promise<{ ok: true } | ReportFailure> {
  if (!memberCan(member, WRITE)) return refuse(NO_ACCESS);
  const normal = normalisePath(String(path ?? ""), 200);
  if (normal === null || normal === "/") return refuse("That address could not be read.");
  try {
    return await db().transaction(async (tx) => {
      await lockRedirects(tx, member.store.id);
      const [already] = await tx.execute<Row>(sql`select 1 as x from commerce.not_found_ignored where store_id = ${member.store.id}::uuid and path = ${normal}`);
      if (already) return { ok: true as const };
      const [count] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.not_found_ignored where store_id = ${member.store.id}::uuid`);
      if (Number(count.n) >= NOT_FOUND_IGNORED_MAX) return refuse(`At most ${NOT_FOUND_IGNORED_MAX.toLocaleString("en")} addresses can be hidden. Show the hidden ones and restore some first.`);
      await tx.execute(sql`insert into commerce.not_found_ignored (store_id, path, created_by) values (${member.store.id}::uuid, ${normal}, ${member.account.id}::uuid)`);
      await auditIn(tx, member, "not_found.ignored", { path: normal });
      return { ok: true as const };
    });
  } catch (error) {
    console.error("[not-found] an address could not be hidden", error instanceof Error ? error.message : error);
    return refuse("The activity log could not be written, so nothing was changed. Try again.");
  }
}

/** Brings a hidden address back into the report. `website:write`. */
export async function restoreAddress(member: Membership, path: string): Promise<{ ok: true } | ReportFailure> {
  if (!memberCan(member, WRITE)) return refuse(NO_ACCESS);
  const normal = normalisePath(String(path ?? ""), 200);
  if (normal === null) return refuse("That address could not be read.");
  try {
    return await db().transaction(async (tx) => {
      const rows = await tx.execute<Row>(sql`delete from commerce.not_found_ignored where store_id = ${member.store.id}::uuid and path = ${normal} returning path`);
      if (rows.length > 0) await auditIn(tx, member, "not_found.restored", { path: normal });
      return { ok: true as const };
    });
  } catch (error) {
    console.error("[not-found] an address could not be restored", error instanceof Error ? error.message : error);
    return refuse("The activity log could not be written, so nothing was changed. Try again.");
  }
}

/**
 * The one click: makes the manual redirect from a missing address to a target (a suggestion, or one typed in the short form) with the origin `report`, through
 * `createRedirect()` and its one check. The row is then covered and leaves the default view. `website:write`.
 */
export async function redirectFromReport(member: Membership, input: { path: string; to: string }): Promise<SavedRedirect | RedirectFailure> {
  return createRedirect(member, { from: input.path, to: input.to }, { origin: "report" });
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * The daily clean-up (3.5): report rows 90 days after their day, in batches. `not_found_ignored` and the redirects are kept until staff delete them. Never
 * throws; the number of rows removed.
 */
export async function pruneNotFound(batch = 5_000): Promise<number> {
  let removed = 0;
  try {
    for (let i = 0; i < 200; i += 1) {
      const rows = await db().execute<Row>(sql`
        delete from commerce.not_found_hits
         where ctid in (select ctid from commerce.not_found_hits where day < ((now() at time zone 'utc')::date - ${NOT_FOUND_KEEP_DAYS}::int) limit ${batch})
        returning 1 as x
      `);
      removed += rows.length;
      if (rows.length < batch) break;
    }
  } catch (error) {
    console.error("[not-found] the clean-up failed:", error instanceof Error ? error.message : error);
  }
  return removed;
}
