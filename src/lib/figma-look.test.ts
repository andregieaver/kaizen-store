import { describe, expect, it } from "vitest";

import { SAVED_COLOURS_MAX } from "./colour-library";
import { colourRoles, figmaFamilies, figmaLook, fontRoles, isDarkColour, lookFromFigma, textRoles, weightOf, type FigmaColour, type FigmaTextStyle } from "./figma-look";
import { contrastRatio, templateSettings, themeWarnings } from "./theme";

const base = templateSettings("minimal");
const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};
const style = (name: string, color: string): FigmaColour => ({ name, color });
const type = (name: string, size: number, more: Partial<FigmaTextStyle> = {}): FigmaTextStyle => ({ name, family: "Inter", style: "Regular", size, ...more });

describe("a Figma file's colours by their names (D898 F3)", () => {
  it("finds the brand, the page and its text, and passes over states, shades and text on the brand", () => {
    const { light } = colourRoles([
      style("Brand/Primary/Hover", "#0b4f44"),
      style("Primary/Light", "#d7efe9"),
      style("On Primary", "#ffffff"),
      style("Text/Primary", "#1c1c1c"),
      style("Text/Secondary", "#5c5c5c"),
      style("Background/Primary", "#fbf8f3"),
      style("Surface/Primary", "#eeeeee"),
      style("Brand/Primary", "#1f6f5c"),
    ]);
    expect(light.accent?.name).toBe("Brand/Primary");
    expect(light.text?.name).toBe("Text/Primary");
    expect(light.background?.name).toBe("Background/Primary");
  });

  it("reads a variable's dark mode, and a style's Dark group, as the dark palette; a last word Dark is a shade", () => {
    expect(isDarkColour({ name: "color/background", color: "#000000", mode: "Dark" })).toBe(true);
    expect(isDarkColour({ name: "color/background", color: "#ffffff", mode: "Light", main: true })).toBe(false);
    expect(isDarkColour(style("Dark/Background", "#101010"))).toBe(true);
    expect(isDarkColour(style("Primary/Dark", "#0b4f44"))).toBe(false);
  });

  it("takes the most colourful as the brand's colour when none is named for it", () => {
    const roles = colourRoles([style("Error/500", "#e11d1d"), style("Grey/100", "#f4f4f4"), style("Sea", "#1d6fb8"), style("Moss", "#6b8f5e"), style("Ink", "#111111")]);
    expect(roles.light.accent?.name).toBe("Sea");
    expect(roles.guessedAccent).toBe(true);
  });
});

describe("a Figma file's text styles", () => {
  it("gives each heading level, the paragraph and the button its style, by name and then by size", () => {
    const roles = textRoles([
      type("Display", 72, { style: "Bold" }),
      type("Heading/Large", 48, { style: "Semi Bold" }),
      type("Heading/Small", 28),
      type("H2", 40),
      type("Body/Small", 14),
      type("Body/Regular", 16),
      type("Body/Bold", 16, { style: "Bold" }),
      type("Button/Label", 15, { style: "Medium", upper: true }),
      type("Caption", 12),
    ]);
    expect(roles.h1?.name).toBe("Display");
    expect(roles.h2?.name).toBe("H2");
    expect(roles.h3?.name).toBe("Heading/Large");
    expect(roles.h4?.name).toBe("Heading/Small");
    expect(roles.p?.name).toBe("Body/Regular");
    expect(roles.list?.name).toBe("Body/Regular");
    expect(roles.button?.name).toBe("Button/Label");
  });

  it("reads a style's weight from its name", () => {
    expect([weightOf("Regular"), weightOf("Semi Bold Italic"), weightOf("ExtraBold"), weightOf("Light"), weightOf("Black"), weightOf("Bold"), weightOf("Medium")]).toEqual([
      400, 600, 800, 300, 900, 700, 500,
    ]);
  });

  it("names the heading's and the body's typefaces, the heading's first", () => {
    const text = [type("H1", 56, { family: "Fraunces", style: "Bold" }), type("Body", 16, { family: "Work Sans" })];
    expect(fontRoles(text)).toMatchObject({ heading: { family: "Fraunces" }, body: { family: "Work Sans" } });
    expect(figmaFamilies(figmaLook.parse({ colours: [], text }))).toEqual(["Fraunces", "Work Sans"]);
  });
});

describe("the look from a Figma file", () => {
  const colours = [
    style("Brand/Primary", "#7fd1b9"),
    style("Background/Default", "#f7f3ea"),
    // Pale text on a pale page: the look makes it readable.
    style("Text/Default", "#b5b0a8"),
    { name: "bg/page", color: "#14110f", mode: "Dark" },
    { name: "text/default", color: "#d8d2c8", mode: "Dark" },
  ];
  const text = [
    type("H1", 64, { family: "Fancy Grotesk", style: "Bold", line: 72, tracking: -1.28 }),
    type("Heading/2", 40, { family: "Fancy Grotesk", style: "Semi Bold" }),
    type("Body", 17, { family: "Work Sans", line: 26 }),
    type("Button", 15, { family: "Work Sans", style: "Medium", upper: true }),
  ];
  const fonts = new Map<string, string | null>([
    ["Fancy Grotesk", "Space Grotesk"],
    ["Work Sans", "Work Sans"],
  ]);

  it("is readable in both palettes, its own page colours given, and both modes followed", () => {
    const { settings, found } = lookFromFigma(figmaLook.parse({ colours, text }), base, fonts, ids());
    expect(themeWarnings({ ...settings, visitorSwitch: true })).toEqual([]);
    expect(settings.mode).toBe("auto");
    expect(settings.light.background).toBe("#f7f3ea");
    expect(settings.dark.background).toBe("#14110f");
    expect(contrastRatio(settings.light.text, settings.light.background)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(settings.light.accentText, settings.light.accent)).toBeGreaterThanOrEqual(4.5);
    expect(found).toMatchObject({ accent: { name: "Brand/Primary", guessed: false }, dark: true, heading: "Space Grotesk", body: "Work Sans" });
  });

  it("lays the text styles into the theme's elements with the installed typefaces, smaller on smaller screens", () => {
    const { settings } = lookFromFigma(figmaLook.parse({ colours, text }), base, fonts, ids());
    expect(settings.fonts).toEqual({ heading: "Space Grotesk", body: "Work Sans" });
    expect(settings.headings).toEqual({ weight: "bold", case: "normal" });
    const h1 = settings.elements?.h1;
    expect(h1?.typography?.text).toEqual({ family: "Space Grotesk", weight: 700, size: { value: 64, unit: "px" }, lineHeight: { value: 72, unit: "px" }, letterSpacing: { value: -1.28, unit: "px" } });
    expect(h1?.at?.md?.typography?.text).toEqual({ size: { value: 51, unit: "px" }, lineHeight: { value: 57, unit: "px" } });
    expect(h1?.at?.sm?.typography?.text).toEqual({ size: { value: 38, unit: "px" }, lineHeight: { value: 43, unit: "px" } });
    expect(settings.elements?.p?.typography?.text).toMatchObject({ family: "Work Sans", size: { value: 17, unit: "px" } });
    expect(settings.elements?.p?.at).toBeUndefined();
    expect(settings.elements?.button?.typography?.text).toMatchObject({ weight: 500, transform: "uppercase" });
  });

  it("saves each colour once, a dark mode's named so, and counts what a full library leaves out", () => {
    const { settings, found } = lookFromFigma(figmaLook.parse({ colours: [...colours, style("Brand/Primary", "#7fd1b9")], text: [] }), base, fonts, ids());
    expect(settings.library?.colours.map((c) => c.name)).toEqual(["Brand/Primary", "Background/Default", "Text/Default", "bg/page (dark)", "text/default (dark)"]);
    expect(found.saved).toBe(5);
    const many = Array.from({ length: SAVED_COLOURS_MAX + 3 }, (_, i) => style(`Scale/${i}`, `#${(i * 5).toString(16).padStart(2, "0")}4466`));
    expect(lookFromFigma(figmaLook.parse({ colours: many, text: [] }), base, fonts, ids()).found.left).toBe(3);
  });

  it("keeps the base's palettes when the file names no colour for the brand, the page or its text, and its fonts when it has no text styles", () => {
    const { settings } = lookFromFigma(figmaLook.parse({ colours: [style("Grey/100", "#f4f4f4")], text: [] }), base, fonts, ids());
    expect(settings.light).toEqual(base.light);
    expect(settings.dark).toEqual(base.dark);
    expect(settings.fonts).toEqual(base.fonts);
  });

  it("refuses what is not a file's colours and type", () => {
    expect(figmaLook.safeParse({ colours: [{ name: "x", color: "red" }], text: [] }).success).toBe(false);
    expect(figmaLook.safeParse({ colours: [], text: [{ name: "H1", family: "Inter", size: 9000 }] }).success).toBe(false);
  });
});
