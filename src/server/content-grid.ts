import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import { EMPTY_GRID, type GridData, type GridItem } from "@/lib/content-grid";
import { customGridData } from "@/lib/custom-grid";
import { assertNever, sourceTraits } from "@/lib/grid-source";
import { tileFieldIds } from "@/lib/tile-fields";
import { pageExcerpt, parsePageContent, type ContentGridBlock, type PageType, termContentOf } from "@/lib/page-content";
import { localizePage } from "@/lib/page-translation";
import { marketPath } from "@/lib/paths";
import type { StoreRoute } from "@/lib/store-parts";
import { marketIn } from "./shop";
import { summarize } from "@/lib/seo";
import { featureOn } from "@/lib/store-features";
import { knownIds, withDescendants } from "@/lib/taxonomy";

import { catalogTag, listGridProducts, type GridProduct } from "./catalog";
import { fieldsTag } from "./custom-fields";
import { shownFieldsForItems } from "./field-tiles";
import { pagesTag } from "./pages";
import { getOpenStore, storeTag } from "./stores";
import { currentTerms, termsTag } from "./taxonomy";

/**
 * The items a content grid (D51) shows, looked up for the site and for the
 * builder's preview. Cached until its content (pages, a store's catalogue)
 * or its categories and tags change.
 */

type Row = Record<string, unknown>;

const EXCERPT_MAX = 300;

/**
 * Where a grid is shown: the page it is on (left out of a grid of pages),
 * whose page it is (a store's, or Kaizen's: null), and on a store's page
 * the market the shopper is in (else the store's first).
 */
export type GridPlace = {
  pageId: string | null;
  owner: string | null;
  /** The market: a country's code (its own view) or a market address such as `no-en-eur`; the store's first if none. */
  market?: string;
  /**
   * On a store's page, the address's query and the page's path, for
   * grids shoppers filter and sort (D83); without it they show as set.
   */
  listing?: ListingPlace;
  /** What a saved page of a store is: an article (D57) has its own custom fields' values (D118); a page unless said. */
  pageType?: "page" | "article";
  /** On a store's working page (D113), the route it stands in for: the components for its cart, checkout and so on draw only there. */
  route?: StoreRoute;
  /** In a product layout (D79), the product the page is for: a grid that recommends (D139) recommends around it. */
  product?: string;
  /** On the store's All products page (D83): a product archive, which a grid that recommends reads the chosen filters of. */
  archive?: boolean;
  /** On a category or tag page (D140): the term the page is for, which a grid that recommends recommends around. */
  term?: { id: string; kind: "category" | "tag" };
  /**
   * The address's parameters where the route has them and no `listing` or `route` carries them (Kaizen's pages): read only
   * inside a part's display hole (D179 phase 4), so the page around stays prerendered.
   */
  query?: Promise<Record<string, string | string[] | undefined>>;
};

/** Where a filterable grid reads its choices, and the address they go to. */
export type ListingPlace = { query: Promise<Record<string, string | string[] | undefined>>; path: string };

/** A grid's items where it is shown. */
export async function gridData(block: ContentGridBlock, place: GridPlace): Promise<GridData> {
  const source = block.source;
  // The owner's own items (D155) are answered from the block itself, in the order written: no query, no catalogue cache.
  if (!sourceTraits(source).lookedUp) return gridCustom(block, place);
  const filter = { categories: block.categories, tags: block.tags, sort: block.sort, limit: block.limit, tileFields: tileFieldIds(block) };
  // Every source is answered here, so a new one is a compile error until it is.
  switch (source.type) {
    case "pages":
      return gridPages(place.owner, place.market ?? null, filter, place.pageId);
    case "articles":
      // The owner's blog articles (D57), newest first unless chosen.
      return gridPages(place.owner, place.market ?? null, filter, place.pageId, "article");
    case "products": {
      // On a store's page, its own products in the shopper's market (D53); on Kaizen's, the store and market chosen.
      const storeId = place.owner ?? source.storeId;
      const market = place.owner ? (place.market ?? source.market) : source.market;
      if (!storeId) return { ...EMPTY_GRID };
      return gridProducts(storeId, market ?? null, filter);
    }
    case "custom":
      return gridCustom(block, place);
    default:
      return assertNever(source);
  }
}

/**
 * What a grid of custom items needs to know about where it is shown (D155): the market's front page to link from and
 * its language, kept with the store (the block's items are not cached: they are the page's own words). On Kaizen's
 * pages (no owner) there is no market: English, and links from the site's root.
 */
async function customWhere(owner: string | null, marketCode: string | null): Promise<{ base: string | null; lang: string; locale: string } | null> {
  "use cache";
  cacheLife("hours");
  if (!owner) return { base: null, lang: "en", locale: "en-GB" };
  const [row] = await readDb().execute<Row>(sql`select slug from commerce.stores where id = ${owner}::uuid`);
  if (!row) return null;
  const slug = String(row.slug);
  // Tagged before anything can come out empty: a store that is not open yet, or has no such market, must be asked again when it changes.
  cacheTag(storeTag(slug));
  const store = await getOpenStore(slug);
  const market = store && marketIn(store, marketCode);
  if (!store || !market) return null;
  return { base: marketPath(store.slug, market.slug), lang: market.lang, locale: market.locale };
}

/** A grid of custom items (D155): the block's own items, with their links made in the shopper's market. */
async function gridCustom(block: ContentGridBlock, place: GridPlace): Promise<GridData> {
  const where = await customWhere(place.owner, place.market ?? null);
  return where ? customGridData(block, where) : { ...EMPTY_GRID };
}

/** An open store by id, and one of its markets (by code or by the address of a view, else its first). */
export async function storeAndMarket(storeId: string, marketCode: string | null) {
  const [row] = await readDb().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const store = row ? await getOpenStore(String(row.slug)) : null;
  const market = store && marketIn(store, marketCode);
  return store && market ? { store, market } : null;
}

/**
 * Whether a page's owner sells online (D178 step 5): Kaizen and a store with the online shop on; a website's grids of products and its search
 * draw nothing. Cached with the catalogue, which a feature's switch refreshes.
 */
export async function ownerSells(owner: string | null): Promise<boolean> {
  "use cache";
  if (!owner) return true;
  cacheTag(catalogTag(owner));
  const shop = await storeAndMarket(owner, null);
  return !shop || featureOn(shop.store, "shop");
}

type Filter = { categories: string[]; tags: string[]; sort: string; limit: number; tileFields: string[] };

/**
 * The items with the custom fields the grid's tiles show (D120): one batch read
 * for all of them, cached under the store's fields tag (`shownFieldsForItems()`).
 */
export async function withTileFields(
  storeId: string,
  entity: "product" | "page" | "article",
  market: { locale: string; lang: string; slug: string },
  fieldIds: string[],
  items: GridItem[],
): Promise<GridItem[]> {
  if (fieldIds.length === 0 || items.length === 0) return items;
  const byItem = await shownFieldsForItems(
    storeId,
    entity,
    items.map((item) => item.id),
    fieldIds,
    market.locale,
    market.lang,
    market.slug,
  );
  return items.map((item) => (byItem[item.id] ? { ...item, fields: byItem[item.id] } : item));
}

/** The owner's published pages (or articles) in the grid's categories and tags; a store's link within the market. */
async function gridPages(
  owner: string | null,
  marketCode: string | null,
  filter: Filter,
  exclude: string | null,
  type: PageType = "page",
): Promise<GridData> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner), termsTag({ storeId: owner, contentType: "page" }));
  // A tile's fields (D120) change with the store's fields, so the grid is refreshed with them.
  if (owner && filter.tileFields.length > 0) cacheTag(fieldsTag(owner));

  const shop = owner ? await storeAndMarket(owner, marketCode) : null;
  if (owner && !shop) return { ...EMPTY_GRID };
  const prefix = type === "article" ? "/blog" : "";
  const href = (slug: string) =>
    shop ? marketPath(shop.store.slug, shop.market.slug, `${prefix}/${slug}`) : `${prefix}/${slug}`;
  const language = shop ? { lang: shop.market.lang, locale: shop.market.locale } : { lang: "en", locale: "en-GB" };
  const terms = await currentTerms(owner, termContentOf(type));
  const categories = withDescendants(terms, knownIds(terms, "category", filter.categories));
  const tags = knownIds(terms, "tag", filter.tags);
  // Asked for, but all deleted since: nothing matches.
  if ((filter.categories.length > 0 && categories.length === 0) || (filter.tags.length > 0 && tags.length === 0)) {
    return { ...EMPTY_GRID };
  }
  const matches = (key: "categories" | "tags", ids: string[]) =>
    ids.length === 0 ? sql`true` : sql`jsonb_exists_any(p.published -> ${key}, ${`{${ids.join(",")}}`}::text[])`;
  const order =
    filter.sort === "oldest"
      ? sql`p.published_at, p.slug`
      : filter.sort === "title"
        ? sql`lower(p.published ->> 'title'), p.slug`
        : sql`p.published_at desc, p.slug`;
  // Articles go by the day they first appeared (D57); pages by their last publishing.
  const dated = type === "article";
  const articleOrder =
    filter.sort === "oldest"
      ? sql`coalesce(p.first_published_at, p.published_at), p.slug`
      : sql`coalesce(p.first_published_at, p.published_at) desc, p.slug`;
  const rows = await readDb().execute<Row>(sql`
    select p.id, p.slug, p.published, coalesce(p.first_published_at, p.published_at) as first_published_at
    from commerce.pages p
    where p.store_id is not distinct from ${owner}::uuid and p.type = ${type} and p.published_at is not null
      and (${exclude}::uuid is null or p.id <> ${exclude}::uuid)
      and ${matches("categories", categories)}
      and ${matches("tags", tags)}
    order by ${dated && filter.sort !== "title" ? articleOrder : order}
    limit ${Math.max(1, Math.min(48, filter.limit))}
  `);
  const items = rows.flatMap((row): GridItem[] => {
    const stored = parsePageContent(row.published);
    if (!stored) return [];
    // A store's page in the market's language where it is translated (D55).
    const content = localizePage(stored, shop?.market.locale);
    return [
      {
        id: String(row.id),
        href: href(String(row.slug)),
        title: content.title,
        excerpt: content.seo.description || pageExcerpt(content, EXCERPT_MAX),
        image: content.thumbnail ? { url: content.thumbnail.url, alt: content.thumbnail.alt } : null,
        price: null,
        ...(dated && { date: new Date(String(row.first_published_at)).toISOString() }),
      },
    ];
  });
  if (owner && shop && filter.tileFields.length > 0) {
    return { items: await withTileFields(owner, type === "article" ? "article" : "page", shop.market, filter.tileFields, items), ...language };
  }
  return { items, ...language };
}

/** A store's products in the grid's categories and tags, priced in one of its markets (its first unless named). */
async function gridProducts(storeId: string, marketCode: string | null, filter: Filter): Promise<GridData> {
  "use cache";
  cacheLife("hours");
  cacheTag(termsTag({ storeId, contentType: "product" }));
  if (filter.tileFields.length > 0) cacheTag(fieldsTag(storeId));

  const shop = await storeAndMarket(storeId, marketCode);
  if (!shop) return { ...EMPTY_GRID };
  const { store, market } = shop;

  const scope = await gridScope(storeId, filter);
  if (!scope) return { items: [], lang: market.lang, locale: market.locale };
  const products = await listGridProducts(storeId, market, { ...scope, sort: filter.sort, limit: filter.limit });
  const items = products.map((product) => productItem(store.slug, market.slug, product));
  return { lang: market.lang, locale: market.locale, items: await withTileFields(storeId, "product", market, filter.tileFields, items) };
}

/**
 * A product grid's categories (with those below them) and tags, as the
 * store has them now; null when all it asked for are deleted, so nothing
 * matches.
 */
export async function gridScope(
  storeId: string,
  filter: Pick<Filter, "categories" | "tags">,
): Promise<{ categoryIds: string[]; tagIds: string[] } | null> {
  const terms = await currentTerms(storeId, "product");
  const categoryIds = withDescendants(terms, knownIds(terms, "category", filter.categories));
  const tagIds = knownIds(terms, "tag", filter.tags);
  if ((filter.categories.length > 0 && categoryIds.length === 0) || (filter.tags.length > 0 && tagIds.length === 0)) return null;
  return { categoryIds, tagIds };
}

/** A product as a grid's tile, linked within the market. */
export function productItem(storeSlug: string, marketSlug: string, product: GridProduct): GridItem {
  return {
    id: product.id,
    href: marketPath(storeSlug, marketSlug, `/p/${product.handle}`),
    title: product.title,
    excerpt: summarize(product.description, EXCERPT_MAX),
    image: product.image,
    price: { view: product.price, from: product.priceVaries },
    audience: product.audience,
  };
}

export type GridStore = { id: string; name: string; markets: { code: string; currency: string }[] };

/** Open stores and their markets, for choosing whose products a grid shows: the template (demo) store first; never a store template (D175). */
export async function listGridStores(): Promise<GridStore[]> {
  const rows = await readDb().execute<Row>(sql`
    select s.id, s.name,
      coalesce(json_agg(json_build_object('code', m.code, 'currency', m.currency) order by m.code)
        filter (where m.code is not null), '[]') as markets
    from commerce.stores s
    -- The countries it offers (D178: its own alone with Several countries off).
    left join commerce.markets m on m.store_id = s.id and m.active
      and (commerce.feature_on(s.id, 'countries') or m.code = commerce.home_market(s.id))
    where s.status = 'active' and not s.starter
    group by s.id, s.name, s.is_template
    order by s.is_template desc, lower(s.name)
  `);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    markets: r.markets as { code: string; currency: string }[],
  }));
}
