import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { RolePage } from "@/components/role-page";
import { resolveShop } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

import { WishlistSection } from "./wishlist-section";

type Props = PageProps<"/s/[store]/[market]/wishlist">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The shopper's wishlists (D34): the store's own page for them (D113), built
 * in the page builder, where one is chosen; else the standard page.
 */
export default async function WishlistPage({ params, searchParams }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  await pageShopOrMoved("/wishlist");
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <WishlistRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function WishlistRoute({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  return (
    <RolePage store={store} market={market} ab={shop.ab} role="wishlist" route={{ part: "wishlist", query: searchParams }}>
      <WishlistSection store={store} market={market} query={searchParams} />
    </RolePage>
  );
}
