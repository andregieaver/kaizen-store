import "server-only";

import { sql } from "drizzle-orm";
import { revalidateTag, updateTag } from "next/cache";

import { db } from "@/db/client";
import { storeOrigins } from "@/lib/paths";
import { SEGMENTS_MAX, pathOfTarget, type AddressContext } from "@/lib/redirect-path";
import { emptyIndex, redirectsTag, type RedirectIndex } from "@/lib/redirects";
import { siteUrl } from "@/lib/site";

import { pgTextArray } from "./pg-arrays";
import type { Store } from "./stores";

type Row = Record<string, unknown>;
/** Anything that can run a statement: the database, or a transaction of it. */
export type Executor = Pick<ReturnType<typeof db>, "execute">;

/**
 * What a redirect is checked against (wave 2, second run, D168, `docs/wave-2-redirects.md` 4.1 rule 7, 5.2): the addresses that are LIVE now (a source may not
 * be one) and the redirects the store has that a new one could chain or loop through. Both are read for the few addresses a check needs, never the store's
 * whole catalogue and redirect table, so an import of 100,000 lines in chunks of 500 reads what each chunk names and nothing more. Every statement carries the
 * store id.
 */

const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** What a store's typed or imported addresses are read against: its slug, its countries and the hosts that are its own. Pure given the store. */
export function addressContextOf(store: Pick<Store, "slug" | "markets">): AddressContext {
  const hosts = [...storeOrigins(store.slug), siteUrl()].map(hostOf).filter((h): h is string => h !== null);
  return { store: store.slug, countries: [...new Set(store.markets.map((m) => m.code.toLowerCase()))], ownHosts: [...new Set(hosts)] };
}

/**
 * The addresses among `paths` that are live on the store now (rule 7): an ACTIVE product's `/p/{handle}`, a category's or tag's `/category|tag/{slug}`, a
 * published page's `/{slug}` (the front page's and the role pages' own included), a published article's `/blog/{slug}`, `/blog` when there are articles, and
 * `/products`. A draft or archived product's address is not live. A path that is none of these shapes is not live.
 */
export async function liveOf(storeId: string, paths: readonly string[], run: Executor = db()): Promise<Set<string>> {
  const live = new Set<string>();
  const handles: string[] = [];
  const categories: string[] = [];
  const tags: string[] = [];
  const pages: string[] = [];
  const articles: string[] = [];
  let wantsBlog = false;
  for (const path of new Set(paths)) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0 || parts.length > SEGMENTS_MAX) continue;
    if (path === "/products") live.add(path);
    else if (path === "/blog") wantsBlog = true;
    else if (parts.length === 2 && parts[0] === "p") handles.push(parts[1]);
    else if (parts.length === 2 && parts[0] === "category") categories.push(parts[1]);
    else if (parts.length === 2 && parts[0] === "tag") tags.push(parts[1]);
    else if (parts.length === 2 && parts[0] === "blog") articles.push(parts[1]);
    else if (parts.length === 1) pages.push(parts[0]);
  }
  // `slug` of a page or an article may hold capitals in the database; the normal form is lower case, so the comparison is too.
  const rows = await run.execute<Row>(sql`
    select 'p' as k, p.handle as v from commerce.products p
     where p.store_id = ${storeId}::uuid and p.status = 'active' and p.handle = any(${pgTextArray(handles)}::text[])
    union all
    select t.kind, t.slug from commerce.terms t
     where t.store_id = ${storeId}::uuid and t.content_type = 'product'
       and ((t.kind = 'category' and t.slug = any(${pgTextArray(categories)}::text[])) or (t.kind = 'tag' and t.slug = any(${pgTextArray(tags)}::text[])))
    union all
    select pg.type, lower(pg.slug) from commerce.pages pg
     where pg.store_id = ${storeId}::uuid and pg.published_at is not null
       and ((pg.type = 'page' and lower(pg.slug) = any(${pgTextArray(pages)}::text[])) or (pg.type = 'article' and lower(pg.slug) = any(${pgTextArray(articles)}::text[])))
    union all
    select 'blog', '' where ${wantsBlog} and exists (select 1 from commerce.pages pg where pg.store_id = ${storeId}::uuid and pg.type = 'article' and pg.published_at is not null)
  `);
  for (const row of rows) {
    const kind = String(row.k);
    const value = String(row.v);
    if (kind === "p") live.add(`/p/${value}`);
    else if (kind === "category" || kind === "tag") live.add(`/${kind}/${value}`);
    else if (kind === "page") live.add(`/${value}`);
    else if (kind === "article") live.add(`/blog/${value}`);
    else if (kind === "blog") live.add("/blog");
  }
  return live;
}

/**
 * The redirects a check may need, read from the paths it names (`seeds`: the sources and the targets' paths of the lines): the rows whose source is a seed,
 * then, from each MANUAL row's target, the rows whose source is that path, for at most 12 hops (a chain longer than the 10 hops that are followed, and a
 * loop, stop there). An automatic row's current address is its product's (while active) or its category's or tag's. Never the store's whole table.
 */
export async function indexFor(storeId: string, seeds: readonly string[], run: Executor = db()): Promise<RedirectIndex> {
  const index = emptyIndex() as { manual: Map<string, string>; automatic: Map<string, string | null> };
  const wanted = [...new Set(seeds)].filter((s) => s !== "");
  if (wanted.length === 0) return index;
  const rows = await run.execute<Row>(sql`
    with recursive walk (source, kind, target, product_id, term_id, depth) as (
      select r.source, r.kind, r.target, r.product_id, r.term_id, 1
        from commerce.redirects r
       where r.store_id = ${storeId}::uuid and r.source = any(${pgTextArray(wanted)}::text[])
      union
      select r.source, r.kind, r.target, r.product_id, r.term_id, w.depth + 1
        from walk w
        join commerce.redirects r on r.store_id = ${storeId}::uuid and r.source = commerce.redirect_path_of(w.target)
       where w.kind = 'manual' and w.depth < 12
    )
    select distinct w.source, w.kind, w.target,
      case w.kind
        when 'product' then (select '/p/' || p.handle from commerce.products p where p.store_id = ${storeId}::uuid and p.id = w.product_id and p.status = 'active')
        when 'category' then (select '/category/' || t.slug from commerce.terms t where t.store_id = ${storeId}::uuid and t.id = w.term_id)
        when 'tag' then (select '/tag/' || t.slug from commerce.terms t where t.store_id = ${storeId}::uuid and t.id = w.term_id)
      end as current
    from walk w
  `);
  for (const row of rows) {
    if (String(row.kind) === "manual") index.manual.set(String(row.source), String(row.target));
    else index.automatic.set(String(row.source), row.current === null ? null : String(row.current));
  }
  return index;
}

/**
 * The same, with what earlier chunks of a dry run PLANNED to write laid over it (`overlay`: source to target): the check judges a whole file as one set, so a
 * later chunk sees an earlier line (a chain through it collapses, a loop through it is refused) without any of it being written. A path the overlay leads
 * to that the database was not asked about is read in another round (at most six: a chain is followed for ten hops).
 */
export async function indexWithOverlay(storeId: string, seeds: readonly string[], overlay: ReadonlyMap<string, string>, run: Executor = db()): Promise<RedirectIndex> {
  const wanted = new Set(seeds);
  let result: RedirectIndex = emptyIndex();
  for (let round = 0; round < 6; round += 1) {
    const index = await indexFor(storeId, [...wanted], run);
    const manual = new Map(index.manual);
    const automatic = new Map(index.automatic);
    let grew = false;
    const queue = [...wanted, ...pathsOfIndex(index)];
    const seen = new Set<string>();
    for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
      if (seen.has(path)) continue;
      seen.add(path);
      const target = overlay.get(path);
      if (target === undefined) continue;
      manual.set(path, target);
      automatic.delete(path);
      const next = pathOfTarget(target);
      if (!wanted.has(next)) {
        wanted.add(next);
        grew = true;
      }
      queue.push(next);
    }
    result = { manual, automatic };
    if (!grew) break;
  }
  return result;
}

/** The paths an index passes through: every source and every target's path (what a liveness check needs to cover). */
export function pathsOfIndex(index: RedirectIndex): string[] {
  return [...index.manual.keys(), ...[...index.manual.values()].map(pathOfTarget), ...index.automatic.keys(), ...[...index.automatic.values()].filter((v): v is string => v !== null)];
}

/** How many MANUAL redirects the store has (for the limit). */
export async function manualCountOf(storeId: string, run: Executor = db()): Promise<number> {
  const [row] = await run.execute<Row>(sql`select count(*)::int as n from commerce.redirects where store_id = ${storeId}::uuid and kind = 'manual'`);
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// After a change: the cache and this server's short memory
// ---------------------------------------------------------------------------

/** This instance's short memory of what the proxy looked up (so a flood of one address is one query), forgotten when this instance writes a redirect. */
const memory = new Map<string, { at: number; value: unknown }>();
export const MEMORY_MS = 5_000;
const MEMORY_MAX = 2_000;

/** Remembers an answer for a few seconds, per instance; bounded. */
export async function remembered<T>(key: string, load: () => Promise<T>, ms: number = MEMORY_MS): Promise<T> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value as T;
  const value = await load();
  if (memory.size >= MEMORY_MAX) memory.clear();
  memory.set(key, { at: Date.now(), value });
  return value;
}

/** Forgets what this server remembers of a store's redirects (other instances catch up within `MEMORY_MS`). */
export function forgetRedirects(storeId: string): void {
  for (const key of memory.keys()) if (key.startsWith(`${storeId}|`)) memory.delete(key);
}

/**
 * Every writer of `commerce.redirects` calls this once its change is committed: the cached lookup of a missing address is refreshed (`redirectsTag`,
 * by `updateTag()`, else expired at once with `revalidateTag(tag, { expire: 0 })`, so a job, the cron and the assistant can call it as well as an action) and this instance forgets what it remembered.
 */
export function refreshRedirects(storeId: string): void {
  forgetRedirects(storeId);
  const tag = redirectsTag(storeId);
  try {
    updateTag(tag);
  } catch {
    // Outside a server action: expire at once. The stale-while-revalidate form (`refreshTag()`'s "max") leaves a 308 with no `Location` header.
    revalidateTag(tag, { expire: 0 });
  }
}
