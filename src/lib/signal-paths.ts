/**
 * Which store pages heatmaps and recordings may collect on, as the browser can tell (D656, `docs/heatmaps-and-recordings.md` 7.6). An
 * allow-list that mirrors the server's rule (`placeOfPath()` then `speedKind()`, `src/lib/visit-record.ts` and `src/lib/speed.ts`), which
 * the browser cannot import (zod, page content): the server stays the authority and checks again. It may allow a little more than the
 * server (a short page slug on a store without a market in its addresses reads as a market), never less, and it refuses every private route.
 * The lists are copies; `signal-paths.test.ts` holds them equal to the real ones.
 */

import { MARKET_PARAM } from "./pay-routes";

/** Copy of `PRIVATE_ROUTES` (`visit-record.ts`): routes that hold a secret or belong to one person. */
export const PRIVATE_SEGMENTS: readonly string[] = [
  "account",
  "order",
  "unsubscribe",
  "download",
  "subscription",
  "deliveries",
  "wishlist",
  "cart",
  "invoice",
  "invite",
  "restore",
  "sign-in",
  "ab",
  "cookies",
  // A request's confirmation link holds its secret token (D685).
  "request",
];

/** Copy of `RESERVED_STORE_PAGE_SLUGS` (`page-content.ts`): the store's own routes, never one of its pages. */
export const RESERVED_PAGE_SEGMENTS: readonly string[] = [
  "account",
  "blog",
  "blogs",
  "cart",
  "category",
  "checkout",
  "cookies",
  "deliveries",
  "download",
  "order",
  "p",
  "products",
  "request",
  "returns",
  "search",
  "subscription",
  "tag",
  "unsubscribe",
  "wishlist",
  "withdraw",
];

/** Copy of `RESERVED_ARTICLE_SLUGS` (`page-content.ts`). */
export const RESERVED_ARTICLE_SEGMENTS: readonly string[] = ["category", "page", "tag"];

const MARKET = new RegExp(`^${MARKET_PARAM}$`);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SignalPlace = { heat: boolean; rec: boolean };

/** May this address be collected on: heatmaps, recordings, or null for neither. `search` is the address's query string. */
export function signalPlace(pathname: string, search: string, storeSlug: string): SignalPlace | null {
  let segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "s" && segments[1] === storeSlug) segments = segments.slice(2);
  else if (segments[0] === "s") return null;
  if (segments.length > 0 && !PRIVATE_SEGMENTS.includes(segments[0].toLowerCase()) && MARKET.test(segments[0].toLowerCase())) segments = segments.slice(1);
  // The route is the first segment after the market: a private one refuses the whole address, whatever follows (a product handle may be anything).
  if (segments.length > 0 && PRIVATE_SEGMENTS.includes(segments[0].toLowerCase())) return null;
  const typed = new URLSearchParams(search).has("q");
  const both: SignalPlace = { heat: true, rec: !typed };
  const [first, second] = segments;
  switch (segments.length) {
    case 0:
      return both;
    case 1:
      if (first === "search") return { heat: true, rec: false };
      if (first === "products" || first === "blog") return both;
      return SLUG.test(first) && !RESERVED_PAGE_SEGMENTS.includes(first) ? both : null;
    case 2:
      if (first === "p") return second.length > 0 ? both : null;
      if (first === "category" || first === "tag") return SLUG.test(second) ? both : null;
      if (first === "blog") return SLUG.test(second) && !RESERVED_ARTICLE_SEGMENTS.includes(second) ? both : null;
      return null;
    default:
      return null;
  }
}
