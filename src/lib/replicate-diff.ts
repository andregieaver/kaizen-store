import type { ReplicaScore } from "./replicate";

/**
 * How close a copy is to its original, as a number the owner can follow and the AI can aim at (D150). Both pictures are
 * made small first (the server shrinks them to a quarter), so a pixel here is a small square of the page and the
 * smoothing of letters does not count; a square is wrong when any of its colours is off by more than a little. The page is
 * judged in bands from top to bottom, so the weak places are known and a page that is longer or shorter than the original
 * loses what is not there.
 */

/** Pixels as RGBA, four bytes each, row after row. */
export type Raster = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/** How far a colour may be from the original's, out of 255, before the square counts as wrong. */
export const TOLERANCE = 28;
/** The height of a band, in pixels of the (smaller) picture. */
export const BAND = 30;

function wrong(a: Raster, b: Raster, x: number, y: number): boolean {
  const i = (y * a.width + x) * 4;
  const j = (y * b.width + x) * 4;
  return (
    Math.abs(a.data[i] - b.data[j]) > TOLERANCE ||
    Math.abs(a.data[i + 1] - b.data[j + 1]) > TOLERANCE ||
    Math.abs(a.data[i + 2] - b.data[j + 2]) > TOLERANCE
  );
}

/**
 * The match of a copy with its original, 0–100, with the weakest places. Both are as wide as each other (the server makes
 * them so); `scale` is how many pixels of the page one pixel here stands for, for the places given back in the page's own
 * pixels.
 */
export function compareRasters(original: Raster, copy: Raster, scale = 4): ReplicaScore {
  const width = Math.min(original.width, copy.width);
  const longest = Math.max(original.height, copy.height);
  const common = Math.min(original.height, copy.height);
  const bands: { y: number; height: number; match: number }[] = [];
  let right = 0;
  let total = 0;
  for (let top = 0; top < longest; top += BAND) {
    const bottom = Math.min(longest, top + BAND);
    const height = bottom - top;
    let good = 0;
    let all = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = 0; x < width; x++) {
        all += 1;
        if (y < common && !wrong(original, copy, x, y)) good += 1;
      }
    }
    // What the original has and the copy lacks, or the other way about, counts as wrong.
    all += (original.width - width) * height;
    bands.push({ y: Math.round(top * scale), height: Math.round(height * scale), match: all === 0 ? 100 : Math.round((good / all) * 1000) / 10 });
    right += good;
    total += all;
  }
  const match = total === 0 ? 100 : Math.round((right / total) * 1000) / 10;
  return { match, weakest: weakest(bands), heights: { original: Math.round(original.height * scale), copy: Math.round(copy.height * scale) } };
}

/** The weakest stretches: neighbouring weak bands joined, at most five, top to bottom. */
function weakest(bands: { y: number; height: number; match: number }[]): ReplicaScore["weakest"] {
  const bad = bands.filter((band) => band.match < 97);
  if (bad.length === 0) return [];
  const stretches: { y: number; height: number; match: number; n: number }[] = [];
  for (const band of bad) {
    const last = stretches[stretches.length - 1];
    if (last && band.y <= last.y + last.height + 1) {
      last.match = (last.match * last.n + band.match) / (last.n + 1);
      last.n += 1;
      last.height = band.y + band.height - last.y;
    } else stretches.push({ ...band, n: 1 });
  }
  return stretches
    .sort((a, b) => a.match * Math.sqrt(a.height) - b.match * Math.sqrt(b.height))
    .slice(0, 5)
    .sort((a, b) => a.y - b.y)
    .map((s) => ({ y: s.y, height: s.height, match: Math.round(s.match * 10) / 10 }));
}

/** A picture of the difference: the original faded, with the places that differ in red; as wide as the narrower of the two. */
export function diffRaster(original: Raster, copy: Raster): Raster {
  const width = Math.min(original.width, copy.width);
  const height = Math.max(original.height, copy.height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const inBoth = y < original.height && y < copy.height;
      if (inBoth && !wrong(original, copy, x, y)) {
        const i = (y * original.width + x) * 4;
        data[o] = 255 - (255 - original.data[i]) * 0.35;
        data[o + 1] = 255 - (255 - original.data[i + 1]) * 0.35;
        data[o + 2] = 255 - (255 - original.data[i + 2]) * 0.35;
      } else {
        data[o] = 235;
        data[o + 1] = 40;
        data[o + 2] = 60;
      }
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Whether a score is as good as a copy gets by pixels: no pass would be worth the time. */
export const isPerfect = (score: ReplicaScore | null): boolean => score === null || (score.match >= 99.6 && score.heights.original === score.heights.copy);

/**
 * The match of one stretch of the page, 0–100: `y` and `height` are in pixels of the page, `scale` how many of them one
 * pixel of the rasters stands for. What the copy does not reach counts as wrong; a stretch beyond the original is not asked.
 */
export function stretchMatch(original: Raster, copy: Raster, scale: number, y: number, height: number): number | null {
  const top = Math.max(0, Math.floor(y / scale));
  const bottom = Math.min(original.height, Math.ceil((y + height) / scale));
  if (bottom <= top) return null;
  const width = Math.min(original.width, copy.width);
  let good = 0;
  let all = 0;
  for (let row = top; row < bottom; row++) {
    for (let x = 0; x < width; x++) {
      all += 1;
      if (row < copy.height && !wrong(original, copy, x, row)) good += 1;
    }
  }
  return all === 0 ? null : Math.round((good / all) * 1000) / 10;
}
