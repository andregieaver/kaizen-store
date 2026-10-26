import { describe, expect, it } from "vitest";

import { brandInput, uniqueWords } from "./brand";
import { designedTheme, designLookInput, mix, onAccent, readableOn } from "./brand-design";
import { contrastRatio, templateSettings, THEME_TEMPLATE_KEYS, themeWarnings } from "./theme";

/** A look of the store's own (D330, `docs/ai-autopilot.md` 14.4): every colour worked out in code, always readable. */

/** A fixed sequence of colours, so the test is the same every run. */
function* colours(n: number, seed = 7): Generator<string> {
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    yield `#${(x % 16777216).toString(16).padStart(6, "0")}`;
  }
}

const input = (over: Record<string, unknown>) => designLookInput.parse({ title: "Ours", ...over });

describe("designedTheme", () => {
  it("never carries a readability warning, whatever the accent, background and mode", () => {
    const backgrounds = [...colours(30, 3)];
    let tried = 0;
    for (const base of THEME_TEMPLATE_KEYS) {
      for (const accent of colours(60, base.length)) {
        for (const mode of ["auto", "light", "dark"] as const) {
          const background = backgrounds[tried % backgrounds.length];
          const theme = designedTheme(templateSettings(base), input({ accent, background: tried % 2 ? background : undefined, mode }));
          expect([base, accent, background, mode, themeWarnings({ ...theme, visitorSwitch: true })]).toEqual([base, accent, background, mode, []]);
          tried++;
        }
      }
    }
    expect(tried).toBe(THEME_TEMPLATE_KEYS.length * 60 * 3);
  });

  it("keeps the brand's own colours where they read, and lays the fonts and named choices over the base", () => {
    const base = templateSettings("minimal");
    const theme = designedTheme(base, input({ accent: "#1f6f5c", background: "#fbf8f3", text: "#1c1917", heading_font: "Fraunces", body_font: "Inter", button_corners: "rounded", heading_case: "upper", width: "wide", card_style: "bordered" }));
    expect(theme.light).toMatchObject({ background: "#fbf8f3", text: "#1c1917", accent: "#1f6f5c", accentText: "#ffffff" });
    expect(theme.fonts).toEqual({ heading: "Fraunces", body: "Inter" });
    expect(theme).toMatchObject({ buttons: { corners: "rounded" }, headings: { case: "upper" }, layout: { width: "wide" }, productCards: { style: "bordered" } });
    // What was not given stays the base's.
    expect(theme.corners).toEqual(base.corners);
    expect(theme.layout.headerAlign).toBe(base.layout.headerAlign);
    expect(theme.mode).toBe(base.mode);
  });

  it("puts the given colours in the dark set when the mode is dark, and works out the light set", () => {
    const theme = designedTheme(templateSettings("bold"), input({ accent: "#ff6a3d", background: "#101418", text: "#e8e6e3", mode: "dark" }));
    expect(theme.dark.background).toBe("#101418");
    expect(theme.mode).toBe("dark");
    expect(themeWarnings(theme)).toEqual([]);
  });
});

describe("colour helpers", () => {
  it("move a colour until it reads, and choose the text on an accent", () => {
    expect(contrastRatio(readableOn("#777777", "#ffffff", 4.5), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(readableOn("#111111", "#ffffff", 4.5)).toBe("#111111");
    expect(onAccent("#1f6f5c")).toEqual({ accent: "#1f6f5c", text: "#ffffff" });
    expect(onAccent("#ffd23f").text).toBe("#111111");
    const middle = onAccent("#7a7a7a");
    expect(contrastRatio(middle.text, middle.accent)).toBeGreaterThanOrEqual(4.5);
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("the brand's input", () => {
  it("keeps its limits and each word once", () => {
    expect(brandInput.safeParse({ values: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
    expect(brandInput.safeParse({ tagline: "x".repeat(121) }).success).toBe(false);
    expect(uniqueWords(["Calm", "calm ", "Honest", ""])).toEqual(["Calm", "Honest"]);
  });
});
