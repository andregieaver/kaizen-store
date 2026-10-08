import Link from "next/link";

import { FilterDialog, type FilterFacets } from "@/components/filter-dialog";
import { ProductCard } from "@/components/product-card";
import type { CampaignNotices } from "@/lib/campaign-notices";
import { rangeText } from "@/lib/field-filters";
import { t, type Messages } from "@/lib/i18n";
import {
  chosenFilters,
  listingQuery,
  parseListingParams,
  withoutFilter,
  type ChosenFilter,
  type ListingFilters,
} from "@/lib/listing-filters";
import type { Market } from "@/lib/markets";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import type { Term } from "@/lib/taxonomy";
import { getBuyer } from "@/server/b2b";
import { campaignNotices } from "@/server/campaign-notices";
import type { GridProduct } from "@/server/catalog";
import { listingFacets, listingProducts, type ListingFacets, type ListingScope } from "@/server/listing";
import type { Store } from "@/server/stores";
import { siteTerms } from "@/server/taxonomy";

/**
 * A product listing with its sort and filters (D78): the products of the
 * page's `scope` that meet the filters in the address, with a button that
 * opens the filter dialog and the chosen filters above the list, each with
 * a link that takes it away. Per request (it reads who is buying), so pages
 * put it in a `<Suspense>`.
 */
export async function ProductListing({
  store,
  market,
  scope,
  filters,
  base,
  path,
  keep = {},
  products: given,
  hrefFor,
  tracked = false,
  countText,
}: {
  store: Store;
  market: Market;
  scope: ListingScope;
  filters: ListingFilters;
  /** The market's front page address, which product links start from. */
  base: string;
  /** The page's address without its query. */
  path: string;
  /** Other parameters of the page to keep, such as a search's `q`. */
  keep?: Record<string, string>;
  /** The page's products when no filter is chosen (search results as ranked). */
  products?: GridProduct[];
  hrefFor?: (product: GridProduct, index: number) => string;
  tracked?: boolean;
  /** How the number of products shown reads, if not "N products". */
  countText?: (n: number) => string;
}) {
  const m = t(market.lang);
  const buyer = await getBuyer(store);
  const viewer = { buyer, audienceBoth: store.audience === "both" };
  const chosen = chosenFilters(filters);
  const [facets, products, terms, notices] = await Promise.all([
    listingFacets(store.id, market, scope, viewer, m.options as Record<string, string>),
    given && chosen.length === 0 && filters.sort === "featured" ? given : listingProducts(store.id, market, scope, filters, viewer),
    siteTerms(store.id, "product"),
    campaignNotices(store.id, market),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <ListingControls
        market={market}
        filters={filters}
        facets={facets}
        terms={terms}
        path={path}
        keep={keep}
        count={(countText ?? m.listing.count)(products.length)}
        live={!tracked}
      />
      {products.length === 0 ? (
        <p>{chosen.length > 0 ? m.listing.none : m.noProducts}</p>
      ) : (
        <ProductGrid products={products} market={market} m={m} store={store.slug} base={base} hrefFor={hrefFor} tracked={tracked} notices={notices} />
      )}
    </div>
  );
}

/** A listing with the filters in the page's address. */
export async function ProductListingFor({
  searchParams,
  ...props
}: Omit<Parameters<typeof ProductListing>[0], "filters"> & {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ProductListing {...props} filters={parseListingParams(await searchParams)} />;
}

/**
 * A listing's controls (D78): how many products show, the Filter and sort
 * button with its dialog, and the chosen filters, each a link that takes it
 * away. Shared by the listing pages and product grids shoppers filter (D83).
 */
export function ListingControls({
  market,
  filters,
  facets,
  terms,
  path,
  keep = {},
  count,
  live = false,
}: {
  market: Market;
  filters: ListingFilters;
  facets: ListingFacets;
  terms: Term[];
  path: string;
  keep?: Record<string, string>;
  /** How many products show, as said to the shopper. */
  count: string;
  /** The products follow each choice while the dialog is open (D83). */
  live?: boolean;
}) {
  const m = t(market.lang);
  const chosen = chosenFilters(filters);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted">
          {count}
        </p>
        <FilterDialog
          path={path}
          keep={keep}
          filters={filters}
          facets={dialogFacets(facets, m, market)}
          labels={dialogLabels(facets, m, market)}
          live={live}
          count={count}
        />
      </div>
      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="sr-only">{m.listing.chosen}</span>
          <ul className="flex flex-wrap gap-2">
            {chosen.map((item) => {
              const text = chosenText(item, filters, facets, terms, m, market);
              return (
                <li key={JSON.stringify(item)}>
                  <Link
                    href={`${path}${listingQuery(withoutFilter(filters, item), keep)}`}
                    scroll={false}
                    aria-label={m.listing.remove(text)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-button bg-surface px-3 text-sm hover:underline"
                  >
                    {text}
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                    </svg>
                  </Link>
                </li>
              );
            })}
          </ul>
          {chosen.length > 1 && (
            <Link href={`${path}${listingQuery({ ...withoutAll(filters) }, keep)}`} scroll={false} className="text-sm underline">
              {m.listing.clearAll}
            </Link>
          )}
        </div>
      )}
    </>
  );
}

/** Product cards in the storefront's grid. */
export function ProductGrid({
  products,
  market,
  m,
  store,
  base,
  hrefFor,
  tracked = false,
  sizedColumns = false,
  notices,
}: {
  products: GridProduct[];
  market: Market;
  m: Messages;
  store: string;
  base: string;
  hrefFor?: (product: GridProduct, index: number) => string;
  tracked?: boolean;
  /**
   * Columns by the block's screen sizes (D179): a product layout's related products, whose block's rules set `--grid-cols`
   * at each size; else two on phones and four from tablets.
   */
  sizedColumns?: boolean;
  /** The store's campaigns (D115), for the badge on each product's card. */
  notices?: CampaignNotices;
}) {
  return (
    <ul className={sizedColumns ? "grid grid-cols-[repeat(var(--grid-cols),minmax(0,1fr))] gap-6" : "grid grid-cols-2 gap-6 md:grid-cols-4"}>
      {products.map((product, index) => (
        <ProductCard
          key={product.handle}
          product={product}
          href={hrefFor ? hrefFor(product, index) : `${base}/p/${product.handle}`}
          tracked={tracked}
          market={market}
          m={m}
          store={store}
          base={base}
          notices={notices}
        />
      ))}
    </ul>
  );
}

const withoutAll = (filters: ListingFilters): ListingFilters => chosenFilters(filters).reduce(withoutFilter, filters);

function dialogFacets(facets: ListingFacets, m: Messages, market: Market): FilterFacets {
  return {
    kinds: facets.kinds.map((kind) => ({ ...kind, label: capitalise(m.search.kinds[kind.kind]) })),
    categories: facets.categories,
    tags: facets.tags,
    options: facets.options,
    fields: facets.fields,
    ranges: facets.ranges.map((range) => ({ ...range, hint: rangeText(range.min, range.max, range.unit, market.locale) })),
    price: facets.price,
  };
}

function dialogLabels(facets: ListingFacets, m: Messages, market: Market) {
  const whole = (amount: number) => formatMoney(amount * 10 ** minorUnitDigits(market.currency), market.currency, market.locale);
  return {
    open: m.listing.open,
    title: m.listing.title,
    close: m.listing.close,
    sort: m.listing.sort,
    sorts: m.listing.sorts,
    kind: m.listing.kind,
    category: m.listing.category,
    tag: m.listing.tag,
    price: m.listing.price,
    priceFrom: m.listing.priceFrom,
    priceTo: m.listing.priceTo,
    priceRange: facets.price ? m.listing.priceRange(whole(facets.price.min), whole(facets.price.max)) : null,
    currency: currencySign(market),
    availability: m.listing.availability,
    inStock: m.listing.inStock,
    clear: m.listing.clear,
    apply: m.listing.apply,
  };
}

/** How a chosen filter reads, in the shopper's language, with names from the store. */
function chosenText(item: ChosenFilter, filters: ListingFilters, facets: ListingFacets, terms: Term[], m: Messages, market: Market): string {
  const labels = m.options as Record<string, string>;
  const whole = (amount: number) => formatMoney(Math.round(amount * 10 ** minorUnitDigits(market.currency)), market.currency, market.locale);
  switch (item.type) {
    case "kind":
      return capitalise(m.search.kinds[item.value]);
    case "category":
    case "tag":
      return terms.find((term) => term.kind === item.type && term.slug === item.value)?.name ?? item.value;
    case "option": {
      const option = facets.options.find((o) => o.name === item.name);
      return `${option?.label ?? labels[item.name] ?? item.name}: ${labels[item.value] ?? item.value}`;
    }
    case "field": {
      // A custom field (D118), worded as the store wrote it in the shopper's language.
      const field = facets.fieldLabels.find((f) => f.name === item.name);
      return `${field?.label ?? item.name}: ${field?.values[item.value] ?? item.value}`;
    }
    case "range": {
      // A number or measurement field (D120): "Vekt: 100–500 g", in the unit the filter compares in.
      const field = facets.rangeLabels.find((f) => f.name === item.name);
      const range = filters.ranges.find((r) => r.name === item.name);
      return `${field?.label ?? item.name}: ${rangeText(range?.min ?? null, range?.max ?? null, field?.unit ?? "", market.locale)}`;
    }
    case "price":
      return filters.minPrice !== null && filters.maxPrice !== null
        ? m.search.between(whole(filters.minPrice), whole(filters.maxPrice))
        : filters.minPrice !== null
          ? m.search.over(whole(filters.minPrice))
          : m.search.under(whole(filters.maxPrice ?? 0));
    case "stock":
      return m.listing.inStock;
  }
}

const capitalise = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

function currencySign(market: Market): string {
  const parts = new Intl.NumberFormat(market.locale, { style: "currency", currency: market.currency }).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? market.currency;
}
