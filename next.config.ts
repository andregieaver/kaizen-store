import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

import { baseRouteHeaders, oauthRouteHeaders, payRouteHeaders, PUBLIC_FILE_HEADERS, replayRouteHeaders } from "./src/lib/csp";
import { storeDomain, storeHosts } from "./src/lib/paths";
import { siteUrl } from "./src/lib/site";
import { embedFrameHeaders } from "./src/lib/support-embed";
import { storeHostRoutes } from "./src/lib/store-hosts";
import { themeHostRoutes, themesHost, themesOrigin } from "./src/lib/theme-host";
import { docsHost, docsHostRoutes } from "./src/lib/docs-host";
import { readStoreHosts } from "./src/lib/store-hosts-build";

const CHROMIUM_FILES = [
  "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
  "./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/{browsers,package}.json",
];

// The documents' PDFs draw with Chromium; their HTML is written by `staticMarkup()`, which needs no package from disk (D695, 19 November 2026).
const DOCUMENT_PDF_FILES = [...CHROMIUM_FILES];

// The docs' content (D442): every article, the sections' titles and the list of Norwegian pages still to write.
const DOCS_FILES = ["./content/docs/**/*"];

// HarfBuzz's subsetter, which `subset-font` reads from disk at run time, for the dispatcher's font trimmer (`src/server/font-trim.ts`).
const HARFBUZZ_FILES = ["./node_modules/.pnpm/harfbuzzjs@*/node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm"];

/**
 * Vercel's build machine has 8 GB, and the build outgrew it from 27 October 2026: the type check needs a 5 GB heap of its own since
 * the admin's catalogues were typed (D312), Turbopack's compile holds up to 7 GB, and the workers that collect and render pages start
 * before it lets go. Each setting that reads this was measured under an 8 GB cap (`docs/build-memory.md`).
 */
const ON_VERCEL = Boolean(process.env.VERCEL);
/**
 * Vercel's own 8 GB machine. `vercel build` sets VERCEL on a GitHub runner too (bloat review step 1.29: the production build made in CI and
 * deployed prebuilt), and the runner has room, so the limits that only save memory follow the machine; what the deployment holds does not.
 */
const TIGHT_MACHINE = ON_VERCEL && !process.env.GITHUB_ACTIONS;

/** The build skips its own type check on Vercel (memory, D378) and in CI's browser jobs, which set SKIP_BUILD_TYPECHECK: CI's `static` job and the quick gate run `pnpm typecheck` on the same project on every push (bloat review step 0.38). A local `pnpm build` checks as ever. */
const SKIP_TYPECHECK = ON_VERCEL || process.env.SKIP_BUILD_TYPECHECK === "1";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Next renders every page per request, static ones included, for user agents on this list, so their metadata is in the head. Our prerendered pages already hold title and description in the head (scripts/render-modes.mjs checks it), so the list keeps only link-preview fetchers, which never run scripts and come once per shared link. Bing, Apple, Yandex, Google's shop and ads fetchers and Meta's catalogue then get the cached page, as Googlebot always has (bloat review step 2.5). Setting it replaces Next's default list (html-bots.js).
  htmlLimitedBots: /facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|redditbot|quora link preview|vkShare|tumblr|bitlybot/i,
  // A recorded choice, not an oversight: unset, Next treats it as false and warns on every build and start. The next major release turns it on
  // for everyone; step 2.8 of docs/audits/bloat-review-2026-11 decides adoption by trial.
  partialPrefetching: false,
  poweredByHeader: false,
  // Pictures are never resized on the server (D336, src/lib/picture-sizes.ts): every next/image is served as stored and /_next/image answers 404 (bloat review step 0.32).
  images: { unoptimized: true },
  // The type check is CI's (`SKIP_TYPECHECK` above); everywhere else `next build` checks as ever.
  typescript: { ignoreBuildErrors: SKIP_TYPECHECK },
  // Read from node_modules at run time, not bundled: `subset-font` finds HarfBuzz's WebAssembly by its path (`HARFBUZZ_FILES`).
  serverExternalPackages: ["subset-font", "fontverter"],
  // Chromium (the cookie scan, D58; the page replicator, D150) is read from disk, not
  // imported, so the trace needs telling; only the routes that launch it carry it.
  outputFileTracingIncludes: {
    // The build writes this file when it ends (scripts/next-build.mjs: seconds, peak memory, the ten builds before) and the health route reads it.
    "/api/health": ["./build-stats.json"],
    // Playwright also reads browsers.json and package.json at run time. The globs name
    // pnpm's own folders: a file under a linked folder would turn the link into a folder.
    "/api/cron/cookie-scan": CHROMIUM_FILES,
    // The photographs of published themes' looks (`docs/theme-showcase-phase-2.md` step 1, `src/server/theme-shot-runner.ts`).
    "/api/cron/theme-shots": CHROMIUM_FILES,
    // Looks at pages by the AI manager and the autopilot (D310, `src/server/page-look-runner.ts`).
    "/api/cron/page-looks": CHROMIUM_FILES,
    // A glob, not the route's name: `[store]` would be read as a set of characters, and the route group
    // `(gated)` is part of the path Turbopack matches. Checked in the build's `.nft.json` for this route.
    "/admin/**/replicate/**/tick": CHROMIUM_FILES,
    // The PDFs of invoices and credit notes (D159, `src/server/invoice-pdf.ts`): the hosted page's and the staff's routes, and the job
    // that makes the missing ones. No other route imports `invoice-pdf.ts` (a source-scan test holds it).
    "/s/**/account/documents/**/pdf": DOCUMENT_PDF_FILES,
    "/admin/**/invoices/**/pdf": DOCUMENT_PDF_FILES,
    "/api/cron/document-pdfs": DOCUMENT_PDF_FILES,
    // A contract's page sends it for signing, drawing its PDF there (D695 step 3, `contract-send-actions.ts`); a glob, as the replicate route's.
    "/admin/**/deals/**/contracts/**": DOCUMENT_PDF_FILES,
    // The standard product taxonomy (D327, `src/server/product-taxonomy.ts`) is read from disk, not imported (the type checker would type
    // its 100,000 entries): the product editor, imports, listings, feeds and the AI manager's tools all read it, so every route carries it.
    "/**": ["./src/data/product-taxonomy/*"],
    // The docs' articles (D442, `src/server/docs.ts`) are Markdown files read from disk when the docs are built: every docs page is
    // prerendered, but an address not built (a 404, a page asked for before its build) and the routes below read them at run time. The
    // keys are globs over the route's path with its groups (`/(docs)/docs/…`, `/(docs-nb)/no/docs/…`, `/api/docs/feedback`, the admin's).
    "/**/docs": DOCS_FILES,
    "/**/docs/**": DOCS_FILES,
    // The five-minute dispatcher writes the docs' search index from the same files after a deploy that changed them (D443), and cuts
    // self-hosted fonts to their families' weights with HarfBuzz (D59).
    "/api/cron/cart-reminders": [...DOCS_FILES, ...HARFBUZZ_FILES],
  },
  experimental: {
    // On Vercel, Turbopack without its build cache (its compile held 7.2 GB with it, 5.8 GB without) and one worker for the pages
    // (each holds about 1.3 GB, and the first starts while the compile's memory is still held). And without source maps (D709): the
    // compile had grown to 7.5 GB by 17 November 2026 and 6.3 GB without them. Production never reads the server's maps (Node runs
    // without --enable-source-maps; Next turns them on only for its debug prerender) and the browser's were never made.
    // And without the server bundle's source maps (`serverSourceMaps`, step 1.20): under an 8 GB cap the build peaked at 7.6 to 7.8 GB with
    // them and 6.8 GB without, on 18 November 2026 (docs/build-memory.md). `enablePrerenderSourceMaps: false` gained nothing and is not set.
    // The cache and the one worker only save memory, so they follow the machine that builds (`TIGHT_MACHINE`, step 1.29); the source maps
    // stay off for every Vercel deployment, wherever it is built, so what production runs and logs is the same as before.
    ...(TIGHT_MACHINE ? { turbopackFileSystemCacheForBuild: false, cpus: 1 } : {}),
    ...(ON_VERCEL ? { turbopackSourceMaps: false, turbopackInputSourceMaps: false, serverSourceMaps: false } : {}),
    // Market pages each have their own root layout, so the 404 page is global.
    globalNotFound: true,
    // Product pictures are uploaded through a server action. The browser
    // shrinks them first, so this is headroom, kept under Vercel's 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
    // Next guesses a link's route tree from a route of the same shape; the guess never fills the `rest` param of the `@drawer/[...rest]` slot (the TODO
    // "This should never happen. Bail out with null" in next/dist/client/components/segment-cache/optimistic-routes.js), so the slot's segment is asked
    // for without end at /s/{store} addresses (about 165 requests a second). Remove this line when that TODO is fixed upstream and
    // e2e/prefetch.spec.ts 'a store page goes quiet' passes without it.
    optimisticRouting: false,
  },
};

export default async function config(phase: string): Promise<NextConfig> {
  // Stores on their own hosts once the store domain is set (P7), and on domains of their own (P8):
  // read when building, and built into the deployment's routing and its code together.
  const building = phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER;
  const hosts = storeDomain() && building ? await readStoreHosts() : storeHosts();
  const routes = storeHostRoutes(storeDomain(), siteUrl(), hosts, [themesHost(), docsHost()]);
  // The theme store on its own host (docs/theme-phase-3.md step 3): before the stores' rules, which leave its host alone.
  const themes = themeHostRoutes(themesHost(), siteUrl());
  // The docs on their own host (D442), as the theme store's; their Markdown twins (`….md`) on every host.
  const docs = docsHostRoutes(docsHost(), siteUrl());
  return {
    ...nextConfig,
    ...(building ? { env: { NEXT_PUBLIC_STORE_HOSTS: JSON.stringify(hosts) } } : {}),
    // `nosniff` and a Report-Only policy everywhere (D389) and frame protection on the admin (PSI 2026-10-24, SEC-07), then a strict Content-Security-Policy on the
    // cart, checkout and order of every store, on both shapes of address (wave 1, 1e, docs/pci.md): later entries win where both match.
    headers: async () => [
      ...baseRouteHeaders(themesOrigin(), { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL }),
      // The recording player (D656): what a replayed page may load, enforced; it repeats the admin's frame-ancestors, which it replaces.
      ...replayRouteHeaders(themesOrigin(), { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL }),
      ...payRouteHeaders({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, vercel: Boolean(process.env.VERCEL) }),
      // The consent screens are framed by nobody (D439).
      ...oauthRouteHeaders(),
      // The chat on an owner's own site (D582): its frame is framed by the page's host alone, which the frame's page checks is the site's.
      ...embedFrameHeaders(),
      // Files in public/ with a fixed address are kept a day (`PUBLIC_FILE_HEADERS`).
      ...PUBLIC_FILE_HEADERS,
    ],
    redirects: async () => [...themes.redirects, ...docs.redirects, ...routes.redirects],
    rewrites: async () => ({ beforeFiles: [...themes.rewrites, ...docs.rewrites, ...routes.rewrites], afterFiles: [], fallback: [] }),
  };
}
