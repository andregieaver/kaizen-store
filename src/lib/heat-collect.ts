/**
 * Scroll reach and attention for one page view (D656, `docs/heatmaps-and-recordings.md` sections 3 and 7.3). Pure: the storefront's heat
 * collector feeds it what the window says and sends what it returns; no DOM here, so it is tested in Node.
 */

import { BAND_CAP_MS, BANDS, BIN_PX, MAX_BINS, TICK_MS } from "./page-heat";

// ---------------------------------------------------------------------------
// Scroll reach
// ---------------------------------------------------------------------------

export type ReachState = { maxBottom: number; maxHeight: number; fold: number | null };

export const NO_REACH: ReachState = { maxBottom: 0, maxHeight: 0, fold: null };

/** Takes one measurement: the deepest point seen and the tallest the page was, and the fold at the first. */
export function reachStep(s: ReachState, m: { scrollY: number; innerHeight: number; scrollHeight: number }): ReachState {
  const fold = s.fold ?? (m.scrollHeight > 0 ? Math.min(1000, Math.round((1000 * m.innerHeight) / m.scrollHeight)) : 1000);
  return { maxBottom: Math.max(s.maxBottom, m.scrollY + m.innerHeight), maxHeight: Math.max(s.maxHeight, m.scrollHeight), fold };
}

/** The share of the page seen, in 5 % buckets (0..20): 20 when the page was never taller than the window. */
export function reachBucket(s: ReachState, innerHeight: number): number {
  if (s.maxHeight <= innerHeight || s.maxHeight <= 0) return 20;
  const reach = Math.min(100, Math.floor((100 * s.maxBottom) / s.maxHeight));
  return Math.floor(reach / 5);
}

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

export type AttentionState = {
  /** Ms each 50 px bin of the page was on screen, counted in ticks. */
  bins: number[];
  /** The bins on screen at the last tick; null after a tick that did not count. */
  lastVisible: Set<number> | null;
  /** What the view's summaries have already sent, per band. */
  sentBands: number[];
  /** The height the bands cover, fixed by the first summary; null before it. */
  attH: number | null;
};

export const newAttention = (): AttentionState => ({ bins: new Array<number>(MAX_BINS).fill(0), lastVisible: null, sentBands: new Array<number>(BANDS).fill(0), attH: null });

/**
 * One tick: while the tab is visible and the visitor gave input lately, each bin whose middle line is on screen now and was at the last tick
 * gets `TICK_MS` (so fly-by scrolling counts nothing).
 */
export function attentionTick(s: AttentionState, m: { scrollY: number; innerHeight: number; active: boolean; visible: boolean }): AttentionState {
  if (!m.visible || !m.active) return { ...s, lastVisible: null };
  const visible = new Set<number>();
  const first = Math.max(0, Math.floor((m.scrollY - BIN_PX / 2) / BIN_PX));
  for (let i = first; i < MAX_BINS; i++) {
    const middle = i * BIN_PX + BIN_PX / 2;
    if (middle > m.scrollY + m.innerHeight) break;
    if (middle >= m.scrollY) visible.add(i);
  }
  const bins = s.lastVisible ? s.bins.map((ms, i) => (visible.has(i) && s.lastVisible!.has(i) ? ms + TICK_MS : ms)) : s.bins;
  return { ...s, bins, lastVisible: visible };
}

/**
 * The 20 bands of the height attention covers: each the mean of the bins whose middle line falls in it, or the bin under its middle when
 * none does, capped per band. The height is `min(page height, 20,000 px)`, fixed at the view's first summary (`attH`).
 */
export function attentionBands(s: AttentionState, maxHeight: number): { bands: number[]; attH: number } {
  const attH = s.attH ?? Math.max(1, Math.min(maxHeight, MAX_BINS * BIN_PX));
  const bands: number[] = [];
  for (let b = 0; b < BANDS; b++) {
    const lo = (b * attH) / BANDS;
    const hi = ((b + 1) * attH) / BANDS;
    let sum = 0;
    let n = 0;
    for (let i = Math.floor(lo / BIN_PX); i < MAX_BINS && i * BIN_PX + BIN_PX / 2 < hi; i++) {
      const middle = i * BIN_PX + BIN_PX / 2;
      if (middle >= lo) {
        sum += s.bins[i];
        n += 1;
      }
    }
    const value = n > 0 ? sum / n : s.bins[Math.min(MAX_BINS - 1, Math.floor((lo + hi) / 2 / BIN_PX))];
    bands.push(Math.min(BAND_CAP_MS, Math.round(value)));
  }
  return { bands, attH };
}

/** What a summary adds per band since the last one (never below zero), and the state that remembers it was sent. */
export function attentionDelta(s: AttentionState, maxHeight: number): { delta: number[]; attH: number; next: AttentionState } {
  const { bands, attH } = attentionBands(s, maxHeight);
  const delta = bands.map((ms, i) => Math.max(0, ms - s.sentBands[i]));
  return { delta, attH, next: { ...s, attH, sentBands: bands.map((ms, i) => Math.max(ms, s.sentBands[i])) } };
}
