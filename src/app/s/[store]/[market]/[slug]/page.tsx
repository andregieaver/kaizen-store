import type { Metadata } from "next";

import { listPublishedPages } from "@/server/pages";
import { resolveShop } from "@/server/shop";

import { StorePageView, storePageMetadata } from "./store-page-view";

type Props = PageProps<"/s/[store]/[market]/[slug]">;

/**
 * A store's own pages (D54), in each of its markets, prerendered when the
 * site is built so their content is plain HTML; pages published later are
 * rendered on first visit and then cached until the next change. The
 * store's own routes (`/p`, `/cart`, …) come first, and pages cannot take
 * their addresses (D53). The page's drawing is `StorePageView`, shared with
 * the versions of it an A/B test shows (`ab/[variant]`, D148).
 */
export async function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  const shop = await resolveShop(params.store, params.market);
  const pages = shop ? await listPublishedPages(shop.store.id) : [];
  // Cache Components needs at least one entry; "_" simply renders a 404.
  const top = pages.filter((page) => !page.slug.includes("/"));
  return top.length > 0 ? top.map((page) => ({ slug: page.slug })) : [{ slug: "_" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return storePageMetadata(params, null);
}

export default function StorePage({ params, searchParams }: Props) {
  return <StorePageView params={params} searchParams={searchParams} variant={null} />;
}
