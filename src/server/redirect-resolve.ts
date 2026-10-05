import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { notFound, permanentRedirect } from "next/navigation";

import { db, readDb } from "@/db/client";
import { REDIRECT_HOPS_MAX } from "@/lib/data-limits";
import { legacyPathOf, parseLegacyRequest } from "@/lib/legacy-path";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { encodeAddress, mergeQuery, normalisePath, pathOfTarget } from "@/lib/redirect-path";
import { redirectsTag } from "@/lib/redirects";

import { catalogTag } from "./catalog";
import { recordNotFound } from "./not-found";
import { liveOf, remembered } from "./redirect-live";
import { countHit } from "./redirects";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The lookup of an address that would otherwise be a 404 (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.1, 4.1 rule 9, 5.2, 5.3, section 10). A
 * redirect is looked up ONLY where a request found nothing: `missOrRedirect()` is the one function a route calls instead of `notFound()`, and the proxy asks for
 * an address with no country (`legacyResponse()`). A live page is never looked up, so normal shopping is not slowed.
 *
 * The lookup is a `'use cache'` function tagged `redirectsTag(store)` and the store's catalogue tag, with `cacheLife({ stale: 300, revalidate: 1, expire: 3600 })`
 * (section 10 of the spec: a dynamic miss streams with status 200, so the status of a 308 or a 404 is only given by a cached lookup; a `stale` under 30 or an
 * `expire` under 300 makes it dynamic again). Every writer of a redirect refreshes the tag, so a redirect added after a first 404 takes effect on the next
 * request. A miss is recorded, and a hit counted, inside the cache's fill (at most once per `revalidate` window per address and instance: counts are lower
 * bounds, `after()` does not run for a render that can be prerendered). A failure of the database is a 404 as it would have been, logged: a miss is never a 500.
 */

/** The cache life of the lookup. Written out in the `cacheLife()` call too (its argument is read by the compiler); a test holds the two together. */
export const LOOKUP_LIFE = { stale: 300, revalidate: 1, expire: 3600 } as const;

export type Resolution = { to: string; redirectId: string };

/** The rows of the walk from an address: manual hops, ending at an automatic redirect or a manual one whose target is not another redirect's source. */
type Hop = { id: string; source: string; kind: "manual" | "product" | "category" | "tag"; target: string | null; productId: string | null; termId: string | null };

async function walkFrom(storeId: string, path: string, manualOnly: boolean): Promise<Hop[]> {
  const rows = await readDb().execute<Row>(sql`
    with recursive walk (depth, id, source, kind, target, product_id, term_id, seen) as (
      select 1, r.id, r.source, r.kind, r.target, r.product_id, r.term_id, array[r.source]
        from commerce.redirects r
       where r.store_id = ${storeId}::uuid and r.source = ${path} ${manualOnly ? sql`and r.kind = 'manual'` : sql``}
      union all
      select w.depth + 1, r.id, r.source, r.kind, r.target, r.product_id, r.term_id, w.seen || r.source
        from walk w
        join commerce.redirects r on r.store_id = ${storeId}::uuid and r.source = commerce.redirect_path_of(w.target)
       where w.kind = 'manual' and w.depth <= ${REDIRECT_HOPS_MAX} and not (r.source = any(w.seen))
    )
    select depth, id, source, kind, target, product_id, term_id from walk order by depth
  `);
  return rows.map((r) => ({
    id: String(r.id),
    source: String(r.source),
    kind: String(r.kind) as Hop["kind"],
    target: r.target === null ? null : String(r.target),
    productId: r.product_id === null ? null : String(r.product_id),
    termId: r.term_id === null ? null : String(r.term_id),
  }));
}

/** The address an automatic redirect leads to now: its product's page when the product is active and priced in the market, its category's or tag's page while it exists; else null. */
async function entityAddress(storeId: string, hop: Hop, marketCode: string | null): Promise<string | null> {
  if (hop.kind === "product" && hop.productId) {
    const [row] = await readDb().execute<Row>(sql`
      select p.handle from commerce.products p
       where p.store_id = ${storeId}::uuid and p.id = ${hop.productId}::uuid and p.status = 'active'
         and ${marketCode === null ? sql`true` : sql`exists (
           select 1 from commerce.product_variants v join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${marketCode}
            where v.product_id = p.id and v.active)`}
    `);
    return row ? `/p/${String(row.handle)}` : null;
  }
  if ((hop.kind === "category" || hop.kind === "tag") && hop.termId) {
    const [row] = await readDb().execute<Row>(sql`
      select t.kind, t.slug from commerce.terms t where t.store_id = ${storeId}::uuid and t.id = ${hop.termId}::uuid and t.content_type = 'product'
    `);
    return row ? `/${String(row.kind)}/${String(row.slug)}` : null;
  }
  return null;
}

/**
 * Where an address that is not live goes, or null: the chain of redirects from it followed in ONE response (at most 10 hops, 4.1 rule 9), stopping at the first
 * address that is live (it is served as itself and never looked up), a loop or the eleventh hop is a miss (logged), and an automatic redirect whose thing is not
 * live in the market is a miss. The answer is the final target as stored (a path, with a query and fragment) and the id of the first redirect, for its count.
 * `manualOnly` is for an address with no country (2.1.3), where only a manual redirect applies. Reads only; never throws into the caller's page (it does).
 */
export async function resolveMiss(storeId: string, marketCode: string | null, path: string, options: { manualOnly?: boolean } = {}): Promise<Resolution | null> {
  const hops = await walkFrom(storeId, path, options.manualOnly === true);
  if (hops.length === 0) return null;
  const first = hops[0];
  if (hops.length > REDIRECT_HOPS_MAX) {
    console.error("[redirects] a chain longer than the hop limit is a miss:", storeId, path);
    return null;
  }
  // A hop reached by a manual target that is a LIVE address ends the chain before it: that address is served as itself.
  let end = hops.length - 1;
  if (hops.length > 1) {
    const live = await liveOf(storeId, hops.slice(1).map((h) => h.source));
    const stop = hops.findIndex((h, i) => i > 0 && live.has(h.source));
    if (stop > 0) end = stop - 1;
  }
  const last = hops[end];
  if (last.kind === "manual") {
    if (last.target === null) return null;
    // A loop in the data (the last target leads back into the chain), or a chain cut at the limit, is a miss.
    const next = pathOfTarget(last.target);
    if (end === hops.length - 1 && hops.some((h) => h.source === next)) {
      console.error("[redirects] a loop is a miss:", storeId, path);
      return null;
    }
    return { to: last.target, redirectId: first.id };
  }
  const address = await entityAddress(storeId, last, marketCode);
  return address === null ? null : { to: address, redirectId: first.id };
}

/** The lookup of a market's miss, cached and tagged (see the file's header): `to` is a path in the market (with its query and fragment), or null. */
async function lookupCached(storeId: string, marketCode: string, path: string): Promise<{ to: string | null }> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 1, expire: 3600 });
  cacheTag(redirectsTag(storeId), catalogTag(storeId));
  try {
    const found = await resolveMiss(storeId, marketCode, path);
    if (found) {
      await countHit(storeId, found.redirectId);
      return { to: found.to };
    }
  } catch (error) {
    console.error("[redirects] a lookup failed, so the address is a 404:", error instanceof Error ? error.message : error);
    return { to: null };
  }
  await recordNotFound(storeId, path, false);
  return { to: null };
}

/** The part of an address that a path segment of `_` stands for: the placeholder the build prerenders so a route has a static param. It is no address. */
const isPlaceholder = (path: string): boolean => path.split("/").some((part) => part === "_");

/**
 * The address to go to, in a market: a target of `/` is the market's front page. The stored target is percent-DECODED, so the address is encoded here
 * (`encodeAddress()`): a `Location` header is ASCII, and Node refuses a character above U+00FF, which made a Greek or Polish handle a 500 instead of a 308.
 */
export function locationIn(storeSlug: string, marketSlug: string, target: string): string {
  const tail = target === "/" ? "" : target.startsWith("/?") || target.startsWith("/#") ? target.slice(1) : target;
  return encodeAddress(marketPath(storeSlug, marketSlug, tail));
}

/**
 * The one function a store route calls where it would call `notFound()`: `path` is the address after the market (`/p/old-cup`, `/old-slug`, `/blog/x`), and
 * `query` the request's query string where the route has it (a prerendered page has none: only the proxy and dynamic routes can carry it). Goes to the
 * redirect's target in the same market with a 308, or gives the store's 404 page. Never returns.
 */
export async function missOrRedirect(shop: { store: Pick<Store, "id" | "slug">; market: Pick<Market, "slug" | "code"> }, path: string, query = ""): Promise<never> {
  const normal = normalisePath(path);
  let to: string | null = null;
  if (normal !== null && normal !== "/" && !isPlaceholder(normal)) {
    try {
      to = (await lookupCached(shop.store.id, shop.market.code, normal)).to;
    } catch (error) {
      console.error("[redirects] the lookup of a miss failed:", error instanceof Error ? error.message : error);
    }
  }
  if (to !== null) permanentRedirect(locationIn(shop.store.slug, shop.market.slug, mergeQuery(to, query)));
  notFound();
}

// ---------------------------------------------------------------------------
// An address with no country
// ---------------------------------------------------------------------------

type StoreFacts = { id: string; slug: string; mainMarket: string; countries: string[] } | null;

/** What the proxy needs of a store: its id, its main market's address and its countries; null for a store that is not open or has no market. Remembered for a few seconds (the proxy does not use `'use cache'`). */
async function storeFactsOf(slug: string): Promise<StoreFacts> {
  return remembered(`${slug}|facts`, async () => {
    const [row] = await db().execute<Row>(sql`
      select s.id, s.slug,
        (select coalesce(json_agg(lower(m.code) order by (m.code = s.country) desc nulls last, m.created_at, m.code), '[]')
           from commerce.markets m where m.store_id = s.id and m.active) as countries
      from commerce.stores s where s.slug = ${slug} and s.status = 'active'
    `);
    if (!row) return null;
    const countries = (row.countries as string[]).map(String);
    return countries.length === 0 ? null : { id: String(row.id), slug: String(row.slug), mainMarket: countries[0], countries };
  }, 30_000);
}

/** The first market of a store as an address (the country's own view), for the redirect of an address with no country. */
export async function mainMarketOf(storeSlug: string): Promise<string | null> {
  return (await storeFactsOf(storeSlug))?.mainMarket ?? null;
}

export type LegacyAnswer = { location: string } | { miss: { storeId: string; path: string } } | null;

/**
 * An address with no country (`/collections/shoes` on a store's own host, or under `/s/{store}/`): a manual redirect from it goes, permanently, to its target
 * in the store's MAIN market, with the request's query string; anything else is left to the routes (the 404 it was) and returned as a `miss` for the caller to
 * count. Used by the proxy (`legacyResponse()`) and by the unknown-market route. Only manual redirects apply here; an address that is not market-less is null.
 */
export async function legacyAnswer(pathname: string, search: string, hostStore: string | null): Promise<LegacyAnswer> {
  const request = parseLegacyRequest(pathname, hostStore);
  if (!request) return null;
  return legacyAnswerOf(request.store, request.path, search);
}

/** The same for a path the market route found to name no market of the store (`legacyPathOf()` of its parts). */
export async function legacyAnswerOf(storeSlug: string, path: string, search: string): Promise<LegacyAnswer> {
  const facts = await storeFactsOf(storeSlug);
  if (!facts || isPlaceholder(path)) return null;
  try {
    const found = await remembered(`${facts.id}|legacy|${path}`, () => resolveMiss(facts.id, null, path, { manualOnly: true }));
    if (found) {
      await countHit(facts.id, found.redirectId);
      return { location: locationIn(facts.slug, facts.mainMarket, mergeQuery(found.to, search)) };
    }
  } catch (error) {
    console.error("[redirects] a lookup of an address with no country failed:", error instanceof Error ? error.message : error);
    return null;
  }
  return { miss: { storeId: facts.id, path } };
}

/** The route that finds its first part is no market of the store (`/s/demo/om-oss`): where a manual redirect from `rest` goes, or null. */
export async function legacyRedirectFor(storeSlug: string, rest: readonly string[], search = ""): Promise<string | null> {
  const path = legacyPathOf(rest);
  if (path === null) return null;
  const answer = await legacyAnswerOf(storeSlug, path, search);
  return answer && "location" in answer ? answer.location : null;
}
