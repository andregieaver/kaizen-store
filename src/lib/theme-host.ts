/**
 * The theme store's own address (`docs/theme-phase-3.md` step 3): `themes.kaizenaflow.com`, set as `NEXT_PUBLIC_THEMES_HOST` and read when
 * building, as the store domain is (P7). Nothing changes without it: the theme store stays at `/themes` on Kaizena Flow's own site.
 *
 * With it, routing by host (`themeHostRoutes()`, in `next.config.ts` beside stores' own hosts):
 *
 * - on the host, `/` serves the list and `/{slug}` a theme's page (the routes under `/themes`), with its own `sitemap.xml` and `robots.txt`;
 *   an address there that is not a theme (`/pricing`, the header's links) goes on to the same address on Kaizena Flow's site, by the theme
 *   page (one part) or by a redirect here (more than one);
 * - on Kaizena Flow's own host, `/themes` and `/themes/{slug}` move there for good (a store's own `/themes` is untouched); `/themes/{slug}/try` stays, as only Kaizena Flow's own host
 *   sees the admin's sign-in.
 *
 * Links in the theme store are built with `themeStorePath()` (a path on whichever host serves it), `themeStoreUrl()` (a full address:
 * canonical, sitemap, structured data) and `platformHref()` (a link to Kaizena Flow's own site, full on the host).
 */

import { siteUrl } from "./site";

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::\d{2,5})?$/;

/** The theme store's host (with a port only where one is used), or null while it has none. */
export function themesHost(): string | null {
  const value = process.env.NEXT_PUBLIC_THEMES_HOST?.trim().toLowerCase();
  if (!value) return null;
  if (!HOST.test(value)) throw new Error(`NEXT_PUBLIC_THEMES_HOST must be a host name such as themes.kaizenaflow.com, not "${value}".`);
  return value;
}

const local = (host: string) => /^(?:[^:]+\.)?localhost(?::\d+)?$/.test(host);

/** `https://themes.kaizenaflow.com` (plain http on localhost), or null. */
export function themesOrigin(host = themesHost()): string | null {
  return host ? `${local(host) ? "http" : "https"}://${host}` : null;
}

/** Whether a request's `Host` header is the theme store's own host. */
export function isThemesHost(host: string | null | undefined, themes = themesHost()): boolean {
  return Boolean(themes && host && host.toLowerCase() === themes);
}

/**
 * A path in the theme store, as the page serving it links: `""` is the list, `"calm"` a theme, `"?kind=food"` the list filtered. On its own
 * host the theme store is the root; without one it is under `/themes`.
 */
export function themeStorePath(sub = ""): string {
  const base = themesHost() ? "" : "/themes";
  if (sub === "" || sub.startsWith("?")) return `${base || "/"}${sub}`;
  return `${base}/${sub}`;
}

/** A full address in the theme store: canonical addresses, the sitemap and structured data. */
export function themeStoreUrl(sub = ""): string {
  const origin = themesOrigin();
  return origin ? `${origin}${themeStorePath(sub)}` : `${siteUrl()}${themeStorePath(sub)}`;
}

/** A link from the theme store to Kaizena Flow's own site (sign-up, the try route, the preview): full while the store has its own host. */
export function platformHref(path: string): string {
  return themesHost() ? `${siteUrl()}${path}` : path;
}

type Match = { type: "host"; value: string };
export type ThemeHostRedirect = { source: string; destination: string; permanent: boolean; has?: Match[]; missing?: Match[] };
export type ThemeHostRewrite = { source: string; destination: string; has: Match[] };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Served on every host, as on a store's (`SHARED` in `store-hosts.ts`): Next.js's files, the API and `public`. */
const SHARED = "_next/|api/|demo/|kaizen/";

/** A theme's address (`THEME_SLUG`) or the host's two files; anything else on the host is Kaizena Flow's own. */
const ON_HOST = "[a-z0-9][a-z0-9-]*|sitemap\\.xml|robots\\.txt";

export function themeHostRoutes(host: string | null, platformUrl: string): { redirects: ThemeHostRedirect[]; rewrites: ThemeHostRewrite[] } {
  if (!host) return { redirects: [], rewrites: [] };
  const origin = themesOrigin(host) as string;
  const onHost: Match = { type: "host", value: escape(host.replace(/:\d+$/, "")) };
  const onPlatform: Match = { type: "host", value: escape(new URL(platformUrl).hostname) };
  return {
    redirects: [
      // Kaizena Flow's own addresses of the theme store move to its host, for good; only on Kaizena Flow's host (a store's `/themes` is its own).
      { source: "/themes", has: [onPlatform], destination: `${origin}/`, permanent: true },
      { source: `/themes/:slug(${ON_HOST})`, has: [onPlatform], destination: `${origin}/:slug`, permanent: true },
      // On the host, an address of more than one part is Kaizena Flow's own (the admin, the blog, the try route).
      { source: `/:path((?!${SHARED})[^/]+/.+)`, has: [onHost], destination: `${platformUrl}/:path`, permanent: false },
    ],
    // Rewrites before files apply in turn, each to the path the one before left: the root comes last, so `/themes` is not rewritten again.
    rewrites: [
      { source: `/:slug(${ON_HOST})`, has: [onHost], destination: "/themes/:slug" },
      { source: "/", has: [onHost], destination: "/themes" },
    ],
  };
}
