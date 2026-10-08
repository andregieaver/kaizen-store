import { z } from "zod";

/**
 * Motion (D128): a curated set of effects an owner picks for a row, column or component and for their backgrounds:
 * an *entrance* (when it comes into view, or when the page loads), a *hover* effect, a *scroll* effect (tied to
 * how far the page is scrolled: parallax, fades, scale, blur) and a *background* effect. Owners choose from lists; they
 * never write animation code. What is stored is only these names and a few named amounts, checked by the schemas below
 * (shared by the browser and the server), so nothing an owner types reaches a style or a script.
 *
 * How it is drawn (`src/components/motion.tsx`, `motion.css`, the `motion` runtime): CSS does what it can by itself
 * (entrances on load, hover, scroll-linked effects where the browser has `animation-timeline`); a small runtime loaded
 * only on pages that use motion (`inView` for waypoints, `scroll()` where the CSS is missing, pointer effects) does the
 * rest. Without JavaScript, or with "reduce motion", every part is simply shown. Effects only move, fade, scale, blur
 * or clip (`transform`, `opacity`, `filter`, `clip-path`), so nothing shifts the layout.
 */

/** Which kind of part an effect can go on. `text` effects are for headings and rich text only. */
export type MotionTarget = "row" | "column" | "block" | "text";

type Catalogue<Id extends string> = Record<Id, { label: string; group: string; hint: string; targets: readonly MotionTarget[] }>;
const ALL: readonly MotionTarget[] = ["row", "column", "block", "text"];

// ---------------------------------------------------------------------------
// Entrances
// ---------------------------------------------------------------------------

export const ENTER_EFFECTS = {
  fade: { label: "Fade in", group: "Fade", hint: "Appears gently.", targets: ALL },
  "fade-up": { label: "Fade up", group: "Fade", hint: "Rises into place.", targets: ALL },
  "fade-down": { label: "Fade down", group: "Fade", hint: "Drops into place.", targets: ALL },
  "fade-left": { label: "Fade from the right", group: "Fade", hint: "Slides in from the right.", targets: ALL },
  "fade-right": { label: "Fade from the left", group: "Fade", hint: "Slides in from the left.", targets: ALL },
  "zoom-in": { label: "Zoom in", group: "Zoom", hint: "Grows from a little smaller.", targets: ALL },
  "zoom-out": { label: "Zoom out", group: "Zoom", hint: "Settles down from a little larger.", targets: ALL },
  pop: { label: "Pop", group: "Zoom", hint: "Springs in with a small overshoot.", targets: ALL },
  "blur-in": { label: "Blur in", group: "Blur", hint: "Comes into focus.", targets: ALL },
  "blur-up": { label: "Blur and rise", group: "Blur", hint: "Comes into focus as it rises.", targets: ALL },
  "wipe-left": { label: "Wipe from the left", group: "Reveal", hint: "Uncovered from the left.", targets: ALL },
  "wipe-up": { label: "Wipe up", group: "Reveal", hint: "Uncovered from the bottom.", targets: ALL },
  iris: { label: "Iris", group: "Reveal", hint: "Opens from the centre.", targets: ALL },
  "flip-x": { label: "Flip up", group: "3D", hint: "Turns up around its top edge.", targets: ALL },
  "flip-y": { label: "Flip sideways", group: "3D", hint: "Turns around its left edge.", targets: ALL },
  "rotate-in": { label: "Turn in", group: "3D", hint: "Straightens from a slight tilt.", targets: ALL },
  words: { label: "Words, one by one", group: "Text", hint: "Each word rises in turn.", targets: ["text"] },
  "words-blur": { label: "Words, out of focus", group: "Text", hint: "Each word comes into focus in turn.", targets: ["text"] },
  chars: { label: "Letters, one by one", group: "Text", hint: "Each letter appears in turn (short texts).", targets: ["text"] },
  lines: { label: "Lines, one by one", group: "Text", hint: "Each line rises in turn.", targets: ["text"] },
} as const satisfies Catalogue<string>;
export type EnterEffect = keyof typeof ENTER_EFFECTS;
export const ENTER_IDS = Object.keys(ENTER_EFFECTS) as [EnterEffect, ...EnterEffect[]];

/** How fast, how far and how softly an entrance moves; the milliseconds and pixels are in the CSS, by these names. */
export const MOTION_SPEEDS = { fast: "Quick", normal: "Normal", slow: "Slow" } as const;
export type MotionSpeed = keyof typeof MOTION_SPEEDS;
export const MOTION_DISTANCES = { small: "Short", medium: "Medium", large: "Long" } as const;
export type MotionDistance = keyof typeof MOTION_DISTANCES;
export const MOTION_EASES = { smooth: "Smooth", snappy: "Snappy", soft: "Soft", bounce: "Bounce" } as const;
export type MotionEase = keyof typeof MOTION_EASES;
export const MOTION_INTENSITIES = { subtle: "Subtle", medium: "Medium", strong: "Strong" } as const;
export type MotionIntensity = keyof typeof MOTION_INTENSITIES;

/** Where a waypoint is: how far into the screen the part must come before its entrance starts. */
export const MOTION_STARTS = { early: "Just as it appears", middle: "A little way in", late: "Well into view" } as const;
export type MotionStart = keyof typeof MOTION_STARTS;

/** An entrance's delay and duration (D179 phase 3, Beaver's Animation): 0–10 s and 0.1–5 s, in milliseconds, set in steps of 0.1 s. */
export const DELAY_MAX = 10_000;
export const DURATION_MIN = 100;
export const DURATION_MAX = 5000;
export const STAGGER_MAX = 600;

/**
 * An entrance. `trigger` is `view` (a waypoint: when it comes into view, at `start`) or `load` (when the page opens).
 * `once` (the default) plays it the first time only; off, it plays again each time the part comes into view.
 * `stagger` (milliseconds) plays a row's columns, a column's components, or a text's words one after another.
 */
export type EnterMotion = {
  effect: EnterEffect;
  speed?: MotionSpeed;
  ease?: MotionEase;
  distance?: MotionDistance;
  /** Milliseconds before it starts (the builder sets tenths of a second; plans and older pages steps of 50). */
  delay?: number;
  /** Milliseconds it takes, over its speed's (D179 phase 3); its speed's when left out. */
  duration?: number;
  trigger?: "view" | "load";
  start?: MotionStart;
  once?: boolean;
  stagger?: number;
};

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export const HOVER_EFFECTS = {
  lift: { label: "Lift", group: "Move", hint: "Rises with a soft shadow.", targets: ["row", "column", "block", "text"] },
  grow: { label: "Grow", group: "Move", hint: "Gets a little bigger.", targets: ["row", "column", "block", "text"] },
  float: { label: "Float", group: "Move", hint: "Bobs gently while pointed at.", targets: ["column", "block", "text"] },
  tilt: { label: "Tilt", group: "Pointer", hint: "Leans towards the pointer, in 3D.", targets: ["column", "block"] },
  magnetic: { label: "Magnetic", group: "Pointer", hint: "Follows the pointer a little.", targets: ["block"] },
  spotlight: { label: "Spotlight", group: "Pointer", hint: "A soft light follows the pointer.", targets: ["row", "column", "block"] },
  glow: { label: "Glow", group: "Light", hint: "A soft glow in the site's accent colour.", targets: ["column", "block"] },
  shine: { label: "Shine", group: "Light", hint: "A glint sweeps across.", targets: ["column", "block"] },
  "image-zoom": { label: "Picture zoom", group: "Picture", hint: "The picture inside grows, cropped by its frame.", targets: ["column", "block"] },
  dim: { label: "Dim the rest", group: "Focus", hint: "Its neighbours fade back.", targets: ["column"] },
} as const satisfies Catalogue<string>;
export type HoverEffect = keyof typeof HOVER_EFFECTS;
export const HOVER_IDS = Object.keys(HOVER_EFFECTS) as [HoverEffect, ...HoverEffect[]];
export type HoverMotion = { effect: HoverEffect; intensity?: MotionIntensity };

// ---------------------------------------------------------------------------
// Scroll-linked
// ---------------------------------------------------------------------------

export const SCROLL_EFFECTS = {
  parallax: { label: "Parallax", group: "Move", hint: "Drifts slower than the page.", targets: ALL },
  "parallax-fast": { label: "Reverse parallax", group: "Move", hint: "Drifts faster than the page.", targets: ALL },
  "drift-left": { label: "Drift left", group: "Move", hint: "Slides sideways as the page scrolls.", targets: ALL },
  "drift-right": { label: "Drift right", group: "Move", hint: "Slides the other way.", targets: ALL },
  "fade-scroll": { label: "Fade with scroll", group: "Fade", hint: "Fades in on the way in, out on the way out.", targets: ALL },
  "scale-up": { label: "Grow with scroll", group: "Scale", hint: "Grows as it comes into view.", targets: ALL },
  "scale-down": { label: "Settle with scroll", group: "Scale", hint: "Shrinks to its size as it comes into view.", targets: ALL },
  "blur-scroll": { label: "Focus with scroll", group: "Blur", hint: "Sharpens as it comes into view.", targets: ALL },
  rotate: { label: "Turn with scroll", group: "3D", hint: "Turns slightly as the page scrolls.", targets: ["column", "block"] },
} as const satisfies Catalogue<string>;
export type ScrollEffect = keyof typeof SCROLL_EFFECTS;
export const SCROLL_IDS = Object.keys(SCROLL_EFFECTS) as [ScrollEffect, ...ScrollEffect[]];
export type ScrollMotion = { effect: ScrollEffect; intensity?: MotionIntensity };

/** What can be on one part: an entrance, a hover effect and a scroll effect together. */
export type PartMotion = { enter?: EnterMotion; hover?: HoverMotion; scroll?: ScrollMotion };

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

export const BACKGROUND_EFFECTS = {
  parallax: { label: "Parallax", group: "Scroll", hint: "The background moves slower than the page.", targets: ["row", "column"] },
  "zoom-scroll": { label: "Zoom with scroll", group: "Scroll", hint: "Grows as the page scrolls.", targets: ["row", "column"] },
  "blur-scroll": { label: "Focus with scroll", group: "Scroll", hint: "Sharpens as it comes into view.", targets: ["row", "column"] },
  "fade-scroll": { label: "Fade with scroll", group: "Scroll", hint: "Fades in as it comes into view.", targets: ["row", "column"] },
  "ken-burns": { label: "Slow zoom", group: "Ambient", hint: "Zooms and pans very slowly, on its own.", targets: ["row", "column"] },
  drift: { label: "Slow drift", group: "Ambient", hint: "Glides sideways very slowly, on its own.", targets: ["row", "column"] },
} as const satisfies Catalogue<string>;
export type BackgroundEffect = keyof typeof BACKGROUND_EFFECTS;
export const BACKGROUND_IDS = Object.keys(BACKGROUND_EFFECTS) as [BackgroundEffect, ...BackgroundEffect[]];
export type BackgroundMotion = { effect: BackgroundEffect; intensity?: MotionIntensity };

/**
 * A background made of colours that move (`type: "gradient"` in `Background`): no picture to load. `flow` is how fast it
 * moves by itself. `grain` lays a fine noise over it.
 */
export const GRADIENT_STYLES = {
  shift: { label: "Shifting", hint: "Two to four colours flowing across, at an angle." },
  aurora: { label: "Aurora", hint: "Soft blobs of colour drifting and blending." },
  mesh: { label: "Mesh", hint: "Soft spots of colour, still." },
  conic: { label: "Sweep", hint: "Colours turning slowly around the centre." },
} as const;
export type GradientStyle = keyof typeof GRADIENT_STYLES;
export const GRADIENT_FLOWS = { still: "Still", slow: "Slow", medium: "Medium", fast: "Fast" } as const;
export type GradientFlow = keyof typeof GRADIENT_FLOWS;
export const GRADIENT_COLORS_MIN = 2;
export const GRADIENT_COLORS_MAX = 4;

// ---------------------------------------------------------------------------
// Schemas, shared by the browser and the server
// ---------------------------------------------------------------------------

const speed = z.enum(Object.keys(MOTION_SPEEDS) as [MotionSpeed, ...MotionSpeed[]]).optional();
const intensity = z.enum(Object.keys(MOTION_INTENSITIES) as [MotionIntensity, ...MotionIntensity[]]).optional();

const enterMotion = z.object({
  effect: z.enum(ENTER_IDS),
  speed,
  ease: z.enum(Object.keys(MOTION_EASES) as [MotionEase, ...MotionEase[]]).optional(),
  distance: z.enum(Object.keys(MOTION_DISTANCES) as [MotionDistance, ...MotionDistance[]]).optional(),
  delay: z.number().int().min(0).max(DELAY_MAX).optional(),
  duration: z.number().int().min(DURATION_MIN).max(DURATION_MAX).optional(),
  trigger: z.enum(["view", "load"]).optional(),
  start: z.enum(Object.keys(MOTION_STARTS) as [MotionStart, ...MotionStart[]]).optional(),
  once: z.boolean().optional(),
  stagger: z.number().int().min(0).max(STAGGER_MAX).optional(),
});

/** A part's motion (D128); an empty one is left out. */
export const partMotionSchema = z
  .object({
    enter: enterMotion.optional(),
    hover: z.object({ effect: z.enum(HOVER_IDS), intensity }).optional(),
    scroll: z.object({ effect: z.enum(SCROLL_IDS), intensity }).optional(),
  })
  .optional()
  .transform((motion) => (motion && (motion.enter || motion.hover || motion.scroll) ? motion : undefined));

/** A row's or column's background motion (D128). */
export const backgroundMotionSchema = z.object({ effect: z.enum(BACKGROUND_IDS), intensity }).optional();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Whether an effect can go on this kind of part. */
export const enterFits = (effect: EnterEffect, target: MotionTarget) => (ENTER_EFFECTS[effect].targets as readonly MotionTarget[]).includes(target);
export const hoverFits = (effect: HoverEffect, target: MotionTarget) => (HOVER_EFFECTS[effect].targets as readonly MotionTarget[]).includes(target);
export const scrollFits = (effect: ScrollEffect, target: MotionTarget) => (SCROLL_EFFECTS[effect].targets as readonly MotionTarget[]).includes(target);

/** The effects a kind of part can take, grouped for a list, in the catalogue's order. */
export function effectsFor<Id extends string>(
  catalogue: Catalogue<Id>,
  target: MotionTarget,
): { group: string; effects: { id: Id; label: string; hint: string }[] }[] {
  const groups: { group: string; effects: { id: Id; label: string; hint: string }[] }[] = [];
  for (const id of Object.keys(catalogue) as Id[]) {
    const entry = catalogue[id];
    if (!(entry.targets as readonly MotionTarget[]).includes(target)) continue;
    let bucket = groups.find((g) => g.group === entry.group);
    if (!bucket) groups.push((bucket = { group: entry.group, effects: [] }));
    bucket.effects.push({ id, label: entry.label, hint: entry.hint });
  }
  return groups;
}

/** Whether a part holds any motion of its own (not its children's). */
export const hasMotion = (part: { motion?: PartMotion; backgroundMotion?: BackgroundMotion }): boolean =>
  Boolean(part.motion?.enter || part.motion?.hover || part.motion?.scroll || part.backgroundMotion);
