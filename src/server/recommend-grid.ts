import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import type { GridData } from "@/lib/content-grid";
import { EMPTY_GRID } from "@/lib/content-grid";
import type { ContentGridBlock } from "@/lib/page-content";
import type { RecommendBlock, RecommendPlace } from "@/lib/recommendations";
import { DEFAULT_MIX } from "@/lib/recommendations";
import { tileFieldIds } from "@/lib/tile-fields";

import { catalogTag } from "./catalog";
import { gridData, storeAndMarket, type GridPlace } from "./content-grid";
import { fieldsTag } from "./custom-fields";
import { pagesTag } from "./pages";
import { standInFor } from "./recommend";
import { getRecommendSettings, recommendTag } from "./recommend-settings";
import { termsTag } from "./taxonomy";

/**
 * Where a grid that recommends (D139) is, as the page it is on tells it: a product's page (its layout names the product),
 * the All products archive, an article, another page, or a working page (cart, checkout and so on).
 */
export function recommendPlaceOf(place: GridPlace): RecommendPlace {
  if (place.product) return { kind: "product", productId: place.product };
  // A category's or tag's page (D140) is a listing of that term.
  if (place.term) return { kind: "listing", query: "", termId: place.term.id };
  if (place.route) return { kind: "other" };
  if (place.archive) return { kind: "listing", query: "" };
  if (place.pageId) return place.pageType === "article" ? { kind: "article", pageId: place.pageId } : { kind: "page", pageId: place.pageId };
  return { kind: "other" };
}

/** What the grid asks of the engine. */
export function recommendBlockOf(block: ContentGridBlock): RecommendBlock {
  const recommend = block.source.type === "products" ? block.source.recommend : undefined;
  return {
    limit: Math.min(12, Math.max(1, block.limit)),
    mix: recommend?.mix ?? DEFAULT_MIX,
    explain: recommend?.explain ?? true,
    categories: block.categories,
    tags: block.tags,
    tileFields: tileFieldIds(block),
  };
}

/** Whether a grid recommends: a product grid with the option on, on a store's own page. */
export const recommends = (block: ContentGridBlock, place: GridPlace): boolean =>
  block.source.type === "products" && Boolean(block.source.recommend) && place.owner !== null;

/**
 * What such a grid shows before the shopper's own session arrives (and in the builder's preview): the recommendations for
 * the page for everyone, with no cart, account or AI, kept with the catalogue.
 */
export async function recommendedGridData(block: ContentGridBlock, place: GridPlace): Promise<GridData> {
  if (!recommends(block, place) || !place.owner) return gridData(block, place);
  const shop = await storeAndMarket(place.owner, place.market ?? null);
  if (!shop) return { ...EMPTY_GRID };
  const items = await standInFor(place.owner, shop.market.slug, recommendPlaceOf(place), recommendBlockOf(block));
  return { items, lang: shop.market.lang, locale: shop.market.locale };
}

/**
 * What the page draws for a grid that recommends, kept with what it depends on: the stand-in (recommendations for everyone), the
 * store and market addresses the browser asks with, and whether the store's recommendations are on. Its arguments are plain
 * (the page's place holds a promise, so only what the grid needs is passed).
 */
export async function recommendingGrid(
  owner: string,
  marketCode: string | null,
  block: ContentGridBlock,
  where: RecommendPlace,
): Promise<{ data: GridData; store: string; market: string; enabled: boolean } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(recommendTag(owner), catalogTag(owner), termsTag({ storeId: owner, contentType: "product" }), fieldsTag(owner), pagesTag(owner));
  const shop = await storeAndMarket(owner, marketCode);
  if (!shop) return null;
  const enabled = (await getRecommendSettings(owner)).enabled;
  const items = enabled ? await standInFor(owner, shop.market.slug, where, recommendBlockOf(block)) : [];
  return { data: { items, lang: shop.market.lang, locale: shop.market.locale }, store: shop.store.slug, market: shop.market.slug, enabled };
}
