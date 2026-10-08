import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PayRouteGuard } from "@/components/pay-route-guard";
import { RolePage } from "@/components/role-page";
import { resolveAfterSaleShop } from "@/server/shop";

import { OrderDetails } from "./order-section";

type Props = PageProps<"/s/[store]/[market]/order/[orderId]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The order's page: the store's own page for it (D113), built in the page
 * builder, where one is chosen; else the standard page. Everything here
 * depends on the order in the address, so it all renders per request.
 */
export default function OrderPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <Order params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Order({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug, orderId } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  return (
    <>
      {/* Loads the page afresh if the document has been elsewhere: nothing another page added runs where a card is typed (wave 1, 1e). */}
      <PayRouteGuard store={store.slug} />
      <RolePage store={store} market={market} ab={shop.ab} role="order" route={{ part: "order", param: orderId, query: searchParams }}>
        <OrderDetails store={store} market={market} orderId={orderId} query={searchParams} />
      </RolePage>
    </>
  );
}
