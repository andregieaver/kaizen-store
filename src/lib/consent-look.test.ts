import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { consentLookOwn, followTheme, patchConsentLook, startingColours } from "./consent-look";
import { consentColours, templateSettings, themeAttributes, themeCss, themeWarnings, type ThemeSettings } from "./theme";
import { parseStoreTheme } from "./theme-schema";

const minimal = (): ThemeSettings => templateSettings("minimal");
const rule = (css: string, selector: string) => css.split("\n").find((line) => line.startsWith(`${selector} {`)) ?? "";

describe("the cookie popup's own look (D883)", () => {
  it("takes the page's colour set by default, so a theme saved before draws it as it did", () => {
    const s = minimal();
    expect(consentColours(s, "light")).toEqual({
      set: "light",
      colours: expect.objectContaining({ background: s.light.background, text: s.light.text, button: s.light.accent, buttonText: s.light.accentText }),
    });
    expect(consentColours(s, "dark").set).toBe("dark");
    const css = themeCss(s, "html");
    expect(rule(css, "html")).toContain(`--consent-background: ${s.light.background}`);
    expect(rule(css, "html")).toContain("--consent-scheme: light");
  });

  it("keeps the set it is given, whatever set the page shows", () => {
    const s = { ...minimal(), mode: "auto" as const, consent: { scheme: "dark" as const } };
    expect(consentColours(s, "light")).toMatchObject({ set: "dark", colours: { background: s.dark.background } });
    const css = themeCss(s, "html");
    expect(rule(css, "html")).toContain(`--consent-background: ${s.dark.background}`);
    // A row on a light background of its own does not make it light either.
    expect(css).toMatch(new RegExp(`\\.kz-on-light \\{[^}]*--consent-background: ${s.dark.background}`));
  });

  it("draws its own colours, corners and shadow where it has them", () => {
    const s = minimal();
    const colours = startingColours(s);
    s.consent = { colours: { ...colours, light: { ...colours.light, background: "#123456" } }, corners: "none", buttonCorners: "square", shadow: "none" };
    const css = rule(themeCss(s, "html"), "html");
    expect(css).toContain("--consent-background: #123456");
    expect(css).toContain("--consent-radius: 0;");
    expect(css).toContain("--consent-button-radius: 0;");
    expect(css).toContain("--consent-shadow: none");
  });

  it("starts its own colours from what it shows, so choosing them changes nothing", () => {
    const s = minimal();
    const before = themeCss(s, "html");
    expect(themeCss({ ...s, consent: { colours: startingColours(s) } }, "html")).toBe(before);
  });

  it("puts its headings in the body text's font only when chosen", () => {
    expect(themeAttributes(minimal())).not.toHaveProperty("data-consent-heading");
    expect(themeAttributes({ ...minimal(), consent: { heading: "body" } })).toMatchObject({ "data-consent-heading": "body" });
  });

  it("warns about its own colours that are hard to read, in the set it shows", () => {
    const s = minimal();
    const colours = startingColours(s);
    s.consent = { scheme: "dark", colours: { ...colours, dark: { ...colours.dark, text: colours.dark.background } } };
    expect(themeWarnings(s).some((w) => w.startsWith("The cookie popup's text in the dark colours"))).toBe(true);
    // On a site always light, following the site, the dark set is not shown.
    const light = { ...s, mode: "light" as const, visitorSwitch: false };
    expect(themeWarnings({ ...light, consent: { colours: s.consent.colours } })).toEqual(themeWarnings({ ...light, consent: undefined }));
  });

  it("is kept by the schema, and a damaged look falls back to the theme's", () => {
    const kept = parseStoreTheme({ base: "minimal", settings: { consent: { scheme: "dark", shadow: "soft" } } });
    expect(kept.settings.consent).toEqual({ scheme: "dark", shadow: "soft" });
    const damaged = parseStoreTheme({ base: "minimal", settings: { consent: { scheme: "purple" } } });
    expect(damaged.settings.consent).toBeUndefined();
  });

  it("follows the theme again with its colour set kept, and takes out what is set back", () => {
    expect(consentLookOwn(undefined)).toBe(false);
    expect(consentLookOwn({ scheme: "dark" })).toBe(false);
    expect(consentLookOwn({ shadow: "soft" })).toBe(true);
    expect(followTheme({ scheme: "dark", shadow: "soft", corners: "none" })).toEqual({ scheme: "dark" });
    expect(patchConsentLook({ scheme: "dark", shadow: "soft" }, { shadow: undefined })).toEqual({ scheme: "dark" });
  });

  it("is drawn by the banner and the popup through .consent-look alone", () => {
    const manager = readFileSync(path.join(__dirname, "../components/consent/consent-manager.tsx"), "utf8");
    expect(manager.match(/className="consent-look /g)).toHaveLength(2);
    const css = readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
    for (const name of ["background", "foreground", "muted", "border", "accent", "accent-foreground", "button-radius"]) {
      expect(css).toContain(`--${name}: var(--consent-${name});`);
    }
  });
});
