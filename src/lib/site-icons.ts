import type { Metadata } from "next";

import type { Favicon } from "./navigation";

/** Kaizen's own icon, on every host (it is in `public/kaizen`, which store hosts share). */
export const KAIZEN_ICON = "/kaizen/favicon.ico";

/**
 * A site's icons for its pages' head (D62): the owner's, small for tabs and
 * large for home screens, or Kaizen's without one.
 */
export function siteIcons(favicon: Favicon | null): NonNullable<Metadata["icons"]> {
  if (!favicon) return { icon: KAIZEN_ICON };
  return {
    icon: [
      { url: favicon.smallUrl, type: "image/png", sizes: "64x64" },
      { url: favicon.url, type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: favicon.url, sizes: "512x512" }],
  };
}

/** Where `/favicon.ico` leads, for browsers that ask for it without reading the page. */
export function faviconRedirect(favicon: Favicon | null): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: favicon?.smallUrl ?? KAIZEN_ICON, "Cache-Control": "public, max-age=3600" },
  });
}
