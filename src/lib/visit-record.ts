import { z } from "zod";

import { splitSiteVersions } from "./ab-site";
import { landingKind, type LandingKind } from "./analytics-traffic";
import { parseMarketSlug } from "./market-slug";
import { RESERVED_ARTICLE_SLUGS, RESERVED_STORE_PAGE_SLUGS } from "./page-content";

/**
 * What the visit endpoint accepts and what it makes of a path (D152, docs/analytics.md, "Visit counting"). Pure and shared
 * by `recordVisit()` and its tests. The endpoint never trusts the body: every field is checked here, a path that is not
 * one of the store's pages is dropped, and nothing is kept that was not asked for.
 */

/** Characters a URL path can hold as the browser writes it (percent-encoded), so nothing odd is ever stored. */
const PATH = /^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/]*$/;

export const visitBody = z.object({
  store: z.string().regex(/^[a-z0-9-]{3,40}$/),
  path: z.string().max(300).regex(PATH),
  referrer: z.string().max(120).optional(),
  utm_source: z.string().max(60).optional(),
  utm_medium: z.string().max(30).optional(),
  utm_campaign: z.string().max(80).optional(),
  gclid: z.literal(true).optional(),
  fbclid: z.literal(true).optional(),
  ttclid: z.literal(true).optional(),
});

export type VisitBodyInput = z.infer<typeof visitBody>;

/** Page views one visitor can add on one day; past it the visit is left as it is (a script, not a person). */
export const PAGE_VIEW_CAP = 3000;
/** Rows older than this many months are deleted by the daily job. */
export const RETENTION_MONTHS = 25;
/**
 * Abuse bounds (docs/analytics.md): new visitor-day rows one store takes in a day, and new rows one address (as a keyed hash)
 * can start in ten minutes. They bound how far a script can inflate sessions or bloat the table; they do not prevent it.
 */
export const NEW_VISITS_PER_STORE_DAY = 50_000;
export const NEW_VISITS_PER_ADDRESS_WINDOW = 100;

/** What is kept for a page that is none of the store's known kinds of page. */
export const OTHER_PAGE = "(other)";

export type VisitPlace = {
  /** The country of the market the page is in (`NO`), null on the store's front door (the country chooser). */
  market: string | null;
  kind: LandingKind;
  /** A product page's handle. */
  handle: string | null;
  /** The only form of the path that is ever stored: `safeLandingPath()`'s. */
  landing: string;
};

/** A slug as pages, categories, tags and articles are written. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 80;
/** A product handle as the shopper's browser may spell it (decoded): letters and digits with `-`, `_` and `.` inside. */
const HANDLE = /^[\p{L}\p{N}](?:[\p{L}\p{N}._-]*[\p{L}\p{N}])?$/u;
const HANDLE_MAX = 100;
/** Pages of the store's own that stand alone (no segment after them) and are worth a name of their own. */
const PLAIN_PAGES: readonly string[] = ["cart", "checkout", "search", "products", "blog"];
/**
 * Routes whose address holds a secret or an id, or that belong to one person: never a landing page, whatever follows. Most of
 * them are also reserved page slugs; this list is the belt to that braces, in case a route is added there first.
 */
const PRIVATE_ROUTES: readonly string[] = [
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
];

const decoded = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

/**
 * What of a page's address may be kept (D152, docs/analytics.md, "Visit counting"). Never the path as it came: a store's
 * pages carry orders' ids and one-time or long-lived tokens in their addresses (a sign-in link, an invoice, an unsubscribe),
 * and a visit row lives for 25 months and is read by every member. Only a short list of route shapes is kept, with the
 * market's country in front, and everything else is `(other)`:
 *
 * - `/` the country chooser (`/s/{store}`), `/no` a market's front page
 * - `/no/p/{handle}` a product (the handle checked), `/no/category/{slug}`, `/no/tag/{slug}`, `/no/blog/{slug}`
 * - `/no/cart`, `/no/checkout`, `/no/search`, `/no/products`, `/no/blog`
 * - `/no/{slug}` a single page of the store's own, when the slug is a slug and not one of the store's working routes
 *
 * The query and fragment are dropped first and nothing after the shapes above is looked at: a second segment under an
 * account, order, download, subscription, unsubscribe or cart route is `(other)`, not a shortened address.
 */
function landingOf(country: string | null, rest: readonly string[]): string {
  if (country === null) return "/";
  const market = `/${country.toLowerCase()}`;
  if (rest.length === 0) return market;
  const [first, second] = rest;
  if (rest.length === 1) {
    if (PLAIN_PAGES.includes(first)) return `${market}/${first}`;
    if (SLUG.test(first) && first.length <= SLUG_MAX && !RESERVED_STORE_PAGE_SLUGS.includes(first) && !PRIVATE_ROUTES.includes(first)) return `${market}/${first}`;
    return OTHER_PAGE;
  }
  if (rest.length === 2) {
    if (first === "p") {
      const handle = decoded(second)?.trim() ?? "";
      return handle.length > 0 && handle.length <= HANDLE_MAX && HANDLE.test(handle) ? `${market}/p/${handle}` : OTHER_PAGE;
    }
    if (first === "category" || first === "tag") return SLUG.test(second) && second.length <= SLUG_MAX ? `${market}/${first}/${second}` : OTHER_PAGE;
    if (first === "blog") return SLUG.test(second) && second.length <= SLUG_MAX && !RESERVED_ARTICLE_SLUGS.includes(second) ? `${market}/blog/${second}` : OTHER_PAGE;
  }
  return OTHER_PAGE;
}

/**
 * Which page of the store a path is, or null when it is not one of its pages. On the platform a store's pages are
 * `/s/{store}/…`, on its own host `/{market}/…`; the front door is `/s/{store}` or `/`. A market is one of the store's
 * countries, with its language and currency choices and any A/B versions (`no-en-eur`, `no~…`).
 */
export function placeOfPath(path: string, storeSlug: string, marketCodes: readonly string[]): VisitPlace | null {
  const clean = path.split(/[?#]/, 1)[0];
  let segments = clean.split("/").filter((s) => s !== "");
  if (segments[0] === "s") {
    if (segments[1] !== storeSlug) return null;
    segments = segments.slice(2);
  }
  if (segments.length === 0) return { market: null, kind: "other", handle: null, landing: landingOf(null, []) };
  const choice = parseMarketSlug(splitSiteVersions(segments[0].toLowerCase()).market);
  if (!choice || !marketCodes.includes(choice.country)) return null;
  const landing = landingKind(clean);
  return { market: choice.country, kind: landing.kind, handle: landing.handle, landing: landingOf(choice.country, segments.slice(1)) };
}

/**
 * Whether a request is from the store's own pages, as far as its headers say (D152): the endpoint is open to the web, so
 * the store in the body must be the one the page came from. A browser always sends `Origin` on a POST, and `Referer` unless
 * a page asks otherwise; with neither the request is not a page's. Both, when present, must be the host the request came to.
 * On one of the store's own hosts that is enough (`ownHosts`: the hosts of this store and no other). While stores live on
 * Kaizen's host (`storesOnPlatformHost`) the page's address must be under `/s/{store}`, which only a Referer can show.
 * This ties a request to a page; a script can still send any headers it likes, which is why the endpoint also has its caps.
 */
export function fromStoresOwnPage(input: {
  origin: string | null | undefined;
  referer: string | null | undefined;
  requestHost: string | null | undefined;
  slug: string;
  ownHosts: readonly string[];
  storesOnPlatformHost: boolean;
}): boolean {
  const requestHost = input.requestHost?.toLowerCase();
  if (!requestHost) return false;
  const parse = (value: string | null | undefined): URL | null => {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  };
  const origin = parse(input.origin);
  const referer = parse(input.referer);
  if (!origin && !referer) return false;
  // A header that is there but is not an address (`Origin: null`) is no page's.
  if (input.origin && !origin) return false;
  if (input.referer && !referer) return false;
  if (origin && origin.host.toLowerCase() !== requestHost) return false;
  if (referer && referer.host.toLowerCase() !== requestHost) return false;
  if (input.ownHosts.some((host) => host.toLowerCase() === requestHost)) return true;
  if (!input.storesOnPlatformHost || !referer) return false;
  const [, prefix, store] = referer.pathname.split("/");
  return prefix === "s" && store === input.slug;
}
