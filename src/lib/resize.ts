import { CONTENT_MAX_MAX, CONTENT_MAX_MIN } from "./page-content";

/**
 * The arithmetic of resizing on the page builder's canvas (D182): dragging a row's side edges changes how wide its
 * content may be, dragging the edge between two columns changes how the row's width is shared. Pure, so the drag, the
 * keyboard and the tests agree.
 */

/** A column is never narrower than this share of its row (of 100). */
export const MIN_SHARE = 5;
/** A row's width snaps to steps of this many pixels, unless Shift is held. */
export const WIDTH_STEP = 8;

/**
 * The columns' widths as measured (any unit) as whole shares of 100 that add up to 100: each rounded down, the rest given
 * to the largest fractions first. A column no wider than nothing gets the least share.
 */
export function sharesOf(widths: readonly number[]): number[] {
  const total = widths.reduce((sum, width) => sum + Math.max(0, width), 0);
  if (widths.length === 0) return [];
  if (total <= 0) return widths.map((_, i) => Math.floor(100 / widths.length) + (i < 100 % widths.length ? 1 : 0));
  const exact = widths.map((width) => (Math.max(0, width) / total) * 100);
  const shares = exact.map((value) => Math.max(MIN_SHARE, Math.floor(value)));
  let left = 100 - shares.reduce((sum, share) => sum + share, 0);
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length) {
    shares[order[k].i] += 1;
    left -= 1;
  }
  // Taking the least share from the widest, if keeping each at least that much made the sum too large.
  while (left < 0) {
    const widest = shares.indexOf(Math.max(...shares));
    if (shares[widest] <= MIN_SHARE) break;
    shares[widest] -= 1;
    left += 1;
  }
  return shares;
}

/**
 * The shares after the edge between column `edge` and the next one moves by `delta` (of 100, to the right positive): only
 * those two change, together keeping what they had, each at least `MIN_SHARE`.
 */
export function moveEdge(shares: readonly number[], edge: number, delta: number): number[] {
  if (edge < 0 || edge >= shares.length - 1) return [...shares];
  const pair = shares[edge] + shares[edge + 1];
  const least = MIN_SHARE;
  const most = pair - MIN_SHARE;
  if (most < least) return [...shares];
  const left = Math.min(Math.max(Math.round(shares[edge] + delta), least), most);
  const next = [...shares];
  next[edge] = left;
  next[edge + 1] = pair - left;
  return next;
}

/** A row's content width after dragging: snapped to `WIDTH_STEP` (not with `free`), kept between the least and the most a row can hold, and no wider than the room. */
export function dragWidth(px: number, options: { free?: boolean; room?: number } = {}): number {
  const snapped = options.free ? Math.round(px) : Math.round(px / WIDTH_STEP) * WIDTH_STEP;
  const most = Math.min(CONTENT_MAX_MAX, Math.max(CONTENT_MAX_MIN, options.room ?? CONTENT_MAX_MAX));
  return Math.min(Math.max(snapped, CONTENT_MAX_MIN), most);
}
