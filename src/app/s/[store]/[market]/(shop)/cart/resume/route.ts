import { connection } from "next/server";

import { marketPath } from "@/lib/paths";
import { resumeHandoff } from "@/server/cart-handoff";
import { resolveSellingShop } from "@/server/shop";

/**
 * Where a cart made on another site (the WordPress plugin, D170) is opened: `?t=` is the one-time secret of the hand-over. It makes the cart this
 * browser's, then sends the shopper on to the cart or the checkout. A link that is wrong, used or run out goes to the cart page as it is, with
 * nothing said about why. Never cached, never indexed, and the secret is not kept in the address after the redirect.
 */
export async function GET(request: Request, { params }: RouteContext<"/s/[store]/[market]/cart/resume">) {
  await connection();
  const { store, market } = await params;
  // A website (D178 step 5: the online shop off) takes no cart: the link goes to the front page, nothing resumed.
  const shop = await resolveSellingShop(store, market);
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
  if (!shop) return new Response(null, { status: 303, headers: { ...headers, Location: "/" } });
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const resumed = await resumeHandoff({ storeId: shop.store.id, market: shop.market }, token);
  const path = marketPath(shop.store.slug, shop.market.slug, resumed?.to === "checkout" ? "/checkout" : "/cart");
  return new Response(null, { status: 303, headers: { ...headers, Location: path } });
}
