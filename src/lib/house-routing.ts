/**
 * Kaizena Flow's site served from its own store (step 5 of `docs/platform-parity-plan.md`, D474): which addresses on Kaizena Flow's own host
 * stay the platform's, and which are the store's. Pure: the proxy, its tests and the sitemaps share it.
 *
 * While the switch (`platform_settings.site_from_store`) is on, a page request on Kaizena Flow's own host is the store's unless its first part
 * is one of the platform's own routes: the admin, the API, sign-in and OAuth, sign-up, the theme store, the docs, the status page, the
 * notice form, get-domain, support, the holding pages, referral links, and the platform's own files. The same few stay the platform's under
 * `/no/` (`PLATFORM_ROUTES_NB`, the folders of `src/app/(platform-nb)/no/`, `(docs-nb)` and `(theme-preview-nb)` that are no page of the
 * site). Everything else, the front page, every page, `blog`, `category`, `tag` and `cookies`, is the store's.
 */

/** Kaizena Flow's own store (D466): made by its migration at this address, never moved. */
export const HOUSE_SLUG = "kaizenaflow";

/**
 * The first parts of an address that stay the platform's on its own host. A test holds the list to the folders of `src/app` and
 * `src/app/(platform)` that are no page of the site (every one but `[slug]`, `blog`, `category`, `cookies`, `tag` and the front page).
 */
export const PLATFORM_ROUTES: readonly string[] = [
  "_next",
  ".well-known",
  "admin",
  "api",
  "auth",
  "demo",
  "docs",
  "favicon.ico",
  "get-domain",
  "holding",
  "kaizen",
  "llms.txt",
  "oauth",
  "og.png",
  "r",
  "report",
  "robots.txt",
  "s",
  "sign-up",
  "sitemap-kaizen.xml",
  "sitemap.xml",
  "status",
  "support",
  "themes",
  "unsubscribe",
];

/** The platform's own routes under `/no/` (Norwegian, D312): a test holds them to the folders of `(platform-nb)/no`, `(docs-nb)/no` and `(theme-preview-nb)/no`. */
export const PLATFORM_ROUTES_NB: readonly string[] = ["docs", "get-domain", "report", "sign-up", "status", "themes"];

/** Whether a path on Kaizena Flow's own host stays the platform's while its site is served from its store (case as Next.js routes it). */
export function platformKeeps(pathname: string): boolean {
  const [first = "", second = ""] = pathname.split("/").filter(Boolean);
  if (first === "") return false;
  if (PLATFORM_ROUTES.includes(first)) return true;
  return first === "no" && PLATFORM_ROUTES_NB.includes(second);
}

/** The host name of an address (`kaizenaflow.com`), lower case and without its port; empty for one that cannot be read. */
export function hostnameOf(host: string): string {
  return host.toLowerCase().trim().replace(/:\d+$/, "");
}

/**
 * The store whose pages a request on Kaizena Flow's own host is answered with (`hostStore` for the proxy), or null when it stays the
 * platform's: the switch must be on, the host must be the site's own (`site`, a host name), and the path no platform route.
 */
export function houseHostStore(input: { host: string; pathname: string; site: string; house: string | null }): string | null {
  if (!input.house) return null;
  if (hostnameOf(input.host) !== hostnameOf(input.site)) return null;
  return platformKeeps(input.pathname) ? null : input.house;
}

/** The path the store's routes answer a request on Kaizena Flow's own host from: the store's pages are under `/s/{store}` (`src/app/s/[store]`). */
export function houseServedPath(house: string, served: string): string {
  return `/s/${house}${served === "/" ? "" : served}`;
}
