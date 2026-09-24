import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  experimental: {
    // Market pages each have their own root layout, so the 404 page is global.
    globalNotFound: true,
    // Product pictures are uploaded through a server action. The browser
    // shrinks them first, so this is headroom, kept under Vercel's 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
