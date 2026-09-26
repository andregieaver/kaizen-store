import { describe, expect, it } from "vitest";

import {
  THEME_TEMPLATE_KEYS,
  contrastRatio,
  darkBehindLogo,
  parseStoreTheme,
  templateSettings,
  themeAttributes,
  themeCss,
  themeSettingsSchema,
  themeWarnings,
} from "./theme";

describe("design themes (D60)", () => {
  it("has templates that are valid and readable in both colour sets", () => {
    for (const key of THEME_TEMPLATE_KEYS) {
      const settings = templateSettings(key);
      expect(themeSettingsSchema.parse(settings)).toEqual(settings);
      expect(themeWarnings({ ...settings, mode: "auto" }), key).toEqual([]);
    }
  });

  it("keeps the demo store's look as Minimal", () => {
    const minimal = templateSettings("minimal");
    expect(minimal.mode).toBe("auto");
    expect(minimal.light).toMatchObject({ background: "#ffffff", text: "#171717", surface: "#f5f5f4" });
    expect(minimal.dark).toMatchObject({ background: "#0a0a0a", text: "#ededed" });
    expect(minimal.buttons).toEqual({ style: "filled", corners: "pill" });
  });

  it("has Bold modern: a black header, square corners, spaced capitals and a bright accent", () => {
    const bold = templateSettings("bold");
    expect(bold.layout).toMatchObject({ headerBackground: "inverse", width: "wide" });
    expect(bold.buttons.corners).toBe("square");
    expect(bold.corners).toEqual({ cards: "none", fields: "none" });
    expect(bold.headings).toEqual({ weight: "bold", case: "upper" });
    expect(bold.fonts).toEqual({ heading: "Archivo", body: "Inter" });
    const css = themeCss(bold, "x");
    expect(css).toContain("--button-radius: 0; --radius-lg: 0; --radius-md: 0; --content-width: 80rem");
    expect(css).toContain("--heading-weight: 700");
    expect(themeAttributes(bold)["data-heading-case"]).toBe("upper");
  });

  it("reads a stored theme over its template, and falls back when it is damaged", () => {
    expect(parseStoreTheme(null)).toEqual({ base: "minimal", savedId: null, settings: templateSettings("minimal") });
    // Fonts saved before themes (D59) are kept; the rest comes from Minimal.
    const withFonts = parseStoreTheme({ settings: { fonts: { heading: "Lora" } } });
    expect(withFonts.settings.fonts).toEqual({ heading: "Lora" });
    expect(withFonts.settings.light.background).toBe("#ffffff");
    const warm = parseStoreTheme({ base: "warm", settings: { light: { accent: "#123456" } } });
    expect(warm.settings.light).toMatchObject({ accent: "#123456", background: "#faf6ef" });
    expect(parseStoreTheme({ base: "warm", settings: { light: { accent: "red; }" } } }).settings).toEqual(templateSettings("warm"));
    expect(parseStoreTheme({ base: "gothic" }).base).toBe("minimal");
    expect(parseStoreTheme({ savedId: "not-an-id" }).savedId).toBeNull();
  });

  it("turns settings into CSS variables, by the visitor's device or one colour set", () => {
    const warm = templateSettings("warm");
    const auto = themeCss({ ...warm, mode: "auto" }, "html[data-store-theme]");
    expect(auto).toContain("html[data-store-theme] { color-scheme: light; --background: #faf6ef;");
    expect(auto).toContain("--accent: #a84a26; --accent-foreground: #fffaf3");
    expect(auto).toContain("--button-radius: 0.375rem; --radius-lg: 0.25rem; --radius-md: 0.375rem; --content-width: 64rem; --card-aspect: 3 / 4; --heading-weight: 600");
    expect(auto).toContain("@media (prefers-color-scheme: dark) { html[data-store-theme] { color-scheme: dark; --background: #1c1612;");
    const light = themeCss(warm, "x");
    expect(light).not.toContain("@media");
    expect(themeCss(warm, "x", "dark")).toContain("--background: #1c1612");
    expect(themeAttributes(warm)).toEqual({
      "data-store-theme": "",
      "data-button-style": "filled",
      "data-heading-case": "normal",
      "data-card-style": "bordered",
      "data-card-align": "center",
    });
  });

  it("measures contrast as WCAG does, and names the pairs that are hard to read", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1);
    const pale = { ...templateSettings("minimal"), mode: "light" as const };
    pale.light = { ...pale.light, muted: "#cccccc" };
    expect(themeWarnings(pale)).toEqual([expect.stringMatching(/^Secondary text on the background in the light colours is hard to read/)]);
  });

  it("knows where a logo sits on a dark background, by device and theme", () => {
    // Minimal follows the device: dark behind the logo only in dark mode.
    expect(darkBehindLogo(templateSettings("minimal"), "header")).toEqual({ light: false, dark: true });
    // Warm classic is always light.
    expect(darkBehindLogo(templateSettings("warm"), "header")).toEqual({ light: false, dark: false });
    // Bold modern's inverted header is black in light mode and light in dark mode; its page the other way round.
    expect(darkBehindLogo(templateSettings("bold"), "header")).toEqual({ light: true, dark: false });
    expect(darkBehindLogo(templateSettings("bold"), "page")).toEqual({ light: false, dark: true });
    const accentHeader = { ...templateSettings("warm"), layout: { ...templateSettings("warm").layout, headerBackground: "accent" as const } };
    expect(darkBehindLogo(accentHeader, "header")).toEqual({ light: true, dark: true });
  });
});
