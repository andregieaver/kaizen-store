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
    // The device decides, unless the visitor chose light (D99)…
    expect(auto).toContain(
      '@media (prefers-color-scheme: dark) { html[data-store-theme]:not([data-color-mode="light"], [data-color-mode="light"] *) { color-scheme: dark; --background: #1c1612;',
    );
    // …or dark.
    expect(auto).toContain('html[data-store-theme][data-color-mode="dark"], :where([data-color-mode="dark"]) html[data-store-theme]:not([data-color-mode]) { color-scheme: dark; --background: #1c1612;');
    // Always light: no device's mode, and dark only by the visitor's choice.
    const light = themeCss(warm, "x");
    expect(light).not.toContain("@media");
    expect(light).toMatch(/^x \{ color-scheme: light;/);
    expect(light).toContain('x[data-color-mode="dark"], :where([data-color-mode="dark"]) x:not([data-color-mode]) { color-scheme: dark;');
    // Always dark: light by choice.
    expect(themeCss({ ...warm, mode: "dark" }, "x")).toContain('x[data-color-mode="light"]');
    // The admin's preview shows one set only.
    expect(themeCss(warm, "x", "dark")).toBe(`x { ${themeCss(warm, "x", "dark").slice(4, -2)} }`);
    expect(themeCss(warm, "x", "dark")).toContain("--background: #1c1612");
    expect(themeCss(warm, "x", "dark")).not.toContain("data-color-mode");
    expect(themeAttributes(warm)).toEqual({
      "data-store-theme": "",
      "data-button-style": "filled",
      "data-heading-case": "normal",
      "data-card-style": "bordered",
      "data-card-align": "center",
      // Always light says so, so that `dark:` does not follow the device (D99).
      "data-color-mode": "light",
    });
    expect(themeAttributes({ ...warm, mode: "auto" })).not.toHaveProperty("data-color-mode");
  });

  it("lets visitors choose light or dark only where the owner says so (D99)", () => {
    expect(templateSettings("minimal").visitorSwitch).toBe(false);
    expect(parseStoreTheme({ base: "warm", settings: { visitorSwitch: true } }).settings.visitorSwitch).toBe(true);
    // A store always light warns about its dark colours too once visitors may choose them.
    const pale = { ...templateSettings("warm"), dark: { ...templateSettings("warm").dark, muted: templateSettings("warm").dark.background } };
    expect(themeWarnings(pale)).toEqual([]);
    expect(themeWarnings({ ...pale, visitorSwitch: true })).toEqual([expect.stringMatching(/in the dark colours is hard to read/)]);
  });

  it("measures contrast as WCAG does, and names the pairs that are hard to read", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1);
    const pale = { ...templateSettings("minimal"), mode: "light" as const };
    pale.light = { ...pale.light, muted: "#cccccc" };
    expect(themeWarnings(pale)).toEqual([expect.stringMatching(/^Secondary text on the background in the light colours is hard to read/)]);
  });

  it("knows where a logo sits on a dark background, in the theme's light and dark colours", () => {
    // Minimal: dark behind the logo only in its dark colours.
    expect(darkBehindLogo(templateSettings("minimal"), "header")).toEqual({ light: false, dark: true });
    // Warm classic is always light, but its dark colours show where a visitor chooses dark (D99).
    expect(darkBehindLogo(templateSettings("warm"), "header")).toEqual({ light: false, dark: true });
    // Bold modern's inverted header is black in light mode and light in dark mode; its page the other way round.
    expect(darkBehindLogo(templateSettings("bold"), "header")).toEqual({ light: true, dark: false });
    expect(darkBehindLogo(templateSettings("bold"), "page")).toEqual({ light: false, dark: true });
    const accentHeader = { ...templateSettings("warm"), layout: { ...templateSettings("warm").layout, headerBackground: "accent" as const } };
    // Its accent is dark in its light colours and light in its dark ones.
    expect(darkBehindLogo(accentHeader, "header")).toEqual({ light: true, dark: false });
  });
});
