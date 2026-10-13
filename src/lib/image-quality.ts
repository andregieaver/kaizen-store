/**
 * Whether a compressed picture looks the same as what it was made from (D213). Pure, so the browser's compressor
 * (`src/lib/image-compress.ts`) and the tests share it. Two pictures of the same size are compared by structural similarity
 * (SSIM, Wang et al. 2004) in 8 × 8 windows, four pixels apart: on brightness (Y), where the eye sees detail, and on colour
 * (Cb, Cr), where encoders save most. A picture with see-through parts is compared over white and over black, so a change in
 * its transparency counts.
 *
 * "The same" is `looksTheSame()`: the average window close to identical, and the worst windows (the lowest hundredth) still
 * close, so a sharp edge or a line of small text that blurred is not hidden by a large calm sky.
 */
import { formatBytes } from "./image-size";

/** RGBA pixels, as a canvas's `getImageData()` gives them. */
export type Pixels = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

export type Likeness = {
  /** Mean SSIM of brightness, 0 to 1. */
  luma: number;
  /** The lowest hundredth of the brightness windows' SSIM: how bad the worst parts are. */
  lumaLow: number;
  /** Mean SSIM of the two colour channels. */
  chroma: number;
  /** For a large picture, mean SSIM of brightness at its full size too, so fine grain is not smoothed away. */
  lumaFull?: number;
};

/** The bar for "looks the same" (`looksTheSame()`), each chosen so that a difference is not seen at the size it is shown. */
export const SAME = { luma: 0.985, lumaLow: 0.93, chroma: 0.97, lumaFull: 0.975 } as const;

export const looksTheSame = (likeness: Likeness): boolean =>
  likeness.luma >= SAME.luma &&
  likeness.lumaLow >= SAME.lumaLow &&
  likeness.chroma >= SAME.chroma &&
  (likeness.lumaFull === undefined || likeness.lumaFull >= SAME.lumaFull);

const WINDOW = 8;
const STEP = 4;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

type Channels = { y: Float32Array; cb: Float32Array; cr: Float32Array };

/** Brightness and colour of each pixel, laid over a background (`over`, 0 black to 255 white) where it is see-through. */
function channels(pixels: Pixels, over: number): Channels {
  const count = pixels.width * pixels.height;
  const y = new Float32Array(count);
  const cb = new Float32Array(count);
  const cr = new Float32Array(count);
  const data = pixels.data;
  for (let i = 0; i < count; i++) {
    const a = data[i * 4 + 3] / 255;
    const r = data[i * 4] * a + over * (1 - a);
    const g = data[i * 4 + 1] * a + over * (1 - a);
    const b = data[i * 4 + 2] * a + over * (1 - a);
    y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  return { y, cb, cr };
}

/** SSIM of every window of one channel, in reading order. */
function windows(a: Float32Array, b: Float32Array, width: number, height: number): Float64Array {
  const size = Math.min(WINDOW, width, height);
  const across = Math.max(1, Math.floor((width - size) / STEP) + 1);
  const down = Math.max(1, Math.floor((height - size) / STEP) + 1);
  const scores = new Float64Array(across * down);
  const n = size * size;
  let k = 0;
  for (let wy = 0; wy < down; wy++) {
    for (let wx = 0; wx < across; wx++) {
      const x0 = wx * STEP;
      const y0 = wy * STEP;
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = y0; y < y0 + size; y++) {
        let i = y * width + x0;
        for (let x = 0; x < size; x++, i++) {
          const va = a[i];
          const vb = b[i];
          sa += va;
          sb += vb;
          saa += va * va;
          sbb += vb * vb;
          sab += va * vb;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      const va = Math.max(0, saa / n - ma * ma);
      const vb = Math.max(0, sbb / n - mb * mb);
      const cov = sab / n - ma * mb;
      scores[k++] = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    }
  }
  return scores;
}

const mean = (scores: Float64Array) => scores.reduce((sum, s) => sum + s, 0) / scores.length;

/** The value below which a hundredth of the windows fall. */
function lowHundredth(scores: Float64Array): number {
  const sorted = Float64Array.from(scores).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 100))];
}

function hasTransparency(pixels: Pixels): boolean {
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] < 255) return true;
  return false;
}

function likenessOver(a: Pixels, b: Pixels, over: number): Likeness {
  const ca = channels(a, over);
  const cb = channels(b, over);
  const luma = windows(ca.y, cb.y, a.width, a.height);
  return {
    luma: mean(luma),
    lumaLow: lowHundredth(luma),
    chroma: (mean(windows(ca.cb, cb.cb, a.width, a.height)) + mean(windows(ca.cr, cb.cr, a.width, a.height))) / 2,
  };
}

/**
 * Half the size, each pixel the average of four: how a picture is seen. A picture is kept at up to 1600 pixels so that it
 * stays sharp on screens with two pixels to each of the page's, so a difference in a single pixel is not seen; measuring at
 * full size would call fine texture (leaves, gravel, fabric) changed when no one could tell.
 */
export function halved(pixels: Pixels): Pixels {
  const width = Math.max(1, Math.floor(pixels.width / 2));
  const height = Math.max(1, Math.floor(pixels.height / 2));
  if (pixels.width < 2 || pixels.height < 2) return pixels;
  const data = new Uint8ClampedArray(width * height * 4);
  const source = pixels.data;
  const row = pixels.width * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * 2 * row + x * 8;
      for (let c = 0; c < 4; c++) {
        data[(y * width + x) * 4 + c] = (source[i + c] + source[i + 4 + c] + source[i + row + c] + source[i + row + 4 + c] + 2) >> 2;
      }
    }
  }
  return { data, width, height };
}

/** Pictures smaller than this on their long side are measured as they are, as they may be shown at their own size. */
const HALVE_FROM = 960;

/** How alike `copy` is to `original` (the same width and height), as they are seen (`halved()` for large ones). */
export function likeness(original: Pixels, copy: Pixels): Likeness {
  if (original.width !== copy.width || original.height !== copy.height) throw new Error("Pictures of different sizes cannot be compared.");
  if (Math.max(original.width, original.height) < HALVE_FROM) return likenessAsIs(original, copy);
  const seen = likenessAsIs(halved(original), halved(copy));
  const lumaFull = mean(windows(channels(original, 255).y, channels(copy, 255).y, original.width, original.height));
  return { ...seen, lumaFull };
}

function likenessAsIs(original: Pixels, copy: Pixels): Likeness {
  if (!hasTransparency(original) && !hasTransparency(copy)) return likenessOver(original, copy, 255);
  const white = likenessOver(original, copy, 255);
  const black = likenessOver(original, copy, 0);
  return {
    luma: Math.min(white.luma, black.luma),
    lumaLow: Math.min(white.lumaLow, black.lumaLow),
    chroma: Math.min(white.chroma, black.chroma),
  };
}

/**
 * The lowest setting between `low` and `high` whose result `passes`, by halving the range (`steps` tries); a result only
 * gets better as the setting rises. Returns `high` when nothing lower passes, so a picture is never made worse than the
 * highest setting allowed.
 */
export async function lowestPassing<T>(
  low: number,
  high: number,
  steps: number,
  attempt: (setting: number) => Promise<T>,
  passes: (result: T) => boolean,
): Promise<{ setting: number; result: T }> {
  let best: { setting: number; result: T } | null = null;
  let lo = low;
  let hi = high;
  for (let i = 0; i < steps; i++) {
    const mid = Math.round(((lo + hi) / 2) * 100) / 100;
    const result = await attempt(mid);
    if (passes(result)) {
      best = { setting: mid, result };
      hi = mid;
    } else {
      lo = mid;
    }
    if (hi - lo <= 0.01) break;
  }
  if (best) return best;
  return { setting: high, result: await attempt(high) };
}

/** A saving as people read it: "Saved 4.2 MB (82%)", or null when there was none worth saying. */
export function savingWords(before: number, after: number): string | null {
  if (before <= 0 || after >= before) return null;
  const saved = before - after;
  const percent = Math.round((saved / before) * 100);
  if (percent < 1) return null;
  return `Saved ${formatBytes(saved)} (${percent}%)`;
}
