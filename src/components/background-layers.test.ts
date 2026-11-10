import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BACKDROPS, BACKDROP_IDS, BACKDROP_WORDS } from "@/lib/backdrops";
import type { BackgroundLayer } from "@/lib/background-layers";
import { DEFAULT_BREAKPOINTS } from "@/lib/breakpoints";
import { colourCss } from "@/lib/colour";
import { shiftHue } from "@/lib/hue";
import { newPageContent, type PageBlock, type PageContent, type PageRow } from "@/lib/page-content";
import { partCss, rowStyle } from "@/lib/part-css";
import { partStyleAt } from "@/lib/part-css.testing";

import { BackdropPicker, LayerFields } from "./admin/backdrop-fields";
import { PageArticle } from "./page-article";
import { BackgroundLayers, PartBackground, rowBox } from "./page-parts";

vi.mock("server-only", () => ({}));
vi.mock("@/server/place-lang", () => ({ placeLang: async () => "nb" }));

// Drawn without a site's theme: what is tested here is the page's own.
const NO_THEME = { elements: undefined, sections: undefined };

const glow: BackgroundLayer = { id: "g", type: "glow", color: "#d946ef", outer: "#7c3aed", x: 50, y: 63, width: 150, height: 40, scroll: -100, ambient: "breathe" };
const grid: BackgroundLayer = { id: "p", type: "pattern", pattern: "grid", color: "#ffffff", opacity: 9, fade: "edges", scroll: -22 };
const horizon: BackgroundLayer = { id: "h", type: "horizon", color: "#d946ef", fill: "#07051a", y: 64, scroll: -40 };
const stars: BackgroundLayer = { id: "s", type: "pattern", pattern: "stars", color: "#ffffff", scroll: 60, ambient: "twinkle" };
const base = BACKDROPS.horizon.background;

const heading = (id: string, text: string): PageBlock => ({ id, type: "heading", text, level: 2 }) as PageBlock;
const row = (extra: Partial<PageRow> = {}): PageRow => ({ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [heading("h1", "Over the backdrop")] }], ...extra });
const page = (...rows: PageRow[]): PageContent => ({ ...newPageContent(), title: "Backdrop", slug: "backdrop", rows });
const draw = (content: PageContent) =>
  renderToString(createElement(PageArticle, { content, place: { pageId: "p", owner: null, theme: NO_THEME }, inAdmin: true })).replace(/<!-- -->/g, "");
const layers = (props: Parameters<typeof BackgroundLayers>[0]) => renderToStaticMarkup(createElement(BackgroundLayers, props));

describe("the layers over a background, as drawn (D534)", () => {
  it("draws a frame of their own behind the content, each layer an element in the order kept, the lowest first", () => {
    const out = layers({ layers: [grid, glow, horizon, stars] });
    expect(out).toMatch(/^<div aria-hidden="true" class="absolute inset-0 -z-10 overflow-hidden \[border-radius:inherit\]" data-fx-bgroot="" data-fx-layers="">/);
    expect([...out.matchAll(/data-fx-bglayer="(\w+)"/g)].map((m) => m[1])).toEqual(["pattern", "glow", "horizon", "pattern"]);
    expect(out).toContain('data-fx-pattern="grid" data-fx-fade="edges"');
    expect(out).toContain("<span data-fx-glow=\"\"></span>");
    expect(out).toContain("<span data-fx-disc=\"\"></span>");
    // Nothing a visitor can press or a screen reader reads.
    expect(out).not.toMatch(/<(a|button|img)\b/);
  });

  it("gives each layer its own travel on the frame's timeline, so they move apart, and its movement by itself", () => {
    const out = layers({ layers: [grid, glow, horizon, stars] });
    expect([...out.matchAll(/data-fx-scroll="layer" data-fx-tl="parent"[^>]*--fx-sk:(-?[\d.]+)/g)].map((m) => Number(m[1]))).toEqual([-0.22, -1, -0.4, 0.6]);
    expect(out).toContain('data-fx-amb="breathe"');
    expect(out).toContain('data-fx-amb="twinkle"');
  });

  it("draws them still where asked (the canvas with its motion preview off), with nothing left that moves", () => {
    const out = layers({ layers: [grid, glow, horizon, stars], still: true });
    expect(out).not.toMatch(/data-fx-scroll|data-fx-amb|data-fx-tl|--fx-sk/);
    expect([...out.matchAll(/data-fx-bglayer/g)]).toHaveLength(4);
  });

  it("draws nothing for no layers, or layers all switched off", () => {
    expect(layers({ layers: undefined })).toBe("");
    expect(layers({ layers: [] })).toBe("");
    expect(layers({ layers: [{ ...glow, hidden: true }] })).toBe("");
    expect([...layers({ layers: [{ ...glow, hidden: true }, grid] }).matchAll(/data-fx-bglayer/g)]).toHaveLength(1);
  });

  it("turns the colours of the background and of every layer by the part's hue", () => {
    const out = renderToStaticMarkup(createElement(PartBackground, { background: base, layers: [glow], hue: 120 }));
    expect(out).toContain(`--fx-c1:${shiftHue("#1d1250", 120)}`);
    expect(out).not.toContain("#1d1250");
    expect(out).toContain(`--fx-lc1:${shiftHue("#d946ef", 120)}`);
    expect(out).not.toContain("#d946ef");
    // With no turn, the colours are the ones kept.
    const plain = renderToStaticMarkup(createElement(PartBackground, { background: base, layers: [glow] }));
    expect(plain).toContain("--fx-c1:#1d1250");
    expect(plain).toContain("--fx-lc1:#d946ef");
  });

  it("draws the layers over the background's own frame, and alone where the background is a colour or none", () => {
    const both = renderToStaticMarkup(createElement(PartBackground, { background: base, layers: [glow] }));
    expect(both.indexOf("data-fx-gradient")).toBeGreaterThan(-1);
    expect(both.indexOf("data-fx-layers")).toBeGreaterThan(both.indexOf("data-fx-gradient"));
    for (const background of [undefined, { type: "color" as const, color: "#07051a" }])
      expect(renderToStaticMarkup(createElement(PartBackground, { background, layers: [glow] }))).toMatch(/^<div aria-hidden="true"[^>]*data-fx-layers=""/);
  });
});

describe("a row with a backdrop on a page", () => {
  const backdrop = row({ background: base, backgroundLayers: [grid, glow, horizon, stars], backgroundHue: -130 });

  it("draws its layers in the row's background, with the content after them", () => {
    const out = draw(page(backdrop));
    expect(out).toContain("Over the backdrop");
    expect([...out.matchAll(/data-fx-bglayer/g)]).toHaveLength(4);
    expect(out.indexOf("data-fx-layers")).toBeLessThan(out.indexOf("Over the backdrop"));
    expect(out).toContain(`--fx-lc1:${shiftHue("#d946ef", -130)}`);
  });

  it("draws a column's layers too", () => {
    const out = draw(page(row({ columns: [{ id: "c1", blocks: [heading("h1", "In a card")], backgroundLayers: [glow], background: { type: "color", color: "#07051a" } }] })));
    expect([...out.matchAll(/data-fx-bglayer="glow"/g)]).toHaveLength(1);
  });

  it("marks the row for the colour set its turned background asks for, and turns a colour of its own", () => {
    expect(rowBox(backdrop, "site").className).toContain("kz-on-dark");
    expect(rowBox(row({ background: BACKDROPS.dots.background, backgroundHue: 90 }), "site").className).toContain("kz-on-light");
    const coloured = row({ background: { type: "color", color: "#1d1250" }, backgroundHue: 90 });
    expect(partStyleAt(partCss([coloured], "site", DEFAULT_BREAKPOINTS), rowStyle(coloured).className.split(" "), 1400)["background-color"]).toBe(colourCss(shiftHue("#1d1250", 90)));
  });
});

describe("the builder's backdrop panel", () => {
  const nothing = () => {};

  it("offers every ready-made backdrop by name, each drawn as it will look, and no hue until there is a colour to turn", () => {
    const out = renderToStaticMarkup(createElement(BackdropPicker, { background: undefined, layers: undefined, hue: undefined, onBackdrop: nothing, onHue: nothing }));
    for (const id of BACKDROP_IDS) {
      expect(out).toContain(`data-backdrop="${id}"`);
      expect(out).toContain(`aria-label="Use ${BACKDROP_WORDS.presets[id].name}"`);
    }
    expect([...out.matchAll(/data-fx-layers/g)]).toHaveLength(BACKDROP_IDS.length);
    // A picture of each: nothing in a tile moves.
    expect(out).not.toMatch(/data-fx-scroll|data-fx-amb/);
    expect(out).not.toContain("data-hue-field");
  });

  it("offers the hue as one slider once a backdrop is on, saying the turn in degrees", () => {
    const out = renderToStaticMarkup(createElement(BackdropPicker, { background: base, layers: [glow], hue: -130, onBackdrop: nothing, onHue: nothing }));
    expect(out).toContain("data-hue-field");
    const slider = out.match(/<input[^>]*type="range"[^>]*>/)?.[0] ?? "";
    for (const attribute of ['min="-180"', 'max="180"', 'step="5"', 'value="-130"', 'aria-valuetext="-130°"']) expect(slider).toContain(attribute);
    expect(out).toMatch(/<label[^>]*>Hue<\/label>/);
    expect(out).toContain("Original colours");
    // With no turn there is nothing to go back to.
    const still = renderToStaticMarkup(createElement(BackdropPicker, { background: base, layers: [glow], hue: undefined, onBackdrop: nothing, onHue: nothing }));
    expect(still).toMatch(/<button[^>]*disabled=""[^>]*>Original colours<\/button>/);
    expect(still).toContain('aria-valuetext="0°"');
  });

  it("keeps the layers one press away: closed until asked for, saying how many there are", () => {
    const some = renderToStaticMarkup(createElement(LayerFields, { layers: [grid, glow, horizon], onLayers: nothing }));
    expect(some).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*Customise the layers \(3\)<\/button>/);
    expect(some).not.toContain("<fieldset");
    const none = renderToStaticMarkup(createElement(LayerFields, { layers: undefined, onLayers: nothing }));
    expect(none).toContain("Add layers over the background");
  });
});
