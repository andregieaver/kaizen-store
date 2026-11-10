import Link from "next/link";
import { Suspense } from "react";

import type { CampaignNotices } from "@/lib/campaign-notices";
import type { GridData } from "@/lib/content-grid";
import { t } from "@/lib/i18n";
import { sourceTraits } from "@/lib/grid-source";
import { tileAsk, type TileAsk } from "@/lib/shop-tiles";
import { chosenFilters, listingQuery, parseListingParams } from "@/lib/listing-filters";
import type { ContentGridBlock } from "@/lib/page-content";
import { tileFieldIds } from "@/lib/tile-fields";
import { getBuyer } from "@/server/b2b";
import { campaignNoticesAt } from "@/server/campaign-notices";
import { gridData, gridScope, ownerSells, productItem, storeAndMarket, withTileFields, type GridPlace, type ListingPlace } from "@/server/content-grid";
import { recommendBlockOf, recommendingGrid, recommendPlaceOf, recommends } from "@/server/recommend-grid";
import { listingFacets, listingPage, listingPageOf, LISTING_PAGES_MAX } from "@/server/listing";
import { siteTerms } from "@/server/taxonomy";

import { ContentGridView } from "./content-grid";
import { ListingControls } from "./product-listing";
import { RecommendedGrid } from "./lazy/blocks";

/**
 * A content grid on the site (D51): its items looked up (and cached) on the
 * server. A product grid on a store's page with Filter and sort (D83) shows
 * the listing's controls over it and follows the choices in the address,
 * per request; its grid as set is the prerendered stand-in meanwhile.
 */
export async function ContentGridSection({ block, place, eager = false }: { block: ContentGridBlock; place: GridPlace; /** It may be on the first screen. */ eager?: boolean }) {
  // A grid of products draws nothing in a website (D178 step 5: the online shop off); a grid of pages, articles or the owner's items stays.
  if (sourceTraits(block.source).products && !(await ownerSells(place.owner))) return null;
  // A grid that recommends (D139) is built with the recommendations for everyone, then follows the shopper's own.
  if (recommends(block, place) && place.owner) return <RecommendingGrid block={block} place={place} owner={place.owner} eager={eager} />;
  const data = await gridData(block, place);
  const { listing } = place;
  // The stock left and a quantity chooser on a store's own product tiles (D540), as the grid allows; the store's settings come with the facts.
  const tiles = place.owner ? tileAsk(block.shopTiles) : null;
  const products = sourceTraits(block.source).products;
  const notices = products && place.owner ? await campaignNoticesAt(place.owner, place.market ?? null) : undefined;
  if (block.filters && products && place.owner && listing) {
    return (
      <Suspense fallback={<ContentGridView block={block} data={data} notices={notices} eager={eager} tiles={tiles} />}>
        <FilterableGrid block={block} owner={place.owner} market={place.market} listing={listing} data={data} notices={notices} eager={eager} tiles={tiles} />
      </Suspense>
    );
  }
  return <ContentGridView block={block} data={data} notices={notices} eager={eager} tiles={tiles} />;
}

/** The grid's products as the shopper filters and sorts them, with the controls to do so. */
async function FilterableGrid({
  block,
  owner,
  market: marketCode,
  listing,
  data,
  notices,
  eager,
  tiles,
}: {
  tiles: TileAsk | null;
  block: ContentGridBlock;
  owner: string;
  market: string | undefined;
  listing: ListingPlace;
  data: GridData;
  notices?: CampaignNotices;
  eager: boolean;
}) {
  const [shop, query] = await Promise.all([storeAndMarket(owner, marketCode ?? null), listing.query]);
  if (!shop) return <ContentGridView block={block} data={data} eager={eager} />;
  const { store, market } = shop;
  const m = t(market.lang);
  const filters = parseListingParams(query);
  const scope = await gridScope(store.id, block);
  if (!scope) return <ContentGridView block={block} data={data} eager={eager} />;
  const buyer = await getBuyer(store);
  const viewer = { buyer, audienceBoth: store.audience === "both" };
  // Without choices the grid keeps its own order; with them, the listing's (D78).
  const unfiltered = chosenFilters(filters).length === 0 && filters.sort === "featured";
  // How far *Show more* has been followed (code review FF1): the grid shows its first `page` times its own number.
  const page = listingPageOf(query.page);
  const [facets, listed, terms] = await Promise.all([
    listingFacets(store.id, market, scope, viewer, m.options as Record<string, string>),
    // The first page without choices is the grid as built, in its own order; anything else is read as the listing reads it.
    unfiltered && page === 1 ? null : listingPage(store.id, market, scope, filters, viewer, page, block.limit),
    siteTerms(store.id, "product"),
  ]);
  const items = listed
    ? await withTileFields(
        store.id,
        "product",
        market,
        tileFieldIds(block),
        listed.products.map((product) => productItem(store.slug, market.slug, product)),
      )
    : data.items;
  // How many there are in all: the listing's own count, or, for the grid as built, the page's products before filters.
  const total = Math.max(listed ? listed.total : facets.total, items.length);
  const more = total > items.length;

  return (
    <div className="flex flex-col gap-4">
      <ListingControls
        market={market}
        filters={filters}
        facets={facets}
        terms={terms}
        path={listing.path}
        count={more ? m.listing.countOf(items.length, total) : m.listing.count(items.length)}
        live
      />
      {items.length === 0 && !unfiltered ? (
        <p>{m.listing.none}</p>
      ) : (
        <ContentGridView block={block} data={{ ...data, items }} notices={notices} eager={eager} tiles={tiles} />
      )}
      {more && page < LISTING_PAGES_MAX && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <p className="text-sm text-muted">{m.listing.countOf(items.length, total)}</p>
          <Link href={`${listing.path}${listingQuery(filters, { page: String(page + 1) })}`} scroll={false} className="rounded-button flex min-h-12 items-center justify-center border border-border px-6 font-medium">
            {m.listing.showMore}
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * A product grid that recommends (D139): the recommendations for the page for everyone are its prerendered stand-in, kept
 * with the catalogue; in the browser the shopper's own replace them (`RecommendedGrid`).
 */
async function RecommendingGrid({ block, place, owner, eager }: { block: ContentGridBlock; place: GridPlace; owner: string; eager: boolean }) {
  const where = recommendPlaceOf(place);
  const [grid, notices] = await Promise.all([recommendingGrid(owner, place.market ?? null, block, where), campaignNoticesAt(owner, place.market ?? null)]);
  if (!grid) return null;
  const fallback = <ContentGridView block={block} data={grid.data} notices={notices} eager={eager} />;
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
      >
        {fallback}
      </RecommendedGrid>
    </Suspense>
  );
}
