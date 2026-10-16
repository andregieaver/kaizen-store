import { describe, expect, it } from "vitest";

import { findClaims } from "./claims";
import { LAUNCH_THEMES } from "./launch-themes";
import {
  HIGHLIGHT_KINDS,
  HIGHLIGHT_SIZE,
  backdropColours,
  closeupPlace,
  collageLayout,
  collageSections,
  highlightAlt,
  phoneDetailTop,
  readHighlightWords,
  themeHighlights,
} from "./theme-highlights";
import { readListing } from "./theme-store";
import type { ShotParts } from "./theme-shots";

/** A theme's highlights (`docs/theme-showcase-phase-2.md` step 2): their words, layout and what the theme page shows. */

const parts = (rows: [number, number][], product: [number, number] | null = null, length = 6000): ShotParts => ({
  length,
  header: { top: 0, height: 80 },
  rows: rows.map(([top, height]) => ({ top, height })),
  product: product ? { top: product[0], height: product[1] } : null,
  footer: { top: length - 400, height: 400 },
});

describe("a highlight's words", () => {
  it("keep a title and a line per kind, cut to their limits, and drop a kind without a title or one unknown", () => {
    const words = readHighlightWords({
      devices: { title: "  On   every screen ", text: "x".repeat(200) },
      collage: { title: "", text: "No title" },
      closeup: { title: "Up close" },
      sideways: { title: "Unknown" },
    });
    expect(words).toEqual({ devices: { title: "On every screen", text: "x".repeat(160) }, closeup: { title: "Up close", text: "" } });
    expect(readHighlightWords("nope")).toEqual({});
  });

  it("are kept in a listing only when some are written", () => {
    expect(readListing({ kinds: [] })).not.toHaveProperty("highlights");
    expect(readListing({ highlights: { collage: { title: "Room", text: "" } } }).highlights).toEqual({ collage: { title: "Room", text: "" } });
  });

  it("give a picture an alt text of what it shows, named for the theme (its words are its caption)", () => {
    expect(highlightAlt("Calm", "devices")).toBe("Calm: on a computer and two phones");
    expect(highlightAlt("Calm", "collage")).toBe("Calm: the page, section by section");
  });

  it("of the launch themes are written by hand, for all three, and make no claims", () => {
    for (const theme of LAUNCH_THEMES) {
      const words = readHighlightWords(theme.listing.highlights);
      expect(Object.keys(words), theme.key).toEqual([...HIGHLIGHT_KINDS]);
      for (const line of Object.values(words)) expect(findClaims(`${line.title}. ${line.text}`), `${theme.key}: ${line.title}`).toEqual([]);
    }
  });
});

describe("what the theme page shows", () => {
  const file = (name: string) => ({ path: `platform/theme-shots/t/u/${name}`, url: `https://x.test/${name}`, width: 1600, height: 1000, bytes: 1 });

  it("is each highlight made, in order, with its words where written", () => {
    const shown = themeHighlights("Calm", { closeup: file("c"), devices: file("d") }, { devices: { title: "On every screen", text: "Phones too." } });
    expect(shown.map((h) => [h.kind, h.title, h.text, h.alt])).toEqual([
      ["devices", "On every screen", "Phones too.", "Calm: on a computer and two phones"],
      ["closeup", null, null, "Calm: the product page up close"],
    ]);
    expect(themeHighlights("Calm", null)).toEqual([]);
  });
});

describe("the highlights' layout", () => {
  it("shows the second phone at the product, else the second row, never past the page", () => {
    expect(phoneDetailTop(parts([[80, 700], [780, 500]], [1300, 900]))).toBe(1300);
    expect(phoneDetailTop(parts([[80, 700], [780, 500]]))).toBe(780);
    expect(phoneDetailTop(parts([[80, 700]], [5900, 100]))).toBe(6000 - 844);
    expect(phoneDetailTop(null)).toBe(844);
  });

  it("cuts the collage from rows, the product and the footer tall enough, at most five, the page's opening first", () => {
    const sections = collageSections(parts([[80, 700], [780, 100], [880, 1400], [2280, 600], [2880, 600], [3480, 600], [4080, 600]], [4680, 700]));
    expect(sections).toHaveLength(5);
    expect(sections[0]).toEqual({ top: 80, height: 700 });
    // A tall section is cut; a short one is left out.
    expect(sections.some((s) => s.top === 880 && s.height === 900) || !sections.some((s) => s.top === 880)).toBe(true);
    expect(sections.some((s) => s.top === 780)).toBe(false);
    expect(collageSections(null)).toEqual([]);
  });

  it("lays the collage in two balanced columns inside the canvas, the second starting lower", () => {
    const sections = collageSections(parts([[80, 700], [780, 600], [1380, 600], [1980, 600]], [2580, 700]));
    const tiles = collageLayout(sections, 1440);
    expect(tiles).toHaveLength(sections.length);
    const lefts = [...new Set(tiles.map((t) => t.left))];
    expect(lefts).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.left).toBeGreaterThanOrEqual(0);
      expect(tile.left + tile.width).toBeLessThanOrEqual(HIGHLIGHT_SIZE.width);
      expect(tile.top).toBeLessThan(HIGHLIGHT_SIZE.height);
      expect(tile.width).toBeGreaterThanOrEqual(520);
      expect(tile.width).toBeLessThanOrEqual(700);
    }
    const firstTop = (left: number) => Math.min(...tiles.filter((t) => t.left === left).map((t) => t.top));
    expect(firstTop(Math.max(...lefts))).toBeGreaterThan(firstTop(Math.min(...lefts)));
  });

  it("centres a short collage in the canvas", () => {
    const [tile] = collageLayout([{ top: 0, height: 400 }], 1440);
    expect(tile.top).toBeGreaterThan(200);
    expect(tile.left + tile.width / 2).toBe(HIGHLIGHT_SIZE.width / 2);
  });

  it("fits the close-up in the canvas, never enlarged past its own size (or a little, when cut from the page)", () => {
    const place = closeupPlace(2048, 1300);
    expect(place.width).toBeLessThanOrEqual(HIGHLIGHT_SIZE.width - 240);
    expect(place.height).toBeLessThanOrEqual(HIGHLIGHT_SIZE.height - 180);
    expect(closeupPlace(600, 300)).toMatchObject({ width: 600, height: 300 });
    expect(closeupPlace(600, 300, 1.2)).toMatchObject({ width: 720, height: 360 });
  });

  it("tints the backdrop with the theme's accent, lighter at the start", () => {
    const { from, to } = backdropColours({ surface: "#ffffff", accent: "#000000" });
    expect(from).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseInt(from.slice(1, 3), 16)).toBeGreaterThan(parseInt(to.slice(1, 3), 16));
  });
});
