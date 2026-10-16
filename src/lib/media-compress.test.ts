import { describe, expect, it } from "vitest";

import { compressPlan, keepsOriginal } from "./media-compress";

const file = (over: Partial<Parameters<typeof compressPlan>[0]> = {}) => ({
  kind: "image" as const,
  contentType: "image/webp",
  compressedAt: null,
  uses: [{ source: "page" }],
  ...over,
});

describe("what Compress does with a library file (D213)", () => {
  it("offers a picture used on pages only, as AVIF", () => {
    expect(compressPlan(file())).toEqual({ offered: true, avif: true });
    expect(compressPlan(file({ uses: [{ source: "page" }, { source: "menu" }, { source: "theme" }] }))).toEqual({ offered: true, avif: true });
  });

  it("keeps a picture that leaves the site, or is not used yet, a WebP", () => {
    expect(compressPlan(file({ uses: [{ source: "page" }, { source: "product" }] }))).toEqual({ offered: true, avif: false });
    expect(compressPlan(file({ uses: [{ source: "seo" }] }))).toEqual({ offered: true, avif: false });
    expect(compressPlan(file({ uses: [] }))).toEqual({ offered: true, avif: false });
  });

  it("never offers a file compressed already, a GIF, a drawing, or the logo and icon", () => {
    expect(compressPlan(file({ compressedAt: "2026-10-13T08:00:00Z" })).offered).toBe(false);
    expect(compressPlan(file({ contentType: "image/gif" })).offered).toBe(false);
    expect(compressPlan(file({ contentType: "image/svg+xml" })).offered).toBe(false);
    expect(compressPlan(file({ uses: [{ source: "navigation" }] })).offered).toBe(false);
  });

  it("offers a video, never as AVIF", () => {
    expect(compressPlan(file({ kind: "video", contentType: "video/mp4" }))).toEqual({ offered: true, avif: false });
  });

  it("keeps the original in storage where the file left the site", () => {
    expect(keepsOriginal([{ source: "page" }, { source: "menu" }])).toBe(false);
    expect(keepsOriginal([])).toBe(false);
    for (const source of ["product", "seo", "chat", "navigation", "theme_listing"]) expect(keepsOriginal([{ source }])).toBe(true);
  });
});
