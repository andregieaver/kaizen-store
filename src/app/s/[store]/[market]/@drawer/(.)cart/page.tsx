import { Suspense } from "react";

import { CartContents } from "@/app/s/[store]/[market]/cart/cart-contents";
import { CartDrawer } from "@/components/cart-drawer";
import { DrawerBackground } from "@/components/drawer-background";
import { surfaceClass } from "@/lib/background-surface";
import { t } from "@/lib/i18n";
import { CART_DRAWER_LOOK, drawerHasBackground, menuLook } from "@/lib/menu-drawer";
import { headerDrawer } from "@/lib/site-layout";
import { siteLayoutFor } from "@/server/site-layouts";
import { resolveSellingShop } from "@/server/shop";

/**
 * The cart opened from a page of the store: on phones it slides out over
 * that page (`CartDrawer`); loading `/cart` itself shows the cart page. It
 * lies as the store's header's Cart component says (D571): its type, edge and
 * background, a panel from the right on the theme's background unless set.
 */
export default async function CartDrawerPage({ params }: { params: Promise<{ store: string; market: string }> }) {
  const { store: storeSlug, market: marketSlug } = await params;
  // Nothing to slide out in a website (D178 step 5: the online shop off).
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop) return null;
  const { store, market } = shop;
  const m = t(market.lang);
  // The header as published (cached with the store's pages); a header under an A/B test gives its original's settings.
  const drawer = headerDrawer((await siteLayoutFor(store.id, "header"))?.content, "cart");
  const own = drawer && drawerHasBackground(drawer);
  return (
    <CartDrawer
      title={m.cart}
      labels={{ close: m.closeCart }}
      look={menuLook(drawer, CART_DRAWER_LOOK)}
      surface={drawer ? surfaceClass(drawer) : undefined}
      blur={drawer?.backdropBlur}
      background={own ? <DrawerBackground drawer={drawer} /> : undefined}
    >
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <CartContents store={store} market={market} m={m} drawer />
      </Suspense>
    </CartDrawer>
  );
}
