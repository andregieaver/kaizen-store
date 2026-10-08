import "server-only";

import { market as marketParam, store as storeParam } from "next/root-params";

import { shopOrMoved, type Shop } from "./shop";

/**
 * The shop of the page being drawn, read from the root parameters (the market layout's `store` and `market`), or the move of a country,
 * language or currency the store no longer offers (D178, `marketMoved()`: a 308 to the same `path` where it is offered) or the 404. A page
 * whose content streams in a `<Suspense>` calls it before the boundary: the root parameters are known to the prerender, where the page's own
 * `params` (with a token or a slug) are not, so the move is the response's status and not a redirect in a page already sent.
 */
export async function pageShopOrMoved(path = "/"): Promise<Shop> {
  const [storeSlug, marketSlug] = await Promise.all([storeParam(), marketParam()]);
  return shopOrMoved(storeSlug, marketSlug, path);
}
