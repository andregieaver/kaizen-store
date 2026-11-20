import { Suspense, type ReactNode } from "react";

import { t, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { StorePartBlock } from "@/lib/page-content";
import { requirementMet } from "@/lib/store-features";
import { drawsOn, shopPartAfterSale, shopPartFeature, type ShopPart, type StoreRoute } from "@/lib/store-parts";
import { storeAndMarket, type GridPlace } from "@/server/content-grid";
import type { Store } from "@/server/stores";

import type { StorePartDrawer } from "./page-article";

/** What a route's parts module draws for one shop part, with what the frame has worked out; null for a part it does not draw. */
export type PartDraw = (p: {
  part: ShopPart;
  store: Store;
  market: Market;
  route: StoreRoute;
  query: NonNullable<StoreRoute["query"]>;
  m: Messages;
  holdsTerms: boolean;
  holdsGift: boolean;
}) => ReactNode;

/**
 * One of a store's working pages (D113) on a page built in the page builder:
 * the cart, checkout, order confirmation, My account, sign-in, wishlists, a
 * subscription, subscription boxes or the cookies list, the same components
 * the standard pages are made of. It draws only on the route it belongs to,
 * where the address carries what it needs (`place.route`); anywhere else it
 * draws nothing. The cart, checkout and order pages also come in pieces
 * (D117, `STORE_PIECES`), each the same component the whole page is made of.
 * The frame imports no section: each working route hands `draw`, its own
 * parts module (`cart-parts.tsx`, `checkout-parts.tsx`, ...), so a route's
 * first scripts carry only the sections it draws (bloat review step 2.9).
 */
export function storePartDrawer(draw: PartDraw): StorePartDrawer {
  return function WorkingPart({ block, place }: { block: StorePartBlock; place: GridPlace }) {
    const route = place.route;
    if (!route || !drawsOn(block.part, route.part) || !place.owner) return null;
    return (
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <Part owner={place.owner} market={place.market ?? null} route={route} part={block.part} draw={draw} />
      </Suspense>
    );
  };
}

async function Part({
  owner,
  market: marketCode,
  route,
  part,
  draw,
}: {
  owner: string;
  market: string | null;
  route: StoreRoute;
  part: ShopPart;
  draw: PartDraw;
}) {
  const shop = await storeAndMarket(owner, marketCode);
  if (!shop) return null;
  const { store, market } = shop;
  // A component of a store feature that is off draws nothing (D178): the bonus credits with the bonus program off. One that serves shoppers'
  // links to what they already have (a subscription's page) still draws.
  if (!requirementMet(store, shopPartFeature(part)) && !shopPartAfterSale(part)) return null;
  const query = route.query ?? Promise.resolve({});
  const m = t(market.lang);
  // A page with its own piece for the terms at checkout (wave 1, 1e) has them there; the payment form then does not draw them too.
  const holdsTerms = route.holds?.includes("checkout_terms") ?? false;
  // The same for the cart's gift box (wave 3, D173): a cart page made of pieces with no gift piece gets the box above its checkout button.
  const holdsGift = route.holds?.includes("cart_gift") ?? false;
  return draw({ part, store, market, route, query, m, holdsTerms, holdsGift }) ?? null;
}
