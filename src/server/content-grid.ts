import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import { EMPTY_GRID, type GridData, type GridItem } from "@/lib/content-grid";
import { pageExcerpt, parsePageContent, type ContentGridBlock } from "@/lib/page-content";
import { marketPath } from "@/lib/paths";
import { summarize } from "@/lib/seo";
import { knownIds, withDescendants } from "@/lib/taxonomy";

import { listGridProducts } from "./catalog";
import { pagesTag } from "./pages";
import { getOpenStore } from "./stores";
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
export type GridPlace = { pageId: string | null; owner: string | null; market?: string };

/** A grid's items where it is shown. */
export async function gridData(block: ContentGridBlock, place: GridPlace): Promise<GridData> {
  const filter = { categories: block.categories, tags: block.tags, sort: block.sort, limit: block.limit };
  if (block.source.type === "pages") return gridPages(place.owner, place.market ?? null, filter, place.pageId);
  // On a store's page, its own products in the shopper's market (D53); on Kaizen's, the store and market chosen.
  const storeId = place.owner ?? block.source.storeId;
  const market = place.owner ? (place.market ?? block.source.market) : block.source.market;
  if (!storeId) return { ...EMPTY_GRID };
  return gridProducts(storeId, market ?? null, filter);
}

/** An open store by id, and one of its markets (by code, else its first). */
async function storeAndMarket(storeId: string, marketCode: string | null) {
  const [row] = await readDb().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const store = row ? await getOpenStore(String(row.slug)) : null;
  const market = store && (marketCode ? store.markets.find((m) => m.code === marketCode) : store.markets[0]);
  return store && market ? { store, market } : null;
}

type Filter = { categories: string[]; tags: string[]; sort: string; limit: number };

/** The owner's published pages in the grid's categories and tags; a store's link within the market. */
async function gridPages(owner: string | null, marketCode: string | null, filter: Filter, exclude: string | null): Promise<GridData> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner), termsTag({ storeId: owner, contentType: "page" }));

  const shop = owner ? await storeAndMarket(owner, marketCode) : null;
  if (owner && !shop) return { ...EMPTY_GRID };
  const href = (slug: string) => (shop ? marketPath(shop.store.slug, shop.market.slug, `/${slug}`) : `/${slug}`);
  const language = shop ? { lang: shop.market.lang, locale: shop.market.locale } : { lang: "en", locale: "en-GB" };
  const terms = await currentTerms(owner, "page");
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
  const rows = await readDb().execute<Row>(sql`
    select p.id, p.slug, p.published from commerce.pages p
    where p.store_id is not distinct from ${owner}::uuid and p.published_at is not null
      and (${exclude}::uuid is null or p.id <> ${exclude}::uuid)
      and ${matches("categories", categories)}
      and ${matches("tags", tags)}
    order by ${order}
    limit ${Math.max(1, Math.min(48, filter.limit))}
  `);
  const items = rows.flatMap((row): GridItem[] => {
    const content = parsePageContent(row.published);
    if (!content) return [];
    return [
      {
        id: String(row.id),
        href: href(String(row.slug)),
        title: content.title,
        excerpt: content.seo.description || pageExcerpt(content, EXCERPT_MAX),
        image: content.thumbnail ? { url: content.thumbnail.url, alt: content.thumbnail.alt } : null,
        price: null,
      },
    ];
  });
  return { items, ...language };
}

/** A store's products in the grid's categories and tags, priced in one of its markets (its first unless named). */
async function gridProducts(storeId: string, marketCode: string | null, filter: Filter): Promise<GridData> {
  "use cache";
  cacheLife("hours");
  cacheTag(termsTag({ storeId, contentType: "product" }));

  const shop = await storeAndMarket(storeId, marketCode);
  if (!shop) return { ...EMPTY_GRID };
  const { store, market } = shop;

  const terms = await currentTerms(storeId, "product");
  const categoryIds = withDescendants(terms, knownIds(terms, "category", filter.categories));
  const tagIds = knownIds(terms, "tag", filter.tags);
  if ((filter.categories.length > 0 && categoryIds.length === 0) || (filter.tags.length > 0 && tagIds.length === 0)) {
    return { items: [], lang: market.lang, locale: market.locale };
  }
  const products = await listGridProducts(storeId, market.code, market.locale, {
    categoryIds,
    tagIds,
    sort: filter.sort,
    limit: filter.limit,
  });
  return {
    lang: market.lang,
    locale: market.locale,
    items: products.map((product) => ({
      id: product.id,
      href: marketPath(store.slug, market.slug, `/p/${product.handle}`),
      title: product.title,
      excerpt: summarize(product.description, EXCERPT_MAX),
      image: product.image,
      price: { view: product.price, from: product.priceVaries },
    })),
  };
}

export type GridStore = { id: string; name: string; markets: { code: string; currency: string }[] };

/** Open stores and their markets, for choosing whose products a grid shows: the template (demo) store first. */
export async function listGridStores(): Promise<GridStore[]> {
  const rows = await readDb().execute<Row>(sql`
    select s.id, s.name,
      coalesce(json_agg(json_build_object('code', m.code, 'currency', m.currency) order by m.code)
        filter (where m.code is not null), '[]') as markets
    from commerce.stores s
    left join commerce.markets m on m.store_id = s.id and m.active
    where s.status = 'active'
    group by s.id, s.name, s.is_template
    order by s.is_template desc, lower(s.name)
  `);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    markets: r.markets as { code: string; currency: string }[],
  }));
}
