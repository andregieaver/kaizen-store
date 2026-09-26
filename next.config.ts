import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  // The cookie scan's Chromium (D58) is read from disk, not imported, so the
  // trace needs telling; only the scan's route carries it.
  outputFileTracingIncludes: {
    // Playwright also reads its own files (browsers.json) at run time.
    "/api/cron/cookie-scan": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/playwright-core/**"],
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
