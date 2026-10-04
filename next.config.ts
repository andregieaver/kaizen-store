import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

import { payRouteHeaders } from "./src/lib/csp";
import { storeDomain, storeHosts } from "./src/lib/paths";
import { siteUrl } from "./src/lib/site";
import { LEGACY_WORK_REDIRECTS } from "./src/lib/work-paths";
import { storeHostRoutes } from "./src/lib/store-hosts";
import { readStoreHosts } from "./src/lib/store-hosts-build";

const CHROMIUM_FILES = [
  "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
  "./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/{browsers,package}.json",
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  // Chromium (the cookie scan, D58; the page replicator, D150) is read from disk, not
  // imported, so the trace needs telling; only the routes that launch it carry it.
  outputFileTracingIncludes: {
    // Playwright also reads browsers.json and package.json at run time. The globs name
    // pnpm's own folders: a file under a linked folder would turn the link into a folder.
    "/api/cron/cookie-scan": CHROMIUM_FILES,
    // A glob, not the route's name: `[store]` would be read as a set of characters, and the route group
    // `(gated)` is part of the path Turbopack matches. Checked in the build's `.nft.json` for this route.
    "/admin/**/replicate/**/tick": CHROMIUM_FILES,
  },
  experimental: {
    // Market pages each have their own root layout, so the 404 page is global.
    globalNotFound: true,
    // Product pictures are uploaded through a server action. The browser
    // shrinks them first, so this is headroom, kept under Vercel's 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default async function config(phase: string): Promise<NextConfig> {
  // Stores on their own hosts once the store domain is set (P7), and on domains of their own (P8):
  // read when building, and built into the deployment's routing and its code together.
  const building = phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER;
  const hosts = storeDomain() && building ? await readStoreHosts() : storeHosts();
  const routes = storeHostRoutes(storeDomain(), siteUrl(), hosts);
  return {
    ...nextConfig,
    ...(building ? { env: { NEXT_PUBLIC_STORE_HOSTS: JSON.stringify(hosts) } } : {}),
    // A strict Content-Security-Policy on the cart, checkout and order of every store, on both shapes of address (wave 1, 1e, docs/pci.md).
    headers: async () => payRouteHeaders({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, vercel: Boolean(process.env.VERCEL) }),
    // Work moved to the owner's level (D123): its old store-level addresses go to the new ones.
    redirects: async () => [...LEGACY_WORK_REDIRECTS, ...routes.redirects],
    rewrites: async () => ({ beforeFiles: routes.rewrites, afterFiles: [], fallback: [] }),
  };
}
