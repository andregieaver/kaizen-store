import { describe, expect, it } from "vitest";

import { brandMarksInput, iconInk, iconSvg, markColour, monogramOf, pathOk, wordmarkSvg } from "./brand-marks";
import { contrastRatio, templateSettings } from "./theme";

/** The brand's logo and icon drawn by code (D330 F2a, `docs/ai-autopilot.md` 14.4). */

describe("monogramOf", () => {
  it("is the first letter of the first two words, in capitals", () => {
    expect(monogramOf("Fjord Coffee Roasters")).toBe("FC");
    expect(monogramOf("øya")).toBe("Ø");
    expect(monogramOf("north-wind studio")).toBe("NW");
    expect(monogramOf("  42 Bakery ")).toBe("4B");
    expect(monogramOf("…")).toBe("");
  });
});

describe("the marks' colours", () => {
  const palette = templateSettings("minimal").light;

  it("take the colour asked for where it reaches 3:1, else the text colour", () => {
    expect(markColour(palette, palette.background, "text")).toBe(palette.text);
    expect(markColour({ ...palette, accent: "#f1f1f1" }, palette.background, "accent")).toBe(palette.text);
    expect(markColour({ ...palette, accent: "#1f6f5c" }, palette.background, "accent")).toBe("#1f6f5c");
  });

  it("put letters on the accent that read", () => {
    for (const accent of ["#1f6f5c", "#ffd23f", "#7a7a7a", "#ff6a3d"]) {
      expect(contrastRatio(iconInk({ ...palette, accent, accentText: accent }), accent)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the marks' SVG", () => {
  const box = { x1: 0, y1: -70, x2: 300, y2: 5 };

  it("holds only paths and fills, fitted to the shapes", () => {
    const svg = wordmarkSvg("M0 0L10 0L10 10Z", box, "#171717");
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-9 -79 318 93"><path d="M0 0L10 0L10 10Z" fill="#171717"/></svg>');
    expect(iconSvg("M0 0L10 0L10 10Z", { x1: 0, y1: -70, x2: 60, y2: 0 }, "#1f6f5c", "#ffffff", "circle")).toContain('<circle cx="256" cy="256" r="256" fill="#1f6f5c"/>');
  });

  it("refuses anything that is not path data or a colour", () => {
    expect(pathOk('M0 0"/><script>alert(1)</script>')).toBe(false);
    expect(() => wordmarkSvg("M0 0 Z", box, "red")).toThrow();
    expect(() => iconSvg("<g/>", box, "#000000", "#ffffff", "square")).toThrow();
  });
});

describe("the input", () => {
  it("keeps the letters to two and the weight to the font's steps", () => {
    expect(brandMarksInput.safeParse({ icon_letters: "ABC" }).success).toBe(false);
    expect(brandMarksInput.safeParse({ weight: 650 }).success).toBe(false);
    expect(brandMarksInput.parse({})).toEqual({ colour: "text", icon_shape: "rounded" });
  });
});
