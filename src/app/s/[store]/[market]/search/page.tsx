import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { RolePage } from "@/components/role-page";
import { SearchSection } from "@/components/search-section";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { resolveShop, sellingPageOr404 } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

type Props = PageProps<"/s/[store]/[market]/search">;

// Results pages are for shoppers, not search engines: crawlers neither list
// them nor follow their links, which record clicks (D77).
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Search in a store (Phase 2, S1, S2): the store's own search page (D112),
 * built in the page builder with a Search component, where one is chosen;
 * else the standard page, a heading over the search (`SearchSection`).
 */
export default async function SearchPage({ params, searchParams }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  // Search finds products (D72), so a website (D178 step 5: the online shop off) has none: the 404 before the boundary.
  await sellingPageOr404(await pageShopOrMoved("/search"), "/search");
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <Search params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Search({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const path = `${marketPath(store.slug, market.slug)}/search`;
  const place = { pageId: null, owner: store.id, market: market.slug, listing: { query: searchParams, path } };
  return (
    <RolePage store={store} market={market} role="search" place={place}>
      <div className="flex flex-col gap-6">
        <h1 className="text-3xl font-heading tracking-tight">{t(market.lang).search.title}</h1>
        <SearchSection place={place} />
      </div>
    </RolePage>
  );
}
