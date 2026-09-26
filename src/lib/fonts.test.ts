import { describe, expect, it } from "vitest";

import rows from "./fonts/google-fonts.json";
import { catalogFont, fontClass, fontSlug, fontStack, installedStyles, parseSiteFonts, type CatalogRow } from "./fonts";

describe("Google Fonts (D59)", () => {
  it("reads the catalogue, most popular first, with Latin families only", () => {
    const catalog = (rows as CatalogRow[]).map(catalogFont);
    expect(catalog.length).toBeGreaterThan(1000);
    expect(catalog.slice(0, 20).map((f) => f.family)).toContain("Roboto");
    const lora = catalog.find((f) => f.family === "Lora")!;
    expect(lora).toMatchObject({ category: "serif", weights: [400, 500, 600, 700], italics: [400, 500, 600, 700] });
    expect(new Set(catalog.map((f) => f.family)).size).toBe(catalog.length);
  });

  it("names families in addresses and classes, with a fallback of their kind", () => {
    expect(fontSlug("Open Sans")).toBe("open-sans");
    expect(fontClass("Playfair Display SC")).toBe("kf-playfair-display-sc");
    expect(fontStack("Lora", "serif")).toMatch(/^"Lora", ui-serif, .*serif$/);
  });

  it("installs the builder's weights a family has, or its nearest to normal", () => {
    expect(installedStyles({ family: "A", category: "serif", weights: [300, 400, 700, 900], italics: [400, 900] })).toEqual({
      weights: [400, 700],
      italics: [400],
    });
    expect(installedStyles({ family: "B", category: "display", weights: [100, 900], italics: [] })).toEqual({ weights: [100], italics: [] });
  });

  it("reads a site's fonts, dropping what is not a family name", () => {
    expect(parseSiteFonts({ heading: "Lora", body: "Inter" })).toEqual({ heading: "Lora", body: "Inter" });
    expect(parseSiteFonts({ heading: "Lora; }" })).toEqual({});
    expect(parseSiteFonts(null)).toEqual({});
  });
});
