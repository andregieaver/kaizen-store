import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HORIZON_CURVES,
  HORIZON_WIDTHS,
  LAYERS_MAX,
  LAYER_AMBIENTS,
  LAYER_FADES,
  LAYER_KINDS,
  LAYER_PATTERNS,
  PATTERN_SIZES,
  addLayer,
  backgroundHasHue,
  copiedLayers,
  huedBackground,
  keptLayers,
  layerDraw,
  layerTravel,
  layersScroll,
  layersShow,
  moveLayer,
  newLayer,
  patchLayer,
  patternSize,
  removeLayer,
  setPattern,
  type BackgroundLayer,
  type GlowLayer,
  type HorizonLayer,
  type LayerKind,
  type PatternLayer,
} from "./background-layers";
import { backgroundHueSchema, backgroundLayerSchema, backgroundLayersSchema } from "./background-layers-schema";
import { layerFx, motionNeeds } from "./motion-attrs";
import { pageRowSchema, rowShows, type PageRow } from "./page-content";
import { shiftHue } from "./hue";

const css = readFileSync(join(process.cwd(), "src/app/motion.css"), "utf8");

const glow: GlowLayer = { id: "g", type: "glow", color: "#D946EF", outer: "#7c3aed", x: 50, y: 63, width: 150, height: 40 };
const grid: PatternLayer = { id: "p", type: "pattern", pattern: "grid", color: "#ffffff", opacity: 9, fade: "edges" };
const horizon: HorizonLayer = { id: "h", type: "horizon", color: "#d946ef", fill: "#07051a", y: 64 };

const row = (patch: Partial<PageRow> = {}): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [] }], ...patch });

describe("drawing a layer over a background (D534)", () => {
  it("gives a glow its two colours, the outer half as solid, and its place and size", () => {
    expect(layerDraw(glow)).toEqual({
      attrs: { "data-fx-bglayer": "glow" },
      style: { "--fx-lc1": "#d946ef", "--fx-lc2": "#7c3aed8a", "--fx-x": "50%", "--fx-y": "63%", "--fx-gy": "63cqh", "--fx-w": "150cqw", "--fx-h": "40cqh" },
    });
    // One colour fades evenly: the same colour, half as solid, where its heart ends.
    expect(layerDraw({ ...glow, outer: undefined })?.style["--fx-lc2"]).toBe("#d946ef8a");
  });

  it("gives a pattern its kind, colour, size and fade, and how solid it is", () => {
    expect(layerDraw(grid)).toEqual({
      attrs: { "data-fx-bglayer": "pattern", "data-fx-pattern": "grid", "data-fx-fade": "edges" },
      style: { "--fx-o": 0.09, "--fx-lc1": "#ffffff", "--fx-size": "52px" },
    });
    expect(layerDraw({ ...grid, pattern: "stars", fade: undefined, opacity: undefined })).toEqual({
      attrs: { "data-fx-bglayer": "pattern", "data-fx-pattern": "stars" },
      style: { "--fx-lc1": "#ffffff", "--fx-size": "200px" },
    });
  });

  it("gives a horizon its rim, disc, lit edge and haze, and the disc's width by its curve", () => {
    const drawn = layerDraw(horizon);
    expect(drawn?.attrs).toEqual({ "data-fx-bglayer": "horizon" });
    expect(drawn?.style).toMatchObject({ "--fx-lc1": "#d946efd1", "--fx-lc2": "#07051a", "--fx-lc4": "#d946ef80", "--fx-y": "64%", "--fx-r": "125cqw" });
    expect(drawn?.style["--fx-lc3"]).toMatch(/^#f[0-9a-f]{5}$/);
    for (const curve of Object.keys(HORIZON_CURVES) as (keyof typeof HORIZON_CURVES)[])
      expect(layerDraw({ ...horizon, curve })?.style["--fx-r"]).toBe(`${HORIZON_WIDTHS[curve] / 2}cqw`);
  });

  it("holds what it is given inside its limits, and leaves out a layer it cannot draw", () => {
    const wild = layerDraw({ ...glow, x: 400, y: -20, width: 9999, height: 1, opacity: 500 });
    expect(wild?.style).toMatchObject({ "--fx-x": "100%", "--fx-y": "0%", "--fx-gy": "0cqh", "--fx-w": "300cqw", "--fx-h": "10cqh" });
    expect(wild?.style["--fx-o"]).toBeUndefined();
    expect(layerDraw({ ...grid, size: 5000 })?.style["--fx-size"]).toBe(`${PATTERN_SIZES.grid.max}px`);
    expect(layerDraw({ ...glow, color: "red; background: url(x)" })).toBeNull();
    expect(layerDraw({ ...horizon, fill: "transparent" })).toBeNull();
    expect(layerDraw({ ...grid, pattern: "plaid" as never })).toBeNull();
    expect(layerDraw({ ...glow, hidden: true })).toBeNull();
    expect(layerDraw({ id: "x", type: "blob", color: "#ffffff" } as never)).toBeNull();
    // An unknown fade is left out, never written.
    expect(layerDraw({ ...grid, fade: "sideways" as never })?.attrs["data-fx-fade"]).toBeUndefined();
  });

  it("writes only names from its lists, colours and numbers with a unit", () => {
    const layers: BackgroundLayer[] = [glow, grid, horizon, { ...grid, id: "s", pattern: "stars" }, { ...grid, id: "d", pattern: "dots", fade: "up" }];
    for (const layer of layers) {
      const drawn = layerDraw(layer, 40)!;
      for (const value of Object.values(drawn.attrs)) expect(value).toMatch(/^[a-z]+$/);
      for (const value of Object.values(drawn.style)) expect(String(value)).toMatch(/^(#[0-9a-f]{6}([0-9a-f]{2})?|\d+(\.\d+)?(%|px|cqw|cqh)?)$/);
    }
  });

  it("turns every colour of a layer by the part's hue", () => {
    const turned = layerDraw(glow, 90)!;
    expect(turned.style["--fx-lc1"]).toBe(shiftHue("#d946ef", 90));
    expect(turned.style["--fx-lc2"]).toBe(`${shiftHue("#7c3aed", 90)}8a`);
    const arc = layerDraw(horizon, -120)!;
    expect(arc.style["--fx-lc2"]).toBe(shiftHue("#07051a", -120));
    expect(arc.style["--fx-lc1"]).toBe(`${shiftHue("#d946ef", -120)}d1`);
  });
});

describe("how a layer moves", () => {
  it("travels against the page by its own distance, on its frame's timeline", () => {
    expect(layerFx({ scroll: -100 })).toEqual({ attrs: { "data-fx-scroll": "layer", "data-fx-tl": "parent" }, style: { "--fx-sk": -1 } });
    expect(layerFx({ scroll: 60, ambient: "twinkle" })).toEqual({
      attrs: { "data-fx-scroll": "layer", "data-fx-tl": "parent", "data-fx-amb": "twinkle" },
      style: { "--fx-sk": 0.6 },
    });
    expect(layerFx({ ambient: "breathe" })).toEqual({ attrs: { "data-fx-amb": "breathe" }, style: {} });
  });

  it("stays still with nothing set, with a travel of none, or when asked to", () => {
    expect(layerFx({})).toEqual({ attrs: {}, style: {} });
    expect(layerFx({ scroll: 0 })).toEqual({ attrs: {}, style: {} });
    expect(layerFx(undefined)).toEqual({ attrs: {}, style: {} });
    expect(layerFx({ ambient: "spin" as never })).toEqual({ attrs: {}, style: {} });
    expect(layerTravel(250)).toBe(1);
    expect(layerTravel(Number.NaN)).toBe(0);
  });

  it("asks for the motion runtime where a layer that is drawn travels, for browsers without scroll timelines", () => {
    expect(motionNeeds([row({ backgroundLayers: [{ ...glow, scroll: -80 }] })]).js).toBe(true);
    expect(motionNeeds([row({ columns: [{ id: "c", blocks: [], backgroundLayers: [{ ...grid, scroll: 30 }] }] })]).js).toBe(true);
    expect(motionNeeds([row({ backgroundLayers: [{ ...glow, ambient: "breathe" }] })]).js).toBe(false);
    expect(motionNeeds([row({ backgroundLayers: [{ ...glow, scroll: -80, hidden: true }] })]).js).toBe(false);
    expect(layersScroll(undefined)).toBe(false);
  });

  it("is drawn by the stylesheet: every pattern, fade and movement by itself, and the travel", () => {
    for (const pattern of Object.keys(LAYER_PATTERNS)) expect(css).toContain(`[data-fx-pattern="${pattern}"]`);
    for (const fade of Object.keys(LAYER_FADES)) expect(css).toContain(`[data-fx-fade="${fade}"]`);
    for (const ambient of Object.keys(LAYER_AMBIENTS)) expect(css).toContain(`[data-fx-amb="${ambient}"]`);
    for (const selector of ["[data-fx-layers]", "[data-fx-bglayer]", "[data-fx-glow]", "[data-fx-disc]", '[data-fx-scroll="layer"]']) expect(css).toContain(selector);
    // A layer that moves by itself needs the three animation slots, as every part that moves does.
    expect(css).toMatch(/\[data-fx-bgm\],\s*\[data-fx-amb\],/);
  });

  it("moves only where 'reduce motion' is not asked for", () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n {2}\}\n/g, "");
    expect(outside).not.toMatch(/fx-s-layer|fx-l-twinkle|fx-l-breathe|data-fx-amb/);
    expect(outside).toContain("[data-fx-bglayer]");
  });
});

describe("the hue of a whole background", () => {
  it("turns a colour, a gradient's colours and the colour over a picture, and leaves the rest as it is", () => {
    expect(huedBackground({ type: "color", color: "#1d1250", opacity: 80 }, 60)).toEqual({ type: "color", color: shiftHue("#1d1250", 60), opacity: 80 });
    const gradient = { type: "gradient" as const, style: "radial" as const, colors: ["#1d1250", "#07051a"], overlay: { color: "#3b5bff", opacity: 20 }, grain: true };
    expect(huedBackground(gradient, 60)).toEqual({
      ...gradient,
      colors: [shiftHue("#1d1250", 60), shiftHue("#07051a", 60)],
      overlay: { color: shiftHue("#3b5bff", 60), opacity: 20 },
    });
    const picture = { type: "image" as const, image: { url: "https://example.com/a.jpg", width: 10, height: 10 }, overlay: null };
    expect(huedBackground(picture, 60)).toEqual(picture);
    const video = { type: "video" as const, video: { url: "https://example.com/a.mp4" }, poster: null, overlay: { color: "#7c3aed", opacity: 40 } };
    expect(huedBackground(video, 60).overlay).toEqual({ color: shiftHue("#7c3aed", 60), opacity: 40 });
  });

  it("is the same background with no turn", () => {
    const colour = { type: "color" as const, color: "#1d1250" };
    expect(huedBackground(colour, undefined)).toBe(colour);
    expect(huedBackground(colour, 0)).toBe(colour);
    expect(huedBackground(undefined, 40)).toBeUndefined();
  });

  it("is offered where a turn would show", () => {
    expect(backgroundHasHue(undefined, undefined)).toBe(false);
    expect(backgroundHasHue({ type: "image", overlay: null }, [])).toBe(false);
    expect(backgroundHasHue({ type: "image", overlay: { color: "#7c3aed", opacity: 40 } }, undefined)).toBe(true);
    expect(backgroundHasHue({ type: "color", color: "#1d1250" }, undefined)).toBe(true);
    expect(backgroundHasHue(undefined, [glow])).toBe(true);
  });
});

describe("editing the layers", () => {
  it("starts a layer of each kind as one the page accepts and draws", () => {
    for (const kind of Object.keys(LAYER_KINDS) as LayerKind[]) {
      const layer = newLayer(kind, `new-${kind}`);
      expect(layer.type).toBe(kind);
      expect(backgroundLayerSchema.safeParse(layer).success, kind).toBe(true);
      expect(layerDraw(layer), kind).not.toBeNull();
    }
  });

  it("adds on top until the list is full, removes, and moves a layer up or down", () => {
    const three = [glow, grid, horizon];
    expect(addLayer(three, { ...glow, id: "top" }).map((l) => l.id)).toEqual(["g", "p", "h", "top"]);
    const full = Array.from({ length: LAYERS_MAX }, (_, i) => ({ ...glow, id: `l${i}` }));
    expect(addLayer(full, { ...glow, id: "one-more" })).toHaveLength(LAYERS_MAX);
    expect(removeLayer(three, "p").map((l) => l.id)).toEqual(["g", "h"]);
    expect(moveLayer(three, "g", 1).map((l) => l.id)).toEqual(["p", "g", "h"]);
    expect(moveLayer(three, "h", -1).map((l) => l.id)).toEqual(["g", "h", "p"]);
    expect(moveLayer(three, "h", 1).map((l) => l.id)).toEqual(["g", "p", "h"]);
    expect(moveLayer(three, "nobody", 1).map((l) => l.id)).toEqual(["g", "p", "h"]);
  });

  it("changes one layer, taking away what is set to nothing", () => {
    const next = patchLayer([glow, grid], "p", { opacity: undefined, scroll: -30 });
    expect(next[0]).toBe(glow);
    expect(next[1]).toEqual({ id: "p", type: "pattern", pattern: "grid", color: "#ffffff", fade: "edges", scroll: -30 });
    expect("opacity" in next[1]).toBe(false);
  });

  it("starts a changed pattern at its own size", () => {
    const stars = setPattern({ ...grid, size: 20 }, "stars");
    expect(stars.size).toBeUndefined();
    expect(patternSize(stars)).toBe(PATTERN_SIZES.stars.start);
  });

  it("keeps no empty list, and copies a ready-made list with ids of its own", () => {
    expect(keptLayers([])).toBeUndefined();
    expect(keptLayers([glow])).toEqual([glow]);
    let n = 0;
    const copies = copiedLayers([glow, grid], () => `id-${++n}`);
    expect(copies.map((l) => l.id)).toEqual(["id-1", "id-2"]);
    expect(copies[0]).toEqual({ ...glow, id: "id-1" });
  });
});

describe("the layers as a page stores them", () => {
  it("reads a row and a column with layers and a hue, and keeps them", () => {
    const stored = row({ backgroundLayers: [glow, { ...grid, scroll: -20 }, horizon], backgroundHue: -45, columns: [{ id: "c", blocks: [], backgroundLayers: [grid], backgroundHue: 20 }] });
    const read = pageRowSchema.parse(stored);
    expect(read.backgroundLayers).toEqual(stored.backgroundLayers);
    expect(read.backgroundHue).toBe(-45);
    expect(read.columns[0].backgroundLayers).toEqual([grid]);
    expect(read.columns[0].backgroundHue).toBe(20);
  });

  it("leaves out an empty list and no turn, so a row without them is stored as it always was", () => {
    const read = pageRowSchema.parse(row({ backgroundLayers: [], backgroundHue: 0 }));
    expect("backgroundLayers" in read && read.backgroundLayers !== undefined).toBe(false);
    expect(read.backgroundHue).toBeUndefined();
    expect(pageRowSchema.parse(row()).backgroundLayers).toBeUndefined();
  });

  it("refuses what is not in its lists or outside its limits", () => {
    const refused: unknown[] = [
      { ...glow, color: "red" },
      { ...glow, outer: "url(javascript:alert(1))" },
      { ...glow, x: 101 },
      { ...glow, width: 5 },
      { ...glow, opacity: 0 },
      { ...glow, scroll: 150 },
      { ...glow, scroll: 12.5 },
      { ...glow, ambient: "spin" },
      { ...glow, id: "has space" },
      { ...grid, pattern: "plaid" },
      { ...grid, fade: "sideways" },
      { ...grid, size: 5 },
      { ...grid, pattern: "stars", size: 50 },
      { ...horizon, fill: "#fff" },
      { ...horizon, curve: "wavy" },
      { id: "x", type: "picture", color: "#ffffff" },
    ];
    for (const layer of refused) expect(backgroundLayerSchema.safeParse(layer).success, JSON.stringify(layer)).toBe(false);
    expect(backgroundLayersSchema.safeParse(Array.from({ length: LAYERS_MAX + 1 }, (_, i) => ({ ...glow, id: `l${i}` }))).success).toBe(false);
    expect(backgroundLayersSchema.safeParse([glow, { ...grid, id: "g" }]).success).toBe(false);
    for (const hue of [181, -181, 10.5, "40"]) expect(backgroundHueSchema.safeParse(hue).success, String(hue)).toBe(false);
  });

  it("draws a row that holds nothing but layers, and not one whose layers are all switched off", () => {
    expect(rowShows(row({ backgroundLayers: [glow] }))).toBe(true);
    expect(rowShows(row({ backgroundLayers: [{ ...glow, hidden: true }] }))).toBe(false);
    expect(rowShows(row({ columns: [{ id: "c", blocks: [], backgroundLayers: [grid] }] }))).toBe(true);
    expect(layersShow([])).toBe(false);
  });
});
