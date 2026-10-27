/**
 * Routing by host (P6, P7): configuration Next.js hands to Vercel's routing
 * layer, so it costs no function call and reads nothing but the host name.
 * Built from `NEXT_PUBLIC_STORE_DOMAIN` at build time; nothing without it.
 *
 * - `{store}.{domain}/…` serves `/s/{store}/…`, except Next.js's own files,
 *   the API (the consent log, fonts) and the pictures in `public`. Kaizen's
 *   own pages, the admin among them, are not reachable there.
 * - `/s/{store}/…` anywhere else moves to the store's host, so the store's
 *   pages, and what the store adds to them, only run there.
 * - The domain itself and `www.` go to Kaizen.
 * - A store's primary custom domain (P8) serves its pages as its host does;
 *   its `{store}.{domain}` host and its other domains move there. The
 *   domains come from the database when the deployment is built.
 * - A language's own domain (D313), or a country's (D338), serves the store's
 *   pages as the primary does (never moved there); the proxy reads its
 *   language or country from the host.
 */

import type { StoreHosts } from "./paths";

type Match = { type: "host"; value: string };
export type HostRedirect = { source: string; destination: string; permanent: boolean; has?: Match[]; missing?: Match[] };
export type HostRewrite = { source: string; destination: string; has: Match[] };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Served from the platform on every host: Next.js's files, the API, and
 * `public` (its folders `demo` and `kaizen`, with Kaizen's own icon). A
 * store's `/favicon.ico` is its own (D62).
 */
const SHARED = "_next/|api/|demo/|kaizen/";

export function storeHostRoutes(
  domain: string | null,
  platformUrl: string,
  customHosts: StoreHosts = {},
  themesHost: string | null = null,
): { redirects: HostRedirect[]; rewrites: HostRewrite[] } {
  if (!domain) return { redirects: [], rewrites: [] };
  const [hostname, port] = domain.split(":");
  const host = escape(hostname);
  const scheme = /^localhost$/.test(hostname) ? "http" : "https";
  const origin = (name: string) => `${scheme}://${name}${port ? `:${port}` : ""}`;
  // The theme store's host may be a name under the store domain (`themes.{domain}`, docs/theme-phase-3.md step 3): it is never a store's.
  const themesLabel = themesHost?.replace(/:\d+$/, "").endsWith(`.${hostname}`) ? themesHost.replace(/:\d+$/, "").slice(0, -hostname.length - 1) : null;
  const notThemes = themesLabel && /^[a-z0-9-]+$/.test(themesLabel) ? `(?!${escape(themesLabel)}\\.)` : "";
  const storeHost: Match = { type: "host", value: `(?<store>${notThemes}[a-z0-9-]+)\\.${host}` };
  const exactly = (name: string): Match => ({ type: "host", value: escape(name) });

  // Stores with a primary domain of their own: every other address of theirs leads there.
  // A language's own domain (D313) serves the store's pages as its primary does; the proxy reads the language from the host.
  // A country's own domain (D338) is served the same way; the proxy reads the country from the host.
  const custom = Object.entries(customHosts).map(([slug, { primary, hosts, languages = {}, countries = {} }]) => {
    const own = [...Object.values(languages), ...Object.values(countries)];
    return {
      slug,
      primary,
      served: [...(primary ? [primary] : []), ...own.filter((name) => name !== primary && hosts.includes(name))],
      canonical: origin(primary ?? `${slug}.${hostname}`),
      others: [...(primary ? [`${slug}.${hostname}`] : []), ...hosts.filter((name) => name !== primary && !own.includes(name))],
    };
  });
  const everywhere = (destination: string) => `${destination}/:path*`;
  return {
    redirects: [
      ...custom.flatMap(({ canonical, others }) =>
        others.map((name) => ({ source: "/:path*", has: [exactly(name)], destination: everywhere(canonical), permanent: false })),
      ),
      ...custom.map(({ slug, canonical }) => ({
        source: `/s/${slug}/:path*`,
        destination: everywhere(canonical),
        permanent: false,
      })),
      {
        source: "/:path*",
        // Kaizen itself on the domain (trying it on localhost) keeps it; `www.` still goes.
        has: [{ type: "host", value: new URL(platformUrl).hostname === hostname ? `www\\.${host}` : `(?:www\\.)?${host}` }],
        destination: `${platformUrl}/:path*`,
        permanent: false,
      },
      {
        source: "/s/:store/:path*",
        missing: [storeHost],
        destination: `${scheme}://:store.${domain}/:path*`,
        permanent: true,
      },
    ],
    // Rewrites before files apply in turn, each to the path the one before left: the front door
    // comes last, so its `/s/{store}` is not rewritten again.
    rewrites: [
      { source: `/:path((?!${SHARED}).+)`, has: [storeHost], destination: "/s/:store/:path" },
      ...custom.flatMap(({ slug, served }) =>
        served.map((name) => ({ source: `/:path((?!${SHARED}).+)`, has: [exactly(name)], destination: `/s/${slug}/:path` })),
      ),
      { source: "/", has: [storeHost], destination: "/s/:store" },
      ...custom.flatMap(({ slug, served }) => served.map((name) => ({ source: "/", has: [exactly(name)], destination: `/s/${slug}` }))),
    ],
  };
}
