/**
 * Heatmaps' numbers and the summary a page view sends (D656, `docs/heatmaps-and-recordings.md` section 3, the one place they are
 * defined; `page-heat.test.ts` holds them to it). Pure and browser-safe: no zod and no server module, as the storefront's collector
 * imports it; the server checks the summary with its own schema.
 */

import { ANCHOR_MAX } from "./heat-anchor";

export const HEAT_ENDPOINT = "/api/signals/heat";

/** A page view visible for less than this is never sent (an A/B reload, a bounce). */
export const MIN_VIEW_MS = 1000;
/** Scroll reach is kept in 5 % buckets: 0..20. */
export const REACH_BUCKETS = 21;
/** Attention is sent as 20 bands of 5 % of the page's height. */
export const BANDS = 20;
/** Attention is collected in bins of this many CSS px, at most `MAX_BINS` of them (the first 20,000 px). */
export const BIN_PX = 50;
export const MAX_BINS = 400;
/** The attention tick, and how long after the last input a visitor still counts as looking. */
export const TICK_MS = 250;
export const IDLE_MS = 15_000;
/** At most this much attention per band and page view. */
export const BAND_CAP_MS = 120_000;
/** At most this many clicks and test versions in one summary, and this many bytes in all. */
export const MAX_CLICKS = 60;
export const MAX_TAGS = 5;
export const MAX_HEAT_BYTES = 8000;
/** A map needs this many page views; A/B behaviour this many per version, its flag this many. */
export const MIN_MAP_VIEWS = 30;
export const MIN_VERSION_VIEWS = 100;
export const FLAG_VERSION_VIEWS = 2000;
/** How long the totals are kept: page totals 13 months, click cells 90 days. */
export const HEAT_KEEP_DAYS = 396;
export const CELL_KEEP_DAYS = 90;
/** Summaries a store takes in a day, against a script. */
export const HEAT_BEACONS_PER_STORE_DAY = 50_000;

export const HEAT_DEVICES = ["mobile", "tablet", "desktop"] as const;
export type HeatDevice = (typeof HEAT_DEVICES)[number];

/** The device class of a page view, by the width CSS media queries use and the store's breakpoints. */
export function deviceClass(innerWidth: number, breakpoints: { md: number; lg: number }): HeatDevice {
  return innerWidth < breakpoints.md ? "mobile" : innerWidth < breakpoints.lg ? "tablet" : "desktop";
}

/** One click: its anchor, its cell, and whether it was dead and whether it completed a rage run. */
export type HeatClick = [anchor: string, cx: number, cy: number, dead: 0 | 1, rage: 0 | 1];

/** What a page view sends: the first summary (`seq` 0) counts the view; continuations add attention, clicks and flags. */
export type HeatBody = {
  v: 1;
  store: string;
  /** The pathname the view started on, never a query. */
  path: string;
  seq: number;
  device: HeatDevice;
  /** Seq 0 only: the reach bucket (0..20), the fold (per mille) and the height attention covers (px). */
  reach?: number;
  fold?: number;
  attH?: number;
  /** 20 numbers: ms added since the last summary of this view. */
  att: number[];
  clicks: HeatClick[];
  /** This view's first dead, rage, and dead-or-rage click, since the last summary. */
  dv: 0 | 1;
  rv: 0 | 1;
  fv: 0 | 1;
  /** The test versions the visitor was shown on this view: [experiment id, version]. */
  ab: [string, string][];
};

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** The summary as sent: clicks cut to `MAX_CLICKS` and versions to `MAX_TAGS`, then clicks dropped from the end until it fits in `MAX_HEAT_BYTES`. */
export function heatBody(input: Omit<HeatBody, "v">): HeatBody {
  const body: HeatBody = {
    v: 1,
    ...input,
    clicks: input.clicks.filter(([anchor]) => anchor.length <= ANCHOR_MAX).slice(0, MAX_CLICKS),
    ab: input.ab.slice(0, MAX_TAGS),
  };
  while (body.clicks.length > 0 && bytes(JSON.stringify(body)) > MAX_HEAT_BYTES) body.clicks = body.clicks.slice(0, -1);
  return body;
}

/** A test version as heat totals and recordings name it. */
export const tagOf = (experiment: string, version: string) => `${experiment}:${version}`;
