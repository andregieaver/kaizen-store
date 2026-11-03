/**
 * The docs portal's own address (wave 14 unit E1, D442): `docs.kaizenaflow.com`, set as `NEXT_PUBLIC_DOCS_HOST` and read when building, as
 * the theme store's host is (D249, `src/lib/theme-host.ts`). Nothing depends on it: without it the docs are at `/docs` (English) and
 * `/no/docs` (Norwegian, the owners' track only) on Kaizena Flow's own site, which is also how they run locally and before the DNS record.
 *
 * With it, routing by host (`docsHostRoutes()`, in `next.config.ts` beside the theme store's and the stores' rules):
 *
 * - on the host, `/` is the docs' front page, `/owners/…`, `/developers/…`, `/reference/…` (unit E4) and `/changelog` its pages, `/search`
 *   its search (D443), `/no`, `/no/search` and `/no/owners/…` the Norwegian ones, with its own `sitemap.xml`, `robots.txt`, `llms.txt`
 *   and `llms-full.txt`; any other address there goes on to the same address on Kaizena Flow's site (`/pricing`, `/admin`), and the API,
 *   Next.js's files and `public` answer as on every host (the feedback and search routes are under `/api/docs/`, which is why no docs page
 *   is ever under `/api`);
 * - on Kaizena Flow's own host, `/docs/…` and `/no/docs/…` move there for good (308).
 *
 * Every page also answers as plain Markdown at its address plus `.md` (for AI tools and people who want the source): a rewrite on every host
 * sends `/docs/{page}.md` to the route `/docs/md/{page}` (`/docs/md/no/{page}` for Norwegian), so no page segment has to end in `.md`.
 *
 * Links are built with `docsPath()` (a path on whichever host serves the docs), `docsUrl()` (a full address: canonical, sitemap, llms.txt)
 * and `docsSiteHref()` (a link to Kaizena Flow's own site, full on the host).
 */

import { PLATFORM_LANG_FACTS, type PlatformLang } from "./platform-lang";
import { siteUrl } from "./site";

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::\d{2,5})?$/;

/** The docs' host (with a port only where one is used), or null while they have none. */
export function docsHost(): string | null {
  const value = process.env.NEXT_PUBLIC_DOCS_HOST?.trim().toLowerCase();
  if (!value) return null;
  if (!HOST.test(value)) throw new Error(`NEXT_PUBLIC_DOCS_HOST must be a host name such as docs.kaizenaflow.com, not "${value}".`);
  return value;
}

const local = (host: string) => /^(?:[^:]+\.)?localhost(?::\d+)?$/.test(host);

/** `https://docs.kaizenaflow.com` (plain http on localhost), or null. */
export function docsOrigin(host = docsHost()): string | null {
  return host ? `${local(host) ? "http" : "https"}://${host}` : null;
}

/** Whether a request's `Host` header is the docs' own host. */
export function isDocsHost(host: string | null | undefined, docs = docsHost()): boolean {
  return Boolean(docs && host && host.toLowerCase() === docs);
}

/**
 * A path in the docs, as the page serving it links: `""` is the docs' front page, `"owners/getting-started/create-your-store"` a page,
 * `"#on-this-page"` or `"?q=x"` the front page with it. On their own host the docs are the root; without one they are under `/docs`. Norwegian
 * puts its prefix first (`/no/docs`, `/no` on the host).
 */
export function docsPath(sub = "", lang: PlatformLang = "en"): string {
  const prefix = lang === "en" ? "" : `/${PLATFORM_LANG_FACTS[lang].prefix}`;
  const base = docsHost() ? prefix : `${prefix}/docs`;
  if (sub === "" || sub.startsWith("?") || sub.startsWith("#")) return `${base || "/"}${sub}`;
  return `${base}/${sub}`;
}

/** A full address in the docs: canonical addresses, the sitemap, llms.txt. */
export function docsUrl(sub = "", lang: PlatformLang = "en"): string {
  return `${docsOrigin() ?? siteUrl()}${docsPath(sub, lang)}`;
}

/** A page's plain Markdown (`….md`); the front page has none. */
export function docsMarkdownPath(sub: string, lang: PlatformLang = "en"): string {
  return `${docsPath(sub, lang)}.md`;
}

/** A link from the docs to Kaizena Flow's own site (the status page, sign-up, the admin): full while the docs have their own host. */
export function docsSiteHref(path: string): string {
  return docsHost() ? `${siteUrl()}${path}` : path;
}

type Match = { type: "host"; value: string };
export type DocsHostRedirect = { source: string; destination: string; permanent: boolean; has?: Match[] };
export type DocsHostRewrite = { source: string; destination: string; has?: Match[] };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Served on every host, as on a store's (`SHARED` in `store-hosts.ts`): Next.js's files, the API and `public`. */
const SHARED = "(?:_next|api|demo|kaizen)/";

/** The docs' tracks and lists at the host's root (`/owners/…`); `reference` is the generated reference's (unit E4). */
const TRACKS = "owners|developers|reference";

/** The host's own files. */
const FILES = "sitemap\\.xml|robots\\.txt|llms\\.txt|llms-full\\.txt";

/** Every address the docs' host serves itself (after the leading slash); anything else there is Kaizena Flow's own. */
const OWN = `(?:${TRACKS})(?:/|$)|changelog(?:\\.md)?$|(?:${FILES})$|search$|no$|no/search$|no/owners(?:/|$)`;

/** A page's Markdown twin, on every host: the route `/docs/md/…` answers it (a page segment cannot end in `.md`). */
const MARKDOWN: DocsHostRewrite[] = [
  { source: "/docs/:page(.+)\\.md", destination: "/docs/md/:page" },
  { source: "/no/docs/:page(.+)\\.md", destination: "/docs/md/no/:page" },
];

export function docsHostRoutes(host: string | null, platformUrl: string): { redirects: DocsHostRedirect[]; rewrites: DocsHostRewrite[] } {
  if (!host) return { redirects: [], rewrites: MARKDOWN };
  const origin = docsOrigin(host) as string;
  const onHost: Match = { type: "host", value: escape(host.replace(/:\d+$/, "")) };
  const onPlatform: Match = { type: "host", value: escape(new URL(platformUrl).hostname) };
  return {
    redirects: [
      // Kaizena Flow's own addresses of the docs move to their host, for good; only on Kaizena Flow's host (a store's `/docs` is its own).
      { source: "/docs", has: [onPlatform], destination: `${origin}/`, permanent: true },
      { source: "/docs/:path+", has: [onPlatform], destination: `${origin}/:path+`, permanent: true },
      { source: "/no/docs", has: [onPlatform], destination: `${origin}/no`, permanent: true },
      { source: "/no/docs/:path+", has: [onPlatform], destination: `${origin}/no/:path+`, permanent: true },
      // On the host, an address that is not the docs' is Kaizena Flow's own (pricing, the admin, the blog).
      { source: `/:path((?!${SHARED}|${OWN}).+)`, has: [onHost], destination: `${platformUrl}/:path`, permanent: false },
    ],
    // Rewrites before files apply in turn, each to the path the one before left: each source here names the host's own addresses only, so
    // none takes another's result, and the Markdown twins come last (`/owners/x.md` is `/docs/owners/x.md`, then `/docs/md/owners/x`).
    rewrites: [
      { source: "/", has: [onHost], destination: "/docs" },
      { source: `/:path((?:${TRACKS}|changelog|${FILES})(?:/.*|\\.md)?)`, has: [onHost], destination: "/docs/:path" },
      // The search page (D443), its filters in the query, which a rewrite keeps.
      { source: "/search", has: [onHost], destination: "/docs/search" },
      { source: "/no", has: [onHost], destination: "/no/docs" },
      { source: "/no/search", has: [onHost], destination: "/no/docs/search" },
      { source: "/no/:path(owners(?:/.*)?)", has: [onHost], destination: "/no/docs/:path" },
      ...MARKDOWN,
    ],
  };
}
