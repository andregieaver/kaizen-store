import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import type { Market } from "@/lib/markets";
import { hasFilters, worthUnderstanding, type SearchFilters } from "@/lib/query-understanding";
import { normalizeQuery, prefixQuery, reciprocalRankFusion } from "@/lib/search";
import { vectorLiteral } from "@/lib/vectors";

import { aiFor } from "./ai";
import { listGridProducts, type GridProduct } from "./catalog";

/**
 * Keyword search (Phase 2, S1): in Postgres, with no AI. A product matches
 * when its title or description does, stemmed in its own language
 * (`product_translations.search`), when its title is close to what was typed
 * (trigrams, for typos and parts of compound words: "kopp" finds
 * "keramikkopp"), when a SKU is typed, or when it is in a category or tag of
 * that name. Titles weigh most, then descriptions; an exact SKU goes first.
 * Only active products with a price in the market are found, and each in
 * the market's language where it has one.
 */

type Row = Record<string, unknown>;
type Shop = { storeId: string; market: Market };

/** How close a title (or category name) must be to what was typed, from 0 to 1. */
const CLOSE = 0.5;

/**
 * What a search's filters ask of a product `p` (D75), as SQL: in one of the
 * categories (or below it), with one of the tags, of the kind, with a
 * variant priced in the range in the market, in stock (goods: physical
 * stock at an active place, or digital; bookings count as available), all
 * with values the filters were checked to hold.
 */
function filterClause(filters: SearchFilters | null, market: Market): SQL {
  if (!filters) return sql`true`;
  const parts: SQL[] = [];
  const list = (values: string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
  if (filters.categories.length > 0) {
    parts.push(sql`exists (
      with recursive picked as (
        select id from commerce.terms
        where store_id = p.store_id and content_type = 'product' and kind = 'category' and slug = any(${list(filters.categories)})
        union
        select t.id from commerce.terms t join picked on t.parent_id = picked.id
      )
      select 1 from commerce.product_terms pt
      where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id in (select id from picked)
    )`);
  }
  if (filters.tags.length > 0) {
    parts.push(sql`exists (
      select 1 from commerce.product_terms pt join commerce.terms te on te.id = pt.term_id
      where pt.store_id = p.store_id and pt.product_id = p.id and te.kind = 'tag' and te.slug = any(${list(filters.tags)})
    )`);
  }
  if (filters.kind) parts.push(sql`p.kind = ${filters.kind}`);
  if (filters.minPriceMinor !== null || filters.maxPriceMinor !== null) {
    parts.push(sql`exists (
      select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = p.id and v.active and cp.market_code = ${market.code}
        and cp.amount_minor >= ${filters.minPriceMinor ?? 0}
        and cp.amount_minor <= ${filters.maxPriceMinor ?? Number.MAX_SAFE_INTEGER}
    )`);
  }
  if (filters.inStock) {
    parts.push(sql`(p.kind <> 'goods' or exists (
      select 1 from commerce.product_variants v
      where v.product_id = p.id and v.active and (v.delivery = 'digital' or (
        select coalesce(sum(s.available), 0) from commerce.available_stock s
        join commerce.inventory_locations l on l.store_id = s.store_id and l.id = s.location_id and l.active
        where s.store_id = p.store_id and s.variant_id = v.id
      ) > 0)
    ))`);
  }
  return parts.length === 0 ? sql`true` : sql.join(parts, sql` and `);
}

/** Whether words hold anything to search for in the market's language, rather than only stop words. */
async function searchable(shop: Shop, words: string): Promise<boolean> {
  if (!words) return false;
  const [row] = await readDb().execute<Row>(sql`
    select numnode(websearch_to_tsquery(commerce.search_config(${shop.market.locale}), ${words})) > 0 as searchable
  `);
  return Boolean(row?.searchable);
}

/** The ids of the products a query finds, best first (while typing, `prefix`: words as starts of words). */
export async function matchingIds(
  shop: Shop,
  query: string,
  limit: number,
  prefix: boolean,
  filters: SearchFilters | null = null,
): Promise<string[]> {
  const text = normalizeQuery(query);
  if (!text) return [];
  const { storeId, market } = shop;
  const config = sql`commerce.search_config(${market.locale})`;
  // The full query as a web search would read it; while typing, each word as the start of a word.
  const words = prefix ? prefixQuery(text) : null;
  const tsq = words ? sql`to_tsquery(${config}, ${words})` : sql`websearch_to_tsquery(${config}, ${text})`;
  const rows = await readDb().execute<Row>(sql`
    with q as (select ${tsq} as tsq, ${text}::text as text),
    docs as (
      -- The market's translation, or the product's first where it has none in the market's language.
      select t.product_id, t.search, lower(t.title) as title
      from commerce.product_translations t
      where t.store_id = ${storeId}::uuid
        and (t.locale = ${market.locale} or not exists (
          select 1 from commerce.product_translations x where x.product_id = t.product_id and x.locale = ${market.locale}
        ))
    ),
    scored as (
      select p.id, p.created_at,
        coalesce(max(ts_rank_cd(d.search, q.tsq)) filter (where d.search @@ q.tsq), 0) * 4
          + max(extensions.word_similarity(q.text, d.title))
          + case when bool_or(sku.exact) then 10 when bool_or(sku.near) then 1 else 0 end
          + case when bool_or(term.hit) then 0.5 else 0 end as score,
        bool_or(d.search @@ q.tsq) or max(extensions.word_similarity(q.text, d.title)) >= ${CLOSE}
          or bool_or(sku.exact or sku.near) or bool_or(term.hit) as found
      from commerce.products p
      cross join q
      join docs d on d.product_id = p.id
      left join lateral (
        select bool_or(lower(v.sku) = q.text) as exact, bool_or(length(q.text) >= 3 and lower(v.sku) like q.text || '%') as near
        from commerce.product_variants v where v.product_id = p.id and v.active
      ) sku on true
      left join lateral (
        select true as hit
        from commerce.product_terms pt
        join commerce.terms te on te.id = pt.term_id
        where pt.store_id = p.store_id and pt.product_id = p.id
          and (lower(te.name) = q.text or extensions.word_similarity(q.text, lower(te.name)) >= 0.7)
        limit 1
      ) term on true
      where p.store_id = ${storeId}::uuid and p.status = 'active'
        and exists (
          select 1 from commerce.current_prices cp
          join commerce.product_variants v on v.id = cp.variant_id
          where v.product_id = p.id and v.active and cp.market_code = ${market.code}
        )
        and ${filterClause(filters, market)}
      group by p.id, p.created_at
    )
    select id from scored where found
    order by score desc, created_at desc
    limit ${limit}
  `);
  return rows.map((row) => String(row.id));
}

/** Candidates each list gives the fusion. */
const KEYWORD_CANDIDATES = 100;
const MEANING_CANDIDATES = 50;
/**
 * How far below the closest product others may come and still be found by
 * meaning: a query matching nothing well otherwise finds everything just
 * above the store's limit.
 */
const MEANING_MARGIN = 0.1;

export type Meaning = {
  /** The query's vector, made by the store's search model. */
  vector: number[];
  /** That model's `space`: only vectors of the same model are compared. */
  space: string;
  /** Products less similar than this are not found by meaning. */
  minSimilarity: number;
};

/**
 * Products closest in meaning to a query's vector (S2, D74): the store's
 * active products with a price in the market, by their closest
 * translation, most similar first. The store's limit is applied by the
 * caller, so the closest similarity can be logged even when none pass it.
 */
export async function meaningMatches(
  shop: Shop,
  meaning: Meaning,
  limit: number,
  filters: SearchFilters | null = null,
): Promise<{ id: string; similarity: number }[]> {
  const { storeId, market } = shop;
  const rows = await readDb().execute<Row>(sql`
    with q as (select ${vectorLiteral(meaning.vector)}::extensions.vector as v)
    select e.product_id, max(1 - (e.embedding OPERATOR(extensions.<=>) q.v)) as similarity
    from commerce.product_embeddings e
    cross join q
    join commerce.products p on p.store_id = e.store_id and p.id = e.product_id
    where e.store_id = ${storeId}::uuid and e.space = ${meaning.space}
      and extensions.vector_dims(e.embedding) = extensions.vector_dims(q.v)
      and p.status = 'active'
      and exists (
        select 1 from commerce.current_prices cp
        join commerce.product_variants v on v.id = cp.variant_id
        where v.product_id = p.id and v.active and cp.market_code = ${market.code}
      )
      and ${filterClause(filters, market)}
    group by e.product_id
    order by similarity desc, e.product_id
    limit ${limit}
  `);
  return rows.map((row) => ({ id: String(row.product_id), similarity: Number(row.similarity) }));
}

/**
 * Products that meet a search's filters alone, newest first: for searches
 * that are only filters, such as "lamper under 500 kr" read as the
 * lighting category under 500 kroner.
 */
export async function filteredIds(shop: Shop, filters: SearchFilters, limit: number): Promise<string[]> {
  const { storeId, market } = shop;
  const rows = await readDb().execute<Row>(sql`
    select p.id from commerce.products p
    where p.store_id = ${storeId}::uuid and p.status = 'active'
      and exists (
        select 1 from commerce.current_prices cp
        join commerce.product_variants v on v.id = cp.variant_id
        where v.product_id = p.id and v.active and cp.market_code = ${market.code}
      )
      and ${filterClause(filters, market)}
    order by p.created_at desc, p.id
    limit ${limit}
  `);
  return rows.map((row) => String(row.id));
}

export type Ranked = {
  ids: string[];
  /** How close the closest product came by meaning; null when meaning was not asked. */
  semanticBest: number | null;
  /** Results only meaning found. */
  meaningOnly: number;
};

/**
 * A search's products, best first: by keyword, and by meaning when the
 * query's vector is given, merged by reciprocal rank fusion. With filters
 * (D75), keywords are the words they leave, both lists keep to them, and a
 * search that is only filters lists what meets them. Without a vector or
 * filters it is keyword search alone.
 */
export async function rankedSearch(
  shop: Shop,
  query: string,
  limit: number,
  meaning: Meaning | null,
  filters: SearchFilters | null = null,
): Promise<Ranked> {
  const text = normalizeQuery(query);
  if (!text) return { ids: [], semanticBest: null, meaningOnly: 0 };
  // Words that are all stop words ("i" in "nyheter i belysning") search for nothing: list by the filters.
  const words = filters ? ((await searchable(shop, filters.text)) ? filters.text : "") : text;
  const [keyword, closest] = await Promise.all([
    words ? matchingIds(shop, words, KEYWORD_CANDIDATES, false, filters) : filters ? filteredIds(shop, filters, KEYWORD_CANDIDATES) : Promise.resolve([]),
    meaning ? meaningMatches(shop, meaning, MEANING_CANDIDATES, filters) : Promise.resolve([]),
  ]);
  const semanticBest = meaning ? (closest[0]?.similarity ?? null) : null;
  const floor = Math.max(meaning?.minSimilarity ?? 1, (semanticBest ?? 1) - MEANING_MARGIN);
  const byMeaning = closest.filter((match) => match.similarity >= floor);
  const ids = reciprocalRankFusion([keyword, byMeaning.map((match) => match.id)]).slice(0, limit);
  const found = new Set(keyword);
  return { ids, semanticBest, meaningOnly: ids.filter((id) => !found.has(id)).length };
}

export type SearchResult = {
  products: GridProduct[];
  semanticBest: number | null;
  meaningOnly: number;
  /** What the search was understood as, when the store's text model changed anything (D75). */
  filters: SearchFilters | null;
};

type VectorFor = (storeId: string, space: string, text: string) => Promise<number[]>;
type Understand = (storeId: string, textModel: string, market: { locale: string; currency: string }, text: string) => Promise<SearchFilters>;

const skipped = (what: string) => (error: unknown) => {
  console.warn(`${what} skipped: ${error instanceof Error ? error.message : String(error)}`);
  return null;
};

/**
 * The products a search finds, as the store's product cards show them.
 * With the store's AI, the search's vector (`vectorFor`) adds meaning, and
 * its text model (`understand`) turns a search that may hold a price, an
 * order or stock into filters; both are asked at once, and whatever fails
 * or is late is left out, down to keyword search alone. `understand` is
 * left out when the shopper asked for the words exactly as typed, and both
 * are in the keyword arm of a search test (D77).
 */
export async function searchProducts(
  shop: Shop,
  query: string,
  vectorFor: VectorFor | null,
  understand: Understand | null = null,
  limit = 48,
): Promise<SearchResult> {
  const text = normalizeQuery(query);
  if (!text) return { products: [], semanticBest: null, meaningOnly: 0, filters: null };
  const ai = await aiFor(shop.storeId);
  const textModel = understand && ai?.textModel && worthUnderstanding(text) ? ai.textModel : null;
  const [vector, understood] = await Promise.all([
    ai?.space && vectorFor ? vectorFor(shop.storeId, ai.space, text).catch(skipped("Search by meaning")) : null,
    textModel && understand
      ? understand(shop.storeId, textModel, { locale: shop.market.locale, currency: shop.market.currency }, text).catch(
          skipped("Understanding the search"),
        )
      : null,
  ]);
  const meaning = vector && ai?.space ? { vector, space: ai.space, minSimilarity: ai.minSimilarity } : null;
  const filters = understood && hasFilters(understood) ? understood : null;
  const ranked = await rankedSearch(shop, text, limit, meaning, filters);
  if (ranked.ids.length === 0) return { products: [], semanticBest: ranked.semanticBest, meaningOnly: 0, filters };
  const products = await listGridProducts(shop.storeId, shop.market.code, shop.market.locale, {
    categoryIds: [],
    tagIds: [],
    // The order asked for, or the search's own.
    sort: filters?.sort === "priceLow" || filters?.sort === "priceHigh" ? filters.sort : filters?.sort === "newest" ? "newest" : "given",
    limit,
    ids: ranked.ids,
  });
  return { products, semanticBest: ranked.semanticBest, meaningOnly: ranked.meaningOnly, filters };
}

export type Suggestion = { handle: string; title: string; image: { url: string; alt: string } | null };

/**
 * As the shopper types (type-ahead): a few products whose words start with
 * what was typed, or whose titles are close to it. Keyword only, so no AI
 * call slows typing; nothing is logged.
 */
export async function suggestProducts(shop: Shop, query: string, limit = 6): Promise<Suggestion[]> {
  if (normalizeQuery(query).length < 2) return [];
  const ids = await matchingIds(shop, query, limit, true);
  if (ids.length === 0) return [];
  const cards = await listGridProducts(shop.storeId, shop.market.code, shop.market.locale, {
    categoryIds: [],
    tagIds: [],
    sort: "given",
    limit,
    ids,
  });
  return cards.map((c) => ({ handle: c.handle, title: c.title, image: c.image }));
}

/**
 * Keeps a search and how many products it found, for the zero-result rate,
 * with how close meaning came and how many results only meaning found.
 */
export async function logSearch(
  shop: Shop,
  query: string,
  results: number,
  meaning: { semanticBest: number | null; meaningOnly: number; filters?: SearchFilters | null } = { semanticBest: null, meaningOnly: 0 },
  /** The search's own id (its result links carry it), and its search test and arm (D77). */
  test: { id: string; experimentId: string | null; arm: "hybrid" | "keyword" | null } | null = null,
): Promise<void> {
  const text = normalizeQuery(query).slice(0, 100);
  if (!text) return;
  const filters = meaning.filters ? JSON.stringify(meaning.filters) : null;
  await db().execute(sql`
    insert into commerce.search_queries (id, store_id, market_code, query, results, semantic_best, meaning_results, filters, experiment_id, arm)
    values (coalesce(${test?.id ?? null}::uuid, gen_random_uuid()), ${shop.storeId}::uuid, ${shop.market.code}, ${text}, ${results}, ${meaning.semanticBest},
      ${Math.min(meaning.meaningOnly, results)}, ${filters}::jsonb, ${test?.experimentId ?? null}::uuid, ${test?.arm ?? null})
  `);
}

/** Days searches are kept: queries may hold personal data. */
export const SEARCH_LOG_DAYS = 90;

/** Forgets searches older than `SEARCH_LOG_DAYS`; from the five-minute cron. */
export async function pruneSearchLog(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.search_queries where created_at < now() - make_interval(days => ${SEARCH_LOG_DAYS}) returning 1
  `);
  return rows.length;
}

export type SearchStats = {
  days: number;
  searches: number;
  /** Searches that found nothing, of all searches: 0 to 1. */
  zeroRate: number;
  /** Searches where meaning was asked (the store's AI answered, D74). */
  meaningSearches: number;
  /** Searches with results only meaning found. */
  meaningHelped: number;
  top: { query: string; count: number; results: number }[];
  /** With how close meaning came, on average, when it was asked: near the limit, the limit may be too high. */
  zero: { query: string; count: number; closest: number | null }[];
};

/** A store's searches over the last days: how many, how many found nothing, and which. */
export async function searchStats(storeId: string, days = 30): Promise<SearchStats> {
  const since = sql`now() - make_interval(days => ${days})`;
  const [[totals], top, zero] = await Promise.all([
    readDb().execute<Row>(sql`
      select count(*)::int as searches, count(*) filter (where results = 0)::int as zero,
        count(*) filter (where semantic_best is not null)::int as meaning,
        count(*) filter (where meaning_results > 0)::int as helped
      from commerce.search_queries where store_id = ${storeId}::uuid and created_at >= ${since}
    `),
    readDb().execute<Row>(sql`
      select query, count(*)::int as count, round(avg(results))::int as results
      from commerce.search_queries where store_id = ${storeId}::uuid and created_at >= ${since}
      group by query order by count(*) desc, query limit 20
    `),
    readDb().execute<Row>(sql`
      select query, count(*)::int as count, avg(semantic_best) as closest
      from commerce.search_queries where store_id = ${storeId}::uuid and created_at >= ${since} and results = 0
      group by query order by count(*) desc, query limit 20
    `),
  ]);
  const searches = Number(totals?.searches ?? 0);
  return {
    days,
    searches,
    zeroRate: searches === 0 ? 0 : Number(totals.zero) / searches,
    meaningSearches: Number(totals?.meaning ?? 0),
    meaningHelped: Number(totals?.helped ?? 0),
    top: top.map((r) => ({ query: String(r.query), count: Number(r.count), results: Number(r.results) })),
    zero: zero.map((r) => ({ query: String(r.query), count: Number(r.count), closest: r.closest === null ? null : Number(r.closest) })),
  };
}
