import { describe, expect, it } from "vitest";

import { showVersion, shownVersions } from "./ab-shown";
import { DEAD_AFTER_MS, RAGE_COUNT, RAGE_GAP_MS, RAGE_RADIUS_PX, SCROLL_ALIVE_MS, SELECTION_ALIVE_MS } from "./click-signals";
import { addArrays, attentionSeconds, foldPercent, frustrationRank, projectCells, reachedShares, reachLines } from "./heat-read";
import {
  BAND_CAP_MS,
  BANDS,
  BIN_PX,
  CELL_KEEP_DAYS,
  deviceClass,
  HEAT_KEEP_DAYS,
  heatBody,
  IDLE_MS,
  MAX_BINS,
  MAX_HEAT_BYTES,
  MIN_MAP_VIEWS,
  MIN_VIEW_MS,
  REACH_BUCKETS,
  tagOf,
  TICK_MS,
  type HeatClick,
} from "./page-heat";

describe("the definitions (D656, docs/heatmaps-and-recordings.md section 3)", () => {
  it("are the numbers the plan writes down", () => {
    expect({ MIN_VIEW_MS, REACH_BUCKETS, BANDS, BIN_PX, MAX_BINS, TICK_MS, IDLE_MS, BAND_CAP_MS, MIN_MAP_VIEWS, HEAT_KEEP_DAYS, CELL_KEEP_DAYS }).toEqual({
      MIN_VIEW_MS: 1000,
      REACH_BUCKETS: 21,
      BANDS: 20,
      BIN_PX: 50,
      MAX_BINS: 400,
      TICK_MS: 250,
      IDLE_MS: 15000,
      BAND_CAP_MS: 120000,
      MIN_MAP_VIEWS: 30,
      HEAT_KEEP_DAYS: 396,
      CELL_KEEP_DAYS: 90,
    });
    expect({ DEAD_AFTER_MS, SCROLL_ALIVE_MS, SELECTION_ALIVE_MS, RAGE_COUNT, RAGE_GAP_MS, RAGE_RADIUS_PX }).toEqual({
      DEAD_AFTER_MS: 2500,
      SCROLL_ALIVE_MS: 300,
      SELECTION_ALIVE_MS: 100,
      RAGE_COUNT: 3,
      RAGE_GAP_MS: 1000,
      RAGE_RADIUS_PX: 30,
    });
  });

  it("classes a device by the store's breakpoints", () => {
    const bp = { md: 768, lg: 1024 };
    expect([deviceClass(390, bp), deviceClass(820, bp), deviceClass(1023, bp), deviceClass(1440, bp)]).toEqual(["mobile", "tablet", "tablet", "desktop"]);
    expect(deviceClass(820, { md: 900, lg: 1200 })).toBe("mobile");
  });
});

describe("the summary a page view sends (D656)", () => {
  const base = { store: "demo", path: "/no", seq: 0, device: "mobile" as const, att: new Array(20).fill(0), dv: 0 as const, rv: 0 as const, fv: 0 as const, ab: [] };

  it("keeps to 60 clicks, 5 versions and 8,000 bytes by dropping clicks from the end", () => {
    const clicks: HeatClick[] = Array.from({ length: 80 }, (_, i) => [`3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b${String(i).padStart(2, "0")}`, 1, 2, 0, 0]);
    const ab = Array.from({ length: 7 }, (_, i): [string, string] => [`e${i}`, "b"]);
    const body = heatBody({ ...base, clicks, ab });
    expect(body.v).toBe(1);
    expect(body.ab).toHaveLength(5);
    expect(body.clicks.length).toBeLessThanOrEqual(60);
    expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThanOrEqual(MAX_HEAT_BYTES);
    expect(body.clicks[0]).toEqual(clicks[0]);
  });

  it("names a test version", () => {
    expect(tagOf("3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c", "b")).toBe("3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c:b");
  });
});

describe("the versions shown on a page (D656)", () => {
  it("registers and takes away, counting markers that say the same", () => {
    const a = showVersion("e1", "b");
    const b = showVersion("e1", "b");
    const c = showVersion("e2", "a");
    expect(shownVersions()).toEqual([["e1", "b"], ["e2", "a"]]);
    a();
    a();
    expect(shownVersions()).toEqual([["e1", "b"], ["e2", "a"]]);
    b();
    c();
    expect(shownVersions()).toEqual([]);
  });
});

describe("reading the totals (D656)", () => {
  it("adds arrays, and turns the reach histogram into shares and lines", () => {
    expect(addArrays([[1, 2], [3, 4]], 2)).toEqual([4, 6]);
    const hist = new Array(21).fill(0);
    hist[20] = 25;
    hist[10] = 25;
    hist[0] = 50;
    const shares = reachedShares(hist);
    expect(shares[0]).toBe(1);
    expect(shares[10]).toBe(0.5);
    expect(shares[20]).toBe(0.25);
    expect(reachLines(shares)).toEqual({ p75: 0, p50: 10, p25: 20 });
    expect(reachedShares(new Array(21).fill(0))[0]).toBe(0);
  });

  it("works the fold and attention out per page view, and nothing without views", () => {
    expect(foldPercent(1500, 3)).toBe(50);
    expect(foldPercent(0, 0)).toBeNull();
    expect(attentionSeconds(new Array(20).fill(4000), 2)?.[0]).toBe(2);
    expect(attentionSeconds([], 0)).toBeNull();
  });

  it("ranks pages by frustration and leaves out pages with too few views", () => {
    const ranked = frustrationRank(
      [
        { page: "/no", views: 100, frustratedViews: 5 },
        { page: "/no/p/x", views: 40, frustratedViews: 10 },
        { page: "/no/tiny", views: 10, frustratedViews: 9 },
      ],
      30,
    );
    expect(ranked.map((r) => r.page)).toEqual(["/no/p/x", "/no"]);
    expect(ranked[0].frustration).toBe(0.25);
  });

  it("puts each cell in the middle of its place in the anchor's box, and counts the rest apart", () => {
    const layout = { v: 1 as const, w: 390, h: 2000, fold: 400, anchors: { a: [0, 100, 200, 100] as [number, number, number, number] } };
    expect(projectCells([{ anchor: "a", cx: 0, cy: 9, clicks: 3 }, { anchor: "gone", cx: 1, cy: 1, clicks: 2 }], layout)).toEqual({
      points: [{ x: 10, y: 195, weight: 3 }],
      missing: 2,
    });
  });
});
