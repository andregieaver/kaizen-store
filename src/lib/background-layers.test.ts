import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HORIZON_CURVES,
  HORIZON_WIDTHS,
  LAYERS_MAX,
  LAYER_AMBIENTS,
  LAYER_BLUR_MAX,
  LAYER_FADES,
  LAYER_KINDS,
  LAYER_PATTERNS,
  PATTERN_SIZES,
  PICTURE_FITS,
  PICTURE_WIDTH_DEFAULT,
  PICTURE_WIDTH_MAX,
  addLayer,
  backgroundHasHue,
  copiedLayers,
  huedBackground,
  keptLayers,
  layerColour,
  layerDraw,
  layerPictureUrls,
  layerTravel,
  layersScroll,
  layersShow,
  mapLayerPictures,
  moveLayer,
  newLayer,
  newPictureLayer,
  patchLayer,
  patternSize,
  removeLayer,
  setPattern,
  setPictureFit,
  withLayerSmallCopies,
  type BackgroundLayer,
  type GlowLayer,
  type HorizonLayer,
  type PatternLayer,
  type PictureLayer,
} from "./background-layers";
import { backgroundHueSchema, backgroundLayerSchema, backgroundLayersSchema } from "./background-layers-schema";
import { layerFx, motionNeeds } from "./motion-attrs";
import { pageRowSchema, rowShows, type PageRow } from "./page-content";
import { shiftHue } from "./hue";

const css = readFileSync(join(process.cwd(), "src/app/motion.css"), "utf8");

const glow: GlowLayer = { id: "g", type: "glow", color: "#D946EF", outer: "#7c3aed", x: 50, y: 63, width: 150, height: 40 };
const grid: PatternLayer = { id: "p", type: "pattern", pattern: "grid", color: "#ffffff", opacity: 9, fade: "edges" };
const horizon: HorizonLayer = { id: "h", type: "horizon", color: "#d946ef", fill: "#07051a", y: 64 };
const picture: PictureLayer = { id: "i", type: "picture", image: { url: "https://cdn.example.com/cloud.webp", width: 1600, height: 900 }, x: 30, y: 40, width: 60 };

const row = (patch: Partial<PageRow> = {}): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [] }], ...patch });

describe("drawing a layer over a background (D534)", () => {
  it("gives a glow its two colours, the outer half as solid, and its place and size", () => {
    expect(layerDraw(glow)).toEqual({
      attrs: { "data-fx-bglayer": "glow" },
      style: { "--fx-lc1": "#d946ef", "--fx-lc2": "#7c3aed8a", "--fx-x": "50%", "--fx-y": "63%", "--fx-gx": "50cqw", "--fx-gy": "63cqh", "--fx-w": "150cqw", "--fx-h": "40cqh" },
      inner: { "data-fx-glow": "" },
    });
    // One colour fades evenly: the same colour, half as solid, where its heart ends.
    expect(layerDraw({ ...glow, outer: undefined })?.style["--fx-lc2"]).toBe("#d946ef8a");
  });

  it("gives a pattern its kind, colour, size and fade, and how solid it is", () => {
    expect(layerDraw(grid)).toEqual({
      attrs: { "data-fx-bglayer": "pattern" },
      style: { "--fx-o": 0.09, "--fx-lc1": "#ffffff", "--fx-size": "52px" },
      inner: { "data-fx-pattern": "grid", "data-fx-fade": "edges" },
    });
    expect(layerDraw({ ...grid, pattern: "stars", fade: undefined, opacity: undefined })).toEqual({
      attrs: { "data-fx-bglayer": "pattern" },
      style: { "--fx-lc1": "#ffffff", "--fx-size": "200px" },
      inner: { "data-fx-pattern": "stars" },
    });
  });

  it("gives a horizon its rim, disc, lit edge and haze, and the disc's width by its curve", () => {
    const drawn = layerDraw(horizon);
    expect(drawn?.attrs).toEqual({ "data-fx-bglayer": "horizon" });
    expect(drawn?.inner).toEqual({ "data-fx-disc": "" });
    expect(drawn?.style).toMatchObject({ "--fx-lc1": "#d946efd1", "--fx-lc2": "#07051a", "--fx-lc4": "#d946ef80", "--fx-y": "64%", "--fx-r": "125cqw" });
    expect(drawn?.style["--fx-lc3"]).toMatch(/^#f[0-9a-f]{5}$/);
    for (const curve of Object.keys(HORIZON_CURVES) as (keyof typeof HORIZON_CURVES)[])
      expect(layerDraw({ ...horizon, curve })?.style["--fx-r"]).toBe(`${HORIZON_WIDTHS[curve] / 2}cqw`);
  });

  it("holds what it is given inside its limits, and leaves out a layer it cannot draw", () => {
    const wild = layerDraw({ ...glow, x: 400, y: -20, width: 9999, height: 1, opacity: 500 });
    expect(wild?.style).toMatchObject({ "--fx-x": "100%", "--fx-y": "0%", "--fx-gx": "100cqw", "--fx-gy": "0cqh", "--fx-w": "300cqw", "--fx-h": "10cqh" });
    expect(wild?.style["--fx-o"]).toBeUndefined();
    expect(layerDraw({ ...grid, size: 5000 })?.style["--fx-size"]).toBe(`${PATTERN_SIZES.grid.max}px`);
    expect(layerDraw({ ...glow, color: "red; background: url(x)" })).toBeNull();
    expect(layerDraw({ ...horizon, fill: "transparent" })).toBeNull();
    expect(layerDraw({ ...grid, pattern: "plaid" as never })).toBeNull();
    expect(layerDraw({ ...glow, hidden: true })).toBeNull();
    expect(layerDraw({ id: "x", type: "blob", color: "#ffffff" } as never)).toBeNull();
    // An unknown fade is left out, never written.
    expect(layerDraw({ ...grid, fade: "sideways" as never })?.inner["data-fx-fade"]).toBeUndefined();
  });

  it("places a picture by its centre at a width of its own, or cuts it to fill the part, and never writes its address into a style (D537)", () => {
    expect(layerDraw(picture)).toEqual({
      attrs: { "data-fx-bglayer": "picture" },
      style: { "--fx-x": "30%", "--fx-y": "40%", "--fx-w": "60cqw" },
      inner: { "data-fx-pic": "placed" },
    });
    // Filling the part it has no width of its own; `x` and `y` say which part of it shows.
    expect(layerDraw({ ...picture, fit: "cover", fade: "down", opacity: 40 })).toEqual({
      attrs: { "data-fx-bglayer": "picture" },
      style: { "--fx-o": 0.4, "--fx-x": "30%", "--fx-y": "40%" },
      inner: { "data-fx-pic": "cover", "data-fx-fade": "down" },
    });
    expect(layerDraw({ ...picture, width: undefined })?.style["--fx-w"]).toBe(`${PICTURE_WIDTH_DEFAULT}cqw`);
    expect(layerDraw({ ...picture, width: 9000 })?.style["--fx-w"]).toBe(`${PICTURE_WIDTH_MAX}cqw`);
    expect(layerDraw({ ...picture, fit: "stretch" as never })?.inner["data-fx-pic"]).toBe("placed");
    // The hue turns colours; a picture is drawn as it is.
    expect(layerDraw(picture, 120)).toEqual(layerDraw(picture));
  });

  it("leaves out a picture it should not draw: no address, one that is not the web's, or no size", () => {
    for (const url of ["", "javascript:alert(1)", "data:image/png;base64,AAAA", "/relative.png", 'https://x.test/a.png" onerror="x', "https://x.test/a b.png"])
      expect(layerDraw({ ...picture, image: { ...picture.image, url } }), url).toBeNull();
    expect(layerDraw({ ...picture, image: { ...picture.image, width: 0 } })).toBeNull();
    expect(layerDraw({ ...picture, image: undefined as never })).toBeNull();
    expect(layerDraw({ ...picture, hidden: true })).toBeNull();
  });

  it("marks a blurred layer soft and says by how much, held to its limit; a sharp one carries neither (D535)", () => {
    for (const layer of [glow, grid, horizon, picture]) {
      const soft = layerDraw({ ...layer, blur: 12 })!;
      expect(soft.attrs["data-fx-soft"], layer.type).toBe("");
      expect(soft.style["--fx-blur"], layer.type).toBe("12px");
      // The blur is for the element that draws: its attributes are the same, blurred or not.
      expect(soft.inner).toEqual(layerDraw(layer)!.inner);
      const sharp = layerDraw(layer)!;
      expect("data-fx-soft" in sharp.attrs || "--fx-blur" in sharp.style, layer.type).toBe(false);
    }
    expect(layerDraw({ ...glow, blur: 900 })?.style["--fx-blur"]).toBe(`${LAYER_BLUR_MAX}px`);
    for (const none of [0, -5, Number.NaN]) expect(layerDraw({ ...glow, blur: none })?.attrs["data-fx-soft"]).toBeUndefined();
  });

  it("writes only names from its lists, colours and numbers with a unit", () => {
    const layers: BackgroundLayer[] = [glow, grid, horizon, { ...grid, id: "s", pattern: "stars", blur: 3 }, { ...grid, id: "d", pattern: "dots", fade: "up" }];
    for (const layer of layers) {
      const drawn = layerDraw(layer, 40)!;
      for (const value of Object.values({ ...drawn.attrs, ...drawn.inner })) expect(value).toMatch(/^[a-z]*$/);
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
    // A picture (D537) either way it sits, and room for its travel where it fills the part.
    for (const fit of Object.keys(PICTURE_FITS)) expect(css).toContain(`[data-fx-pic="${fit}"]`);
    expect(css).toContain('[data-fx-scroll="layer"] > [data-fx-pic="cover"]');
    // A pattern that travels keeps room for its travel, whatever element of the layer draws it.
    expect(css).toContain('[data-fx-scroll="layer"] > [data-fx-pattern]');
    // A layer that moves by itself needs the three animation slots, as every part that moves does.
    expect(css).toMatch(/\[data-fx-bgm\],\s*\[data-fx-amb\],/);
  });

  it("blurs what draws inside a soft layer, never the layer that travels, and nothing animates the blur (D535)", () => {
    // On the inner element the blur is painted once and the layer only moves it; on the layer it would be blurred again every frame.
    expect(css).toMatch(/\[data-fx-soft\] > \* \{\s*filter: blur\(var\(--fx-blur, 0px\)\);\s*\}/);
    expect(css).not.toMatch(/\[data-fx-(?:soft|bglayer)\] \{[^}]*filter:/);
    // What draws reaches past the frame by twice the blur, so its soft rim does not show.
    expect(css).toMatch(/\[data-fx-soft\] \{\s*--fx-e: calc\(var\(--fx-blur, 0px\) \* 2\);/);
    for (const box of ["[data-fx-glow]", "[data-fx-disc]", "[data-fx-bglayer] > [data-fx-pattern]"]) {
      const rule = css.slice(css.indexOf(`  ${box} {`), css.indexOf("}", css.indexOf(`  ${box} {`)));
      expect(rule, box).toMatch(/inset: [^;]*var\(--fx-e, 0px\)/);
    }
    // A picture that fills the part does the same; a placed one is soft at its own edges, which is the look.
    const cover = css.slice(css.indexOf('  [data-fx-pic="cover"] {'), css.indexOf("}", css.indexOf('  [data-fx-pic="cover"] {')));
    expect(cover).toMatch(/left: calc\(var\(--fx-e, 0px\) \* -1\)/);
    expect(cover).toMatch(/width: calc\(100% \+ var\(--fx-e, 0px\) \* 2\)/);
    for (const keyframes of css.matchAll(/@keyframes fx-(?:s-layer|l-[\w-]+) \{([\s\S]*?)\n {4}\}\n/g)) expect(keyframes[1]).not.toContain("filter");
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
    // A picture is drawn as it is: alone it gives the hue nothing to turn.
    expect(backgroundHasHue(undefined, [picture])).toBe(false);
    expect(backgroundHasHue(undefined, [picture, grid])).toBe(true);
    expect(layerColour(picture)).toBeNull();
    expect(layerColour(glow)).toBe("#D946EF");
  });
});

describe("editing the layers", () => {
  it("starts a layer of each kind as one the page accepts and draws", () => {
    for (const kind of ["glow", "pattern", "horizon"] as const) {
      const layer = newLayer(kind, `new-${kind}`);
      expect(layer.type).toBe(kind);
      expect(backgroundLayerSchema.safeParse(layer).success, kind).toBe(true);
      expect(layerDraw(layer), kind).not.toBeNull();
    }
    // A picture starts from its file: in the middle, half as wide as the part, with nothing kept of what the upload said besides.
    const fresh = newPictureLayer("new-picture", { url: "https://cdn.example.com/a.webp", width: 800, height: 600, alt: "ignored" } as never);
    expect(fresh).toEqual({ id: "new-picture", type: "picture", image: { url: "https://cdn.example.com/a.webp", width: 800, height: 600 }, x: 50, y: 50, width: PICTURE_WIDTH_DEFAULT });
    expect(backgroundLayerSchema.safeParse(fresh).success).toBe(true);
    expect(layerDraw(fresh)).not.toBeNull();
    expect(Object.keys(LAYER_KINDS)).toEqual(["glow", "pattern", "horizon", "picture"]);
  });

  it("changes how a picture sits: filling the part it keeps no width, placed again it gets one", () => {
    const cover = setPictureFit(picture, "cover");
    expect(cover.fit).toBe("cover");
    expect("width" in cover).toBe(false);
    const placed = setPictureFit(cover, "placed");
    expect(placed.fit).toBeUndefined();
    expect(placed.width).toBe(PICTURE_WIDTH_DEFAULT);
    expect(setPictureFit(picture, "placed").width).toBe(60);
  });

  it("lists the layers' pictures, gives each its small copy, and takes them to another address or leaves them out", () => {
    const layers: BackgroundLayer[] = [glow, picture, { ...picture, id: "j", image: { url: "https://cdn.example.com/rock.webp", width: 900, height: 900 } }];
    expect(layerPictureUrls(layers)).toEqual(["https://cdn.example.com/cloud.webp", "https://cdn.example.com/rock.webp"]);
    expect(layerPictureUrls(undefined)).toEqual([]);

    const small = withLayerSmallCopies(layers, (url) => (url.includes("cloud") ? "https://cdn.example.com/cloud-480.webp" : undefined));
    expect((small[1] as PictureLayer).image.small).toBe("https://cdn.example.com/cloud-480.webp");
    expect(small[0]).toBe(glow);
    expect(small[2]).toBe(layers[2]);
    // Nothing new: the same list, so a page read twice is not rebuilt.
    expect(withLayerSmallCopies(small, (url) => (url.includes("cloud") ? "https://cdn.example.com/cloud-480.webp" : undefined))).toBe(small);
    expect(withLayerSmallCopies(undefined, () => "x")).toBeUndefined();

    // To another store: the copy's address, without the small copy that went with the old one; a picture not taken along goes, the rest stay.
    const moved = mapLayerPictures(small, (url) => (url.includes("rock") ? null : url.replace("cdn.example.com", "own.example.com")))!;
    expect(moved.map((layer) => layer.id)).toEqual(["g", "i"]);
    expect((moved[1] as PictureLayer).image).toEqual({ url: "https://own.example.com/cloud.webp", width: 1600, height: 900 });
    expect(mapLayerPictures([picture], () => null)).toBeUndefined();
    expect(mapLayerPictures(undefined, (url) => url)).toBeUndefined();
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
  it("keeps a picture layer with its address and size, and never its small copy (D537)", () => {
    const stored = row({ backgroundLayers: [{ ...picture, fit: "cover", fade: "edges", blur: 6, scroll: -30, image: { ...picture.image, small: "https://cdn.example.com/cloud-480.webp" } }] });
    const read = pageRowSchema.parse(stored);
    expect(read.backgroundLayers).toEqual([{ ...picture, fit: "cover", fade: "edges", blur: 6, scroll: -30 }]);
    const refused: unknown[] = [
      { ...picture, image: { ...picture.image, url: "javascript:alert(1)" } },
      { ...picture, image: { ...picture.image, url: "ftp://cdn.example.com/a.png" } },
      { ...picture, image: { url: "https://cdn.example.com/a.png" } },
      { ...picture, image: undefined },
      { ...picture, fit: "stretch" },
      { ...picture, width: 2 },
      { ...picture, x: 120 },
    ];
    for (const layer of refused) expect(backgroundLayerSchema.safeParse(layer).success, JSON.stringify(layer)).toBe(false);
  });

  it("reads a row and a column with layers and a hue, and keeps them", () => {
    const stored = row({ backgroundLayers: [glow, { ...grid, scroll: -20, blur: 4 }, { ...horizon, blur: LAYER_BLUR_MAX }], backgroundHue: -45, columns: [{ id: "c", blocks: [], backgroundLayers: [grid], backgroundHue: 20 }] });
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
      { ...glow, blur: 0 },
      { ...glow, blur: 41 },
      { ...glow, blur: 2.5 },
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
