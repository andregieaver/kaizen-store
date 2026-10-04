import { Suspense } from "react";

import { AccountSection, SignInForm } from "@/app/s/[store]/[market]/account/account-section";
import {
  CartCheckout,
  CartCode,
  CartContents,
  CartContinue,
  CartCredits,
  CartLines,
  CartSummary,
} from "@/app/s/[store]/[market]/cart/cart-contents";
import {
  Checkout,
  CheckoutBack,
  CheckoutCode,
  CheckoutCredits,
  CheckoutDelivery,
  CheckoutItems,
  CheckoutPayment,
  CheckoutTerms,
  CheckoutTotals,
} from "@/app/s/[store]/[market]/checkout/checkout-section";
import { CookiesSection } from "@/app/s/[store]/[market]/cookies/cookies-section";
import { DeliveriesSection } from "@/app/s/[store]/[market]/deliveries/deliveries-section";
import {
  OrderAccount,
  OrderAddress,
  OrderBookings,
  OrderContinue,
  OrderDetails,
  OrderDocuments,
  OrderDownloads,
  OrderLines,
  OrderStatus,
  OrderSubscription,
  OrderTerms,
  OrderTotals,
} from "@/app/s/[store]/[market]/order/[orderId]/order-section";
import { SubscriptionSection } from "@/app/s/[store]/[market]/subscription/[token]/subscription-section";
import { TermListing } from "@/app/s/[store]/[market]/term-listing";
import { WishlistSection } from "@/app/s/[store]/[market]/wishlist/wishlist-section";
import { t } from "@/lib/i18n";
import type { StorePartBlock } from "@/lib/page-content";
import { routeOfPart, type ShopPart, type StoreRoute } from "@/lib/store-parts";
import { storeAndMarket, type GridPlace } from "@/server/content-grid";

/**
 * One of a store's working pages (D113) on a page built in the page builder:
 * the cart, checkout, order confirmation, My account, sign-in, wishlists, a
 * subscription, weekly deliveries or the cookies list, the same components
 * the standard pages are made of. It draws only on the route it belongs to,
 * where the address carries what it needs (`place.route`); anywhere else it
 * draws nothing. The cart, checkout and order pages also come in pieces
 * (D117, `STORE_PIECES`), each the same component the whole page is made of.
 */
export function StorePartSection({ block, place }: { block: StorePartBlock; place: GridPlace }) {
  const route = place.route;
  if (!route || route.part !== routeOfPart(block.part) || !place.owner) return null;
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <Part owner={place.owner} market={place.market ?? null} route={route} part={block.part} />
    </Suspense>
  );
}

async function Part({
  owner,
  market: marketCode,
  route,
  part,
}: {
  owner: string;
  market: string | null;
  route: StoreRoute;
  part: ShopPart;
}) {
  const shop = await storeAndMarket(owner, marketCode);
  if (!shop) return null;
  const { store, market } = shop;
  const query = route.query ?? Promise.resolve({});
  const m = t(market.lang);
  const order = route.param ? { store, market, orderId: route.param, query } : null;
  // A page with its own piece for the terms at checkout (wave 1, 1e) has them there; the payment form then does not draw them too.
  const holdsTerms = route.holds?.includes("checkout_terms") ?? false;
  switch (part) {
    case "cart_lines":
      return <CartLines store={store} market={market} m={m} />;
    case "cart_summary":
      return <CartSummary store={store} market={market} m={m} />;
    case "cart_code":
      return <CartCode store={store} market={market} m={m} />;
    case "cart_credits":
      return <CartCredits store={store} market={market} m={m} />;
    case "cart_checkout":
      return <CartCheckout store={store} market={market} m={m} />;
    case "cart_continue":
      return <CartContinue store={store} market={market} m={m} />;
    case "checkout_items":
      return <CheckoutItems store={store} market={market} />;
    case "checkout_code":
      return <CheckoutCode store={store} market={market} />;
    case "checkout_credits":
      return <CheckoutCredits store={store} market={market} />;
    case "checkout_delivery":
      return <CheckoutDelivery store={store} market={market} />;
    case "checkout_totals":
      return <CheckoutTotals store={store} market={market} />;
    case "checkout_terms":
      return <CheckoutTerms store={store} market={market} />;
    case "checkout_payment":
      return <CheckoutPayment store={store} market={market} drawTerms={!holdsTerms} />;
    case "checkout_back":
      return <CheckoutBack store={store} market={market} />;
    case "order_status":
      return order && <OrderStatus {...order} />;
    case "order_account":
      return order && <OrderAccount {...order} />;
    case "order_bookings":
      return order && <OrderBookings {...order} />;
    case "order_lines":
      return order && <OrderLines {...order} />;
    case "order_totals":
      return order && <OrderTotals {...order} />;
    case "order_documents":
      return order && <OrderDocuments {...order} />;
    case "order_subscription":
      return order && <OrderSubscription {...order} />;
    case "order_downloads":
      return order && <OrderDownloads {...order} />;
    case "order_address":
      return order && <OrderAddress {...order} />;
    case "order_terms":
      return order && <OrderTerms {...order} />;
    case "order_continue":
      return order && <OrderContinue {...order} />;
    case "cart":
      return <CartContents store={store} market={market} m={m} />;
    case "checkout":
      return <Checkout store={store} market={market} drawTerms={!holdsTerms} />;
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
    // A category's or tag's own listing (D140); the address carries the term's slug.
    case "category":
    case "tag":
      return route.param ? <TermListing store={store} market={market} kind={part} slug={route.param} query={query} /> : null;
  }
}
