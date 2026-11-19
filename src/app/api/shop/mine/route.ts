import { after, connection } from "next/server";

import { hintCountry } from "@/lib/country-hint";
import { isBot } from "@/lib/experiments";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketLink, marketPath } from "@/lib/paths";
import { fail } from "@/lib/route-fail";
import { sameSite } from "@/lib/same-site";
import { featureOn } from "@/lib/store-features";
import { getCartCount } from "@/server/cart";
import { noteFirstRequest } from "@/server/instance-start";
import { lockedOut } from "@/server/private-mode";
import { resolveShop } from "@/server/shop";
import type { Store } from "@/server/stores";
import { savedProductIds } from "@/server/wishlists";

/**
 * What is this visitor's own on a store page (bloat review step 2.4): `?store=&market=` answers the cart's count, the saved products
 * (D34) and, in a store with several countries, the country suggestion (D338), so the pages themselves are the same for everyone and
 * served as static files. The page asks only when the marker cookie `kaizen_mine_{storeId}` says there may be something, or for the
 * suggestion; never cached. A private store's locked page answers nothing.
 */
export async function GET(request: Request) {
  await connection();
  // A store page is a static file now: its first per-request part an instance answers is this one (bloat review step 1.16's `store` kind).
  noteFirstRequest("store", after);
  if (!sameSite(request)) return fail(403, "Your own things are for the site's own pages.");
  const url = new URL(request.url);
  const store = url.searchParams.get("store") ?? "";
  const market = url.searchParams.get("market") ?? "";
  if (!store || !market) return fail(400, "Name the store and the market.");
  // Not resolveSellingShop(): a website with several countries still gets its suggestion.
  const shop = await resolveShop(store, market);
  if (!shop || (await lockedOut(shop.store))) return fail(404, "No such store.");
  const selling = featureOn(shop.store, "shop");
  const [cart, saved] = selling
    ? await Promise.all([getCartCount({ storeId: shop.store.id, market: shop.market }), savedProductIds(shop.store.id)])
    : [0, [] as string[]];
  const hint = shop.store.markets.length <= 1 ? null : countryHint(request, shop.store, shop.market);
  return Response.json({ cart, saved, hint }, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * The country suggestion: nothing for a crawler, a visitor whose country the store does not sell to, or one already in their country.
 * The link is to the same page in that country's own view, in its language.
 */
function countryHint(request: Request, store: Store, market: Market) {
  if (isBot(request.headers.get("user-agent"))) return null;
  const country = hintCountry(request.headers.get("x-vercel-ip-country"), market.code, store.markets.map((m) => m.code));
  const target = country ? store.markets.find((m) => m.code === country) : undefined;
  if (!target) return null;
  const name = new Intl.DisplayNames([market.locale, "en"], { type: "region" }).of(target.code) ?? target.name;
  const words = t(market.lang).countryHint;
  return {
    fromBase: marketPath(store.slug, market.slug),
    toBase: marketLink(store.slug, market.slug, target.slug),
    lang: market.lang,
    words: { offer: words.offer(name), go: words.go(name), close: words.close, label: words.label },
  };
}
