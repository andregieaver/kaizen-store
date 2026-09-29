import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageEditLink } from "@/components/page-edit-link";
import { SearchSection } from "@/components/search-section";
import { StorePageArticle } from "@/components/store-page-article";
import { t } from "@/lib/i18n";
import { localizePage } from "@/lib/page-translation";
import { adminOrigin, marketPath } from "@/lib/paths";
import { pageForRole } from "@/server/pages";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/search">;

// Results pages are for shoppers, not search engines: crawlers neither list
// them nor follow their links, which record clicks (D77).
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Search in a store (Phase 2, S1, S2): the store's own search page (D112),
 * built in the page builder with a Search component, where one is chosen;
 * else the standard page, a heading over the search (`SearchSection`).
 */
export default function SearchPage({ params, searchParams }: Props) {
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
  const page = await pageForRole(store, "search");
  const place = { pageId: page?.id ?? null, owner: store.id, market: market.slug, listing: { query: searchParams, path } };
  if (page) {
    return (
      <>
        <StorePageArticle content={localizePage(page.content, market.locale)} place={place} />
        <PageEditLink pageId={page.id} store={store.slug} adminOrigin={adminOrigin(store.slug)} />
      </>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-heading tracking-tight">{t(market.lang).search.title}</h1>
      <SearchSection place={place} />
    </div>
  );
}
