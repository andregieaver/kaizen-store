import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import type { GridItem } from "@/lib/content-grid";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { pageExcerpt, parsePageContent } from "@/lib/page-content";
import { localizePage } from "@/lib/page-translation";
import {
  ANCHOR_WEIGHT,
  DEFAULT_MIX,
  PAGE_TEXT_MAX,
  RERANK_SYSTEM,
  applyRerank,
  armFor,
  chooseMix,
  classify,
  fuse,
  intentText,
  parseRerank,
  pickAnchors,
  placementOf,
  reasonFits,
  reasonFor,
  rerankFingerprint,
  rerankUser,
  withinTokenCap,
  type Anchor,
  type AnchorRole,
  type Classified,
  type Facts,
  type Placement,
  type Reason,
  type RecommendKind,
  type RecommendBlock,
  type RecommendPlace,
  type RecommendRequest,
  type RerankInput,
  type RerankPick,
  type Signals,
  type Source,
} from "@/lib/recommendations";
import { parseListingParams } from "@/lib/listing-filters";

import { AiError, aiFor, completeText } from "./ai";
import { getBuyer } from "./b2b";
import { catalogTag, listGridProducts, CATALOG_TAG, type GridProduct } from "./catalog";
import { deviceCartIds, getCart } from "./cart";
import { gridScope, productItem, storeAndMarket, withTileFields } from "./content-grid";
import { getCustomer } from "./customers";
import { fieldsTag, shownFieldsFor } from "./custom-fields";
import { pagesTag } from "./pages";
import { convertedSql, inStockNow } from "./product-conditions";
import { queryVector } from "./query-vector";
import { getRecommendSettings, recommendTag, tokensUsedThisMonth } from "./recommend-settings";
import { CacheLate, cached, cacheKey } from "./search-cache";
import { meaningMatches, rankedSearch } from "./search";
import type { Store } from "./stores";
import { currentTerms, termsTag } from "./taxonomy";
import { savedProductIds } from "./wishlists";

type Row = Record<string, unknown>;

/**
 * Product recommendations (D139). Candidates come from the store's own data (the owner's pairings, what was bought
 * together, products close in meaning, shared categories and tags, the shopper's searches and the page's words, what sells),
 * are fused into one ranking, filtered by hard rules in SQL (active, priced in the market, in stock, right audience, not
 * hidden, not already bought, not in the cart) and sorted into upsells, cross-sells and complements by code. With the
 * store's AI the model may then reorder the best of them; it can only choose ids from that list, its reasons are checked
 * against what each product is, and the words under a product are fixed sentences with a title the store holds. Without
 * the AI, over its monthly cap, in the plain-ranking arm or when it is late, the same ranking stands.
 */

const CANDIDATES = 60;
const RERANK_POOL = 16;
const PER_ANCHOR = 30;
const SOLD_DAYS = 90;
const TOGETHER_DAYS = 365;
const RERANK_WAIT_MS = 2500;
const RERANK_TIMEOUT_MS = 8000;
const PAID = sql`('paid', 'fulfilled', 'closed')`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => sql`${`{${ids.filter((id) => UUID.test(id)).join(",")}}`}::uuid[]`;
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

// ---------------------------------------------------------------------------
// Product facts
// ---------------------------------------------------------------------------

type ProductFacts = Facts & { title: string; description: string; kind: string; categoryNames: string[] };

/**
 * Products of the store as classification and prompts need them: title, description, the cheapest price in the market (as
 * shown), categories and tags. `restriction` is what the product must meet (anchors only need to exist; candidates must
 * be on sale to this shopper).
 */
async function loadFacts(storeId: string, market: Market, ids: readonly string[], restriction: SQL): Promise<Map<string, ProductFacts>> {
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id));
  if (wanted.length === 0) return new Map();
  const price = convertedSql(sql`cp.amount_minor`, market);
  const termsOf = (kind: string, column: SQL) => sql`array(
    select ${column} from commerce.product_terms pt join commerce.terms te on te.id = pt.term_id
    where pt.store_id = p.store_id and pt.product_id = p.id and te.kind = ${kind} order by te.name
  )`;
  const rows = await readDb().execute<Row>(sql`
    select p.id, p.kind,
      coalesce(tl.title, tf.title, '') as title,
      coalesce(nullif(tl.description, ''), tf.description, '') as description,
      (select min(${price}) from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
        where v.product_id = p.id and v.active and cp.market_code = ${market.code}) as price,
      ${termsOf("category", sql`pt.term_id::text`)} as categories,
      ${termsOf("tag", sql`pt.term_id::text`)} as tags,
      ${termsOf("category", sql`te.name`)} as category_names
    from commerce.products p
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
    left join lateral (
      select title, description from commerce.product_translations where product_id = p.id order by locale limit 1
    ) tf on true
    where p.store_id = ${storeId}::uuid and p.id = any(${uuidArray(wanted)}) and ${restriction}
  `);
  return new Map(
    rows.map((row) => [
      String(row.id),
      {
        id: String(row.id),
        title: String(row.title),
        description: String(row.description),
        kind: String(row.kind),
        priceMinor: row.price === null ? 0 : Number(row.price),
        categoryIds: strings(row.categories),
        tagIds: strings(row.tags),
        categoryNames: strings(row.category_names),
      },
    ]),
  );
}

/** What a product must meet to be recommended to this shopper (D139): on sale, in stock, for their kind, not hidden. */
function recommendable(storeId: string, market: Market, viewer: { buyer: "private" | "business"; audienceBoth: boolean }, scope: { categoryIds: string[]; tagIds: string[] }): SQL {
  const inTerms = (termIds: string[]) =>
    termIds.length === 0
      ? sql`true`
      : sql`exists (select 1 from commerce.product_terms pt where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id = any(${uuidArray(termIds)}))`;
  return sql`p.status = 'active'
    and exists (select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = p.id and v.active and cp.market_code = ${market.code})
    and ${inStockNow()}
    and ${viewer.audienceBoth ? sql`p.audience in ('all', ${viewer.buyer === "business" ? "businesses" : "consumers"})` : sql`true`}
    and not exists (select 1 from commerce.recommendation_rules r where r.store_id = ${storeId}::uuid and r.kind = 'hide' and r.product_id = p.id)
    and ${inTerms(scope.categoryIds)} and ${inTerms(scope.tagIds)}`;
}

// ---------------------------------------------------------------------------
// Candidate lists
// ---------------------------------------------------------------------------

type AnchorList = { anchor: string; ids: string[] };

/** The owner's pairings for each anchor, oldest first. */
async function goesWithLists(storeId: string, anchors: string[]): Promise<AnchorList[]> {
  if (anchors.length === 0) return [];
  const rows = await readDb().execute<Row>(sql`
    select product_id, other_product_id from commerce.recommendation_rules
    where store_id = ${storeId}::uuid and kind = 'goes_with' and product_id = any(${uuidArray(anchors)})
    order by created_at, id
  `);
  return group(rows.map((r) => [String(r.product_id), String(r.other_product_id)]));
}

/** Pairs the owner says never go together, both ways. */
async function neverWith(storeId: string, anchors: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (anchors.length === 0) return map;
  const rows = await readDb().execute<Row>(sql`
    select product_id, other_product_id from commerce.recommendation_rules
    where store_id = ${storeId}::uuid and kind = 'never_with' and product_id = any(${uuidArray(anchors)})
  `);
  for (const row of rows) {
    const set = map.get(String(row.product_id)) ?? new Set<string>();
    set.add(String(row.other_product_id));
    map.set(String(row.product_id), set);
  }
  return map;
}

function group(pairs: [string, string][]): AnchorList[] {
  const lists = new Map<string, string[]>();
  for (const [anchor, id] of pairs) lists.set(anchor, [...(lists.get(anchor) ?? []), id]);
  return [...lists].map(([anchor, ids]) => ({ anchor, ids }));
}

/** Products closest in meaning to each anchor, by the vectors the store's AI made (never across models). */
async function similarLists(storeId: string, locale: string, anchors: string[]): Promise<AnchorList[]> {
  if (anchors.length === 0) return [];
  const rows = await readDb().execute<Row>(sql`
    select a.anchor_id, n.product_id, n.similarity
    from unnest(${uuidArray(anchors)}) as a(anchor_id)
    join lateral (
      select x.store_id, x.locale, x.space, x.embedding from commerce.product_embeddings x
      where x.store_id = ${storeId}::uuid and x.product_id = a.anchor_id
      order by (x.locale = ${locale}) desc, x.locale limit 1
    ) e1 on true
    cross join lateral (
      select e2.product_id, 1 - (e2.embedding OPERATOR(extensions.<=>) e1.embedding) as similarity
      from commerce.product_embeddings e2
      where e2.store_id = e1.store_id and e2.locale = e1.locale and e2.space = e1.space and e2.product_id <> a.anchor_id
        and extensions.vector_dims(e2.embedding) = extensions.vector_dims(e1.embedding)
      order by e2.embedding OPERATOR(extensions.<=>) e1.embedding
      limit ${PER_ANCHOR}
    ) n
    order by a.anchor_id, n.similarity desc
  `);
  return group(rows.map((r) => [String(r.anchor_id), String(r.product_id)]));
}

/** What was bought in the same paid orders as each anchor, most often first (the last year, not copied history). */
async function boughtTogetherLists(storeId: string, anchors: string[]): Promise<AnchorList[]> {
  if (anchors.length === 0) return [];
  const rows = await readDb().execute<Row>(sql`
    select a.anchor_id, v2.product_id, count(distinct o.id) as together
    from unnest(${uuidArray(anchors)}) as a(anchor_id)
    join commerce.product_variants v1 on v1.product_id = a.anchor_id
    join commerce.order_lines l1 on l1.store_id = ${storeId}::uuid and l1.variant_id = v1.id
    join commerce.orders o on o.store_id = l1.store_id and o.id = l1.order_id
      and o.status in ${PAID} and o.copied_from is null and o.placed_at > now() - make_interval(days => ${TOGETHER_DAYS})
    join commerce.order_lines l2 on l2.store_id = o.store_id and l2.order_id = o.id and l2.id <> l1.id and not l2.gift
    join commerce.product_variants v2 on v2.id = l2.variant_id and v2.product_id <> a.anchor_id
    group by a.anchor_id, v2.product_id
    order by a.anchor_id, together desc, v2.product_id
  `);
  const capped = new Map<string, number>();
  return group(
    rows
      .filter((r) => {
        const n = (capped.get(String(r.anchor_id)) ?? 0) + 1;
        capped.set(String(r.anchor_id), n);
        return n <= PER_ANCHOR;
      })
      .map((r) => [String(r.anchor_id), String(r.product_id)]),
  );
}

/** Products sharing the most categories and tags with each anchor. */
async function termLists(storeId: string, anchors: string[]): Promise<AnchorList[]> {
  if (anchors.length === 0) return [];
  const rows = await readDb().execute<Row>(sql`
    select a.anchor_id, pt2.product_id, count(*) as shared
    from unnest(${uuidArray(anchors)}) as a(anchor_id)
    join commerce.product_terms pt1 on pt1.store_id = ${storeId}::uuid and pt1.product_id = a.anchor_id
    join commerce.product_terms pt2 on pt2.store_id = pt1.store_id and pt2.term_id = pt1.term_id and pt2.product_id <> a.anchor_id
    group by a.anchor_id, pt2.product_id
    order by a.anchor_id, shared desc, pt2.product_id
  `);
  const capped = new Map<string, number>();
  return group(
    rows
      .filter((r) => {
        const n = (capped.get(String(r.anchor_id)) ?? 0) + 1;
        capped.set(String(r.anchor_id), n);
        return n <= PER_ANCHOR;
      })
      .map((r) => [String(r.anchor_id), String(r.product_id)]),
  );
}

/** What sold most in the last three months, then the newest: the store's answer when nothing else is known. */
async function popularIds(storeId: string, scope: { categoryIds: string[]; tagIds: string[] }, limit: number): Promise<string[]> {
  const inTerms = (termIds: string[]) =>
    termIds.length === 0
      ? sql`true`
      : sql`exists (select 1 from commerce.product_terms pt where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id = any(${uuidArray(termIds)}))`;
  const rows = await readDb().execute<Row>(sql`
    select p.id from commerce.products p
    left join (
      select v.product_id, sum(l.quantity) as sold
      from commerce.order_lines l
      join commerce.product_variants v on v.id = l.variant_id
      join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id and o.status in ${PAID} and o.copied_from is null
        and o.placed_at > now() - make_interval(days => ${SOLD_DAYS})
      where l.store_id = ${storeId}::uuid and not l.gift
      group by v.product_id
    ) s on s.product_id = p.id
    where p.store_id = ${storeId}::uuid and p.status = 'active' and ${inTerms(scope.categoryIds)} and ${inTerms(scope.tagIds)}
    order by coalesce(s.sold, 0) desc, p.created_at desc, p.id
    limit ${limit}
  `);
  return rows.map((r) => String(r.id));
}

// ---------------------------------------------------------------------------
// The shopper
// ---------------------------------------------------------------------------

type Viewer = {
  buyer: "private" | "business";
  audienceBoth: boolean;
  cart: string[];
  saved: string[];
  purchased: Set<string>;
};

const NO_VIEWER: Viewer = { buyer: "private", audienceBoth: false, cart: [], saved: [], purchased: new Set() };

/**
 * Products this shopper has bought: by their account, their email, or a cart of this browser's (the same device), in paid
 * orders of this store, not copied history. Bookings (appointments, stays, rentals) are not counted: they are booked
 * again, so they stay recommendable.
 */
export async function purchasedProductIds(
  storeId: string,
  who: { customerId: string | null; email: string | null; cartIds: string[] },
): Promise<Set<string>> {
  const matches: SQL[] = [];
  if (who.customerId) matches.push(sql`o.customer_id = ${who.customerId}::uuid`);
  if (who.email) matches.push(sql`lower(o.email) = ${who.email.toLowerCase()}`);
  if (who.cartIds.length > 0) matches.push(sql`o.cart_id = any(${uuidArray(who.cartIds)})`);
  if (matches.length === 0) return new Set();
  const rows = await db().execute<Row>(sql`
    select distinct v.product_id
    from commerce.orders o
    join commerce.order_lines l on l.store_id = o.store_id and l.order_id = o.id
    join commerce.product_variants v on v.id = l.variant_id
    join commerce.products p on p.id = v.product_id and p.kind = 'goods'
    where o.store_id = ${storeId}::uuid and o.status in ${PAID} and o.copied_from is null and (${sql.join(matches, sql` or `)})
  `);
  return new Set(rows.map((r) => String(r.product_id)));
}

async function viewerOf(store: Store, market: Market): Promise<Viewer> {
  const [buyer, cart, saved, customer, cartIds] = await Promise.all([
    getBuyer(store),
    getCart({ storeId: store.id, market }),
    savedProductIds(store.id),
    getCustomer(store.id),
    deviceCartIds(store.id),
  ]);
  const purchased = await purchasedProductIds(store.id, { customerId: customer?.id ?? null, email: customer?.email ?? null, cartIds });
  return { buyer, audienceBoth: store.audience === "both", cart: [...new Set(cart.lines.map((l) => l.productId))], saved, purchased };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** What the page is about, in words: a product's, an article's or page's own text, categories, tags and public custom fields. */
type PageWords = { title: string; text: string; productId: string | null; categories: string[] };

const fieldLines = (groups: Awaited<ReturnType<typeof shownFieldsFor>>): string =>
  groups
    .flatMap((g) => g.fields)
    .map((f) => `${f.label}: ${f.text}`.trim())
    .filter((line) => line.length > 2)
    .join(". ")
    .slice(0, 500);

async function pageWords(store: Store, market: Market, place: RecommendPlace, facts: Map<string, ProductFacts>): Promise<PageWords | null> {
  const lang = market.lang;
  if (place.kind === "product") {
    const product = facts.get(place.productId);
    if (!product) return null;
    const fields = fieldLines(await shownFieldsFor(store.id, "product", product.id, market.locale, lang, market.slug));
    return {
      title: product.title,
      text: [product.description.slice(0, 500), fields].filter(Boolean).join(". "),
      productId: product.id,
      categories: product.categoryNames,
    };
  }
  if (place.kind === "article" || place.kind === "page") {
    const type = place.kind;
    const [row] = await readDb().execute<Row>(sql`
      select published from commerce.pages
      where store_id = ${store.id}::uuid and id = ${place.pageId}::uuid and type = ${type} and published_at is not null
    `);
    const stored = row ? parsePageContent(row.published) : null;
    if (!stored) return null;
    const content = localizePage(stored, market.locale);
    const [terms, fields] = await Promise.all([currentTerms(store.id, type), shownFieldsFor(store.id, type, place.pageId, market.locale, lang, market.slug)]);
    // The page's own categories and tags (by name), as words for what it is about.
    const names = terms.filter((term) => [...content.categories, ...content.tags].includes(term.id)).map((term) => term.name);
    return {
      title: content.title,
      text: [pageExcerpt(content, PAGE_TEXT_MAX), names.join(", "), fieldLines(fields)].filter(Boolean).join(". "),
      productId: null,
      categories: names,
    };
  }
  return null;
}

/** The product categories and tags a listing's address chose, as term ids, with their names. */
async function listingScope(store: Store, query: string): Promise<{ categoryIds: string[]; tagIds: string[]; names: string[] }> {
  const filters = parseListingParams(new URLSearchParams(query));
  if (filters.categories.length === 0 && filters.tags.length === 0) return { categoryIds: [], tagIds: [], names: [] };
  const terms = await currentTerms(store.id, "product");
  const chosen = terms.filter((term) => (term.kind === "category" ? filters.categories : filters.tags).includes(term.slug));
  return {
    categoryIds: chosen.filter((term) => term.kind === "category").map((term) => term.id),
    tagIds: chosen.filter((term) => term.kind === "tag").map((term) => term.id),
    names: chosen.map((term) => term.name),
  };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/** A recommended product with what it is to the shopper's product and why, for code that words it itself (the chat agent). */
export type Picked = { product: GridProduct; kind: RecommendKind; reason: Reason; note: string | null };

export type RecommendOutcome = {
  items: GridItem[];
  /** The same products with their kind and reason; server only (the page's request gets `items`). */
  picked: Picked[];
  arm: "ai" | "baseline";
  placement: Placement;
  /** What the model did: `used` or `cached` (its order stands), `holdout` (plain arm), `off`, `cap`, `late`, or `none` (nothing to go on). */
  ai: "used" | "holdout" | "off" | "cap" | "late" | "none";
};

type Pipeline = {
  store: Store;
  market: Market;
  place: RecommendPlace;
  block: RecommendBlock;
  signals: Signals;
  viewer: Viewer;
  /** Whether the store's model may re-rank (settings, arm and cap are decided by the caller). */
  ai: boolean;
  ceilingPercent: number;
};

async function pipeline(p: Pipeline): Promise<{ items: GridItem[]; picked: Picked[]; ai: RecommendOutcome["ai"] }> {
  const { store, market, place, block, signals, viewer } = p;
  const storeId = store.id;
  const m = t(market.lang);

  // What the grid keeps to: its own categories and tags, and a listing's chosen ones.
  const scope = await gridScope(storeId, block);
  if (!scope) return { items: [], picked: [], ai: "none" };
  const listing = place.kind === "listing" ? await listingScope(store, place.query) : null;
  const popularScope = listing && (listing.categoryIds.length > 0 || listing.tagIds.length > 0) ? listing : scope;

  // The products the recommendations are about.
  const pageProductId = place.kind === "product" ? place.productId : null;
  const wanted = pickAnchors({ pageProductId, cart: viewer.cart, views: signals.views, wishlist: viewer.saved });
  const anchorFacts = await loadFacts(storeId, market, wanted.map((a) => a.id), sql`true`);
  const anchors: Anchor[] = wanted.filter((a) => anchorFacts.has(a.id));
  const anchorIds = anchors.map((a) => a.id);
  const roleOf = new Map<string, AnchorRole>(anchors.map((a) => [a.id, a.role]));
  const weightOf = (id: string) => ANCHOR_WEIGHT[roleOf.get(id) ?? "viewed"];

  const words = await pageWords(store, market, place, anchorFacts);
  const searches = signals.searches;

  // Candidate lists, each ranked.
  const [together, similar, terms, rules, never, popular, searched] = await Promise.all([
    boughtTogetherLists(storeId, anchorIds),
    similarLists(storeId, market.locale, anchorIds),
    termLists(storeId, anchorIds),
    goesWithLists(storeId, anchorIds),
    neverWith(storeId, anchorIds),
    popularIds(storeId, popularScope, 30),
    Promise.all(searches.slice(0, 3).map((query) => rankedSearch({ storeId, market }, query, 30, null).then((r) => r.ids))),
  ]);
  const lists: Parameters<typeof fuse>[0] = [
    ...rules.map((l) => ({ source: "goes_with" as Source, ids: l.ids, from: l.anchor, weight: weightOf(l.anchor) })),
    ...together.map((l) => ({ source: "bought_together" as Source, ids: l.ids, from: l.anchor, weight: weightOf(l.anchor) })),
    ...similar.map((l) => ({ source: "similar" as Source, ids: l.ids, from: l.anchor, weight: weightOf(l.anchor) })),
    ...terms.map((l) => ({ source: "terms" as Source, ids: l.ids, from: l.anchor, weight: weightOf(l.anchor) })),
    ...searched.map((ids, i) => ({ source: "search" as Source, ids, weight: 1 - i * 0.15 })),
    { source: "popular" as Source, ids: popular },
  ];

  // What the shopper's words and the page's words mean, found among the products' vectors (needs the store's AI and a cap not reached).
  const text = intentText({ searches, page: words, titles: [] });
  const embedder = text && p.ai ? await aiFor(storeId, { feature: "recommendations" }) : null;
  if (embedder?.space && (await underCap(storeId))) {
    try {
      const vector = await queryVector(storeId, embedder.space, text, "recommendations");
      const found = await meaningMatches({ storeId, market }, { vector, space: embedder.space, minSimilarity: embedder.minSimilarity }, 40);
      lists.push({ source: "text", ids: found.map((f) => f.id) });
    } catch (error) {
      console.warn(`[recommend] meaning skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const fused = fuse(lists).filter((r) => !roleOf.has(r.id));
  // Not what the shopper already has, bought, or was told never to be shown with these products.
  const excluded = new Set<string>([...viewer.purchased, ...viewer.cart]);
  for (const set of never.values()) for (const id of set) excluded.add(id);
  const pool = fused.filter((r) => !excluded.has(r.id)).slice(0, CANDIDATES);
  const facts = await loadFacts(storeId, market, pool.map((r) => r.id), recommendable(storeId, market, viewer, scope));
  const primary = anchors[0] ? anchorFacts.get(anchors[0].id)! : null;

  const classified: Classified[] = [];
  for (const entry of pool) {
    const candidate = facts.get(entry.id);
    if (!candidate) continue;
    const relative = (entry.because ? anchorFacts.get(entry.because) : null) ?? primary;
    const kind = classify(candidate, entry.sources, relative, p.ceilingPercent);
    if (kind) classified.push({ ...entry, kind, categoryIds: candidate.categoryIds });
  }
  const chosen = chooseMix(classified, Math.max(block.limit, RERANK_POOL), block.mix);

  // The model may reorder the best; nothing it says adds or removes a product.
  let ordered = chosen;
  let picks: RerankPick[] | null = null;
  let ai: RecommendOutcome["ai"] = "none";
  const hasIntent = anchors.length > 0 || searches.length > 0 || words !== null;
  if (p.ai && hasIntent && chosen.length >= 3) {
    const input: RerankInput = {
      limit: block.limit,
      references: anchors.map((a) => ({ id: a.id, title: anchorFacts.get(a.id)!.title, role: a.role })),
      searches,
      page: words ? { title: words.title, text: words.text } : null,
      candidates: chosen.slice(0, RERANK_POOL).map((c) => ({ id: c.id, title: facts.get(c.id)!.title, categories: facts.get(c.id)!.categoryNames, kind: c.kind })),
    };
    const result = await rerank(storeId, market, input);
    ai = result.status;
    picks = result.picks;
    if (picks) ordered = applyRerank(chosen, picks);
  } else if (!p.ai) {
    ai = "off";
  }
  const top = ordered.slice(0, block.limit);
  if (top.length === 0) return { items: [], picked: [], ai };

  // Cards, priced as the store prices them; the line under each says why.
  const cards = await listGridProducts(storeId, market, { categoryIds: [], tagIds: [], ids: top.map((c) => c.id), sort: "given", limit: Math.max(top.length, 1) });
  const byId = new Map(cards.map((card) => [card.id, card]));
  const search = searches[0] ?? null;
  const pickOf = new Map((picks ?? []).map((pick) => [pick.id, pick]));
  const items: GridItem[] = [];
  const picked: Picked[] = [];
  for (const entry of top) {
    const card = byId.get(entry.id);
    if (!card) continue;
    const item = productItem(store.slug, market.slug, card);
    const own = reasonFor(entry, roleOf, search);
    const pick = pickOf.get(entry.id);
    const type = pick && reasonFits(entry, pick.reason, words !== null) ? pick.reason : own.type;
    const because = (pick && pick.reason === type ? pick.because : null) ?? own.because;
    const reason: Reason = { type, ref: because ? (anchorFacts.get(because)?.title ?? null) : null };
    const note = reasonText(m, reason);
    if (block.explain && note) item.note = note;
    items.push(item);
    picked.push({ product: card, kind: entry.kind, reason, note });
  }
  // The custom fields the grid's tiles show (D120).
  return { items: await withTileFields(storeId, "product", market, block.tileFields, items), picked, ai };
}

/** The line under a recommended product, in the shopper's language, or none when its title is missing. */
export function reasonText(m: ReturnType<typeof t>, reason: Reason): string | null {
  const r = m.recommend;
  switch (reason.type) {
    case "viewed":
      return reason.ref ? r.viewed(reason.ref) : null;
    case "pairs":
      return reason.ref ? r.pairs(reason.ref) : null;
    case "step_up":
      return reason.ref ? r.stepUp(reason.ref) : null;
    case "cart":
      return reason.ref ? r.cart(reason.ref) : null;
    case "wishlist":
      return reason.ref ? r.wishlist(reason.ref) : null;
    case "search":
      return r.search;
    case "page":
      return r.page;
    case "popular":
      return r.popular;
  }
}

class CapReached extends Error {}

async function underCap(storeId: string): Promise<boolean> {
  const settings = await getRecommendSettings(storeId);
  return withinTokenCap(await tokensUsedThisMonth(storeId), settings.monthlyTokenCap);
}

/**
 * The model's order for these candidates: kept by what it was asked (the same question is answered once), waited for a
 * moment, and left out when late, over the month's cap, or answered with nothing usable.
 */
async function rerank(storeId: string, market: Market, input: RerankInput): Promise<{ picks: RerankPick[] | null; status: RecommendOutcome["ai"] }> {
  const candidateIds = new Set(input.candidates.map((c) => c.id));
  const referenceIds = new Set(input.references.map((r) => r.id));
  const key = cacheKey("rerank", market.locale, rerankFingerprint(input));
  try {
    const picks = await cached<RerankPick[]>(
      storeId,
      "rerank",
      key,
      async () => {
        if (!(await underCap(storeId))) throw new CapReached();
        const ai = await aiFor(storeId, { feature: "recommendations" });
        if (!ai?.textModel) throw new AiError("No text model is set.");
        const { text } = await completeText(
          ai,
          [
            { role: "system", content: RERANK_SYSTEM },
            { role: "user", content: rerankUser(input) },
          ],
          { maxTokens: 500, timeoutMs: RERANK_TIMEOUT_MS, temperature: 0 },
        );
        const parsed = parseRerank(text, candidateIds, referenceIds, input.limit);
        if (!parsed) throw new AiError("The model's order held nothing usable.");
        return parsed;
      },
      RERANK_WAIT_MS,
    );
    // A kept answer is checked against these candidates again.
    return { picks: picks.filter((p) => candidateIds.has(p.id)), status: "used" };
  } catch (error) {
    if (error instanceof CapReached) return { picks: null, status: "cap" };
    const late = error instanceof CacheLate;
    if (!late) console.warn(`[recommend] re-ranking skipped: ${error instanceof Error ? error.message : String(error)}`);
    return { picks: null, status: late ? "late" : "none" };
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Recommendations for the shopper in this request (their cart, wishlist, account and device's carts, and the session the
 * tab sent), in the arm their tab was drawn into.
 */
export async function recommendFor(store: Store, market: Market, request: RecommendRequest): Promise<RecommendOutcome> {
  const settings = await getRecommendSettings(store.id);
  const placement = placementOf(request.place);
  if (!settings.enabled) return { items: [], picked: [], arm: "baseline", placement, ai: "off" };
  const arm = armFor(request.session, settings.holdoutPercent);
  const viewer = await viewerOf(store, market);
  const result = await pipeline({
    store,
    market,
    place: request.place,
    block: request.block,
    signals: request.signals,
    viewer,
    ai: settings.ai && arm === "ai",
    ceilingPercent: settings.upsellCeilingPercent,
  });
  return { ...result, arm, placement, ai: settings.ai && arm === "baseline" ? "holdout" : result.ai };
}

/**
 * Recommendations for a page as it is built, for everyone: no session, cart, account or AI, so it can be kept and shown
 * before the shopper's own arrive (a visitor with nothing of their own to go on sees the same).
 */
export async function standInFor(storeId: string, marketSlug: string, place: RecommendPlace, block: RecommendBlock): Promise<GridItem[]> {
  "use cache";
  cacheLife("hours");
  // What a stand-in depends on: the catalogue, the owner's rules, the grid's categories and tags, custom fields, and the pages' words.
  cacheTag(CATALOG_TAG, catalogTag(storeId), recommendTag(storeId), termsTag({ storeId, contentType: "product" }), fieldsTag(storeId), pagesTag(storeId));
  const shop = await storeAndMarket(storeId, marketSlug);
  if (!shop) return [];
  const settings = await getRecommendSettings(storeId);
  if (!settings.enabled) return [];
  return (await pipeline({ store: shop.store, market: shop.market, place, block, signals: { views: [], searches: [] }, viewer: NO_VIEWER, ai: false, ceilingPercent: settings.upsellCeilingPercent })).items;
}

/**
 * Recommendations for the chat agent (D139): the same engine and rules as the pages, for this visitor (their cart, wishlist,
 * account and device's orders, and what their tab remembers), without the AI's re-ranking: the agent's own model words the
 * answer. Empty while the store's recommendations are off, so the agent searches instead.
 */
export async function recommendForChat(
  store: Store,
  market: Market,
  input: { productId: string | null; signals: Signals; limit?: number },
): Promise<{ on: boolean; picked: Picked[] }> {
  const settings = await getRecommendSettings(store.id);
  if (!settings.enabled) return { on: false, picked: [] };
  const viewer = await viewerOf(store, market);
  const result = await pipeline({
    store,
    market,
    place: input.productId ? { kind: "product", productId: input.productId } : { kind: "other" },
    block: { limit: Math.min(6, input.limit ?? 4), mix: DEFAULT_MIX, explain: false, categories: [], tags: [], tileFields: [] },
    signals: input.signals,
    viewer,
    ai: false,
    ceilingPercent: settings.upsellCeilingPercent,
  });
  return { on: true, picked: result.picked };
}
