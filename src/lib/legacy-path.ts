/**
 * A request for an address with no country (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.1.3, 5.3), pure: the shapes of an old Shopify or other shop
 * (`/collections/shoes`, `/products/old-cup`, `/pages/about`) on a store's own host, or under `/s/{store}/` before stores have hosts. The proxy looks such a
 * path up as a manual redirect source and sends it, permanently, to the target in the store's MAIN market; a path that has a market never reaches the proxy's
 * branch, so normal shopping is not slowed.
 *
 * `LEGACY_MATCHER` is the proxy's second matcher entry written out as a literal (a matcher is read at build time and cannot use a constant): it keeps the
 * proxy off everything that is not a market-less path (a market's pages, `/`, `/s/{store}` alone, `_next/`, `api/`, `admin/`, `demo/`, `kaizen/` and static
 * files). A test holds the literal to `parseLegacyRequest()` over a table of paths, as the A/B marker's is held. The function is the authority, the matcher
 * only keeps the proxy from being called.
 */
import { PLATFORM_SEGMENTS, STATIC_EXTENSIONS, looksLikeMarket, normalisePath } from "./redirect-path";

export type LegacyRequest = {
  store: string;
  /** The path in the normal form, without a market: what a manual redirect's `source` is looked up by. Never `/`. */
  path: string;
  /** True on a store's own host, false under `/s/{store}/`. */
  hostBased: boolean;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The routes the proxy never sees: a market-less path under one of these is the platform's. */
const NOT_STORE_PAGES: readonly string[] = ["_next", "api", "admin", "demo", "kaizen", "favicon.ico"];

const hasStaticExtension = (last: string): boolean => {
  const dot = last.lastIndexOf(".");
  return dot > 0 && STATIC_EXTENSIONS.includes(last.slice(dot + 1).toLowerCase());
};

/**
 * The store and the market-less path of a request, when it is one (see the file's header), else null: `/` and `/s/{store}` alone, a first part that looks like
 * a market (the market's own routes serve it), the platform's routes, a static file, an address that cannot be read in the normal form. `hostStore` is the store
 * the request's host belongs to, or null on the platform's own address.
 */
export function parseLegacyRequest(pathname: string, hostStore: string | null): LegacyRequest | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let store: string;
  let rest: string[];
  let hostBased: boolean;
  if (parts[0] === "s") {
    if (parts.length < 3 || !SLUG.test(parts[1])) return null;
    store = parts[1];
    rest = parts.slice(2);
    hostBased = false;
  } else if (hostStore) {
    store = hostStore;
    rest = parts;
    hostBased = true;
  } else return null;
  const first = rest[0].toLowerCase();
  if (looksLikeMarket(first) || NOT_STORE_PAGES.includes(first) || PLATFORM_SEGMENTS.includes(first)) return null;
  if (hasStaticExtension(rest[rest.length - 1])) return null;
  const path = normalisePath(`/${rest.join("/")}`);
  if (path === null || path === "/") return null;
  return { store, path, hostBased };
}

/**
 * The market-less path of a request the market ROUTES see (the part after the market, or, for an unknown market, the whole path), in the normal form: `rest` are
 * the parts of the address as the router gives them. Null for the root, the platform's routes, a static file or an address that cannot be read.
 * A first part that only LOOKS like a market (`/om-oss`) is not one of the store's: the market route that finds it unknown looks it up as `legacyPathOf([market, ...rest])`.
 */
export function legacyPathOf(rest: readonly string[]): string | null {
  if (rest.length === 0) return null;
  const first = rest[0].toLowerCase();
  if (NOT_STORE_PAGES.includes(first) || PLATFORM_SEGMENTS.includes(first) || hasStaticExtension(rest[rest.length - 1])) return null;
  const path = normalisePath(`/${rest.join("/")}`);
  return path === null || path === "/" ? null : path;
}

/**
 * The proxy's second matcher: every path except `/`, `/s/{store}` alone, a market's pages (a first part of two letters, with a language and a currency, on a
 * store's host or after `/s/{store}/`), `_next/`, `api/`, `admin/`, `demo/`, `kaizen/`, the icon and static files. Case-insensitive, as Next compiles it.
 * Non-capturing groups only.
 */
export const LEGACY_MATCHER = {
  source:
    "/((?!_next/|api/|admin/|demo/|kaizen/|favicon\\.ico|[a-z]{2}(?:-[a-z0-9]{2,8}){0,2}(?:/|$)|s/[^/]+/?$|s/[^/]+/[a-z]{2}(?:-[a-z0-9]{2,8}){0,2}(?:/|$)|.*\\.(?:ico|png|jpg|jpeg|gif|webp|avif|svg|css|js|map|txt|xml|json|woff|woff2|ttf|pdf|csv|zip|mp4|webm)$).+)",
} as const;
