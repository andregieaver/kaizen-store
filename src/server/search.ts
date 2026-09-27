import "server-only";

import { sql } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import { normalizeQuery, prefixQuery, reciprocalRankFusion } from "@/lib/search";
import type { Market } from "@/lib/markets";
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

/** The ids of the products a query finds, best first (while typing, `prefix`: words as starts of words). */
export async function matchingIds(shop: Shop, query: string, limit: number, prefix: boolean): Promise<string[]> {
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
export async function meaningMatches(shop: Shop, meaning: Meaning, limit: number): Promise<{ id: string; similarity: number }[]> {
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
    group by e.product_id
    order by similarity desc, e.product_id
    limit ${limit}
  `);
  return rows.map((row) => ({ id: String(row.product_id), similarity: Number(row.similarity) }));
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
 * query's vector is given, merged by reciprocal rank fusion. Without a
 * vector it is keyword search alone.
 */
export async function rankedSearch(shop: Shop, query: string, limit: number, meaning: Meaning | null): Promise<Ranked> {
  const text = normalizeQuery(query);
  if (!text) return { ids: [], semanticBest: null, meaningOnly: 0 };
  const [keyword, closest] = await Promise.all([
    matchingIds(shop, text, KEYWORD_CANDIDATES, false),
    meaning ? meaningMatches(shop, meaning, MEANING_CANDIDATES) : Promise.resolve([]),
  ]);
  const semanticBest = meaning ? (closest[0]?.similarity ?? null) : null;
  const byMeaning = closest.filter((match) => match.similarity >= (meaning?.minSimilarity ?? 1));
  const ids = reciprocalRankFusion([keyword, byMeaning.map((match) => match.id)]).slice(0, limit);
  const words = new Set(keyword);
  return { ids, semanticBest, meaningOnly: ids.filter((id) => !words.has(id)).length };
}

export type SearchResult = { products: GridProduct[]; semanticBest: number | null; meaningOnly: number };

/**
 * The products a search finds, as the store's product cards show them,
 * best first. Meaning is added when the store's AI has a search model and
 * answers in time (`vectorFor`); otherwise, or when it fails, the search is
 * by keyword alone.
 */
export async function searchProducts(
  shop: Shop,
  query: string,
  vectorFor: (storeId: string, space: string, text: string) => Promise<number[]>,
  limit = 48,
): Promise<SearchResult> {
  const text = normalizeQuery(query);
  if (!text) return { products: [], semanticBest: null, meaningOnly: 0 };
  let meaning: Meaning | null = null;
  const ai = await aiFor(shop.storeId);
  if (ai?.space) {
    try {
      meaning = { vector: await vectorFor(shop.storeId, ai.space, text), space: ai.space, minSimilarity: ai.minSimilarity };
    } catch (error) {
      console.warn(`Search by meaning skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const ranked = await rankedSearch(shop, text, limit, meaning);
  if (ranked.ids.length === 0) return { products: [], semanticBest: ranked.semanticBest, meaningOnly: 0 };
  const products = await listGridProducts(shop.storeId, shop.market.code, shop.market.locale, {
    categoryIds: [],
    tagIds: [],
    sort: "given",
    limit,
    ids: ranked.ids,
  });
  return { products, semanticBest: ranked.semanticBest, meaningOnly: ranked.meaningOnly };
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
  meaning: { semanticBest: number | null; meaningOnly: number } = { semanticBest: null, meaningOnly: 0 },
): Promise<void> {
  const text = normalizeQuery(query).slice(0, 100);
  if (!text) return;
  await db().execute(sql`
    insert into commerce.search_queries (store_id, market_code, query, results, semantic_best, meaning_results)
    values (${shop.storeId}::uuid, ${shop.market.code}, ${text}, ${results}, ${meaning.semanticBest},
      ${Math.min(meaning.meaningOnly, results)})
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
