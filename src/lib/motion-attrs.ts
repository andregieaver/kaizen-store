import type { CSSProperties } from "react";

import {
  ENTER_EFFECTS,
  enterFits,
  hoverFits,
  scrollFits,
  type BackgroundMotion,
  type EnterEffect,
  type EnterMotion,
  type MotionDistance,
  type MotionEase,
  type MotionIntensity,
  type MotionSpeed,
  type MotionTarget,
  type PartMotion,
} from "./motion";
import type { PageBlock, PageRow } from "./page-content";
import { flowRows } from "./page-modal";

/**
 * How motion (D128, `src/lib/motion.ts`) reaches the page: a part's stored effect names become `data-fx-*` attributes
 * and `--fx-*` custom properties, which `src/app/motion.css` turns into animation and `src/lib/motion-runtime.ts`
 * completes in the browser (waypoints, text splitting, pointer effects, scroll effects where CSS has none). Nothing an
 * owner types gets here: only the names and numbers the schemas allow, mapped through the tables below.
 *
 * Attributes (all on the part's own element): `data-fx-enter` (the entrance's name), `data-fx-trigger` (`view` or
 * `load`), `data-fx-start`, `data-fx-repeat`, `data-fx-now`, `data-fx-nofade`, `data-fx-text`, `data-fx-each` (a row or
 * column whose children enter one after another) and `data-fx-c` (such a child), `data-fx-scroll`, `data-fx-hover`,
 * and on a background's layer `data-fx-bgm`/`data-fx-tl`. The runtime adds `data-fx-in`, `data-fx-split` and
 * `data-fx-live`, and the document's `data-fx-ready`.
 */

/** What a page with waiting entrances adds inside `<noscript>`: with no scripts, nothing waits for a waypoint. */
export const FX_NOSCRIPT_CSS =
  '[data-fx-enter][data-fx-trigger="view"],[data-fx-text],[data-fx-w]{animation:none!important;opacity:1!important;transform:none!important;filter:none!important;clip-path:none!important}';

export type FxProps = { attrs: Record<string, string>; style: CSSProperties };

const none = (): FxProps => ({ attrs: {}, style: {} });

// The amounts by name. The CSS holds the same defaults (medium, normal, smooth), so only what differs is sent.
export const SPEED_MS: Record<MotionSpeed, number> = { fast: 400, normal: 700, slow: 1100 };
export const DISTANCE_PX: Record<MotionDistance, number> = { small: 16, medium: 40, large: 80 };
/** How much a scale, a blur or a turn moves, by the same choice as the distance. */
export const DISTANCE_AMOUNT: Record<MotionDistance, number> = { small: 0.4, medium: 1, large: 2 };
export const EASE_CURVES: Record<MotionEase, string> = {
  smooth: "cubic-bezier(.22,1,.36,1)",
  snappy: "cubic-bezier(.3,0,0,1)",
  soft: "cubic-bezier(.45,.05,.25,1)",
  bounce: "cubic-bezier(.34,1.56,.64,1)",
};
export const INTENSITY_FACTOR: Record<MotionIntensity, number> = { subtle: 0.6, medium: 1, strong: 1.6 };

/** Effects that work on a text's words, letters or lines (the runtime splits them). Without the runtime, and above the fold, a whole-block entrance stands in. */
const isTextEffect = (effect: EnterEffect) => {
  const targets = ENTER_EFFECTS[effect].targets as readonly MotionTarget[];
  return targets.length === 1 && targets[0] === "text";
};
export const TEXT_EFFECT_IDS = (Object.keys(ENTER_EFFECTS) as EnterEffect[]).filter(isTextEffect);
const TEXT_FALLBACK: Record<string, EnterEffect> = {
  words: "fade-up",
  "words-blur": "blur-up",
  chars: "fade",
  lines: "fade-up",
};
/** Words (and letters) come in this many milliseconds apart, unless the entrance sets its own `stagger`. */
export const TEXT_STAGGER_MS: Record<string, number> = { words: 60, "words-blur": 60, chars: 24, lines: 120 };

/** Hover effects that need pointer events (the runtime); the rest are CSS. */
export const POINTER_HOVER = ["tilt", "magnetic", "spotlight"] as const;

/** Scroll effects that would fight an entrance over the same properties (opacity, filter): the entrance wins. */
const SCROLL_CLASHES_WITH_ENTRANCE = new Set(["fade-scroll", "blur-scroll"]);

export type FxOptions = {
  /** The part is in the page's first flow row: a `view` entrance behaves as `load` (no waiting for scripts) and an image never starts transparent. */
  firstRow?: boolean;
  /** The part is a picture (an image block): its entrance never starts fully transparent in the first row (LCP). */
  image?: boolean;
  /** The builder's canvas: every entrance plays at once, without a waypoint. */
  preview?: boolean;
  /** This part's place among its parent's children (for a staggered entrance). */
  index?: number;
  /** The parent's `stagger` (ms): this part enters `index × stagger` after the first. */
  parentStagger?: number;
  /** The parent's entrance, which a child with none of its own takes when the parent staggers. */
  parentEnter?: EnterMotion;
};

type Resolved = { trigger: "view" | "load"; now: boolean; text: boolean };

/** When an entrance starts, and whether its text is split (only where scripts can start it in time). */
function resolveTrigger(enter: EnterMotion, options: FxOptions): Resolved {
  const text = isTextEffect(enter.effect);
  if (options.preview) return text ? { trigger: "view", now: true, text } : { trigger: "load", now: false, text };
  if ((enter.trigger ?? "view") === "load" || options.firstRow) return { trigger: "load", now: false, text: false };
  return { trigger: "view", now: false, text };
}

const px = (n: number) => `${n}px`;
const ms = (n: number) => `${n}ms`;

/** The variables an entrance's amounts set, leaving out the defaults the stylesheet has. */
function enterStyle(enter: EnterMotion, into: Record<string, string | number>) {
  if (enter.delay) into["--fx-delay"] = ms(enter.delay);
  // A duration of its own (D179 phase 3) is `--fx-duration`, which motion.css prefers to the speed's.
  if (enter.duration) into["--fx-duration"] = ms(enter.duration);
  else if (enter.speed && enter.speed !== "normal") into["--fx-dur"] = ms(SPEED_MS[enter.speed]);
  if (enter.ease && enter.ease !== "smooth") into["--fx-ease"] = EASE_CURVES[enter.ease];
  if (enter.distance && enter.distance !== "medium") {
    into["--fx-dist"] = px(DISTANCE_PX[enter.distance]);
    into["--fx-amt"] = DISTANCE_AMOUNT[enter.distance];
  }
}

function enterAttrs(enter: EnterMotion, resolved: Resolved, attrs: Record<string, string>) {
  attrs["data-fx-trigger"] = resolved.trigger;
  if (resolved.trigger === "view") {
    if (enter.start && enter.start !== "early") attrs["data-fx-start"] = enter.start;
    if (enter.once === false) attrs["data-fx-repeat"] = "";
    if (resolved.now) attrs["data-fx-now"] = "";
  }
}

/**
 * The attributes and custom properties for a part's motion (D128). `target` is the kind of part (`text` for headings
 * and rich text); an effect that does not fit it is left out. `{}` for both when nothing applies.
 */
export function partFx(motion: PartMotion | undefined, target: MotionTarget, options: FxOptions = {}): FxProps {
  const { parentEnter, parentStagger, index } = options;
  const own = motion?.enter && enterFits(motion.enter.effect, target) ? motion.enter : undefined;
  const staggers = !own && parentEnter && parentStagger && parentStagger > 0 && index !== undefined;
  const inherited =
    staggers && parentEnter && enterFits(parentEnter.effect, target) && !isTextEffect(parentEnter.effect)
      ? parentEnter
      : undefined;
  if (!motion && !inherited) return none();

  const attrs: Record<string, string> = {};
  const style: Record<string, string | number> = {};

  const enter = own ?? inherited;
  if (enter) {
    const resolved = resolveTrigger(enter, options);
    const group =
      (target === "row" || target === "column") &&
      !inherited &&
      own &&
      own.stagger &&
      own.stagger > 0 &&
      !resolved.text;
    if (group) {
      // A row's columns or a column's components come in one after another, each with the entrance; this part itself holds still.
      attrs["data-fx-each"] = "";
      enterAttrs(enter, resolved, attrs);
    } else {
      attrs["data-fx-enter"] =
        resolved.trigger === "load" && isTextEffect(enter.effect) ? TEXT_FALLBACK[enter.effect] : enter.effect;
      enterAttrs(enter, resolved, attrs);
      enterStyle(enter, style);
      if (resolved.text) {
        attrs["data-fx-text"] = "";
        const stagger = enter.stagger ?? TEXT_STAGGER_MS[enter.effect];
        if (stagger !== undefined && stagger !== TEXT_STAGGER_MS[enter.effect]) style["--fx-stagger"] = ms(stagger);
      }
      if (options.image && options.firstRow && resolved.trigger === "load") attrs["data-fx-nofade"] = "";
      if (inherited) {
        attrs["data-fx-c"] = "";
        style["--fx-i"] = index!;
        style["--fx-stagger"] = ms(parentStagger!);
      }
    }
  }

  const hover = motion?.hover;
  if (hover && hoverFits(hover.effect, target)) {
    attrs["data-fx-hover"] = hover.effect;
    if (hover.intensity && hover.intensity !== "medium") style["--fx-hk"] = INTENSITY_FACTOR[hover.intensity];
  }

  const scroll = motion?.scroll;
  if (scroll && scrollFits(scroll.effect, target) && !(enter && SCROLL_CLASHES_WITH_ENTRANCE.has(scroll.effect))) {
    attrs["data-fx-scroll"] = scroll.effect;
    if (scroll.intensity && scroll.intensity !== "medium") style["--fx-sk"] = INTENSITY_FACTOR[scroll.intensity];
  }

  if (Object.keys(attrs).length === 0) return none();
  return { attrs, style: style as CSSProperties };
}

/** Background effects that follow the scroll (the rest run by themselves). */
const BACKGROUND_SCROLL = new Set(["parallax", "zoom-scroll", "blur-scroll", "fade-scroll"]);

/**
 * The attributes for the layer a row's or column's background is drawn on. In the page's first row a background never
 * fades in (it is what the page is seen through at first), so `fade-scroll` is left out there.
 */
export function backgroundFx(
  motion: BackgroundMotion | undefined,
  options: { firstRow?: boolean; preview?: boolean } = {},
): FxProps {
  if (!motion) return none();
  if (options.firstRow && motion.effect === "fade-scroll") return none();
  const attrs: Record<string, string> = { "data-fx-bgm": motion.effect };
  const style: Record<string, string | number> = {};
  if (BACKGROUND_SCROLL.has(motion.effect)) {
    attrs["data-fx-scroll"] = `bg-${motion.effect}`;
    // The scroll is measured on the background's frame (the layer's parent), not on the layer that moves.
    attrs["data-fx-tl"] = "parent";
  }
  if (motion.intensity && motion.intensity !== "medium") style["--fx-sk"] = INTENSITY_FACTOR[motion.intensity];
  return { attrs, style: style as CSSProperties };
}

/** The kind of part a block is, for its effects: headings and rich text take the text ones. */
export const blockTarget = (block: Pick<PageBlock, "type">): MotionTarget =>
  block.type === "heading" || block.type === "richText" ? "text" : "block";

// ---------------------------------------------------------------------------
// What a page needs
// ---------------------------------------------------------------------------

export type MotionNeeds = {
  /** Something needs the runtime: a waypoint entrance, split text, a pointer effect, or a scroll effect (for browsers without CSS scroll timelines). */
  js: boolean;
  /** Something starts hidden until a waypoint (needs the no-script fallback). */
  view: boolean;
  /** Any part has an entrance, hover or scroll effect (they move: the page keeps its sides clipped). */
  any: boolean;
};

type Flags = { js: boolean; view: boolean; any: boolean };

/** One part's own motion; `first` is the page's first flow row (`view` acts as `load` there). */
function motionOf(motion: PartMotion | undefined, target: MotionTarget, first: boolean, into: Flags) {
  if (!motion) return;
  const enter = motion.enter && enterFits(motion.enter.effect, target) ? motion.enter : undefined;
  if (enter) {
    into.any = true;
    const wait = (enter.trigger ?? "view") === "view" && !first;
    if (wait) into.js = into.view = true;
  }
  if (motion.hover && hoverFits(motion.hover.effect, target)) {
    into.any = true;
    if ((POINTER_HOVER as readonly string[]).includes(motion.hover.effect)) into.js = true;
  }
  if (motion.scroll && scrollFits(motion.scroll.effect, target)) {
    into.any = true;
    into.js = true;
  }
}

/** What the rows of a page (or a header or footer) need. Rows in a modal are not in the flow: their entrances wait for the dialog to open. */
export function motionNeeds(rows: readonly PageRow[]): MotionNeeds {
  const flags: Flags = { js: false, view: false, any: false };
  const firstFlow = flowRows(rows)[0];
  for (const row of rows) {
    const first = row === firstFlow;
    motionOf(row.motion, "row", first, flags);
    if (row.backgroundMotion && BACKGROUND_SCROLL.has(row.backgroundMotion.effect) && row.background) flags.js = true;
    for (const column of row.columns) {
      motionOf(column.motion, "column", first, flags);
      if (column.backgroundMotion && BACKGROUND_SCROLL.has(column.backgroundMotion.effect) && column.background)
        flags.js = true;
      for (const block of column.blocks) motionOf(block.motion, blockTarget(block), first, flags);
    }
  }
  // A staggered group's children take the parent's entrance: they wait exactly when the parent does (counted with it above).
  return flags;
}

/** Whether the page's motion needs the runtime (`<MotionRuntime />`); pure CSS effects do not. */
export function pageUsesMotion(rows: readonly PageRow[]): boolean {
  return motionNeeds(rows).js;
}

/** Same as `pageUsesMotion`, under the name the builder's canvas uses for a list of rows. */
export function rowsUseJsMotion(rows: readonly PageRow[]): boolean {
  return motionNeeds(rows).js;
}
