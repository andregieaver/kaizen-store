import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  experimental: {
    // Market pages each have their own root layout, so the 404 page is global.
    globalNotFound: true,
  },
};

export default nextConfig;
