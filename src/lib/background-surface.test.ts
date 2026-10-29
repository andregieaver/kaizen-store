import { describe, expect, it } from "vitest";

import { SURFACE_OPACITY_MIN, partSurface, surfaceClass, surfaceOf } from "./background-surface";
import { contrastRatio, parseStoreTheme, themeCss } from "./theme";

/** A part's own background decides the colour set of the text over it (D390), only where it hides what is behind it. */
describe("surfaceOf", () => {
  it("reads a solid colour by its lightness", () => {
    expect(surfaceOf({ type: "color", color: "#cec7ba" })).toBe("light");
    expect(surfaceOf({ type: "color", color: "#1c1c1c" })).toBe("dark");
    expect(surfaceOf({ type: "color", color: "#709900", opacity: SURFACE_OPACITY_MIN })).toBe("light");
  });

  it("says nothing of a see-through colour or a picture alone", () => {
    expect(surfaceOf({ type: "color", color: "#ffffff", opacity: SURFACE_OPACITY_MIN - 1 })).toBeNull();
    expect(surfaceOf({ type: "image", overlay: null })).toBeNull();
    expect(surfaceOf({ type: "image", overlay: { color: "#000000", opacity: 20 } })).toBeNull();
    expect(surfaceOf(null)).toBeNull();
  });

  it("reads a picture's or video's solid overlay, and a gradient's colours", () => {
    expect(surfaceOf({ type: "image", overlay: { color: "#000000", opacity: 70 } })).toBe("dark");
    expect(surfaceOf({ type: "video", overlay: { color: "#ffffff", opacity: 80 } })).toBe("light");
    expect(surfaceOf({ type: "gradient", colors: ["#f5f4f1", "#c8bfae"] })).toBe("light");
    expect(surfaceOf({ type: "gradient", colors: ["#f5f4f1", "#c8bfae"], opacity: 30 })).toBeNull();
    expect(surfaceOf({ type: "gradient", colors: ["#ffffff", "#ffffff"], overlay: { color: "#111111", opacity: 90 } })).toBe("dark");
  });
});

describe("partSurface", () => {
  it("says nothing when a screen size changes the background's lightness or clears it", () => {
    const base = { type: "color" as const, color: "#ffffff" };
    expect(partSurface({ background: base, at: { sm: { background: { type: "color", color: "#f0f0f0" } } } })).toBe("light");
    expect(partSurface({ background: base, at: { sm: { background: { type: "color", color: "#000000" } } } })).toBeNull();
    expect(partSurface({ background: base, at: { md: { background: null } } })).toBeNull();
    expect(surfaceClass({ background: base })).toBe("kz-on-light");
    expect(surfaceClass({})).toBeUndefined();
  });
});

describe("themeCss and surfaces", () => {
  it("gives a light row the light colours in a dark page, and a dark row the dark ones", () => {
    const settings = parseStoreTheme(null).settings;
    const css = themeCss(settings, "html");
    expect(css).toContain(`html .kz-on-light { color-scheme: light; --background: ${settings.light.background}`);
    expect(css).toContain(`--foreground: ${settings.dark.text}`);
    expect(css).toMatch(/html \.kz-on-dark \{ color-scheme: dark;[^}]*color: var\(--foreground\); \}/);
    // What the footer's link was: the dark set's secondary text on a light row; now the light set's.
    expect(contrastRatio(settings.light.muted, "#cec7ba")).toBeGreaterThan(contrastRatio(settings.dark.muted, "#cec7ba"));
  });
});
