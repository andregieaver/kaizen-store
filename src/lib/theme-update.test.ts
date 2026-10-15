import { describe, expect, it } from "vitest";

import type { DesignSnapshot } from "./design-presets";
import { coreStylesRemoved, cssFate, layoutFate, mergeSettings, whatsNew } from "./theme-update";

/** Updates of an installed theme (D245): the owner's changes laid over the new version, layouts kept or replaced, What's new from facts. */

describe("mergeSettings()", () => {
  const base = { light: { accent: "#111111", text: "#000000" }, fonts: { heading: "Inter" }, buttons: { style: "solid" } };

  it("takes the new version where the owner left a setting as placed, and keeps the owner's elsewhere", () => {
    const mine = { light: { accent: "#ff0000", text: "#000000" }, fonts: { heading: "Inter" }, buttons: { style: "solid" } };
    const theirs = { light: { accent: "#222222", text: "#333333" }, fonts: { heading: "Lora" }, buttons: { style: "solid" } };
    const merged = mergeSettings(base, mine, theirs);
    expect(merged.settings).toEqual({ light: { accent: "#ff0000", text: "#333333" }, fonts: { heading: "Lora" }, buttons: { style: "solid" } });
    expect(merged.own).toEqual(["light.accent"]);
    expect(merged.kept).toEqual(["light.accent"]);
  });

  it("keeps a change the version did not touch without counting it as kept over the version", () => {
    const mine = { ...base, buttons: { style: "outline" } };
    const merged = mergeSettings(base, mine, { ...base, fonts: { heading: "Lora" } });
    expect(merged.settings).toEqual({ ...base, buttons: { style: "outline" }, fonts: { heading: "Lora" } });
    expect(merged.own).toEqual(["buttons.style"]);
    expect(merged.kept).toEqual([]);
  });

  it("takes keys the version adds and drops keys it removes, unless the owner set them", () => {
    const withStyles = { ...base, sectionStyles: { hero: { h1: { radius: 2 } } } };
    expect(mergeSettings(base, base, withStyles).settings).toEqual(withStyles);
    expect(mergeSettings(withStyles, withStyles, base).settings).toEqual(base);
    const owned = { ...withStyles, sectionStyles: { hero: { h1: { radius: 9 } } } };
    expect(mergeSettings(withStyles, owned, base).settings).toEqual(owned);
  });

  it("treats a list as one setting", () => {
    const merged = mergeSettings({ list: [1, 2] }, { list: [1, 2, 3] }, { list: [4] });
    expect(merged.settings).toEqual({ list: [1, 2, 3] });
    expect(merged.kept).toEqual(["list"]);
  });
});

describe("cssFate()", () => {
  it("takes the version's CSS only while the owner left it as placed", () => {
    expect(cssFate("a{}", "a{}", "b{}")).toEqual({ css: "b{}", own: false, kept: false });
    expect(cssFate("a{}", "mine{}", "b{}")).toEqual({ css: "mine{}", own: true, kept: true });
    expect(cssFate("a{}", "mine{}", "a{}")).toEqual({ css: "mine{}", own: true, kept: false });
  });
});

describe("layoutFate()", () => {
  const placed = { id: "p", hash: "h" };
  it("replaces a page the owner has not touched, and keeps one they edited or chose", () => {
    expect(layoutFate(placed, { id: "p", hash: "h" }, true)).toEqual({ kind: "replace" });
    expect(layoutFate(placed, { id: "p", hash: "h" }, false)).toEqual({ kind: "standard" });
    expect(layoutFate(placed, { id: "p", hash: "edited" }, true)).toEqual({ kind: "keep", offer: true });
    expect(layoutFate(placed, { id: "other", hash: "h" }, false)).toEqual({ kind: "keep", offer: false });
    // The standard one before and the owner never chose another: the version's comes in.
    expect(layoutFate(null, null, true)).toEqual({ kind: "replace" });
    // An install from before updates were kept: whatever it shows is the owner's.
    expect(layoutFate(null, { id: "p", hash: "h" }, true)).toEqual({ kind: "keep", offer: true });
  });
});

const snap = (extra: Partial<DesignSnapshot> = {}, settings: Record<string, unknown> = {}): DesignSnapshot =>
  ({ v: 1, theme: { base: "minimal", settings: { fonts: { heading: "Inter" }, ...settings } }, header: null, footer: null, productLayout: null, css: "", ...extra }) as unknown as DesignSnapshot;

describe("whatsNew()", () => {
  it("puts the theme's own note first, then what changed, in plain sentences", () => {
    const before = snap({}, { sectionStyles: { plain: { row: { radius: 1 } }, quote: { row: { radius: 1 } } } });
    const after = snap(
      { css: ".x{}", header: { rows: [], css: "", menus: {} } },
      { fonts: { heading: "Lora" }, sectionStyles: { plain: { row: { radius: 2 } }, hero: { row: { radius: 3 } } } },
    );
    expect(whatsNew(before, after, "  Calmer colours for autumn. ")).toEqual([
      "Calmer colours for autumn.",
      "New fonts.",
      "New section style: Hero.",
      "Changed section style: Plain.",
      "No longer has the section style Quote: rows naming it take its Plain style.",
      "Its own header.",
      "Changed CSS.",
    ]);
  });

  it("says nothing for a version that changed nothing it can name", () => {
    expect(whatsNew(snap(), snap(), null)).toEqual([]);
  });
});

describe("coreStylesRemoved()", () => {
  it("names the core styles a version would take away, and nothing for a theme's own", () => {
    expect(coreStylesRemoved({ sectionStyles: { plain: {}, hero: {}, promo: {} } }, { sectionStyles: { plain: {} } })).toEqual(["hero"]);
    expect(coreStylesRemoved(null, { sectionStyles: {} })).toEqual([]);
  });
});
