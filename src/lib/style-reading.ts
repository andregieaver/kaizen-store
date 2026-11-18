/**
 * The style text owners add to every document, and how many published pages use motion (bloat review step 1.23, GAP-styles-3). Pure: the
 * reading is taken by `styleReading()` in `src/server/style-reading.ts`; the lines are written in `docs/performance.md`.
 */

/** The median store above this many bytes: look again at serving owners' CSS as an external stylesheet. */
export const STYLE_MEDIAN_LINE = 10_000;
/** A store above this many bytes: its sheets move to one external hashed stylesheet, and the page marks it. */
export const STYLE_STORE_LINE = 20_000;
/** Under this share of published pages using motion: motion.css is loaded only where a page uses it (step 2.49). */
export const MOTION_SHARE_LINE = 0.5;

export type StyleRow = {
  storeId: string | null;
  slug: string | null;
  name: string | null;
  cssBytes: number;
  pages: number;
  motionPages: number;
};

export type StyleTrigger = "median" | "store" | "motion";

/** Whether a store's own, header's and footer's CSS together pass the store line. */
export function styleOver(row: Pick<StyleRow, "cssBytes">): boolean {
  return row.cssBytes > STYLE_STORE_LINE;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function styleSummary(rows: readonly StyleRow[]): {
  stores: number;
  medianBytes: number;
  over: number;
  pages: number;
  motionPages: number;
  motionShare: number | null;
  triggers: StyleTrigger[];
} {
  const medianBytes = median(rows.map((r) => r.cssBytes));
  const over = rows.filter(styleOver).length;
  const pages = rows.reduce((sum, r) => sum + r.pages, 0);
  const motionPages = rows.reduce((sum, r) => sum + r.motionPages, 0);
  const motionShare = pages === 0 ? null : motionPages / pages;
  const triggers: StyleTrigger[] = [];
  if (medianBytes > STYLE_MEDIAN_LINE) triggers.push("median");
  if (over > 0) triggers.push("store");
  if (motionShare !== null && motionShare < MOTION_SHARE_LINE) triggers.push("motion");
  return { stores: rows.length, medianBytes, over, pages, motionPages, motionShare, triggers };
}
