import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import type { Buyer } from "@/lib/b2b";
import { toMinorUnits, type ListingFilters } from "@/lib/listing-filters";
import type { Market } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";
import { PRODUCT_KINDS, type ProductKind } from "@/lib/query-understanding";
import { categoryTree, withDescendants, type Term } from "@/lib/taxonomy";

import { CATALOG_TAG, catalogTag, listGridProducts, type GridProduct } from "./catalog";
import { inCategories, inStockNow, shownPrice, textList, withTags } from "./product-conditions";
import { siteTerms, termsTag } from "./taxonomy";

/**
 * Sorting and filtering product listings (D78): which of a page's products
 * meet the shopper's filters, in the order asked, and what the page's
 * products offer to filter by (kinds, categories, tags, variant options
 * and the price range, with counts). A page's products are its `scope`:
 * a category's or tag's (by term ids), search results (by product ids,
 * in their order), or the whole store.
 */

type Row = Record<string, unknown>;

export type ListingScope = { categoryIds?: string[]; tagIds?: string[]; ids?: string[] };

/** Who is looking: prices are compared as shown to them, and a store selling to both shows each kind only its products. */
export type Viewer = { buyer: Buyer; audienceBoth: boolean };

/** How many products a page lists at most. */
export const LISTING_LIMIT = 48;
/** How many of a page's products its choices are counted over. */
const FACET_LIMIT = 2000;

const uuids = (list: string[]) => `{${list.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).join(",")}}`;

/** The page's products: active, with a price in the market, in its scope, shown to this viewer. */
function scopeClause(storeId: string, marketCode: string, scope: ListingScope, viewer: Viewer): SQL {
  const inTerms = (ids: string[] | undefined) =>
    ids && ids.length > 0
      ? sql`exists (select 1 from commerce.product_terms pt where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id = any(${uuids(ids)}::uuid[]))`
      : sql`true`;
  return sql`p.store_id = ${storeId}::uuid and p.status = 'active'
    and exists (
      select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = p.id and v.active and cp.market_code = ${marketCode}
    )
    and ${inTerms(scope.categoryIds)} and ${inTerms(scope.tagIds)}
    and ${scope.ids ? sql`p.id = any(${uuids(scope.ids)}::uuid[])` : sql`true`}
    and ${viewer.audienceBoth ? sql`p.audience in ('all', ${viewer.buyer === "business" ? "businesses" : "consumers"})` : sql`true`}`;
}

/** What the shopper's filters ask of a product `p`, as SQL; every value a parameter. */
function filtersClause(filters: ListingFilters, market: Market, viewer: Viewer): SQL {
  const parts: SQL[] = [];
  if (filters.kinds.length > 0) parts.push(sql`p.kind = any(${textList(filters.kinds)})`);
  if (filters.categories.length > 0) parts.push(inCategories(filters.categories));
  if (filters.tags.length > 0) parts.push(withTags(filters.tags));
  if (filters.options.length > 0) {
    // Every option chosen, on one variant: blue and M is a blue M, not a blue S and a red M.
    const each = filters.options.map((option) => sql`(v.options ->> ${option.name}) = any(${textList(option.values)})`);
    parts.push(sql`exists (
      select 1 from commerce.product_variants v
      where v.product_id = p.id and v.active and ${sql.join(each, sql` and `)}
    )`);
  }
  if (filters.minPrice !== null || filters.maxPrice !== null) {
    const digits = minorUnitDigits(market.currency);
    parts.push(sql`exists (
      select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = p.id and v.active and cp.market_code = ${market.code}
        and ${shownPrice(market.code, viewer.buyer === "business")} between ${toMinorUnits(filters.minPrice, digits) ?? 0}
          and ${toMinorUnits(filters.maxPrice, digits) ?? Number.MAX_SAFE_INTEGER}
    )`);
  }
  if (filters.inStock) parts.push(inStockNow());
  return parts.length === 0 ? sql`true` : sql.join(parts, sql` and `);
}

/**
 * The products of a page that meet the filters, sorted, as product cards
 * show them. "featured" keeps the page's own order: search results'
 * relevance, else the order products were added.
 */
export async function listingProducts(
  storeId: string,
  market: Market,
  scope: ListingScope,
  filters: ListingFilters,
  viewer: Viewer,
): Promise<GridProduct[]> {
  const lowest = sql`(select min(${shownPrice(market.code, viewer.buyer === "business")})
    from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
    where v.product_id = p.id and v.active and cp.market_code = ${market.code})`;
  const title = sql`(select lower(title) from commerce.product_translations tr
    where tr.product_id = p.id order by tr.locale = ${market.locale} desc, tr.locale limit 1)`;
  const order =
    filters.sort === "newest"
      ? sql`p.created_at desc, p.handle`
      : filters.sort === "priceLow"
        ? sql`${lowest}, p.handle`
        : filters.sort === "priceHigh"
          ? sql`${lowest} desc, p.handle`
          : filters.sort === "title"
            ? sql`${title}, p.handle`
            : scope.ids
              ? sql`array_position(${uuids(scope.ids)}::uuid[], p.id)`
              : sql`p.created_at, p.handle`;
  const rows = await readDb().execute<Row>(sql`
    select p.id from commerce.products p
    where ${scopeClause(storeId, market.code, scope, viewer)} and ${filtersClause(filters, market, viewer)}
    order by ${order}
    limit ${LISTING_LIMIT}
  `);
  const ids = rows.map((row) => String(row.id));
  if (ids.length === 0) return [];
  return listGridProducts(storeId, market.code, market.locale, { categoryIds: [], tagIds: [], ids, sort: "given", limit: LISTING_LIMIT });
}

export type FacetValue = { value: string; label: string; count: number };

/** What a page's products offer to filter by, each with how many products have it. */
export type ListingFacets = {
  /** The page's products, before filters. */
  total: number;
  kinds: { kind: ProductKind; count: number }[];
  /** Categories in tree order, with their depth. */
  categories: (FacetValue & { depth: number })[];
  tags: FacetValue[];
  /** Variant options by name (size, colour, rental period …), with their values. */
  options: { name: string; label: string; values: FacetValue[] }[];
  /** Whole units of the currency, as prices are shown to the viewer; null without prices. */
  price: { min: number; max: number } | null;
};

/** Sizes in the order people expect, before other values. */
const SIZES = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl"];

function byValue(a: string, b: string): number {
  const sa = SIZES.indexOf(a.toLowerCase());
  const sb = SIZES.indexOf(b.toLowerCase());
  if (sa >= 0 || sb >= 0) return (sa < 0 ? SIZES.length : sa) - (sb < 0 ? SIZES.length : sb);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The choices a page's products offer (D78). Only what would narrow the
 * page is offered: a kind, category, tag or option value some but not all
 * of its products have (a chosen one is always shown above the list, to
 * take away). `labels` names Kaizen's own option names and values (the
 * demo's).
 */
export async function listingFacets(
  storeId: string,
  market: Market,
  scope: ListingScope,
  viewer: Viewer,
  labels: Record<string, string> = {},
): Promise<ListingFacets> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId), termsTag({ storeId, contentType: "product" }));

  const business = viewer.buyer === "business";
  const products = await readDb().execute<Row>(sql`
    select p.id, p.kind,
      (select min(${shownPrice(market.code, business)}) from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
        where v.product_id = p.id and v.active and cp.market_code = ${market.code}) as low,
      (select max(${shownPrice(market.code, business)}) from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
        where v.product_id = p.id and v.active and cp.market_code = ${market.code}) as high
    from commerce.products p
    where ${scopeClause(storeId, market.code, scope, viewer)}
    limit ${FACET_LIMIT}
  `);
  const total = products.length;
  const empty: ListingFacets = { total, kinds: [], categories: [], tags: [], options: [], price: null };
  if (total === 0) return empty;
  const ids = uuids(products.map((row) => String(row.id)));

  const [links, optionRows, terms] = await Promise.all([
    readDb().execute<Row>(sql`
      select pt.product_id, pt.term_id from commerce.product_terms pt
      where pt.store_id = ${storeId}::uuid and pt.product_id = any(${ids}::uuid[])
    `),
    readDb().execute<Row>(sql`
      select o.key as name, o.value, count(distinct v.product_id)::int as count
      from commerce.product_variants v, jsonb_each_text(v.options) o
      where v.product_id = any(${ids}::uuid[]) and v.active
      group by o.key, o.value
    `),
    siteTerms(storeId, "product"),
  ]);

  const narrows = (count: number) => count > 0 && count < total;
  const label = (text: string) => labels[text] ?? text;

  const kindCounts = new Map<string, number>();
  for (const row of products) kindCounts.set(String(row.kind), (kindCounts.get(String(row.kind)) ?? 0) + 1);
  const kinds = PRODUCT_KINDS.map((kind) => ({ kind, count: kindCounts.get(kind) ?? 0 }));

  const termsOf = new Map<string, Set<string>>();
  for (const row of links) {
    const product = String(row.product_id);
    if (!termsOf.has(product)) termsOf.set(product, new Set());
    termsOf.get(product)!.add(String(row.term_id));
  }
  const countWith = (termIds: string[]) => {
    let count = 0;
    for (const set of termsOf.values()) if (termIds.some((id) => set.has(id))) count += 1;
    return count;
  };
  const categories = categoryTree(terms).map((term) => ({
    value: term.slug,
    label: term.name,
    depth: term.depth,
    count: countWith(withDescendants(terms, [term.id])),
  }));
  const tags = terms
    .filter((term: Term) => term.kind === "tag")
    .map((term) => ({ value: term.slug, label: term.name, count: countWith([term.id]) }));

  const byName = new Map<string, FacetValue[]>();
  for (const row of optionRows) {
    const name = String(row.name);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push({ value: String(row.value), label: label(String(row.value)), count: Number(row.count) });
  }
  const options = [...byName.entries()]
    .map(([name, values]) => ({ name, label: label(name), values: values.sort((a, b) => byValue(a.value, b.value)) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const lows = products.map((row) => Number(row.low)).filter(Number.isFinite);
  const highs = products.map((row) => Number(row.high)).filter(Number.isFinite);
  const unit = 10 ** minorUnitDigits(market.currency);
  const price =
    lows.length > 0 && highs.length > 0
      ? { min: Math.floor(Math.min(...lows) / unit), max: Math.ceil(Math.max(...highs) / unit) }
      : null;

  return {
    total,
    kinds: kinds.filter((kind) => narrows(kind.count)),
    categories: categories.filter((category) => narrows(category.count)),
    tags: tags.filter((tag) => narrows(tag.count)),
    options: options
      .map((option) => ({ name: option.name, label: option.label, values: option.values.filter((value) => narrows(value.count)) }))
      .filter((option) => option.values.length > 0),
    price: price && price.max > price.min ? price : null,
  };
}
