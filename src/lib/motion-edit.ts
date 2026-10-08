import {
  ENTER_EFFECTS,
  GRADIENT_COLORS_MAX,
  GRADIENT_COLORS_MIN,
  HOVER_EFFECTS,
  SCROLL_EFFECTS,
  STAGGER_MAX,
  DELAY_MAX,
  DURATION_MAX,
  DURATION_MIN,
  effectsFor,
  type BackgroundMotion,
  type EnterEffect,
  type EnterMotion,
  type GradientFlow,
  type GradientStyle,
  type HoverEffect,
  type HoverMotion,
  type MotionIntensity,
  type MotionTarget,
  type PartMotion,
  type ScrollEffect,
  type ScrollMotion,
} from "./motion";
import type { BlockType, GradientBackground, PageRow, RowBackground } from "./page-content";
import { pageParts } from "./page-content";

/**
 * The builder's edits of a part's motion (D128), as pure functions: the effects each kind of part is offered, what a
 * change does to what is stored (a part with nothing chosen keeps no `motion` at all, like the schema says), and how a
 * background changes kind without leaving keys of the old kind behind.
 */

// ---------------------------------------------------------------------------
// Which effects a part is offered
// ---------------------------------------------------------------------------

/** What is being edited: a row, a column or a component (with its kind, since text is offered its own effects). */
export type MotionPart = { kind: "row" | "column" | "block"; blockType?: BlockType };

/** Heading and rich text are text: they take the text effects (words, letters, lines) too. */
export const isTextBlock = (type: BlockType | undefined): boolean => type === "heading" || type === "richText";

/**
 * The kind of part to draw and to offer effects for. A heading or rich text is `text`: it takes every entrance (and its
 * own words, letters and lines) but only the hover and scroll effects that suit text, which is all the renderer draws
 * on it, so a list never offers what would do nothing.
 */
export function drawTarget(part: MotionPart): MotionTarget {
  return part.kind === "block" ? (isTextBlock(part.blockType) ? "text" : "block") : part.kind;
}

type Groups<Id extends string> = { group: string; effects: { id: Id; label: string; hint: string }[] }[];

/** The effects of a catalogue a part is offered, grouped, in the catalogue's order. */
export function offered<Id extends string>(
  catalogue: Parameters<typeof effectsFor<Id>>[0],
  part: MotionPart,
): Groups<Id> {
  return effectsFor(catalogue, drawTarget(part));
}

export const enterOffered = (part: MotionPart) => offered<EnterEffect>(ENTER_EFFECTS, part);
export const hoverOffered = (part: MotionPart) => offered<HoverEffect>(HOVER_EFFECTS, part);
export const scrollOffered = (part: MotionPart) => offered<ScrollEffect>(SCROLL_EFFECTS, part);

const flat = <Id extends string>(groups: Groups<Id>): Id[] => groups.flatMap((g) => g.effects.map((e) => e.id));
export const enterFitsPart = (effect: EnterEffect, part: MotionPart) => flat(enterOffered(part)).includes(effect);
export const hoverFitsPart = (effect: HoverEffect, part: MotionPart) => flat(hoverOffered(part)).includes(effect);
export const scrollFitsPart = (effect: ScrollEffect, part: MotionPart) => flat(scrollOffered(part)).includes(effect);

/** What a stagger is between, for a part and its entrance; none where there is nothing to play in turn. */
export type StaggerKind = "columns" | "components" | "words" | "letters" | "lines";
export function staggerKind(part: MotionPart, effect: EnterEffect | undefined): StaggerKind | null {
  if (part.kind === "row") return "columns";
  if (part.kind === "column") return "components";
  if (effect === "words" || effect === "words-blur") return "words";
  if (effect === "chars") return "letters";
  if (effect === "lines") return "lines";
  return null;
}

// ---------------------------------------------------------------------------
// Changing what is stored
// ---------------------------------------------------------------------------

/** What each setting means when it is left out. */
export const ENTER_DEFAULTS = {
  speed: "normal",
  ease: "smooth",
  distance: "medium",
  trigger: "view",
  start: "middle",
  once: true,
  delay: 0,
  stagger: 0,
} as const;
export const INTENSITY_DEFAULT: MotionIntensity = "medium";
export const GRADIENT_FLOW_DEFAULT: GradientFlow = "slow";
export const GRADIENT_ANGLE_DEFAULT = 135;
export const STAGGER_STEP = 50;

/** A motion with nothing in it is no motion: the part keeps no `motion` key. */
export function tidy(motion: PartMotion | undefined): PartMotion | undefined {
  if (!motion) return undefined;
  const next: PartMotion = {};
  if (motion.enter) next.enter = motion.enter;
  if (motion.hover) next.hover = motion.hover;
  if (motion.scroll) next.scroll = motion.scroll;
  return next.enter || next.hover || next.scroll ? next : undefined;
}

/** Drops the keys that say nothing (left out, or a zero delay or stagger), so the page stays as small as it can. */
function lean<T extends object>(value: T): T {
  const next = { ...value } as Record<string, unknown>;
  for (const [key, v] of Object.entries(next)) {
    if (v === undefined || ((key === "delay" || key === "stagger") && v === 0)) delete next[key];
  }
  return next as T;
}

/** Chooses an entrance (its other settings stay while the effect changes), or, with none, takes the entrance away. */
export function setEnterEffect(
  motion: PartMotion | undefined,
  effect: EnterEffect | null,
  part: MotionPart,
): PartMotion | undefined {
  if (!effect) return tidy({ ...motion, enter: undefined });
  const kept = motion?.enter ? { ...motion.enter } : undefined;
  // A stagger only means something where there is something to play in turn.
  if (kept && !staggerKind(part, effect)) delete kept.stagger;
  return tidy({ ...motion, enter: lean({ ...kept, effect }) });
}

/** Changes settings of the entrance; nothing happens where there is no entrance yet. */
export function patchEnter(
  motion: PartMotion | undefined,
  patch: Partial<EnterMotion>,
  part?: MotionPart,
): PartMotion | undefined {
  if (!motion?.enter) return motion;
  const next = lean({ ...motion.enter, ...patch, effect: motion.enter.effect });
  // A waypoint's settings mean nothing to an entrance that plays when the page opens.
  if (next.trigger === "load") {
    delete next.start;
    delete next.once;
  }
  if (next.delay !== undefined) next.delay = clampStep(next.delay, 0, DELAY_MAX);
  if (next.duration !== undefined) next.duration = Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(next.duration / 10) * 10));
  if (next.stagger !== undefined) next.stagger = clampStep(next.stagger, 0, STAGGER_MAX);
  if (part && !staggerKind(part, next.effect)) delete next.stagger;
  return tidy({ ...motion, enter: lean(next) });
}

function clampStep(value: number, min: number, max: number): number {
  const stepped = Math.round(value / STAGGER_STEP) * STAGGER_STEP;
  return Math.min(max, Math.max(min, stepped));
}

export function setHoverEffect(motion: PartMotion | undefined, effect: HoverEffect | null): PartMotion | undefined {
  if (!effect) return tidy({ ...motion, hover: undefined });
  const hover: HoverMotion = motion?.hover ? { ...motion.hover, effect } : { effect };
  return tidy({ ...motion, hover });
}

export function setHoverIntensity(
  motion: PartMotion | undefined,
  intensity: MotionIntensity | undefined,
): PartMotion | undefined {
  if (!motion?.hover) return motion;
  return tidy({ ...motion, hover: lean({ ...motion.hover, intensity }) });
}

export function setScrollEffect(motion: PartMotion | undefined, effect: ScrollEffect | null): PartMotion | undefined {
  if (!effect) return tidy({ ...motion, scroll: undefined });
  const scroll: ScrollMotion = motion?.scroll ? { ...motion.scroll, effect } : { effect };
  return tidy({ ...motion, scroll });
}

export function setScrollIntensity(
  motion: PartMotion | undefined,
  intensity: MotionIntensity | undefined,
): PartMotion | undefined {
  if (!motion?.scroll) return motion;
  return tidy({ ...motion, scroll: lean({ ...motion.scroll, intensity }) });
}

/** The entrance and hover of a motion, without what moves with scrolling (for a preview that plays by itself). */
export const withoutScroll = (motion: PartMotion | undefined): PartMotion | undefined =>
  tidy({ ...motion, scroll: undefined });
/** Only what moves with scrolling (for a preview in a box that scrolls). */
export const onlyScroll = (motion: PartMotion | undefined): PartMotion | undefined => tidy({ scroll: motion?.scroll });

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

export type BackgroundKind = "none" | RowBackground["type"];

/** A picture, a video or a gradient can move; a colour cannot. */
export const backgroundMoves = (background: RowBackground | undefined): boolean =>
  background?.type === "image" || background?.type === "video" || background?.type === "gradient";

/** Chooses a background motion, or (none) takes it away. */
export function setBackgroundEffect(
  current: BackgroundMotion | undefined,
  effect: BackgroundMotion["effect"] | null,
): BackgroundMotion | undefined {
  if (!effect) return undefined;
  return lean({ ...current, effect });
}

export function setBackgroundIntensity(
  current: BackgroundMotion | undefined,
  intensity: MotionIntensity | undefined,
): BackgroundMotion | undefined {
  if (!current) return current;
  return lean({ ...current, intensity });
}

/** What a change of background kind does to the part: its new background, and what else it takes with it. */
export type BackgroundSwitch = {
  background: RowBackground | undefined;
  /** The background's motion no longer applies (a colour, or nothing yet). */
  clearMotion: boolean;
  /** What is behind is not blurred through a background drawn over it (a picture, a video or a gradient). */
  clearBackdropBlur: boolean;
};

/**
 * Switches a row's or column's background to another kind. A background of the new kind is made from nothing but that
 * kind's own settings, so no picture's overlay or blur stays on a gradient, nor a gradient's colours on a picture; one
 * already of that kind is kept. A picture or video waits for its upload (`undefined`).
 */
export function switchBackground(value: RowBackground | undefined, next: BackgroundKind): BackgroundSwitch {
  let background: RowBackground | undefined;
  if (next === "none") background = undefined;
  else if (next === "color") background = { type: "color", color: value?.type === "color" ? value.color : "#f3f4f6" };
  else if (next === "gradient") background = value?.type === "gradient" ? value : defaultGradient();
  else background = value?.type === next ? value : undefined;
  return {
    background,
    clearMotion: !backgroundMoves(background),
    clearBackdropBlur: next === "image" || next === "video" || next === "gradient",
  };
}

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

/** Pleasant colours to start from, in the order they are offered as colours are added. */
export const GRADIENT_PALETTE = ["#6366f1", "#ec4899", "#f59e0b", "#14b8a6"] as const;

export function defaultGradient(style: GradientStyle = "shift"): GradientBackground {
  return {
    type: "gradient",
    style,
    colors: GRADIENT_PALETTE.slice(0, GRADIENT_COLORS_MIN),
    flow: GRADIENT_FLOW_DEFAULT,
  };
}

/** Whether a style takes an angle (the shifting one alone), and a flow (a mesh is still). */
export const gradientHasAngle = (style: GradientStyle) => style === "shift";
export const gradientHasFlow = (style: GradientStyle) => style !== "mesh";

/** Changes the style; settings of the old style that the new one has no use for are taken away. */
export function setGradientStyle(gradient: GradientBackground, style: GradientStyle): GradientBackground {
  const next: GradientBackground = { ...gradient, style };
  if (!gradientHasAngle(style)) delete next.angle;
  if (!gradientHasFlow(style)) delete next.flow;
  else if (!next.flow) next.flow = GRADIENT_FLOW_DEFAULT;
  return next;
}

export function setGradientColor(gradient: GradientBackground, index: number, color: string): GradientBackground {
  if (index < 0 || index >= gradient.colors.length) return gradient;
  return { ...gradient, colors: gradient.colors.map((c, i) => (i === index ? color : c)) };
}

/** Adds a colour (the first of the palette not in use), up to the most a gradient takes. */
export function addGradientColor(gradient: GradientBackground): GradientBackground {
  if (gradient.colors.length >= GRADIENT_COLORS_MAX) return gradient;
  const used = new Set(gradient.colors.map((c) => c.toLowerCase()));
  const color =
    GRADIENT_PALETTE.find((c) => !used.has(c)) ?? GRADIENT_PALETTE[gradient.colors.length % GRADIENT_PALETTE.length];
  return { ...gradient, colors: [...gradient.colors, color] };
}

/** Takes a colour away, down to the fewest a gradient takes. */
export function removeGradientColor(gradient: GradientBackground, index: number): GradientBackground {
  if (gradient.colors.length <= GRADIENT_COLORS_MIN || index < 0 || index >= gradient.colors.length) return gradient;
  return { ...gradient, colors: gradient.colors.filter((_, i) => i !== index) };
}

export function setGradientAngle(gradient: GradientBackground, angle: number): GradientBackground {
  if (!gradientHasAngle(gradient.style)) return gradient;
  const degrees = Math.min(360, Math.max(0, Math.round(angle)));
  const next = { ...gradient };
  if (degrees === GRADIENT_ANGLE_DEFAULT) delete next.angle;
  else next.angle = degrees;
  return next;
}

export function setGradientFlow(gradient: GradientBackground, flow: GradientFlow): GradientBackground {
  return gradientHasFlow(gradient.style) ? { ...gradient, flow } : gradient;
}

/** The grain is a switch: off leaves no key. */
export function setGradientGrain(gradient: GradientBackground, grain: boolean): GradientBackground {
  const next = { ...gradient };
  if (grain) next.grain = true;
  else delete next.grain;
  return next;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** What the canvas's motion preview depends on: every part's motion and background motion, so it starts again when one changes. */
export function motionSignature(rows: PageRow[]): string {
  const parts = pageParts(rows).flatMap((part) => {
    const backgroundMotion = "backgroundMotion" in part ? part.backgroundMotion : undefined;
    return part.motion || backgroundMotion ? [[part.id, part.motion ?? null, backgroundMotion ?? null]] : [];
  });
  return JSON.stringify(parts);
}
