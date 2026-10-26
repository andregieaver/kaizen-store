import "server-only";

import opentype from "opentype.js";

import { log } from "./log";
import { findFont } from "./fonts";

/**
 * A font's outlines for drawing a brand mark (D330 F2a, `docs/ai-autopilot.md` 14.3): Google Fonts' TrueType file for a family and weight,
 * asked as CSS of `fonts.googleapis.com` and fetched only from `fonts.gstatic.com`, read by `opentype.js`, kept in memory. The site's own
 * font files are WOFF2, which the reader does not take; the family is the same.
 */

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const CSS_HOST = "fonts.googleapis.com";
const FILE_HOST = "fonts.gstatic.com";
/** The largest font file read. */
const MAX_FONT_BYTES = 5_000_000;

const kept = new Map<string, opentype.Font>();

/** The weight nearest to the one wanted among a family's weights (ties go to the heavier). */
export function nearestWeight(weights: readonly number[], wanted: number): number {
  if (weights.length === 0) return 400;
  return [...weights].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || b - a)[0];
}

const hostIs = (url: string, host: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === host;
  } catch {
    return false;
  }
};

export type Outlines = { ok: true; font: opentype.Font; family: string; weight: number } | { ok: false; problem: string };

/** The family's outlines at the nearest weight it has; a problem in words when the family is unknown or cannot be fetched. */
export async function fontOutlines(family: string, weight: number, fetcher: Fetcher = fetch): Promise<Outlines> {
  const font = findFont(family);
  if (!font) return { ok: false, problem: `"${family}" is not in the font catalogue (Google Fonts).` };
  const chosen = nearestWeight(font.weights, weight);
  const key = `${font.family}:${chosen}`;
  const cached = kept.get(key);
  if (cached) return { ok: true, font: cached, family: font.family, weight: chosen };
  try {
    const cssUrl = `https://${CSS_HOST}/css2?family=${encodeURIComponent(font.family).replace(/%20/g, "+")}:wght@${chosen}`;
    // No browser's name is sent, so Google answers with TrueType files, which the reader takes.
    const css = await fetcher(cssUrl, { signal: AbortSignal.timeout(10_000) });
    if (!css.ok) throw new Error(`Google Fonts answered ${css.status}`);
    const file = (await css.text()).match(/url\((https:\/\/[^)\s]+)\)\s*format\(['"]truetype['"]\)/)?.[1];
    if (!file || !hostIs(file, FILE_HOST)) throw new Error("Google Fonts sent no TrueType file for it.");
    const response = await fetcher(file, { signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) throw new Error(`Google Fonts answered ${response.status} for the file`);
    const data = await response.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > MAX_FONT_BYTES) throw new Error("The font file was empty or too large.");
    const parsed = opentype.parse(data);
    kept.set(key, parsed);
    return { ok: true, font: parsed, family: font.family, weight: chosen };
  } catch (error) {
    log("warn", "brand.font_outlines_failed", { family: font.family, weight: chosen }, error);
    return { ok: false, problem: `${font.family} could not be fetched from Google Fonts to draw the mark. Try again in a moment, or choose another font.` };
  }
}

/** Forgets the fonts kept in memory (tests). */
export const forgetFontOutlines = () => kept.clear();
