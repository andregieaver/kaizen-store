import type { NextConfig } from "next";

import { storeDomain } from "./src/lib/paths";
import { siteUrl } from "./src/lib/site";
import { storeHostRoutes } from "./src/lib/store-hosts";

// Stores on their own hosts once the store domain is set (P7).
const hostRoutes = storeHostRoutes(storeDomain(), siteUrl());

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  redirects: async () => hostRoutes.redirects,
  rewrites: async () => ({ beforeFiles: hostRoutes.rewrites, afterFiles: [], fallback: [] }),
  // The cookie scan's Chromium (D58) is read from disk, not imported, so the
  // trace needs telling; only the scan's route carries it.
  outputFileTracingIncludes: {
    // Playwright also reads browsers.json and package.json at run time. The globs name
    // pnpm's own folders: a file under a linked folder would turn the link into a folder.
    "/api/cron/cookie-scan": [
      "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
      "./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/{browsers,package}.json",
    ],
  },
  experimental: {
    // Market pages each have their own root layout, so the 404 page is global.
    globalNotFound: true,
    // Product pictures are uploaded through a server action. The browser
    // shrinks them first, so this is headroom, kept under Vercel's 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
