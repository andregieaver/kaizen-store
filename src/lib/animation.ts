/**
 * An animation (D538): a picture that moves, with a see-through background, such as an animated logo. It plays without
 * sound or controls, once unless set to go round, and rests on its last frame. The owner uploads one WebM with
 * transparency; their browser prepares what the site needs (`src/lib/animation-make.ts`), because no browser but
 * Chromium's shows a WebM's transparency and none shows an MP4's:
 *
 *   - a video every browser plays (H.264 in MP4) holding the picture as it looks on black in its top half and its mask
 *     (white where it is solid) in its bottom half, which the site's player puts together on a canvas;
 *   - its last frame as a picture with a see-through background: what it rests on, what visitors who prefer less motion
 *     see, and what is shown wherever it cannot play.
 *
 * Pure: the sizes, the player's two shaders and what a visitor gets. No page model and no browser here.
 */

/** An animation as a component keeps it. */
export type AnimationFile = {
  /** The MP4: picture above, mask below. */
  video: { url: string };
  /** The last frame, see-through, at the size the animation is shown at. */
  still: { url: string; width: number; height: number };
  /** The picture's size inside the video, in pixels: its top half. */
  width: number;
  height: number;
};

/** An animation's picture is at least this many pixels each way. */
export const ANIMATION_SIDE_MIN = 16;
/**
 * No wider or taller than this is kept as the still, the size the animation is shown at: what a page's pictures are kept
 * at (`uploadPicture()` shrinks to it), so the still is made at the size it is stored.
 */
export const ANIMATION_STILL_MAX = 1600;
/**
 * A longer film is a video, with controls to stop it. What moves by itself here has none, so it is over soon; WCAG 2.2.2
 * asks for a way to pause what moves for more than five seconds, and a visitor's own setting for less motion is that way
 * here, as it is for a row's background video.
 */
export const ANIMATION_SECONDS_MAX = 20;
/** What the owner may choose: as much as a video. What is stored is far smaller. */
export const ANIMATION_CHOOSE_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Picture and mask together are one frame twice the picture's height. H.264's levels 4 to 4.2 (1080p, at up to 60
 * frames a second) are what every phone's decoder takes: at most 8,704 blocks of 16 × 16 pixels in a frame.
 */
export const STACKED_BLOCKS_MAX = 8704;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const blocks = (width: number, height: number) => Math.ceil(width / 16) * Math.ceil((height * 2) / 16);

/**
 * The size of the picture inside the video: the source's own shape, never enlarged, even numbers as encoders need, and
 * small enough that picture and mask together fit `STACKED_BLOCKS_MAX`. A 1920 × 1080 source becomes 1394 × 784.
 */
export function stackedPictureSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } | null {
  if (!(sourceWidth >= ANIMATION_SIDE_MIN) || !(sourceHeight >= ANIMATION_SIDE_MIN)) return null;
  const ratio = sourceWidth / sourceHeight;
  const fits = Math.sqrt((STACKED_BLOCKS_MAX * 256) / (2 * sourceWidth * sourceHeight));
  let width = even(sourceWidth * Math.min(1, fits));
  let height = even(width / ratio);
  // Rounding up to whole blocks can take it one row or column over: step down until it fits.
  while (blocks(width, height) > STACKED_BLOCKS_MAX && width > ANIMATION_SIDE_MIN) {
    width -= 2;
    height = even(width / ratio);
  }
  return { width, height };
}

/** The still's size: the source's, no larger than `ANIMATION_STILL_MAX` either way. */
export function stillSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } | null {
  if (!(sourceWidth >= ANIMATION_SIDE_MIN) || !(sourceHeight >= ANIMATION_SIDE_MIN)) return null;
  const scale = Math.min(1, ANIMATION_STILL_MAX / Math.max(sourceWidth, sourceHeight));
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

/** Why a chosen file cannot be an animation, as the builder says it; null when it can. */
export type AnimationRefusal = "type" | "size" | "opaque" | "long" | "small" | "browser" | "unreadable";

/** The file types an animation is made from: WebM is the one format with transparency that browsers can read back. */
export const ANIMATION_SOURCE_TYPES = ["video/webm"] as const;

/** What can be said about a chosen file before it is opened. */
export function refusalBeforeOpening(file: { type: string; size: number }): AnimationRefusal | null {
  if (!(ANIMATION_SOURCE_TYPES as readonly string[]).includes(file.type)) return "type";
  if (!(file.size > 0) || file.size > ANIMATION_CHOOSE_MAX_BYTES) return "size";
  return null;
}

/** What can be said once its track is read. */
export function refusalOnceOpened(track: { width: number; height: number; seconds: number; transparent: boolean }): AnimationRefusal | null {
  if (!track.transparent) return "opaque";
  if (!(track.width >= ANIMATION_SIDE_MIN) || !(track.height >= ANIMATION_SIDE_MIN)) return "small";
  if (!(track.seconds > 0) || track.seconds > ANIMATION_SECONDS_MAX) return "long";
  return null;
}

/**
 * The site's player: a canvas the size of the picture, drawn from the video each frame. The picture is in the top half
 * of the video and is already as it looks on black, so it is the colour times how solid it is; the mask in the bottom
 * half is how solid. Together they are what a canvas with a see-through background wants. The picture is kept no
 * brighter than the mask allows, so a compressed frame cannot glow where it should be clear; and a video's black and
 * white are never exact once compressed and decoded (each browser's decoder a little differently), so the mask's two ends
 * are taken as clear and solid: nothing faint is left over the page, and what is solid hides what is behind it.
 */
export const PLAYER_VERTEX_SHADER = "attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
export const PLAYER_FRAGMENT_SHADER =
  "precision mediump float; uniform sampler2D v; varying vec2 uv; void main(){ float y = uv.y * 0.498 + 0.001; float a = texture2D(v, vec2(uv.x, y)).g; a = clamp((a - 0.02) / 0.96, 0.0, 1.0); vec3 c = texture2D(v, vec2(uv.x, y + 0.5)).rgb; gl_FragColor = vec4(min(c, vec3(a)), a); }";

/** How much of an animation must be on the screen before it starts. */
export const ANIMATION_VISIBLE_SHARE = 0.25;
/** A line too slow to start it in this long shows the still instead: rather the finished picture than a late start. */
export const ANIMATION_START_WAIT_MS = 8000;

/**
 * An animation that plays once a visit (the header's logo, D538): where a tab's storage remembers it under this name.
 */
export const animationSeenKey = (name: string): string => `kz-animation:${name}`;

/**
 * A script for the page itself, right after such an animation: it runs as the page is read, before anything is drawn, and
 * marks the animation as seen when this tab has played it, so the picture is there at once on every later page and never
 * waits for the page's scripts (as the colour mode's script, D99). Without it, or where a policy forbids it, the player
 * finds out a moment later. The name goes in as data, never as code.
 */
export function animationSeenScript(name: string): string {
  const key = JSON.stringify(animationSeenKey(name)).replace(/</g, "\\u003c");
  return `(function(){try{if(sessionStorage.getItem(${key})==="1"){var s=document.currentScript,e=s&&s.previousElementSibling;if(e)e.setAttribute("data-kz-seen","")}}catch(e){}})()`;
}

/** What a visitor gets: the animation, or its still at once. */
export function animationPlays(visitor: { reducedMotion: boolean; canDraw: boolean }): boolean {
  return !visitor.reducedMotion && visitor.canDraw;
}
