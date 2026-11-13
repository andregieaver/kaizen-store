import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { cutPassages } from "@/lib/knowledge";
import { readSitemap } from "@/lib/old-shop";
import {
  LINK_DEPTH,
  PAGE_WORDS_MAX,
  PAGES_AT_ONCE,
  PAGES_PER_RUN,
  RECRAWL_DAYS,
  RUN_BUDGET_MS,
  SITE_PAGES_MAX,
  SITES_PER_RUN,
  linksIn,
  pageUrl,
  robotsAllow,
  robotsRules,
  robotsSitemaps,
  sitePath,
  type CrawlProblem,
  type PageProblem,
  type RobotsRules,
} from "@/lib/site-crawl";
import { mayFrame } from "@/lib/support-embed";
import { isReadableType, pageText, PAGE_MAX_BYTES } from "@/lib/web-page-text";

import { audit } from "./auth";
import { log } from "./log";
import { safeFetch } from "./replicate-fetch";
import type { StaffDesk } from "./support-desk";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Reading chat widgets' websites (D583, step 2 of `docs/support-embed.md`). A site whose tag was found is listed (`discoverSite()`: its
 * robots.txt for our agent, its sitemap, else the links of its front page and the pages they lead to, at most `SITE_PAGES_MAX`), and each
 * page listed is read (`readSitePage()`: only on the site's own host, its words cut into the knowledge base's passages with `site_page_id`,
 * cut again only when the words changed). The five-minute job (`crawlWidgetSites()`) lists a few sites that are due and reads a few dozen
 * pages that are, within a time budget, so a site is read over a few runs; a week later, or when the owner presses *Read the site again*,
 * it is read again. A widget's chat then answers from its own sites' pages as well as the knowledge base (`searchKnowledge(…, {widget})`).
 * The words are the site's own, given to the model as data (its prompt says so; `UNTRUSTED_TEXT`).
 */

/** What the crawler reads the web with (a stand-in in tests). */
export type CrawlDeps = { fetchPage?: typeof safeFetch; budgetMs?: number };

const ROBOTS_BYTES = 512 * 1024;
const SITEMAP_BYTES = 10 * 1024 * 1024;
const SITEMAP_FILES_MAX = 10;
/** Pages fetched only to follow their links, for a site without a sitemap. */
const LINK_PAGES_MAX = 25;

const textOf = (bytes: Uint8Array): string => {
  try {
    const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: SITEMAP_BYTES }) : bytes;
    return new TextDecoder().decode(raw);
  } catch {
    return "";
  }
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

// Listing a site ---------------------------------------------------------------------------------------------------------------------------

/** The site's robots.txt rules for our agent; none when it has no robots.txt or cannot be read (everything may be read). */
async function robotsOf(host: string, fetchPage: typeof safeFetch): Promise<{ rules: RobotsRules; sitemaps: string[] }> {
  const got = await fetchPage(`https://${host}/robots.txt`, { maxBytes: ROBOTS_BYTES, timeoutMs: 10_000, accept: "text/plain", maxRedirects: 3 });
  if (!got.ok || got.status >= 400 || !mayFrame(host, hostOf(got.url))) return { rules: { allow: [], disallow: [] }, sitemaps: [] };
  const text = textOf(got.bytes);
  return { rules: robotsRules(text), sitemaps: robotsSitemaps(text) };
}

/** The page paths the site's sitemaps list (its own and those robots.txt names, an index's files followed), on its own host only. */
async function sitemapPaths(host: string, named: string[], fetchPage: typeof safeFetch): Promise<string[]> {
  const queue = [...new Set([...named, `https://${host}/sitemap.xml`])].filter((url) => mayFrame(host, hostOf(url)));
  const seen = new Set<string>();
  const paths: string[] = [];
  let files = 0;
  while (queue.length > 0 && files < SITEMAP_FILES_MAX && paths.length < SITE_PAGES_MAX * 3) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    files += 1;
    const got = await fetchPage(url, { maxBytes: SITEMAP_BYTES, timeoutMs: 15_000, accept: "application/xml,text/xml;q=0.9,*/*;q=0.5", maxRedirects: 3 });
    if (!got.ok || got.status >= 400 || !mayFrame(host, hostOf(got.url))) continue;
    const map = readSitemap(textOf(got.bytes), SITE_PAGES_MAX * 3);
    if (!map) continue;
    for (const loc of map.locs) {
      if (map.index) {
        if (mayFrame(host, hostOf(loc))) queue.push(loc);
      } else {
        const path = sitePath(host, loc);
        if (path) paths.push(path);
      }
    }
  }
  return paths;
}

/** For a site without a sitemap: the front page and the pages its links lead to, `LINK_DEPTH` deep, fetching at most `LINK_PAGES_MAX`. */
async function linkedPaths(host: string, rules: RobotsRules, fetchPage: typeof safeFetch): Promise<string[]> {
  const found = new Set<string>(["/"]);
  let level = ["/"];
  let fetched = 0;
  for (let depth = 0; depth < LINK_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const path of level) {
      if (fetched >= LINK_PAGES_MAX || found.size >= SITE_PAGES_MAX) break;
      if (!robotsAllow(rules, path)) continue;
      fetched += 1;
      const got = await fetchPage(pageUrl(host, path), { maxBytes: PAGE_MAX_BYTES, timeoutMs: 10_000, accept: "text/html,application/xhtml+xml", maxRedirects: 3 });
      if (!got.ok || got.status >= 400 || !mayFrame(host, hostOf(got.url)) || !isReadableType(got.contentType.split(";")[0])) continue;
      for (const link of linksIn(textOf(got.bytes), host, got.url)) {
        if (found.size >= SITE_PAGES_MAX) break;
        if (!found.has(link)) {
          found.add(link);
          next.push(link);
        }
      }
    }
    level = next;
  }
  return [...found];
}

const SITE_ROW = z.object({
  id: col.uuid,
  host: col.text,
  discovered_at: col.timestampOrNull,
  crawl_requested_at: col.timestampOrNull,
});

/**
 * Lists a site's pages and keeps the list: new ones are added (to be read), ones no longer listed go with their passages, and when the
 * owner asked for the site to be read again every page is read again. Why none could be listed is kept for the admin.
 */
export async function discoverSite(siteId: string, deps: CrawlDeps = {}): Promise<{ pages: number; problem: CrawlProblem | null }> {
  const fetchPage = deps.fetchPage ?? safeFetch;
  const site = await typedRow(
    SITE_ROW,
    sql`select id, host, discovered_at, crawl_requested_at from commerce.support_widget_sites where id = ${siteId}::uuid and verified_at is not null`,
  );
  if (!site) return { pages: 0, problem: null };
  const front = await fetchPage(`https://${site.host}/`, { maxBytes: 64 * 1024, timeoutMs: 10_000, accept: "text/html", maxRedirects: 3 });
  let problem: CrawlProblem | null = null;
  let paths: string[] = [];
  if (!front.ok && front.status === undefined) {
    problem = "unreachable";
  } else {
    const { rules, sitemaps } = await robotsOf(site.host, fetchPage);
    if (!robotsAllow(rules, "/") && rules.allow.length === 0) {
      problem = "robots";
    } else {
      const listed = await sitemapPaths(site.host, sitemaps, fetchPage);
      const candidates = listed.length > 0 ? ["/", ...listed] : await linkedPaths(site.host, rules, fetchPage);
      paths = [...new Set(candidates)].filter((path) => robotsAllow(rules, path)).slice(0, SITE_PAGES_MAX);
      if (paths.length === 0) problem = "no_pages";
    }
  }
  const again = site.crawl_requested_at !== null && (site.discovered_at === null || Date.parse(site.crawl_requested_at) > Date.parse(site.discovered_at));
  await db().transaction(async (tx) => {
    if (paths.length > 0) {
      // In one transaction `now()` is one moment: every page listed now is seen now, and what was seen before it was not listed again.
      await tx.execute(sql`
        insert into commerce.support_widget_site_pages (site_id, path)
        select ${site.id}::uuid, p from unnest(${sql`array[${sql.join(paths.map((path) => sql`${path}`), sql`, `)}]::text[]`}) as p
        on conflict (site_id, path) do update set seen_at = now()
      `);
      await tx.execute(sql`delete from commerce.support_widget_site_pages where site_id = ${site.id}::uuid and seen_at < now()`);
      if (again) await tx.execute(sql`update commerce.support_widget_site_pages set fetched_at = null where site_id = ${site.id}::uuid`);
    }
    // A site that cannot be listed now keeps the pages it had: the chat goes on answering from them until the next listing.
    await tx.execute(sql`update commerce.support_widget_sites set discovered_at = now(), crawl_problem = ${problem} where id = ${site.id}::uuid`);
  });
  log("info", "support.widget_site_listed", { site: site.id, pages: paths.length, problem });
  return { pages: paths.length, problem };
}

// Reading a page ---------------------------------------------------------------------------------------------------------------------------

const PAGE_ROW = z.object({
  id: col.uuid,
  path: col.text,
  content_hash: col.textOrNull,
  host: col.text,
  store_id: col.uuid.nullable(),
});

type PageToRead = z.output<typeof PAGE_ROW>;

/** The page's passages put in place of the ones it had (none, for a page that now has no words). */
async function replacePagePassages(page: PageToRead, title: string, bodies: string[], version: string): Promise<void> {
  const rows = bodies.map((body, position) => sql`(${page.store_id}::uuid, ${page.id}::uuid, null, ${position}, ${title.slice(0, 300)}, ${page.path}, ${body}, ${version})`);
  await db().transaction(async (tx) => {
    await tx.execute(sql`delete from commerce.knowledge_chunks where site_page_id = ${page.id}::uuid`);
    if (rows.length > 0) {
      await tx.execute(sql`
        insert into commerce.knowledge_chunks (store_id, site_page_id, locale, position, title, path, body, version)
        values ${sql.join(rows, sql`, `)}
      `);
    }
  });
}

async function markPage(id: string, fields: { problem: PageProblem | null; title?: string; hash?: string | null }): Promise<void> {
  await db().execute(sql`
    update commerce.support_widget_site_pages set fetched_at = now(), problem = ${fields.problem},
      title = coalesce(${fields.title ?? null}, title),
      content_hash = case when ${fields.hash === undefined} then content_hash else ${fields.hash ?? null} end
    where id = ${id}::uuid
  `);
}

/**
 * Reads one page of a site into the knowledge base: only a page that answers on the site's own host (a redirect elsewhere drops its
 * passages), only HTML or text, its readable words (`pageText()`: no navigation, header, footer, script or form) cut into passages, and
 * only when they changed since the last read. A page that cannot be reached keeps its passages until the next read.
 */
export async function readSitePage(page: PageToRead, deps: CrawlDeps = {}): Promise<PageProblem | null> {
  const got = await (deps.fetchPage ?? safeFetch)(pageUrl(page.host, page.path), { maxBytes: PAGE_MAX_BYTES, timeoutMs: 10_000, accept: "text/html,application/xhtml+xml", maxRedirects: 3 });
  if (!got.ok || got.status >= 400) {
    await markPage(page.id, { problem: "unreachable" });
    return "unreachable";
  }
  if (!mayFrame(page.host, hostOf(got.url))) {
    await replacePagePassages(page, "", [], "moved");
    await markPage(page.id, { problem: "moved", hash: null });
    return "moved";
  }
  const type = got.contentType.split(";")[0].trim();
  if (!isReadableType(type)) {
    await replacePagePassages(page, "", [], "unreadable");
    await markPage(page.id, { problem: "unreadable", hash: null });
    return "unreadable";
  }
  const read = pageText(textOf(got.bytes), type, PAGE_WORDS_MAX);
  const words = [read.description, read.text].filter(Boolean).join("\n\n");
  const title = read.title || page.path;
  if (!words.trim()) {
    await replacePagePassages(page, title, [], "empty");
    await markPage(page.id, { problem: "empty", title, hash: null });
    return "empty";
  }
  const hash = createHash("sha256").update(`${title}\n${words}`).digest("hex").slice(0, 32);
  if (hash !== page.content_hash) await replacePagePassages(page, title, cutPassages(words), hash);
  await markPage(page.id, { problem: null, title, hash });
  return null;
}

// The job ----------------------------------------------------------------------------------------------------------------------------------

/**
 * The five-minute job's share (`dispatcher.widget-sites`): lists up to `SITES_PER_RUN` found sites that are due (never listed, asked for,
 * or listed `RECRAWL_DAYS` ago), then reads up to `PAGES_PER_RUN` pages that are due (never read, or read a week ago), `PAGES_AT_ONCE` at a
 * time, until the time budget is spent. Counts only.
 */
export async function crawlWidgetSites(deps: CrawlDeps = {}): Promise<{ listed: number; read: number; failed: number }> {
  const started = Date.now();
  const budget = deps.budgetMs ?? RUN_BUDGET_MS;
  const due = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      select id from commerce.support_widget_sites
      where verified_at is not null
        and (discovered_at is null or crawl_requested_at > discovered_at or discovered_at < now() - make_interval(days => ${RECRAWL_DAYS}))
      order by discovered_at nulls first
      limit ${SITES_PER_RUN}
    `,
  );
  let listed = 0;
  let failed = 0;
  for (const site of due) {
    if (Date.now() - started > budget / 2) break;
    try {
      await discoverSite(site.id, deps);
      listed += 1;
    } catch (error) {
      failed += 1;
      log("warn", "support.widget_site_list_failed", { site: site.id }, error);
    }
  }
  const pages = await typedRows(
    PAGE_ROW,
    sql`
      select p.id, p.path, p.content_hash, s.host, w.store_id
      from commerce.support_widget_site_pages p
      join commerce.support_widget_sites s on s.id = p.site_id
      join commerce.support_widgets w on w.id = s.widget_id
      where s.verified_at is not null and (p.fetched_at is null or p.fetched_at < now() - make_interval(days => ${RECRAWL_DAYS}))
      order by p.fetched_at nulls first, p.created_at
      limit ${PAGES_PER_RUN}
    `,
  );
  let read = 0;
  let next = 0;
  const worker = async () => {
    while (next < pages.length && Date.now() - started < budget) {
      const page = pages[next++];
      try {
        await readSitePage(page, deps);
        read += 1;
      } catch (error) {
        failed += 1;
        log("warn", "support.widget_page_read_failed", { page: page.id }, error);
      }
    }
  };
  await Promise.all(Array.from({ length: PAGES_AT_ONCE }, worker));
  return { listed, read, failed };
}

// The owner's button -------------------------------------------------------------------------------------------------------------------

/** *Read the site again* (`support:write`): the site is listed and every page read again within the next runs of the job. */
export async function requestCrawl(staff: StaffDesk, siteId: string): Promise<boolean> {
  if (!staff.canWrite || !z.uuid().safeParse(siteId).success) return false;
  const row = await typedRow(
    z.object({ host: col.text }),
    sql`
      update commerce.support_widget_sites s set crawl_requested_at = now()
      from commerce.support_widgets w
      where s.id = ${siteId}::uuid and w.id = s.widget_id and s.verified_at is not null
        and ${staff.desk.storeId ? sql`w.store_id = ${staff.desk.storeId}::uuid` : sql`w.store_id is null`}
      returning s.host
    `,
  );
  if (!row) return false;
  await audit(staff.account.id, staff.desk.storeId, "support.widget_site_read_again", { host: row.host }, { target: { type: "support_widget_site", id: siteId } });
  return true;
}
