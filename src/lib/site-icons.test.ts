import { describe, expect, it } from "vitest";

import { faviconRedirect, KAIZEN_ICON, siteIcons } from "./site-icons";

describe("sites' icons (D62)", () => {
  const favicon = { url: "https://cdn.example/icon.png", smallUrl: "https://cdn.example/icon-480.png" };

  it("gives a site's own icons, small for tabs and large for home screens, or Kaizen's", () => {
    expect(siteIcons(null)).toEqual({ icon: KAIZEN_ICON });
    expect(siteIcons(favicon)).toEqual({
      icon: [
        { url: favicon.smallUrl, type: "image/png", sizes: "64x64" },
        { url: favicon.url, type: "image/png", sizes: "512x512" },
      ],
      apple: [{ url: favicon.url, sizes: "512x512" }],
    });
  });

  it("leads /favicon.ico to the small icon, or Kaizen's", () => {
    expect(faviconRedirect(favicon).headers.get("Location")).toBe(favicon.smallUrl);
    expect(faviconRedirect(null).headers.get("Location")).toBe(KAIZEN_ICON);
    expect(faviconRedirect(null).status).toBe(302);
  });
});
