import { describe, expect, it } from "vitest";

import {
  AUTOPLAY_SECONDS,
  DEFAULT_CAROUSEL,
  activePage,
  carouselSettingsSchema,
  cleanCarousel,
  normalizeSeconds,
  pageCount,
  pageOffsets,
  resolveCarousel,
  snapAttribute,
  tilesPerScreen,
  type TrackMetrics,
} from "./carousel-settings";
import { newPageContent, pageInput } from "./page-content";
import { newBlock } from "./page-rows";

/** A row of `tiles` tiles, each `tile` wide with `gap` between, seen through `width`: what `Carousel` measures. */
const row = (tiles: number, width: number, tile: number, gap = 0, scroll = 0): TrackMetrics => ({
  scroll,
  max: Math.max(0, tiles * tile + (tiles - 1) * gap - width),
  width,
  tiles,
  tileWidth: tile,
  pitch: tile + gap,
});

describe("settings and their defaults", () => {
  it("is arrows only when nothing is set, as before", () => {
    expect(resolveCarousel()).toEqual(DEFAULT_CAROUSEL);
    expect(resolveCarousel(null)).toEqual({ arrows: true, dots: false, snap: "start", rewind: false, autoplay: null });
    expect(resolveCarousel({})).toEqual(DEFAULT_CAROUSEL);
    expect(snapAttribute()).toBeUndefined();
    expect(snapAttribute({ snap: "start" })).toBeUndefined();
    expect(snapAttribute({ snap: "center" })).toBe("center");
    expect(snapAttribute({ snap: "none" })).toBe("none");
  });

  it("fills in what is unset and reads an odd value as the default", () => {
    expect(resolveCarousel({ dots: true, autoplay: { seconds: 8 } })).toEqual({ arrows: true, dots: true, snap: "start", rewind: false, autoplay: { seconds: 8 } });
    expect(resolveCarousel({ arrows: false })).toMatchObject({ arrows: false });
    expect(resolveCarousel({ snap: "spin" as never }).snap).toBe("start");
    expect(resolveCarousel({ autoplay: { seconds: 99 } }).autoplay).toEqual({ seconds: 15 });
  });

  it("keeps only what differs from the default", () => {
    expect(cleanCarousel(undefined)).toBeUndefined();
    expect(cleanCarousel({ arrows: true, dots: false, snap: "start", rewind: false })).toBeUndefined();
    expect(cleanCarousel({ arrows: false, dots: true, snap: "center", rewind: true, autoplay: { seconds: 4 } })).toEqual({
      arrows: false,
      dots: true,
      snap: "center",
      rewind: true,
      autoplay: { seconds: 4 },
    });
    expect(cleanCarousel({ dots: true, autoplay: undefined })).toEqual({ dots: true });
  });

  it("takes autoplay's seconds as a whole number from 3 to 15", () => {
    expect([1, 2.4, 3, 7.6, 15, 16, 100].map(normalizeSeconds)).toEqual([3, 3, 3, 8, 15, 15, 15]);
    expect([Number.NaN, Infinity, "5", null, undefined].map(normalizeSeconds)).toEqual(Array(5).fill(AUTOPLAY_SECONDS.fallback));
  });
});

describe("the settings schema", () => {
  it("accepts every setting and an empty one", () => {
    expect(carouselSettingsSchema.parse({})).toEqual({});
    const all = { arrows: false, dots: true, snap: "none", rewind: true, autoplay: { seconds: 3 } };
    expect(carouselSettingsSchema.parse(all)).toEqual(all);
    expect(carouselSettingsSchema.parse({ autoplay: { seconds: 15 } })).toEqual({ autoplay: { seconds: 15 } });
  });

  it("refuses seconds out of range or not whole, an unknown snap and a wrong kind", () => {
    const refused = (value: unknown) => carouselSettingsSchema.safeParse(value).success === false;
    expect(refused({ autoplay: { seconds: 2 } })).toBe(true);
    expect(refused({ autoplay: { seconds: 16 } })).toBe(true);
    expect(refused({ autoplay: { seconds: 4.5 } })).toBe(true);
    expect(refused({ autoplay: { seconds: "5" } })).toBe(true);
    expect(refused({ autoplay: {} })).toBe(true);
    expect(refused({ snap: "end" })).toBe(true);
    expect(refused({ dots: "yes" })).toBe(true);
  });

  it("is a part of the content grid's and the testimonials' blocks, and left out when unset", () => {
    const page = (block: unknown) => ({
      ...newPageContent(),
      title: "Carousel",
      slug: "carousel",
      rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [block] }] }],
    });
    const parse = (block: unknown) => pageInput.parse(page(block)).rows[0].columns[0].blocks[0];
    const settings = { dots: true, rewind: true, autoplay: { seconds: 6 } };
    const grid = { ...newBlock("contentGrid", () => "g"), display: "carousel", carousel: settings };
    expect(parse(grid)).toMatchObject({ display: "carousel", carousel: settings });
    const quotes = { ...newBlock("testimonials", () => "t"), display: "carousel", carousel: settings };
    expect(parse(quotes)).toMatchObject({ carousel: settings });
    // Unset stays unset: a testimonials block saved as before is the same after.
    expect(parse(newBlock("testimonials", () => "t"))).not.toHaveProperty("carousel");
    expect(parse(newBlock("contentGrid", () => "g"))).not.toHaveProperty("carousel");
    expect(pageInput.safeParse(page({ ...grid, carousel: { autoplay: { seconds: 1 } } })).success).toBe(false);
    expect(pageInput.safeParse(page({ ...quotes, carousel: { snap: "diagonal" } })).success).toBe(false);
  });
});

describe("pages of tiles, for the dots", () => {
  it("counts the tiles that fit, from the width and the pitch", () => {
    expect(tilesPerScreen(row(9, 900, 300, 0))).toBe(3);
    // Three tiles and two gaps fill the width; rounding must not lose one.
    expect(tilesPerScreen(row(9, 3 * 280 + 2 * 24, 280, 24))).toBe(3);
    // A quarter of the next tile showing is not a tile.
    expect(tilesPerScreen(row(9, 3.25 * 300, 300, 0))).toBe(3);
    expect(tilesPerScreen(row(9, 100, 300))).toBe(1);
    expect(tilesPerScreen(row(2, 900, 100))).toBe(2);
    expect(tilesPerScreen({ width: 500, tiles: 0, tileWidth: 0, pitch: 0 })).toBe(1);
  });

  it("counts pages as the tiles over the tiles to a screen, rounded up", () => {
    expect(pageCount(0, 3)).toBe(0);
    expect(pageCount(1, 3)).toBe(1);
    expect(pageCount(3, 3)).toBe(1);
    expect(pageCount(4, 3)).toBe(2);
    expect(pageCount(9, 3)).toBe(3);
    expect(pageCount(10, 3)).toBe(4);
    expect(pageCount(5, 0)).toBe(5);
  });

  it("rests each page a screenful on, and the last at the end of the row", () => {
    expect(pageOffsets(row(9, 300, 100))).toEqual([0, 300, 600]);
    // Ten tiles, three to a screen: the last page holds one tile, so it rests at the end, not past it.
    expect(pageOffsets(row(10, 300, 100))).toEqual([0, 300, 600, 700]);
    expect(pageOffsets(row(4, 300, 100))).toEqual([0, 100]);
    // With gaps.
    expect(pageOffsets(row(6, 210, 100, 10))).toEqual([0, 220, 440]);
  });

  it("is one page when everything fits, and none without tiles", () => {
    expect(pageOffsets(row(3, 300, 100))).toEqual([0]);
    expect(pageOffsets(row(1, 300, 300))).toEqual([0]);
    expect(pageOffsets(row(0, 300, 100))).toEqual([]);
    expect(pageCount(3, tilesPerScreen(row(3, 300, 100)))).toBe(1);
  });

  it("follows scrolling: the page nearest, the earlier on a tie, the last at the end", () => {
    const offsets = pageOffsets(row(10, 300, 100));
    expect(activePage(offsets, 0)).toBe(0);
    expect(activePage(offsets, 149)).toBe(0);
    expect(activePage(offsets, 150)).toBe(0);
    expect(activePage(offsets, 151)).toBe(1);
    expect(activePage(offsets, 300)).toBe(1);
    expect(activePage(offsets, 600)).toBe(2);
    expect(activePage(offsets, 700)).toBe(3);
    expect(activePage([], 40)).toBe(0);
  });
});
