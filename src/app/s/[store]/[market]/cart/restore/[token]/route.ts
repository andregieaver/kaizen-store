import { redirect } from "next/navigation";

import { marketPath } from "@/lib/paths";
import { changeLine } from "@/server/cart";
import { openReminderLink } from "@/server/cart-reminders";
import { setCartCode } from "@/server/discounts";
import { featureOn } from "@/lib/store-features";
import { resolveAfterSaleShop, resolveShop } from "@/server/shop";

/**
 * A cart reminder's button (D33): puts the cart back as it was in this
 * browser, with the reminder's discount code if it has one, and opens it.
 * Items no longer for sale are left out, and quantities follow the stock.
 */
export async function GET(request: Request, { params }: RouteContext<"/s/[store]/[market]/cart/restore/[token]">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  // A country, language or currency the store no longer offers (D178): the cart page says so, or moves to where the cart is; nothing is restored.
  if (!shop) {
    if (await resolveAfterSaleShop(storeSlug, marketSlug)) redirect(marketPath(storeSlug, marketSlug, "/cart"));
    return new Response("Not found", { status: 404 });
  }
  // A website (D178 step 5: the online shop off) restores no cart.
  if (!featureOn(shop.store, "shop")) return new Response("Not found", { status: 404 });
  const cart = { storeId: shop.store.id, market: shop.market };
  const found = token.length <= 64 ? await openReminderLink(shop.store.id, token) : null;
  if (found) {
    for (const line of found.lines) {
      await changeLine(cart, line.variantId, line.quantity, "set", line.sellingPlanId);
    }
    const code = new URL(request.url).searchParams.get("code");
    if (code) await setCartCode(cart, code.slice(0, 40));
  }
  redirect(marketPath(shop.store.slug, shop.market.slug, "/cart"));
}
