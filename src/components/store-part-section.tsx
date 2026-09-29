import { Suspense } from "react";

import { AccountSection, SignInForm } from "@/app/s/[store]/[market]/account/account-section";
import { CartContents } from "@/app/s/[store]/[market]/cart/cart-contents";
import { Checkout } from "@/app/s/[store]/[market]/checkout/checkout-section";
import { CookiesSection } from "@/app/s/[store]/[market]/cookies/cookies-section";
import { DeliveriesSection } from "@/app/s/[store]/[market]/deliveries/deliveries-section";
import { OrderDetails } from "@/app/s/[store]/[market]/order/[orderId]/order-section";
import { SubscriptionSection } from "@/app/s/[store]/[market]/subscription/[token]/subscription-section";
import { WishlistSection } from "@/app/s/[store]/[market]/wishlist/wishlist-section";
import { t } from "@/lib/i18n";
import type { StorePartBlock } from "@/lib/page-content";
import type { StoreRoute } from "@/lib/store-parts";
import { storeAndMarket, type GridPlace } from "@/server/content-grid";

/**
 * One of a store's working pages (D113) on a page built in the page builder:
 * the cart, checkout, order confirmation, My account, sign-in, wishlists, a
 * subscription, weekly deliveries or the cookies list, the same components
 * the standard pages are made of. It draws only on the route it belongs to,
 * where the address carries what it needs (`place.route`); anywhere else it
 * draws nothing.
 */
export function StorePartSection({ block, place }: { block: StorePartBlock; place: GridPlace }) {
  const route = place.route;
  if (!route || route.part !== block.part || !place.owner) return null;
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <Part owner={place.owner} market={place.market ?? null} route={route} />
    </Suspense>
  );
}

async function Part({ owner, market: marketCode, route }: { owner: string; market: string | null; route: StoreRoute }) {
  const shop = await storeAndMarket(owner, marketCode);
  if (!shop) return null;
  const { store, market } = shop;
  const query = route.query ?? Promise.resolve({});
  switch (route.part) {
    case "cart":
      return <CartContents store={store} market={market} m={t(market.lang)} />;
    case "checkout":
      return <Checkout store={store} market={market} />;
    case "order":
      return route.param ? <OrderDetails store={store} market={market} orderId={route.param} query={query} /> : null;
    case "account":
      return <AccountSection store={store} market={market} query={query} />;
    case "sign_in":
      return <SignInForm store={store} market={market} query={query} />;
    case "wishlist":
      return <WishlistSection store={store} market={market} query={query} />;
    case "subscription":
      return route.param ? <SubscriptionSection store={store} market={market} token={route.param} /> : null;
    case "deliveries":
      return <DeliveriesSection store={store} market={market} query={query} />;
    case "cookies":
      return <CookiesSection store={store} market={market} />;
  }
}
