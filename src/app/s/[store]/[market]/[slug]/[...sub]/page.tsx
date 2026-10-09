import type { Metadata } from "next";

import { listPublishedPages } from "@/server/pages";
import { resolveShop } from "@/server/shop";

import { StorePageView, storePageMetadata, type StorePageQuery } from "../store-page-view";

type Props = {
  params: Promise<{ store: string; market: string; slug: string; sub: string[] }>;
  searchParams: StorePageQuery;
};

/** A page's address is its parents' and its own part joined (`projects/project-a`); the view reads it whole. */
const whole = async (params: Props["params"]) => {
  const { sub, ...rest } = await params;
  return { ...rest, slug: [rest.slug, ...sub.map(decodeURIComponent)].join("/") };
};

/** A store's pages nested under another (`/projects/project-a`), drawn like any other page (`[slug]/page.tsx`). */
export async function generateStaticParams({ params }: { params: { store: string; market: string } }) {
  const shop = await resolveShop(params.store, params.market);
  const pages = shop ? await listPublishedPages(shop.store.id) : [];
  const nested = pages.filter((page) => page.slug.includes("/")).map((page) => {
    const [slug, ...sub] = page.slug.split("/");
    return { slug, sub };
  });
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return nested.length > 0 ? nested : [{ slug: "_", sub: ["_"] }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return storePageMetadata(whole(params), null);
}

export default function NestedStorePage({ params, searchParams }: Props) {
  return <StorePageView params={whole(params)} searchParams={searchParams} variant={null} />;
}
