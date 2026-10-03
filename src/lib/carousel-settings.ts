import { z } from "zod";

/**
 * What a carousel does beyond scrolling (D155, B), shared by the content grid
 * and testimonials. Pure, shared with the browser (the page builder, the
 * schema, `Carousel`). The row itself stays the browser's own scrolling; these
 * are the arrows, the dots, where a tile rests, going round, and an optional
 * autoplay that is safe by construction (see `carousel-controller.ts`).
 */

export const CAROUSEL_SNAPS = { start: "Start of the tile", center: "Centre of the tile", none: "Free scrolling" } as const;
export type CarouselSnap = keyof typeof CAROUSEL_SNAPS;

/** Seconds on each page when a carousel plays by itself: from 3 to 15. */
export const AUTOPLAY_SECONDS = { min: 3, max: 15, fallback: 5 } as const;

export type CarouselSettings = {
  /** Previous and next buttons; shown unless off. */
  arrows?: boolean;
  /** One dot per page of tiles, each a button; off unless set. */
  dots?: boolean;
  /** Where a tile comes to rest when scrolling stops; "start" unless set. */
  snap?: CarouselSnap;
  /** Past the last tile the next button goes back to the first: the real tiles only, nothing cloned. Off unless set. */
  rewind?: boolean;
  /** Moves by itself every `seconds` (3 to 15) until the visitor does anything; off unless set. */
  autoplay?: { seconds: number };
};

/** Every setting, with what unset means. */
export type ResolvedCarousel = {
  arrows: boolean;
  dots: boolean;
  snap: CarouselSnap;
  rewind: boolean;
  autoplay: { seconds: number } | null;
};

export const DEFAULT_CAROUSEL: ResolvedCarousel = { arrows: true, dots: false, snap: "start", rewind: false, autoplay: null };

/** A number of seconds as autoplay takes it: a whole number from 3 to 15; anything that is not a number is 5. */
export function normalizeSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return AUTOPLAY_SECONDS.fallback;
  return Math.min(AUTOPLAY_SECONDS.max, Math.max(AUTOPLAY_SECONDS.min, Math.round(value)));
}

/** A carousel's settings with the unset ones filled in. Tolerant: unknown values read as the default. */
export function resolveCarousel(settings?: CarouselSettings | null): ResolvedCarousel {
  const given = settings ?? {};
  return {
    arrows: given.arrows !== false,
    dots: given.dots === true,
    snap: given.snap === "center" || given.snap === "none" ? given.snap : "start",
    rewind: given.rewind === true,
    autoplay: given.autoplay ? { seconds: normalizeSeconds(given.autoplay.seconds) } : null,
  };
}

/** The settings as they are kept: only what differs from the default, or nothing when all is default. */
export function cleanCarousel(settings?: CarouselSettings | null): CarouselSettings | undefined {
  const resolved = resolveCarousel(settings);
  const clean: CarouselSettings = {
    ...(!resolved.arrows && { arrows: false }),
    ...(resolved.dots && { dots: true }),
    ...(resolved.snap !== "start" && { snap: resolved.snap }),
    ...(resolved.rewind && { rewind: true }),
    ...(resolved.autoplay && { autoplay: resolved.autoplay }),
  };
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/** The part of the settings that is a key for effects: changes only when a setting does. */
export const carouselKey = (settings?: CarouselSettings | null) => JSON.stringify(resolveCarousel(settings));

/** The track's `data-snap`, for the style sheet: only where it is not the usual start. */
export const snapAttribute = (settings?: CarouselSettings | null): "center" | "none" | undefined => {
  const { snap } = resolveCarousel(settings);
  return snap === "start" ? undefined : snap;
};

/** The settings in the page's JSON, for `pageInput`: a part of the content grid's and testimonials' schemas. */
export const carouselSettingsSchema = z.object({
  arrows: z.boolean().optional(),
  dots: z.boolean().optional(),
  snap: z.enum(Object.keys(CAROUSEL_SNAPS) as [CarouselSnap, ...CarouselSnap[]], "A carousel rests on an unknown part of its tiles.").optional(),
  rewind: z.boolean().optional(),
  autoplay: z
    .object({
      seconds: z
        .number("Give the seconds a carousel stays on a page as a number.")
        .int(`A carousel stays on a page a whole number of seconds, from ${AUTOPLAY_SECONDS.min} to ${AUTOPLAY_SECONDS.max}.`)
        .min(AUTOPLAY_SECONDS.min, `A carousel stays on a page at least ${AUTOPLAY_SECONDS.min} seconds.`)
        .max(AUTOPLAY_SECONDS.max, `A carousel stays on a page at most ${AUTOPLAY_SECONDS.max} seconds.`),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Pages of tiles (the dots)
// ---------------------------------------------------------------------------

/** What `Carousel` measures of its row: positions in pixels, `scroll` and `max` counted from the start whichever way the page reads. */
export type TrackMetrics = {
  /** How far the row is scrolled. */
  scroll: number;
  /** The furthest it scrolls: its whole width less what is shown. */
  max: number;
  /** What is shown: the row's own width. */
  width: number;
  /** How many tiles. */
  tiles: number;
  /** One tile's width. */
  tileWidth: number;
  /** From one tile's start to the next's: the width and the gap. */
  pitch: number;
};

/** Whole tiles in the row's width, never fewer than one and never more than there are. A hair of room covers rounding. */
export function tilesPerScreen(metrics: Pick<TrackMetrics, "width" | "tiles" | "tileWidth" | "pitch">): number {
  const { width, tiles, tileWidth, pitch } = metrics;
  if (tiles <= 0 || pitch <= 0) return 1;
  const gap = Math.max(0, pitch - tileWidth);
  return Math.min(tiles, Math.max(1, Math.floor((width + gap) / pitch + 0.01)));
}

/** Pages of tiles: the tiles over what shows at once, rounded up. None without tiles. */
export function pageCount(tiles: number, perScreen: number): number {
  if (tiles <= 0) return 0;
  return Math.ceil(tiles / Math.max(1, perScreen));
}

/**
 * Where each page rests: a page further on by the tiles to a screen, the last
 * held to the furthest the row scrolls (so the last page is the end, even when
 * it holds fewer tiles than the others). A row that does not scroll is one page.
 */
export function pageOffsets(metrics: TrackMetrics): number[] {
  const { tiles, max, pitch } = metrics;
  if (tiles <= 1 || max <= 1 || pitch <= 0) return tiles > 0 ? [0] : [];
  const perScreen = tilesPerScreen(metrics);
  const offsets: number[] = [];
  for (let page = 0; page < pageCount(tiles, perScreen); page++) {
    const at = Math.min(Math.round(page * perScreen * pitch), max);
    if (offsets.length === 0 || at > offsets[offsets.length - 1] + 1) offsets.push(at);
  }
  return offsets;
}

/** The page the row rests nearest to; the earlier one when it is halfway. */
export function activePage(offsets: readonly number[], scroll: number): number {
  let best = 0;
  for (let page = 1; page < offsets.length; page++) {
    if (Math.abs(offsets[page] - scroll) < Math.abs(offsets[best] - scroll)) best = page;
  }
  return best;
}
