"use client";

import { useEffect } from "react";

import { CartLinkShell } from "./cart-link";
import { loadOwn, useCart } from "./shopper-own";

/**
 * The cart link with the cart's count, drawn in the browser (bloat review step 2.4): the count comes from `/api/shop/mine`, asked only
 * when the marker cookie says there may be a cart (or for the country suggestion, `hinted`), so the page around it is the same for
 * everyone and served as a static file. Until then, and with no cart, it is the plain link.
 */
export function CartLink({
  storeId,
  storeSlug,
  market,
  lang,
  href,
  variant = "header",
  hinted = false,
}: {
  storeId: string;
  storeSlug: string;
  /** The market's slug, as `/api/shop/mine` resolves it. */
  market: string;
  lang: string;
  /** The cart's address, written by the server (`marketPath()`): the browser does not know the store's address shape. */
  href: string;
  variant?: "header" | "bar";
  hinted?: boolean;
}) {
  useEffect(() => loadOwn({ store: storeSlug, market, storeId, hinted }), [storeSlug, market, storeId, hinted]);
  const count = useCart() ?? 0;
  return <CartLinkShell href={href} lang={lang} variant={variant} count={count} />;
}
