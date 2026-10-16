import { describe, expect, it } from "vitest";

import type { DesignSnapshot } from "./design-presets";
import { PACK_KEYS } from "./content-packs";
import { LAUNCH_THEMES, launchVariation } from "./launch-themes";
import type { PageBlock } from "./page-content";
import { newBlock } from "./page-rows";
import { CORE_SECTION_STYLES } from "./section-styles";
import { blockingLines, themeCheck } from "./theme-check";

/** The checks every theme passes before a version is published (D246, `docs/theme-store.md` 7). */

const launch = () => structuredClone(LAUNCH_THEMES[0].snapshot) as DesignSnapshot;
let n = 0;
const id = () => `t${(n += 1)}`;
const row = (blocks: unknown[]) => ({ id: id(), type: "row", layout: "1", columns: [{ id: id(), blocks }] });
const html = (): PageBlock => ({ ...newBlock("html", id), html: "<p>Hi</p>" }) as PageBlock;
const checks = (snapshot: unknown) => themeCheck(snapshot).findings.filter((f) => f.blocking).map((f) => f.check);

describe("themeCheck()", () => {
  it("passes every launch theme with nothing blocking", () => {
    for (const theme of LAUNCH_THEMES) {
      const result = themeCheck(theme.snapshot);
      expect(blockingLines(result), theme.title).toEqual([]);
    }
  });

  it("passes every launch theme's presets with nothing blocking, nor a secondary text that is hard to read (docs/theme-showcase-phase-1.md step 3)", () => {
    for (const theme of LAUNCH_THEMES) {
      expect(theme.presets.length, theme.title).toBeGreaterThanOrEqual(2);
      expect(theme.presets.length, theme.title).toBeLessThanOrEqual(4);
      for (const preset of theme.presets) {
        const variation = launchVariation(theme, preset);
        const result = themeCheck({ ...theme.snapshot, theme: variation.theme });
        expect(blockingLines(result), `${theme.title} · ${preset.name}`).toEqual([]);
        expect(result.findings.filter((f) => f.check === "contrast").map((f) => f.message), `${theme.title} · ${preset.name}`).toEqual([]);
        expect(preset.key).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
      }
      expect(new Set(theme.presets.map((p) => p.key)).size).toBe(theme.presets.length);
      // Each look of a theme is shown on a different store, and every pack is shown by some theme.
      const packs = [theme.listing.pack, ...theme.presets.map((p) => p.pack)];
      expect(new Set(packs).size, theme.title).toBe(packs.length);
    }
    const shown = new Set(LAUNCH_THEMES.flatMap((t) => [t.listing.pack, ...t.presets.map((p) => p.pack)]));
    expect([...PACK_KEYS].filter((key) => !shown.has(key))).toEqual([]);
  });

  it("refuses a package that cannot be read", () => {
    const result = themeCheck({ v: 2 });
    expect(result.blocking).toBeGreaterThan(0);
    expect(result.findings[0].check).toBe("package");
  });

  it("refuses a palette whose text or buttons are hard to read, and warns for the rest", () => {
    const snapshot = launch();
    snapshot.theme.settings.light.text = "#cccccc";
    snapshot.theme.settings.light.muted = "#bbbbbb";
    const result = themeCheck(snapshot);
    expect(result.findings.some((f) => f.blocking && f.message.startsWith("Text on the background"))).toBe(true);
    expect(result.findings.some((f) => !f.blocking && f.message.startsWith("Secondary text"))).toBe(true);
  });

  it("checks a section style's text over its own background, in each colour set the site shows", () => {
    const snapshot = launch();
    snapshot.theme.settings.sectionStyles = {
      ...snapshot.theme.settings.sectionStyles,
      // A white band with no text colour of its own: fine on light pages, unreadable when the visitor's device is dark.
      contrast: { row: { background: { type: "color", color: "#ffffff" } } },
    };
    const lines = blockingLines(themeCheck(snapshot));
    expect(lines.some((line) => line.includes("Section style Contrast") && line.includes("dark colours"))).toBe(true);
    expect(lines.some((line) => line.includes("Section style Contrast") && line.includes("light colours"))).toBe(false);
  });

  it("refuses a theme without every core section style", () => {
    const snapshot = launch();
    delete snapshot.theme.settings.sectionStyles!.quote;
    const result = themeCheck(snapshot);
    expect(result.findings.filter((f) => f.check === "sections").map((f) => f.where)).toEqual(["Section style Quote"]);
    expect(CORE_SECTION_STYLES).toContain("quote");
  });

  it("refuses words a theme cannot say and links that leave the site", () => {
    const snapshot = launch();
    snapshot.header = {
      rows: [row([{ id: "b1", type: "heading", text: "The best price in Norway", level: 2 }, { id: "b2", type: "button", label: "Visit", href: "https://example.com/" }])],
      css: "",
      menus: {},
    } as unknown as DesignSnapshot["header"];
    const result = themeCheck(snapshot);
    expect(result.findings.some((f) => f.check === "words" && f.message.includes("best price"))).toBe(true);
    expect(result.findings.some((f) => f.check === "words" && f.message.includes("https://example.com/"))).toBe(true);
  });

  it("refuses in a header what the checkout's pages may not hold", () => {
    const snapshot = launch();
    snapshot.header = { rows: [row([html()])], css: "", menus: {} } as unknown as DesignSnapshot["header"];
    expect(checks(snapshot)).toContain("pay");
  });

  it("asks the rules a save asks, when the server passes them", () => {
    const result = themeCheck(launch(), { rulesProblem: () => "Nope." });
    // No layouts in the launch theme: nothing to ask.
    expect(result.blocking).toBe(0);
    const withHeader = launch();
    withHeader.header = { rows: [row([{ id: "b1", type: "heading", text: "Hello", level: 2 }])], css: "", menus: {} } as unknown as DesignSnapshot["header"];
    expect(themeCheck(withHeader, { rulesProblem: () => "Nope." }).findings.map((f) => f.message)).toContain("Nope.");
  });
});
