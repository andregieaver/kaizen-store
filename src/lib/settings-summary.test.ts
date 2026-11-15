import { describe, expect, it } from "vitest";
import { frameAtGlance, sidesAtGlance, spacingAtGlance, typographyAtGlance, visibilityAtGlance } from "./settings-summary";
import { foldOpen, keepScroll, newSettingsMemory, rememberedScroll } from "./settings-memory";

describe("settings at a glance (D631)", () => {
  it("says four sides as none, one number or mixed", () => {
    expect(sidesAtGlance(undefined)).toBeNull();
    expect(sidesAtGlance({ top: 0, right: 0, bottom: 0, left: 0 })).toBeNull();
    expect(sidesAtGlance({ top: 12, right: 12, bottom: 12, left: 12 })).toBe(12);
    expect(sidesAtGlance({ top: 12, right: 24, bottom: 12, left: 24 })).toBe("mixed");
    expect(spacingAtGlance({ padding: { top: 8, right: 8, bottom: 8, left: 8 } })).toEqual({ outside: null, inside: 8 });
  });

  it("says a frame's border, corners and shadow", () => {
    expect(frameAtGlance({})).toEqual({ border: null, radius: null, shadow: null });
    expect(frameAtGlance({ border: { style: "dashed", width: { top: 1, right: 1, bottom: 1, left: 1 }, color: "#000" }, radius: 6, shadow: "md" })).toEqual({
      border: "dashed",
      radius: 6,
      shadow: "md",
    });
  });

  it("says a part's own text look", () => {
    expect(typographyAtGlance(undefined)).toBeNull();
    expect(typographyAtGlance({ text: {} })).toBeNull();
    expect(typographyAtGlance({ text: { weight: 700 } })).toEqual({});
    expect(typographyAtGlance({ text: { family: "Inter", size: { value: 18, unit: "px" } } })).toEqual({ family: "Inter", size: "18px" });
  });

  it("says where, for whom and when a part shows, a schedule alone being for everyone", () => {
    expect(visibilityAtGlance(undefined)).toEqual({ hiddenAt: [], audience: "everyone", schedule: null });
    expect(visibilityAtGlance({ hideAt: ["sm"], show: "signedIn" })).toEqual({ hiddenAt: ["sm"], audience: "signedIn", schedule: null });
    const dated = { rules: [[{ fact: "date" as const, op: "between" as const, value: { from: "2026-12-01T09:00", to: "2026-12-24T23:59" } }]] };
    expect(visibilityAtGlance({ show: dated })).toEqual({ hiddenAt: [], audience: "everyone", schedule: { from: "2026-12-01T09:00", to: "2026-12-24T23:59" } });
    expect(visibilityAtGlance({ show: "never" }).audience).toBe("nobody");
  });
});

describe("the settings panel's memory (D631)", () => {
  it("keeps the scroll per kind of part and tab, and folds as they were left", () => {
    const memory = newSettingsMemory();
    expect(memory.tab).toBe("content");
    expect(rememberedScroll(memory, "block:button", "design")).toBe(0);
    keepScroll(memory, "block:button", "design", 312.6);
    expect(rememberedScroll(memory, "block:button", "design")).toBe(313);
    expect(rememberedScroll(memory, "row", "design")).toBe(0);
    keepScroll(memory, "row", "design", -5);
    expect(rememberedScroll(memory, "row", "design")).toBe(0);
    expect(foldOpen(memory, "spacing", false)).toBe(false);
    memory.open.spacing = true;
    expect(foldOpen(memory, "spacing", false)).toBe(true);
  });
});
