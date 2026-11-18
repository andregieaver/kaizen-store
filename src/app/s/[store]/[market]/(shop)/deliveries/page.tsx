import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { RolePage } from "@/components/role-page";
import { inView, isNative } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { resolveShop } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

import { DeliveriesSection } from "./deliveries-section";

type Props = PageProps<"/s/[store]/[market]/deliveries">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The shopper's weekly delivery (D102): the store's own page for it (D113),
 * built in the page builder, where one is chosen; else the standard page.
 */
export default async function DeliveriesPage({ params, searchParams }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  await pageShopOrMoved("/deliveries");
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <DeliveriesRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function DeliveriesRoute({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop?.store.deliveriesOn) notFound();
  const { store, market } = shop;
  // Weekly deliveries are in the country's own currency (D109): shown in another, the page moves to its own.
  if (!isNative(market)) redirect(marketPath(store.slug, inView(market, { currency: market.nativeCurrency }).slug, "/deliveries"));
  return (
    <RolePage store={store} market={market} ab={shop.ab} role="deliveries" route={{ part: "deliveries", query: searchParams }}>
      <DeliveriesSection store={store} market={market} query={searchParams} />
    </RolePage>
  );
}
