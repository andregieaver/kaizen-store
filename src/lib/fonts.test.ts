import { describe, expect, it } from "vitest";

import rows from "./fonts/google-fonts.json";
import { catalogFont, fontClass, fontSlug, fontStack, FONT_FAMILY, FONT_SLUG, installedStyles, latinUprightFile, type CatalogRow } from "./fonts";
import { parseSiteFonts } from "./fonts-schema";

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

  it("gives every family name an address the stylesheet route answers, and nothing else one", () => {
    // The route answers each with a stylesheet, empty when none is installed, so a streamed boundary never waits on a failure.
    for (const [family] of rows as CatalogRow[]) expect(FONT_SLUG.test(fontSlug(family))).toBe(true);
    for (const family of ["A", "Noto Sans JP ", "x".repeat(100), "Two  Spaces"]) {
      expect(FONT_FAMILY.test(family)).toBe(true);
      expect(FONT_SLUG.test(fontSlug(family))).toBe(true);
    }
    for (const slug of ["", "-lato", "Lato", "lato;color:red", "../lato", "x".repeat(101)]) expect(FONT_SLUG.test(slug)).toBe(false);
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

  it("finds the one file a family draws upright Latin text from, to preload, and none when each weight has its own", () => {
    const face = (subset: string, style: string, weight: number, file: string) =>
      `/* ${subset} */\n@font-face { font-family: 'Inter'; font-style: ${style}; font-weight: ${weight}; font-display: swap; src: url(/api/fonts/files/${file}.woff2) format('woff2'); unicode-range: U+0000-00FF; }`;
    const a = "a".repeat(32);
    const b = "b".repeat(32);
    const c = "c".repeat(32);
    const d = "d".repeat(32);
    // A variable family: every upright weight in one file, italics and other scripts in others.
    const variable = [face("latin-ext", "normal", 400, d), face("latin", "italic", 400, c), ...[400, 500, 600, 700].map((w) => face("latin", "normal", w, a))].join("\n");
    expect(latinUprightFile(`${variable}\n.kf-inter { font-family: "Inter", sans-serif; }`)).toBe(`/api/fonts/files/${a}.woff2`);
    // A file per weight: which one a page draws first is not known.
    expect(latinUprightFile([face("latin", "normal", 400, a), face("latin", "normal", 700, b)].join("\n"))).toBeNull();
    // Only italics, or no Latin at all: nothing to preload.
    expect(latinUprightFile(face("latin", "italic", 400, c))).toBeNull();
    expect(latinUprightFile(face("cyrillic", "normal", 400, a))).toBeNull();
    expect(latinUprightFile("/* Not installed: the fallback font shows. */\n")).toBeNull();
  });
});
