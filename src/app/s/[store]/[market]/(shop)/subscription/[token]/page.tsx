import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { RolePage } from "@/components/role-page";
import { resolveAfterSaleShop } from "@/server/shop";

import { SubscriptionSection } from "./subscription-section";

type Props = PageProps<"/s/[store]/[market]/subscription/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * A shopper's subscription (D25, D29): the store's own page for it (D113),
 * built in the page builder, where one is chosen; else the standard page.
 * The address carries a secret, so it all renders per request.
 */
export default function SubscriptionPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <Subscription params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Subscription({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  return (
    <RolePage store={store} market={market} ab={shop.ab} role="subscription" route={{ part: "subscription", param: token, query: searchParams }}>
      <SubscriptionSection store={store} market={market} token={token} />
    </RolePage>
  );
}
