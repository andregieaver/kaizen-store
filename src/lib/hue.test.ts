import { describe, expect, it } from "vitest";

import { cleanHue, hueBetween, hueOf, shiftHue } from "./hue";

const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

/** WCAG's relative luminance, which says whether text over a colour is drawn light or dark. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("turning a colour's hue (D534)", () => {
  it("leaves a colour as it was given with no turn, a full turn, or nothing to turn", () => {
    expect(shiftHue("#D946EF", 0)).toBe("#D946EF");
    expect(shiftHue("#D946EF", undefined)).toBe("#D946EF");
    expect(shiftHue("#d946ef", 360)).toBe("#d946ef");
    expect(shiftHue("#d946ef", Number.NaN)).toBe("#d946ef");
    expect(shiftHue("rebeccapurple", 90)).toBe("rebeccapurple");
    expect(shiftHue("#fff", 90)).toBe("#fff");
  });

  it("keeps a grey a grey: it has no hue", () => {
    for (const grey of ["#000000", "#ffffff", "#808080", "#070707"]) expect(shiftHue(grey, 120)).toBe(grey);
  });

  it("turns the hue by the degrees asked, always to a colour the screen can show", () => {
    for (const colour of ["#d946ef", "#7c3aed", "#3b5bff", "#14b8a6", "#f59e0b", "#1d1250"]) {
      for (const turn of [-150, -90, -40, 35, 90, 180]) {
        const turned = shiftHue(colour, turn);
        expect(turned).toMatch(/^#[0-9a-f]{6}$/);
        const from = hueOf(colour);
        const to = hueOf(turned);
        if (from === null || to === null) continue;
        const moved = (((to - from - turn + 540) % 360) + 360) % 360 - 180;
        // A colour is rounded to whole channels, so its hue lands within a few degrees (a near-black one further: it has few steps to land on).
        expect(Math.abs(moved), `${colour} by ${turn}`).toBeLessThan(6);
      }
    }
  });

  it("keeps a dark backdrop dark and a light one light, so the text over it stays readable", () => {
    for (const dark of ["#07051a", "#0c0828", "#1d1250", "#111827"])
      for (const turn of [-120, -60, 60, 120, 180]) expect(luminance(shiftHue(dark, turn)), `${dark} by ${turn}`).toBeLessThan(0.1);
    for (const light of ["#f7f7fb", "#ede9fe", "#fdf2f8"])
      for (const turn of [-120, -60, 60, 120, 180]) expect(luminance(shiftHue(light, turn)), `${light} by ${turn}`).toBeGreaterThan(0.7);
  });

  it("comes back to the colour when turned there and back, give or take a rounding", () => {
    for (const colour of ["#6d5bd0", "#4b8f7a", "#b0683c"]) {
      const back = channels(shiftHue(shiftHue(colour, 70), -70));
      channels(colour).forEach((c, i) => expect(Math.abs(c - back[i])).toBeLessThanOrEqual(3));
    }
  });

  it("stores a turn as whole degrees between -180 and 180, and no turn as nothing", () => {
    expect(cleanHue(0)).toBeUndefined();
    expect(cleanHue(0.3)).toBeUndefined();
    expect(cleanHue(34.6)).toBe(35);
    expect(cleanHue(-400)).toBe(-180);
    expect(cleanHue(999)).toBe(180);
    expect(cleanHue("40")).toBeUndefined();
    expect(cleanHue(Number.NaN)).toBeUndefined();
  });

  it("finds the turn that gives one colour the hue of another, and none for a grey", () => {
    const turn = hueBetween("#d946ef", "#14b8a6");
    expect(turn).not.toBeNull();
    const matched = hueOf(shiftHue("#d946ef", turn!));
    const wanted = hueOf("#14b8a6");
    expect(Math.abs((((matched! - wanted! + 540) % 360) + 360) % 360 - 180)).toBeLessThan(6);
    expect(hueBetween("#d946ef", "#d946ef")).toBe(0);
    expect(hueBetween("#d946ef", "#171717")).toBeNull();
    expect(hueBetween("#ffffff", "#14b8a6")).toBeNull();
  });
});
