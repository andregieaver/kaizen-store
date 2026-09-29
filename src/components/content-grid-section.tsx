import { Suspense } from "react";

import type { CampaignNotices } from "@/lib/campaign-notices";
import type { GridData } from "@/lib/content-grid";
import { t } from "@/lib/i18n";
import { chosenFilters, parseListingParams } from "@/lib/listing-filters";
import type { ContentGridBlock } from "@/lib/page-content";
import { getBuyer } from "@/server/b2b";
import { campaignNoticesAt } from "@/server/campaign-notices";
import { gridData, gridScope, productItem, storeAndMarket, type GridPlace, type ListingPlace } from "@/server/content-grid";
import { listingFacets, listingProducts } from "@/server/listing";
import { siteTerms } from "@/server/taxonomy";

import { ContentGridView } from "./content-grid";
import { ListingControls } from "./product-listing";

/**
 * A content grid on the site (D51): its items looked up (and cached) on the
 * server. A product grid on a store's page with Filter and sort (D83) shows
 * the listing's controls over it and follows the choices in the address,
 * per request; its grid as set is the prerendered stand-in meanwhile.
 */
export async function ContentGridSection({ block, place }: { block: ContentGridBlock; place: GridPlace }) {
  const data = await gridData(block, place);
  const { listing } = place;
  const notices = block.source.type === "products" && place.owner ? await campaignNoticesAt(place.owner, place.market ?? null) : undefined;
  if (block.filters && block.source.type === "products" && place.owner && listing) {
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
  const items = products ? products.slice(0, block.limit).map((product) => productItem(store.slug, market.slug, product)) : data.items;

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
