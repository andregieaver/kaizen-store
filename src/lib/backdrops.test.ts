import { describe, expect, it } from "vitest";

import { backdropsEn } from "./admin-messages/backdrops.en";
import { backdropsNb } from "./admin-messages/backdrops.nb";
import { BACKDROPS, BACKDROP_IDS, BACKDROP_WORDS, accentOf, backdropPatch, mainColour, themeHue, type Backdrop } from "./backdrops";
import { themeSwatches } from "./colour";
import { HORIZON_CURVES, LAYERS_MAX, LAYER_AMBIENTS, LAYER_FADES, LAYER_KINDS, LAYER_PATTERNS, layerDraw, type BackgroundLayer } from "./background-layers";
import { surfaceOf } from "./background-surface";
import { hueOf, shiftHue } from "./hue";
import { pageIssues, themeSetsOf } from "./page-a11y";
import { pageColumnSchema, pageRowSchema, type PageBlock, type PageRow } from "./page-content";

const all = BACKDROP_IDS.map((id) => [id, BACKDROPS[id] as Backdrop] as const);
const heading: PageBlock = { id: "h", type: "heading", level: 1, text: "A heading" } as PageBlock;
const rowWith = (id: (typeof BACKDROP_IDS)[number], blocks: PageBlock[] = []): PageRow => {
  let n = 0;
  return { id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks }], ...backdropPatch(id, () => `l${++n}`) } as PageRow;
};

describe("the ready-made backdrops (D534)", () => {
  it.each(all)("%s is page content a row and a column accept, every layer drawn", (id, backdrop) => {
    const row = rowWith(id);
    const read = pageRowSchema.parse(row);
    expect(read.background).toEqual(backdrop.background);
    expect(read.backgroundLayers).toHaveLength(backdrop.layers.length);
    expect(pageColumnSchema.safeParse({ id: "c", blocks: [], background: row.background, backgroundLayers: row.backgroundLayers }).success).toBe(true);
    expect(backdrop.layers.length).toBeLessThanOrEqual(LAYERS_MAX);
    expect(new Set(backdrop.layers.map((layer) => layer.id)).size).toBe(backdrop.layers.length);
    for (const layer of backdrop.layers) expect(layerDraw(layer), layer.id).not.toBeNull();
  });

  it.each(all)("%s is as dark or light as it says, so the text over it is drawn to read", (id, backdrop) => {
    expect(surfaceOf(backdrop.background)).toBe(backdrop.tone);
    // A heading in the theme's colour passes the page check, in a theme that shows both colour sets and in one that shows light only.
    const light = { text: "#171717", background: "#ffffff" };
    const dark = { text: "#ededed", background: "#0a0a0a" };
    for (const mode of ["auto", "light"] as const)
      expect(pageIssues({ title: "A page", rows: [rowWith(id, [heading])] }, { theme: { sets: themeSetsOf({ mode, light, dark }) } }).filter((issue) => issue.rule === "contrast")).toEqual([]);
  });

  it.each(all)("%s keeps its tone whichever way its hue is turned", (_id, backdrop) => {
    for (const hue of [-150, -90, -30, 45, 120, 180]) {
      const turned = backdrop.background.type === "color" ? { ...backdrop.background, color: shiftHue(backdrop.background.color, hue) } : { ...backdrop.background, colors: backdrop.background.colors.map((c) => shiftHue(c, hue)) };
      expect(surfaceOf(turned), String(hue)).toBe(backdrop.tone);
      expect(surfaceOf(backdrop.background, hue), String(hue)).toBe(backdrop.tone);
    }
  });

  it("has a main colour with a hue, for matching a theme", () => {
    for (const [id, backdrop] of all) expect(hueOf(backdrop.accent), id).not.toBeNull();
  });

  it("is put on a part as its own: new ids, nothing shared with the list, and nothing left of the old background's motion or blur", () => {
    let n = 0;
    const patch = backdropPatch("horizon", () => `new-${++n}`);
    expect(patch.backgroundLayers?.map((layer) => layer.id)).toEqual(["new-1", "new-2", "new-3", "new-4", "new-5"]);
    expect(patch.backgroundLayers?.map((layer) => layer.type)).toEqual(BACKDROPS.horizon.layers.map((layer) => layer.type));
    expect(Object.keys(patch).sort()).toEqual(["backdropBlur", "background", "backgroundHue", "backgroundLayers", "backgroundMotion"]);
    expect(patch.backgroundHue).toBeUndefined();
    expect(patch.backgroundMotion).toBeUndefined();
    expect(patch.backdropBlur).toBeUndefined();
    // Changing what the part got changes nothing in the list.
    (patch.background as { colors: string[] }).colors[0] = "#ffffff";
    (patch.backgroundLayers![0] as BackgroundLayer).color = "#000000";
    expect(BACKDROPS.horizon.background.colors[0]).toBe("#1d1250");
    expect(BACKDROPS.horizon.layers[0].color).toBe("#ffffff");
  });
});

describe("matching a background to the theme", () => {
  const glow: BackgroundLayer = { id: "g", type: "glow", color: "#d946ef", x: 50, y: 50, width: 80, height: 60 };
  const grid: BackgroundLayer = { id: "p", type: "pattern", pattern: "grid", color: "#ffffff" };

  it("knows a background by its topmost glow or horizon, else its top layer, else its own colour", () => {
    expect(mainColour(undefined, [glow, grid])).toBe("#d946ef");
    expect(mainColour(undefined, [grid])).toBe("#ffffff");
    expect(mainColour(undefined, [grid, { ...glow, hidden: true }])).toBe("#ffffff");
    expect(mainColour({ type: "gradient", style: "radial", colors: ["#1d1250", "#07051a"] }, undefined)).toBe("#1d1250");
    expect(mainColour({ type: "color", color: "#0b0f1a" }, [])).toBe("#0b0f1a");
    expect(mainColour({ type: "image", image: { url: "https://example.com/a.jpg", width: 1, height: 1 }, overlay: null }, undefined)).toBeNull();
    expect(mainColour(undefined, undefined)).toBeNull();
  });

  it("finds the theme's accent among a colour field's swatches: the light set's where both are offered", () => {
    const palette = { background: "#ffffff", surface: "#f5f5f4", text: "#171717", muted: "#525252", border: "#e5e5e5", accent: "#2563eb", accentText: "#ffffff" };
    expect(accentOf(themeSwatches({ mode: "auto", light: palette, dark: { ...palette, accent: "#93c5fd" } }))).toBe("#2563eb");
    expect(accentOf(themeSwatches({ mode: "light", light: palette, dark: palette }))).toBe("#2563eb");
    expect(accentOf([{ name: "Text on accent", colour: "#ffffff" }, { name: "Accent (dark)", colour: "#93c5fd" }])).toBe("#93c5fd");
    expect(accentOf([])).toBeUndefined();
  });

  it("finds the turn to the theme's accent, and none for a theme in black and white", () => {
    const turn = themeHue(undefined, [glow], "#14b8a6");
    expect(turn).not.toBeNull();
    expect(Math.abs((((hueOf(shiftHue("#d946ef", turn!))! - hueOf("#14b8a6")! + 540) % 360) + 360) % 360 - 180)).toBeLessThan(6);
    expect(themeHue(undefined, [glow], "#171717")).toBeNull();
    expect(themeHue(undefined, [glow], undefined)).toBeNull();
    expect(themeHue(undefined, undefined, "#14b8a6")).toBeNull();
  });
});

describe("the builder's words for backdrops", () => {
  const leaves = (value: unknown, path = ""): [string, string][] =>
    typeof value === "string" ? [[path, value]] : Object.entries(value as object).flatMap(([key, inner]) => leaves(inner, `${path}.${key}`));
  const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("names every backdrop, kind, pattern, fade, curve and movement as their libraries do", () => {
    expect(Object.keys(BACKDROP_WORDS.presets).sort()).toEqual([...BACKDROP_IDS].sort());
    expect(BACKDROP_WORDS.kinds).toEqual(LAYER_KINDS);
    expect(BACKDROP_WORDS.patterns).toEqual(LAYER_PATTERNS);
    expect(BACKDROP_WORDS.fades).toEqual({ none: "Nowhere", ...LAYER_FADES });
    expect(BACKDROP_WORDS.curves).toEqual(HORIZON_CURVES);
    expect(BACKDROP_WORDS.ambients).toEqual({ none: "Still", ...LAYER_AMBIENTS });
    expect(Object.keys(BACKDROP_WORDS.kindHints)).toEqual(Object.keys(LAYER_KINDS));
  });

  it("is the admin's English area, and Norwegian says every word with the same blanks to fill", () => {
    expect(backdropsEn).toBe(BACKDROP_WORDS);
    const nb = new Map(leaves(backdropsNb));
    const en = leaves(backdropsEn);
    expect([...nb.keys()].sort()).toEqual(en.map(([path]) => path).sort());
    for (const [path, english] of en) {
      expect(nb.get(path), path).toBeTruthy();
      expect(names(nb.get(path) ?? ""), path).toEqual(names(english));
    }
  });
});
