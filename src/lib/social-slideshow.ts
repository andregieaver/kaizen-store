/**
 * A social post's slideshow video (D870 S2.5, `docs/social-manager.md` 5): the post's own picture, then the product's other photos, each
 * held a few seconds with a slow zoom and drift and a soft crossfade into the next, as a 9:16 video for Reels and TikTok. Made in the
 * owner's browser from these timings (`src/lib/social-slideshow-make.ts`); pure, so its every frame can be tested.
 */

export const VIDEO_SIZE = { width: 1080, height: 1920 } as const;
export const VIDEO_FPS = 30;
/** How long each photo shows, crossfades included. */
export const SLIDE_SECONDS = 2.6;
/** How long one photo fades into the next. */
export const FADE_SECONDS = 0.5;
/** At most this many photos: a slideshow longer than about fifteen seconds loses people. */
export const SLIDES_MAX = 6;
/** How far a photo zooms over its time on screen (1.08 is 8 % closer at its end). */
export const ZOOM_TO = 1.08;

/** The video's length for this many photos: each photo's time, the fades overlapping. */
export const slideshowSeconds = (photos: number): number => {
  const n = Math.min(Math.max(photos, 0), SLIDES_MAX);
  return n === 0 ? 0 : n * SLIDE_SECONDS - (n - 1) * FADE_SECONDS;
};

/** One photo on screen at a moment: how solid it is, how far it has zoomed, and which way it drifts (-1 to 1 on each axis). */
export type SlideFrame = { index: number; alpha: number; scale: number; driftX: number; driftY: number };

/** The way each photo drifts, in turn: right, left, down, up, so no two in a row move alike. */
const DRIFTS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The photos on screen at `t` seconds, the one underneath first: one photo, or two while the next fades in over it. Each zooms from 1 to
 * `ZOOM_TO` across its own time, and drifts as far as its zoom lets it without showing an edge.
 */
export function framesAt(t: number, photos: number): SlideFrame[] {
  const n = Math.min(Math.max(photos, 0), SLIDES_MAX);
  if (n === 0) return [];
  const step = SLIDE_SECONDS - FADE_SECONDS;
  const frames: SlideFrame[] = [];
  for (let index = 0; index < n; index++) {
    const start = index * step;
    const end = start + SLIDE_SECONDS;
    if (t < start || t >= end) continue;
    const progress = (t - start) / SLIDE_SECONDS;
    const fadingIn = index > 0 && t < start + FADE_SECONDS;
    const alpha = fadingIn ? (t - start) / FADE_SECONDS : 1;
    const [x, y] = DRIFTS[index % DRIFTS.length];
    frames.push({ index, alpha: round(alpha), scale: round(1 + (ZOOM_TO - 1) * progress), driftX: round(x * (progress - 0.5) * 2), driftY: round(y * (progress - 0.5) * 2) });
  }
  // The last photo holds to the end, where nothing comes after it.
  if (frames.length === 0 && t >= 0) frames.push({ index: n - 1, alpha: 1, scale: ZOOM_TO, driftX: 0, driftY: 0 });
  return frames;
}

// `+ 0` turns -0 (a drift of nothing on a reversed axis) into 0.
const round = (n: number) => Math.round(n * 1000) / 1000 + 0;

/**
 * Where to draw a photo of `image` size so it fills `box` (cover) at `scale`, moved by its drift within the room its zoom leaves: never
 * an edge of the photo shows.
 */
export function coverRect(
  image: { width: number; height: number },
  box: { width: number; height: number },
  frame: Pick<SlideFrame, "scale" | "driftX" | "driftY">,
): { x: number; y: number; width: number; height: number } {
  const fit = Math.max(box.width / image.width, box.height / image.height) * frame.scale;
  const width = image.width * fit;
  const height = image.height * fit;
  const roomX = (width - box.width) / 2;
  const roomY = (height - box.height) / 2;
  return { x: (box.width - width) / 2 + frame.driftX * roomX, y: (box.height - height) / 2 + frame.driftY * roomY, width, height };
}

/** Where to draw the post's own picture whole (contain), centred, slightly zoomed with the slide: its words never cut. */
export function containRect(image: { width: number; height: number }, box: { width: number; height: number }, scale: number): { x: number; y: number; width: number; height: number } {
  const fit = Math.min(box.width / image.width, box.height / image.height) * 0.92 * scale;
  const width = image.width * fit;
  const height = image.height * fit;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}
