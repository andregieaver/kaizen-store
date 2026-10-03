import { Suspense } from "react";

import type { CampaignNotices } from "@/lib/campaign-notices";
import type { GridData } from "@/lib/content-grid";
import { t } from "@/lib/i18n";
import { sourceTraits } from "@/lib/grid-source";
import { chosenFilters, parseListingParams } from "@/lib/listing-filters";
import type { ContentGridBlock } from "@/lib/page-content";
import { tileFieldIds } from "@/lib/tile-fields";
import { getBuyer } from "@/server/b2b";
import { campaignNoticesAt } from "@/server/campaign-notices";
import { gridData, gridScope, productItem, storeAndMarket, withTileFields, type GridPlace, type ListingPlace } from "@/server/content-grid";
import { recommendBlockOf, recommendingGrid, recommendPlaceOf, recommends } from "@/server/recommend-grid";
import { listingFacets, listingProducts } from "@/server/listing";
import { siteTerms } from "@/server/taxonomy";

import { ContentGridView } from "./content-grid";
import { ListingControls } from "./product-listing";
import { RecommendedGrid } from "./recommended-grid";

/**
 * A content grid on the site (D51): its items looked up (and cached) on the
 * server. A product grid on a store's page with Filter and sort (D83) shows
 * the listing's controls over it and follows the choices in the address,
 * per request; its grid as set is the prerendered stand-in meanwhile.
 */
export async function ContentGridSection({ block, place }: { block: ContentGridBlock; place: GridPlace }) {
  // A grid that recommends (D139) is built with the recommendations for everyone, then follows the shopper's own.
  if (recommends(block, place) && place.owner) return <RecommendingGrid block={block} place={place} owner={place.owner} />;
  const data = await gridData(block, place);
  const { listing } = place;
  const products = sourceTraits(block.source).products;
  const notices = products && place.owner ? await campaignNoticesAt(place.owner, place.market ?? null) : undefined;
  if (block.filters && products && place.owner && listing) {
    return (
      <Suspense fallback={<ContentGridView block={block} data={data} notices={notices} />}>
        <FilterableGrid block={block} owner={place.owner} market={place.market} listing={listing} data={data} notices={notices} />
      </Suspense>
    );
  }
  return <ContentGridView block={block} data={data} notices={notices} />;
}

/** The grid's products as the shopper filters and sorts them, with the controls to do so. */
async function FilterableGrid({
  block,
  owner,
  market: marketCode,
  listing,
  data,
  notices,
}: {
  block: ContentGridBlock;
  owner: string;
  market: string | undefined;
  listing: ListingPlace;
  data: GridData;
  notices?: CampaignNotices;
}) {
  const [shop, query] = await Promise.all([storeAndMarket(owner, marketCode ?? null), listing.query]);
  if (!shop) return <ContentGridView block={block} data={data} />;
  const { store, market } = shop;
  const m = t(market.lang);
  const filters = parseListingParams(query);
  const scope = await gridScope(store.id, block);
  if (!scope) return <ContentGridView block={block} data={data} />;
  const buyer = await getBuyer(store);
  const viewer = { buyer, audienceBoth: store.audience === "both" };
  // Without choices the grid keeps its own order; with them, the listing's (D78).
  const unfiltered = chosenFilters(filters).length === 0 && filters.sort === "featured";
  const [facets, products, terms] = await Promise.all([
    listingFacets(store.id, market, scope, viewer, m.options as Record<string, string>),
    unfiltered ? null : listingProducts(store.id, market, scope, filters, viewer),
    siteTerms(store.id, "product"),
  ]);
  const items = products
    ? await withTileFields(
        store.id,
        "product",
        market,
        tileFieldIds(block),
        products.slice(0, block.limit).map((product) => productItem(store.slug, market.slug, product)),
      )
    : data.items;

  return (
    <div className="flex flex-col gap-4">
      <ListingControls
        market={market}
        filters={filters}
        facets={facets}
        terms={terms}
        path={listing.path}
        count={m.listing.count(items.length)}
        live
      />
      {items.length === 0 && !unfiltered ? (
        <p>{m.listing.none}</p>
      ) : (
        <ContentGridView block={block} data={{ ...data, items }} notices={notices} />
      )}
    </div>
  );
}

/**
 * A product grid that recommends (D139): the recommendations for the page for everyone are its prerendered stand-in, kept
 * with the catalogue; in the browser the shopper's own replace them (`RecommendedGrid`).
 */
async function RecommendingGrid({ block, place, owner }: { block: ContentGridBlock; place: GridPlace; owner: string }) {
  const where = recommendPlaceOf(place);
  const [grid, notices] = await Promise.all([recommendingGrid(owner, place.market ?? null, block, where), campaignNoticesAt(owner, place.market ?? null)]);
  if (!grid) return null;
  const fallback = <ContentGridView block={block} data={grid.data} notices={notices} />;
  // While the store's recommendations are off there is nothing to ask for: the grid is as built (empty, or its own text).
  if (!grid.enabled) return fallback;
  return (
    <Suspense fallback={fallback}>
      <RecommendedGrid
        block={block}
        initial={grid.data}
        notices={notices}
        store={grid.store}
        market={grid.market}
        place={where}
        ask={recommendBlockOf(block)}
      />
    </Suspense>
  );
}
