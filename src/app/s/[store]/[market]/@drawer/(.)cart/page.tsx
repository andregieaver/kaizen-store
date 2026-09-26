import { Suspense } from "react";

import { CartContents } from "@/app/s/[store]/[market]/cart/cart-contents";
import { CartDrawer } from "@/components/cart-drawer";
import { t } from "@/lib/i18n";
import { resolveShop } from "@/server/shop";

/**
 * The cart opened from a page of the store: on phones it slides out over
 * that page (`CartDrawer`); loading `/cart` itself shows the cart page.
 */
export default async function CartDrawerPage({ params }: { params: Promise<{ store: string; market: string }> }) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  const { store, market } = shop;
  const m = t(market.lang);
  return (
    <CartDrawer title={m.cart} labels={{ close: m.closeCart }}>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <CartContents store={store} market={market} m={m} />
      </Suspense>
    </CartDrawer>
  );
}
