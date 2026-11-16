/**
 * Heatmaps' figures from the daily totals (D656, `docs/heatmaps-and-recordings.md` 8.5): pure, so the admin's reads and the pages share one
 * arithmetic. Arrays are summed here, never by a model; a figure below its minimum volume is left out, never shown as a guess.
 */

import { BANDS, REACH_BUCKETS } from "./page-heat";

/** Adds arrays of equal length element by element (an empty start takes the first one). */
export function addArrays(arrays: readonly (readonly number[])[], length: number): number[] {
  const out = new Array<number>(length).fill(0);
  for (const array of arrays) for (let i = 0; i < length; i++) out[i] += Number(array[i] ?? 0);
  return out;
}

/** For each 5 % step b (0..20): the share of page views that reached at least b × 5 %. */
export function reachedShares(hist: readonly number[]): number[] {
  const views = hist.reduce((a, b) => a + b, 0);
  const out = new Array<number>(REACH_BUCKETS).fill(0);
  if (views === 0) return out;
  let atLeast = 0;
  for (let b = REACH_BUCKETS - 1; b >= 0; b--) {
    atLeast += hist[b] ?? 0;
    out[b] = atLeast / views;
  }
  return out;
}

/** The deepest step (0..20) that at least 75 %, 50 % and 25 % of page views reached. */
export function reachLines(shares: readonly number[]): { p75: number; p50: number; p25: number } {
  const deepest = (share: number) => {
    let at = 0;
    for (let b = 0; b < shares.length; b++) if (shares[b] >= share) at = b;
    return at;
  };
  return { p75: deepest(0.75), p50: deepest(0.5), p25: deepest(0.25) };
}

/** The average fold as a percentage of the page, or null without views. */
export const foldPercent = (foldSum: number, views: number): number | null => (views > 0 ? foldSum / views / 10 : null);

/** Seconds per page view for each band, or null without views. */
export const attentionSeconds = (bands: readonly number[], views: number): number[] | null =>
  views > 0 ? Array.from({ length: BANDS }, (_, i) => (bands[i] ?? 0) / views / 1000) : null;

export type PageTotals = { page: string; views: number; frustratedViews: number };

/** Pages with enough views, most frustrated first (by share of views with a dead or rage click, then by views). */
export function frustrationRank<T extends PageTotals>(rows: readonly T[], minViews: number): (T & { frustration: number })[] {
  return rows
    .filter((row) => row.views >= minViews)
    .map((row) => ({ ...row, frustration: row.frustratedViews / row.views }))
    .sort((a, b) => b.frustration - a.frustration || b.views - a.views || a.page.localeCompare(b.page));
}

export type CellTotal = { anchor: string; cx: number; cy: number; clicks: number };
export type MapLayout = { v: 1; w: number; h: number; fold: number; anchors: Record<string, [number, number, number, number]> };

/** Where each cell's clicks fall on the picture: the middle of the cell inside its anchor's box; clicks on anchors not in the picture are counted apart. */
export function projectCells(cells: readonly CellTotal[], layout: MapLayout): { points: { x: number; y: number; weight: number }[]; missing: number } {
  const points: { x: number; y: number; weight: number }[] = [];
  let missing = 0;
  for (const cell of cells) {
    const box = layout.anchors[cell.anchor];
    if (!box) {
      missing += cell.clicks;
      continue;
    }
    const [x, y, w, h] = box;
    points.push({ x: x + ((cell.cx + 0.5) * w) / 10, y: y + ((cell.cy + 0.5) * h) / 10, weight: cell.clicks });
  }
  return { points, missing };
}
