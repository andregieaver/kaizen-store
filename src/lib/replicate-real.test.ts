import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ContentGridBlock, CustomGridItem, PageBlock, PageRow } from "./page-content";
import { buildReplica, type BuildInput } from "./replicate-build";
import { walk, type PageCapture } from "./replicate-capture";
import { tokensOf } from "./replicate-grid";

/**
 * Defects the calibration on real pages found (D155, C3), each held by a captured tree saved as a fixture in `fixtures/calibrate/`
 * (trimmed to what the case needs; coordinates are the page's own). No browser: the trees were captured by `scripts/replicate-calibrate.ts`.
 */

const fixture = (name: string): PageCapture => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "calibrate", `${name}.json`), "utf8")) as PageCapture;
let n = 0;
const input = (desktop: PageCapture): BuildInput => ({
  desktop,
  mobile: null,
  picture: (url) => ({ url: `/demo/${url.split("/").pop()}`, width: 800, height: 600 }),
  shot: (p) => ({ url: `/demo/shot-${p.replaceAll("/", "-")}.png`, width: 294, height: 88 }),
  video: () => null,
  font: () => null,
});
const blocksOf = (rows: PageRow[]): PageBlock[] => rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));
const gridsOf = (rows: PageRow[]) => blocksOf(rows).filter((b): b is ContentGridBlock => b.type === "contentGrid");
const wordsOf = (item: CustomGridItem) => [item.title, item.text, item.buttonLabel, item.badge, item.priceText, item.picture?.alt ?? "", ...item.details.flatMap((d) => [d.label, d.text])].flatMap(tokensOf);
const captureWords = (capture: PageCapture): Set<string> => {
  const words = new Set<string>();
  for (const node of walk(capture.root)) {
    if (node.runs) for (const w of tokensOf(node.runs.map((r) => (r.br ? " " : r.t)).join(""))) words.add(w);
    if (node.media?.kind === "img") for (const w of tokensOf(node.media.alt)) words.add(w);
    if (node.slide) for (const w of tokensOf(node.slide.text)) words.add(w);
  }
  return words;
};

describe("real pages: a bar fixed to the screen and decoration beside the content (tailwindcss.com, sponsors)", () => {
  // The page's top bar is fixed over its start, and the content has a gutter's hatched rule down each side and a layer of column lines behind
  // it: each used to make the whole page "a row of two columns", so no group of cards in it was ever looked at.
  const built = buildReplica(input(fixture("tailwind-sponsors")), () => `id-${++n}`);

  it("finds the logo wall as one grid of the eight logos, each a picture linked to its sponsor", () => {
    const grids = gridsOf(built.rows);
    expect(grids).toHaveLength(1);
    expect(grids[0].source).toEqual({ type: "custom" });
    const items = grids[0].items!;
    expect(items).toHaveLength(8);
    for (const item of items) {
      expect(item.picture?.url).toMatch(/^\/demo\/shot-/);
      expect(item.link).toMatchObject({ kind: "url" });
    }
    expect(built.grids.built[0]).toMatchObject({ cards: 8, items: 8 });
  });

  it("keeps the fixed bar apart from the page: it is not a column beside the page's content", () => {
    const rowOfTheGrid = built.rows.find((row) => row.columns.some((c) => c.blocks.some((b) => b.type === "contentGrid")))!;
    expect(rowOfTheGrid.columns).toHaveLength(1);
    // The heading above the logos stands in a row of one column too (before, the page's content was one column of a row with the bar as the other).
    const headingRow = built.rows.find((row) => JSON.stringify(row).includes("Supported by the best."))!;
    expect(headingRow.columns).toHaveLength(1);
  });

  it("names the decoration it leaves out, so the report can say it", () => {
    const shapes = built.dropped.filter((d) => d.kind === "shape");
    expect(shapes.length).toBeGreaterThanOrEqual(2);
    expect(shapes.some((d) => /decoration beside the content/.test(d.text ?? ""))).toBe(true);
  });

  it("never puts a word in an item that the page does not have", () => {
    const words = captureWords(fixture("tailwind-sponsors"));
    for (const item of gridsOf(built.rows)[0].items!) for (const w of wordsOf(item)) expect(words.has(w), w).toBe(true);
  });
});

describe("real pages: a slider of plain numbers (kenwheeler.github.io/slick, Multiple Items)", () => {
  // Nine slides of one number each, a loop's six copies, arrows and dots: "each box is one piece of text, like a menu" refused it, and the
  // six slides out of view were then missing from the copy. A slider with slides out of view is its content, whatever each slide holds.
  const capture = fixture("slick-text-slides");
  const built = buildReplica(input(capture), () => `id-${++n}`);

  it("builds one carousel of the nine real slides, in the slider's own order, without the copies", () => {
    const grids = gridsOf(built.rows);
    expect(grids).toHaveLength(1);
    expect(grids[0].display).toBe("carousel");
    expect(grids[0].items!.map((i) => i.title)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(grids[0].carousel).toMatchObject({ dots: true, rewind: true });
    expect(grids[0].carousel?.arrows).not.toBe(false);
  });

  it("reports the copies left out and the slides read out of view", () => {
    const g = built.grids.built[0];
    expect(g.carousel?.clones).toBe(6);
    expect(g.carousel?.script?.hidden).toBeGreaterThan(0);
    expect(built.grids.kept).toEqual([]);
  });

  it("still refuses a plain row of words that all show, in a box that does not slide", () => {
    // The same boxes with no copies, nothing out of view and no controls are a row of words (a menu, tabs), as before.
    const flat = fixture("slick-text-slides");
    for (const node of walk(flat.root)) {
      if (node.slider) {
        node.slider.arrows = [];
        node.slider.dots = null;
        node.children = node.children.filter((k) => !k.slide?.clone && k.slide?.hide === undefined);
      }
    }
    const rebuilt = buildReplica(input(flat), () => `id-${++n}`);
    expect(gridsOf(rebuilt.rows)).toHaveLength(0);
  });
});

describe("real pages: a skip link and a sticky header over the first section (shopify.com)", () => {
  // The page's wrapper holds a skip link placed over its corner and a sticky header the main content is drawn under: both overlapped the
  // content, so the whole page was one "row of columns" and the cards in it were never looked at.
  const capture = fixture("shopify-skip-link");
  const built = buildReplica(input(capture), () => `id-${++n}`);

  it("finds the cards in the main content", () => {
    const grids = gridsOf(built.rows);
    expect(grids).toHaveLength(1);
    expect(grids[0].items).toHaveLength(3);
    expect(built.grids.built[0].cards).toBe(3);
  });

  it("leaves the skip link out and names it, rather than drawing it as a column of the page", () => {
    expect(JSON.stringify(built.rows)).not.toContain("Skip to Content");
    expect(built.dropped.some((d) => d.kind === "shape" && /decoration/.test(d.text ?? ""))).toBe(true);
  });

  it("does not report the page's header, content and footer as boxes kept as columns", () => {
    expect(built.grids.kept.filter((k) => /footer|menu|list of links/.test(k.reason) && k.cards <= 3 && k.y < 10)).toEqual([]);
  });

  it("still keeps a visible link that merely says skip, in the flow of the page", () => {
    const flow = fixture("shopify-skip-link");
    for (const node of walk(flow.root)) if (node.runs?.some((r) => /Skip to Content/.test(r.t))) node.s.position = "static";
    const rebuilt = buildReplica(input(flow), () => `id-${++n}`);
    expect(JSON.stringify(rebuilt.rows)).toContain("Skip to Content");
  });
});

describe("real pages: the word rule on every captured tree kept as a fixture", () => {
  const dir = path.join(__dirname, "fixtures", "calibrate");
  const names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

  it("has the trees this file's cases use", () => {
    expect(names).toEqual(expect.arrayContaining(["tailwind-sponsors", "slick-text-slides", "shopify-skip-link"]));
  });

  it.each(names)("%s: no word in an item that the capture does not have, and every item's picture and link is from the capture", (name) => {
    const capture = fixture(name);
    const words = captureWords(capture);
    const addresses = new Set<string>();
    for (const node of walk(capture.root)) {
      if (node.href) addresses.add(node.href);
      for (const run of node.runs ?? []) if (run.href) addresses.add(run.href);
    }
    const built = buildReplica(input(capture), () => `id-${++n}`);
    for (const grid of gridsOf(built.rows)) {
      for (const item of grid.items ?? []) {
        for (const w of wordsOf(item)) expect(words.has(w), `${name}: "${w}"`).toBe(true);
        if (item.link?.kind === "url") expect(addresses.has(item.link.url), `${name}: ${item.link.url}`).toBe(true);
      }
    }
  });
});
