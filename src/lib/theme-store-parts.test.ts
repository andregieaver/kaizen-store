import { describe, expect, it } from "vitest";

import { THEME_PAGE_PARTS, THEME_STORE_PART_COPY, THEME_STORE_PARTS, themePartDraws, themePartsWith, withThemeName } from "./theme-store-parts";

/** The theme store's components (D285): which draw where, and which have something for a theme. */
describe("the theme store's parts", () => {
  it("name every part, and give a theme's page every part but the list", () => {
    for (const part of THEME_STORE_PARTS) expect(THEME_STORE_PART_COPY[part].name, part).toBeTruthy();
    expect(THEME_PAGE_PARTS).toEqual(THEME_STORE_PARTS.filter((part) => part !== "list"));
  });

  it("draw the list anywhere, and a theme's parts only for a theme the address names", () => {
    expect(themePartDraws("list", {})).toBe(true);
    expect(themePartDraws("stage", {})).toBe(false);
    expect(themePartDraws("stage", { themeSlug: "calm" })).toBe(true);
    // The route says which parts have something for the theme; the others are left out.
    expect(themePartDraws("highlights", { themeSlug: "calm", themeParts: ["stage", "features"] })).toBe(false);
    expect(themePartDraws("features", { themeSlug: "calm", themeParts: ["stage", "features"] })).toBe(true);
  });

  it("know a theme without highlights, pictures or features has nothing for those parts, and count See it live as drawn", () => {
    const bare = { highlights: [], pictureUrl: null, listing: { pictures: [] }, features: [] };
    expect(themePartsWith(bare)).toEqual(["list", "stage", "live", "details"]);
    expect(themePartsWith({ ...bare, highlights: [{}], listing: { pictures: ["/a.webp"] }, features: ["dark"] })).toEqual([...THEME_STORE_PARTS]);
    expect(themePartsWith({ ...bare, pictureUrl: "/own.webp" })).toContain("pictures");
  });

  it("put the theme's name where a line says {theme}", () => {
    expect(withThemeName("Stores wearing {theme}.", "Calm")).toBe("Stores wearing Calm.");
  });
});
