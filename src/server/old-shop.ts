import "server-only";

import { gunzipSync } from "node:zlib";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { suggestTargets, type Candidate, type Suggestion } from "@/lib/not-found";
import {
  OLD_SHOP_ADDRESSES_MAX,
  OLD_SHOP_FILE_BYTES,
  OLD_SHOP_FILES_MAX,
  OLD_SHOP_FIX_BATCH,
  OLD_SHOP_SUGGESTED_ROWS,
  bareHost,
  countByKind,
  counterpartOf,
  fateOf,
  kindOfOldPath,
  oldPathOf,
  readSitemap,
  sureTarget,
  type Fate,
  type KindCount,
  type OldKind,
} from "@/lib/old-shop";
import { parseReplicaUrl } from "@/lib/replicate-url";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { candidatesFor } from "./not-found";
import { memberCan } from "./permissions";
import { pgTextArray } from "./pg-arrays";
import { addressContextOf, indexFor, liveOf, pathsOfIndex } from "./redirect-live";
import { addRedirects } from "./redirects";
import { allowPrivate, safeFetch } from "./replicate-fetch";

type Row = Record<string, unknown>;

/**
 * The old shop's address check (D445 step 1, `docs/moving-from-shopify.md` 8.2 and 8.3): an owner moving from Shopify (or any shop with a
 * sitemap) gives the old shop's address; its sitemap is read once, politely, through `safeFetch()` (one file at a time, at most 60 files and
 * 20,000 addresses), and the addresses are kept in `commerce.old_shops` (this module is its only writer). Every view then works out again,
 * from the store as it is now, where each old address leads: a page, a redirect that ends at a page, a redirect that ends nowhere, or
 * nothing. Each one that leads nowhere is fixed with one press: at once where the same thing lives here under our shape (Shopify's
 * `/products/{handle}` is `/p/{handle}`), else from the 404 report's suggestions. Redirects are made only through `addRedirects()` and
 * `createRedirect()`, with their one check. Only the sitemap is read, never the old shop's pages; nothing is written there.
 */

const READ = "website:read" as const;
const WRITE = "website:write" as const;

export type OldShopProblem = "address" | "unreachable" | "no_sitemap" | "own_shop" | "empty" | "forbidden" | "failed";

export type OldShopRead = { ok: true; addresses: number; files: number; truncated: boolean } | { ok: false; problem: OldShopProblem };

/** The old shop's origin from what the owner typed (`myshop.com`, `https://www.myshop.com/collections/x`), or null. */
export function originOf(raw: string): string | null {
  const parsed = parseReplicaUrl(raw, { allowPrivate: allowPrivate() });
  return parsed.ok ? parsed.url.origin : null;
}

const decoded = (bytes: Uint8Array): string | null => {
  try {
    const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: OLD_SHOP_FILE_BYTES }) : Buffer.from(bytes);
    return raw.toString("utf8");
  } catch {
    return null;
  }
};

/** The `Sitemap:` lines of a robots.txt (where a shop says its sitemap is when it is not at `/sitemap.xml`). */
const sitemapsInRobots = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => /^\s*sitemap\s*:\s*(\S+)/i.exec(line)?.[1] ?? null)
    .filter((u): u is string => u !== null)
    .slice(0, 10);

type Crawl = { ok: true; origin: string; host: string; locs: string[]; files: number; truncated: boolean } | { ok: false; problem: OldShopProblem };

/**
 * Reads the old shop's sitemap: `/sitemap.xml`, else those robots.txt names; an index's files one after another (only on the shop's own host),
 * until 60 files or 20,000 addresses. The host is the one the shop answered on (a `myshopify.com` address that redirects to the shop's domain
 * reads the domain's).
 */
async function crawl(origin: string): Promise<Crawl> {
  const fetchFile = (url: string) => safeFetch(url, { maxBytes: OLD_SHOP_FILE_BYTES, timeoutMs: 20_000, accept: "application/xml,text/xml;q=0.9,*/*;q=0.5", maxRedirects: 5 });
  let first = await fetchFile(`${origin}/sitemap.xml`);
  let at: URL | null = first.ok ? new URL(first.url) : null;
  const queue: string[] = [];
  let firstMap = first.ok ? readSitemap(decoded(first.bytes) ?? "") : null;
  if (!firstMap) {
    const robots = await safeFetch(`${origin}/robots.txt`, { maxBytes: 512 * 1024, timeoutMs: 15_000, accept: "text/plain" });
    // No answer at all (a name that does not resolve, a timeout) is unreachable; a shop that answers 404 to both has no sitemap.
    if (!robots.ok && !first.ok && robots.status === undefined && first.status === undefined) return { ok: false, problem: "unreachable" };
    const named = robots.ok ? sitemapsInRobots(decoded(robots.bytes) ?? "") : [];
    at = robots.ok ? new URL(robots.url) : at;
    for (const url of named) {
      first = await fetchFile(url);
      firstMap = first.ok ? readSitemap(decoded(first.bytes) ?? "") : null;
      if (first.ok && firstMap) {
        at = new URL(first.url);
        break;
      }
    }
    if (!firstMap || at === null) return { ok: false, problem: "no_sitemap" };
  }
  if (at === null) return { ok: false, problem: "no_sitemap" };
  const host = at.hostname;
  const locs: string[] = [];
  const seenFiles = new Set<string>();
  let files = 1;
  let truncated = false;
  const take = (map: { index: boolean; locs: string[] }) => {
    if (map.index) {
      for (const loc of map.locs) {
        let url: URL;
        try {
          url = new URL(loc);
        } catch {
          continue;
        }
        if (bareHost(url.hostname) === bareHost(host) && !seenFiles.has(url.toString())) {
          seenFiles.add(url.toString());
          queue.push(url.toString());
        }
      }
    } else locs.push(...map.locs);
  };
  take(firstMap);
  while (queue.length > 0 && locs.length < OLD_SHOP_ADDRESSES_MAX) {
    if (files >= OLD_SHOP_FILES_MAX) {
      truncated = true;
      break;
    }
    const next = queue.shift()!;
    files += 1;
    const got = await fetchFile(next);
    const map = got.ok ? readSitemap(decoded(got.bytes) ?? "") : null;
    if (map) take(map);
    else log("warn", "old_shop.sitemap_file_skipped", { files });
  }
  if (locs.length >= OLD_SHOP_ADDRESSES_MAX || queue.length > 0) truncated = true;
  return { ok: true, origin: at.origin, host, locs, files, truncated };
}

/**
 * Reads the old shop at `raw` and keeps its addresses for the store, replacing what an earlier read kept (`website:write`). Refuses this store's
 * own address (after a move, the old domain is this store). Audited `redirects.old_shop_read` with the host and the counts.
 */
export async function readOldShop(member: Membership, raw: string): Promise<OldShopRead> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const origin = originOf(String(raw ?? "").slice(0, 300));
  if (origin === null) return { ok: false, problem: "address" };
  const own = addressContextOf(member.store).ownHosts.map(bareHost);
  if (own.includes(bareHost(new URL(origin).hostname))) return { ok: false, problem: "own_shop" };
  let read: Crawl;
  try {
    read = await crawl(origin);
  } catch (error) {
    log("error", "old_shop.read_failed", { storeId: member.store.id }, error);
    return { ok: false, problem: "failed" };
  }
  if (!read.ok) return read;
  if (own.includes(bareHost(read.host))) return { ok: false, problem: "own_shop" };
  const paths = [...new Set(read.locs.map((loc) => oldPathOf(loc, read.host)).filter((p): p is string => p !== null))].slice(0, OLD_SHOP_ADDRESSES_MAX);
  if (paths.length === 0) return { ok: false, problem: "empty" };
  const kept = read.origin;
  await db().execute(sql`
    insert into commerce.old_shops (store_id, origin, paths, files, truncated, read_by, read_at)
    values (${member.store.id}::uuid, ${kept}, ${pgTextArray(paths)}::text[], ${read.files}, ${read.truncated}, ${member.account.id}::uuid, now())
    on conflict (store_id) do update set origin = excluded.origin, paths = excluded.paths, files = excluded.files, truncated = excluded.truncated,
      read_by = excluded.read_by, read_at = excluded.read_at
  `);
  await audit(member.account.id, member.store.id, "redirects.old_shop_read", { host: read.host, addresses: paths.length, files: read.files, truncated: read.truncated }, { area: "website" }).catch((error) =>
    log("error", "old_shop.audit_failed", { storeId: member.store.id }, error),
  );
  log("info", "old_shop.read", { storeId: member.store.id, addresses: paths.length, files: read.files, truncated: read.truncated });
  return { ok: true, addresses: paths.length, files: read.files, truncated: read.truncated };
}

/** Forgets the old shop's addresses (`website:write`); the redirects made from them stay. */
export async function forgetOldShop(member: Membership): Promise<{ ok: boolean }> {
  if (!memberCan(member, WRITE)) return { ok: false };
  await db().execute(sql`delete from commerce.old_shops where store_id = ${member.store.id}::uuid`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export type OldAddress = {
  path: string;
  kind: OldKind;
  fate: Fate["fate"];
  /** Where it can be sent at once (the same thing under our shape, live here), or null. */
  sure: string | null;
  /** Up to three live addresses from the 404 report's word match, for the first rows without a sure target. */
  suggestions: Suggestion[];
};

export type OldShopCheck = {
  origin: string;
  readAt: string;
  files: number;
  truncated: boolean;
  total: number;
  /** Addresses that lead somewhere (live, or a redirect that ends at a page). */
  working: number;
  byKind: KindCount[];
  /** What the store has now, for the counts beside the old shop's (8.3). */
  here: Record<"product" | "category" | "page" | "article", number>;
  /** The addresses that lead nowhere, those with a sure target first; at most `OLD_SHOP_SUGGESTED_ROWS` carry suggestions. */
  needing: OldAddress[];
  /** How many of them can be fixed at once. */
  sure: number;
};

type Kept = { origin: string; paths: string[]; files: number; truncated: boolean; readAt: string };

async function keptOf(storeId: string): Promise<Kept | null> {
  const [row] = await db().execute<Row>(sql`select origin, paths, files, truncated, read_at from commerce.old_shops where store_id = ${storeId}::uuid`);
  if (!row) return null;
  return {
    origin: String(row.origin),
    paths: Array.isArray(row.paths) ? row.paths.map(String) : [],
    files: Number(row.files),
    truncated: Boolean(row.truncated),
    readAt: new Date(String(row.read_at)).toISOString(),
  };
}

/** Where each kept address leads now: the store's redirects from them and its live addresses (theirs, their redirects' targets', and our shape's of each). */
async function fatesOf(storeId: string, paths: readonly string[]): Promise<{ path: string; kind: OldKind; fate: Fate["fate"]; sure: string | null }[]> {
  const index = await indexFor(storeId, paths);
  const counterparts = paths.map(counterpartOf).filter((p): p is string => p !== null);
  const live = await liveOf(storeId, [...paths, ...pathsOfIndex(index), ...counterparts]);
  return paths.map((path) => {
    const { fate } = fateOf(path, { live, index });
    return { path, kind: kindOfOldPath(path), fate, sure: fate === "live" || fate === "redirected" ? null : sureTarget(path, live) };
  });
}

async function countsHere(storeId: string): Promise<OldShopCheck["here"]> {
  const [row] = await db().execute<Row>(sql`
    select
      (select count(*) from commerce.products p where p.store_id = ${storeId}::uuid and p.status = 'active')::int as product,
      (select count(*) from commerce.terms t where t.store_id = ${storeId}::uuid and t.kind = 'category' and t.content_type = 'product')::int as category,
      (select count(*) from commerce.pages pg where pg.store_id = ${storeId}::uuid and pg.type = 'page' and pg.published_at is not null)::int as page,
      (select count(*) from commerce.pages pg where pg.store_id = ${storeId}::uuid and pg.type = 'article' and pg.published_at is not null)::int as article
  `);
  return { product: Number(row?.product ?? 0), category: Number(row?.category ?? 0), page: Number(row?.page ?? 0), article: Number(row?.article ?? 0) };
}

/** The check as the page shows it (`website:read`), or null when no old shop was read or the member may not see it. */
export async function oldShopCheck(member: Membership): Promise<OldShopCheck | null> {
  if (!memberCan(member, READ)) return null;
  const kept = await keptOf(member.store.id);
  if (!kept) return null;
  const rows = await fatesOf(member.store.id, kept.paths);
  const needing = rows.filter((r) => r.fate === "missing" || r.fate === "broken").sort((a, b) => Number(b.sure !== null) - Number(a.sure !== null) || a.path.localeCompare(b.path));
  const unsure = needing.filter((r) => r.sure === null).slice(0, OLD_SHOP_SUGGESTED_ROWS);
  const pool = await candidatesFor(
    member.store.id,
    unsure.map((r) => r.path),
  ).catch((error) => {
    log("error", "old_shop.suggestions_read_failed", { storeId: member.store.id }, error);
    return [] as Candidate[];
  });
  const suggested = new Set(unsure.map((r) => r.path));
  return {
    origin: kept.origin,
    readAt: kept.readAt,
    files: kept.files,
    truncated: kept.truncated,
    total: rows.length,
    working: rows.length - needing.length,
    byKind: countByKind(rows),
    here: await countsHere(member.store.id),
    needing: needing.map((r) => ({ ...r, suggestions: suggested.has(r.path) ? suggestTargets(r.path, pool) : [] })),
    sure: needing.filter((r) => r.sure !== null).length,
  };
}

/**
 * The one press (`website:write`): a redirect from every old address that leads nowhere and has a sure target, in batches through
 * `addRedirects()` (origin `import`; one that the check refuses is skipped and counted). Worked out again here, never taken from the page.
 * Audited once, `redirects.old_shop_fixed`, with the counts.
 */
export async function fixOldShop(member: Membership): Promise<{ ok: true; written: number; refused: number } | { ok: false; problem: OldShopProblem }> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const kept = await keptOf(member.store.id);
  if (!kept) return { ok: false, problem: "empty" };
  const lines = (await fatesOf(member.store.id, kept.paths)).flatMap((r) => (r.sure === null ? [] : [{ from: r.path, to: r.sure }]));
  let written = 0;
  let refused = 0;
  for (let i = 0; i < lines.length; i += OLD_SHOP_FIX_BATCH) {
    const out = await addRedirects(member, lines.slice(i, i + OLD_SHOP_FIX_BATCH), { origin: "import", existing: "replace" });
    if (!out.ok) {
      log("error", "old_shop.fix_failed", { storeId: member.store.id, code: out.code });
      return written > 0 ? { ok: true, written, refused: refused + lines.length - i } : { ok: false, problem: "failed" };
    }
    written += out.written;
    refused += out.plans.filter((p) => p.action === "error").length;
  }
  await audit(member.account.id, member.store.id, "redirects.old_shop_fixed", { host: new URL(kept.origin).hostname, written, refused }, { area: "website" }).catch((error) =>
    log("error", "old_shop.audit_failed", { storeId: member.store.id }, error),
  );
  return { ok: true, written, refused };
}
