import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PayRouteGuard } from "@/components/pay-route-guard";
import { RolePage } from "@/components/role-page";
import { t } from "@/lib/i18n";
import { resolveShop } from "@/server/shop";

import { Checkout } from "./checkout-section";

type Props = PageProps<"/s/[store]/[market]/checkout">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, market } = await params;
  const shop = await resolveShop(store, market);
  return shop ? { title: t(shop.market.lang).checkoutTitle, robots: { index: false, follow: false } } : {};
}

/**
 * The checkout page (decision D22): the store's own page for it (D113), built
 * in the page builder, where one is chosen; else a heading over the checkout.
 */
export default async function CheckoutPage({ params, searchParams }: Props) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  return (
    <>
      {/* Loads the page afresh if the document has been elsewhere: nothing another page added runs where a card is typed (wave 1, 1e). */}
      <PayRouteGuard store={store.slug} />
      <RolePage store={store} market={market} ab={shop.ab} role="checkout" route={{ part: "checkout", query: searchParams }}>
        <h1 className="mb-6 text-3xl font-heading tracking-tight">{t(market.lang).checkoutTitle}</h1>
        <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-surface" />}>
          <Checkout store={store} market={market} />
        </Suspense>
      </RolePage>
    </>
  );
}
