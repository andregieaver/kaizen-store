import {
  BACKGROUND_EFFECTS,
  ENTER_EFFECTS,
  HOVER_EFFECTS,
  SCROLL_EFFECTS,
  backgroundMotionSchema,
  enterFits,
  hoverFits,
  partMotionSchema,
  scrollFits,
  type BackgroundEffect,
  type BackgroundMotion,
  type EnterEffect,
  type EnterMotion,
  type HoverEffect,
  type HoverMotion,
  type MotionDistance,
  type MotionEase,
  type MotionIntensity,
  type MotionSpeed,
  type MotionTarget,
  type PartMotion,
  type ScrollEffect,
  type ScrollMotion,
} from "./motion";
import {
  blockText,
  type BlockType,
  type PageBlock,
  type PageColumn,
  type PageRow,
  type PageType,
} from "./page-content";
import { flowRows } from "./page-modal";

/**
 * "Make my page cool" (D128): the AI manager looks at a page and adds tasteful motion to it. This module is the pure
 * part, shared by the browser and the server: a compact, private outline of the page for the model (`outlinePage`),
 * the checking of what the model answers against the real page and the effect catalogues (`cleanMotionPlan`), a
 * deterministic plan made by rules alone for when there is no AI (`ruleBasedPlan`), and putting a plan on a page
 * (`applyMotionPlan`), which only ever fills motion slots that are empty: what the owner chose stays.
 *
 * Whatever a plan comes from (the model or the rules) goes through one checker, `finish()`, so a page is never a
 * circus: one style, few effects, no entrances inside entrances, nothing on a modal, the first section loading with
 * the page, and the numbers capped.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export const MOTION_STYLES = { subtle: "Subtle", elegant: "Elegant", lively: "Lively" } as const;
export type MotionStyle = keyof typeof MOTION_STYLES;

/** What a plan puts on one part; `id` is a row's, a column's or a block's. */
export type MotionPlanItem = {
  id: string;
  enter?: EnterMotion;
  hover?: HoverMotion;
  scroll?: ScrollMotion;
  backgroundMotion?: BackgroundMotion;
};

export type MotionPlan = {
  style: MotionStyle;
  /** Plain English, composed in code from the items (never from the model). */
  summary: string;
  items: MotionPlanItem[];
  /** Whether a model chose the plan (false: the rules did). */
  aiUsed: boolean;
};

export type MotionPlanResult = { ok: true; plan: MotionPlan } | { ok: false; problem: string };

export type OutlineBackground = "none" | "color" | "image" | "video" | "gradient";
export type OutlineBlock = { id: string; type: BlockType; text?: string; motion?: true };
export type OutlineColumn = {
  id: string;
  blocks: OutlineBlock[];
  /** Blocks left out to keep the outline short. */
  more?: number;
  bg?: OutlineBackground;
  motion?: true;
  bgMotion?: true;
};
export type OutlineRow = {
  id: string;
  kind: "row";
  /** The first row in the page's flow: what people see when it opens. */
  firstRow?: true;
  layout: string;
  fullHeight?: true;
  bg: OutlineBackground;
  motion?: true;
  bgMotion?: true;
  /** Left out for size: the row's id is still here. */
  columns?: OutlineColumn[];
};
/** What the model is told about a page: structure and a few headline words, never prices, addresses or people. */
export type PageOutline = { rows: OutlineRow[]; truncated?: number };

// ---------------------------------------------------------------------------
// Which parts can take what
// ---------------------------------------------------------------------------

/** Components that can have an entrance. Everything else (separators, HTML, shop parts, menus …) stays still. */
const ENTER_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>([
  "richText",
  "heading",
  "image",
  "button",
  "dualButton",
  "video",
  "contentGrid",
  "accordion",
  "tabs",
  "faq",
  "testimonials",
  "iconList",
  "socialLinks",
  "emailForm",
  "newsletter",
]);
const TEXT_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>(["heading", "richText"]);
/** Components a scroll effect suits (not tools, forms or things people read closely). */
const SCROLL_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>([
  "image",
  "video",
  "contentGrid",
  "heading",
  "richText",
  "testimonials",
  "iconList",
]);
/** What a hover effect may be on a component, in order of preference (the first replaces one that does not suit). */
const HOVER_BLOCKS: Partial<Record<BlockType, readonly HoverEffect[]>> = {
  button: ["lift", "grow", "shine", "magnetic", "glow"],
  dualButton: ["lift", "grow", "shine", "magnetic", "glow"],
  image: ["image-zoom", "lift", "shine", "tilt", "glow", "grow"],
  video: ["lift", "grow"],
  socialLinks: ["lift", "float", "grow"],
};
const HOVER_COLUMN: readonly HoverEffect[] = ["lift", "glow", "shine", "tilt", "spotlight", "grow"];
/** Entrances that would hide a picture at the top of the page. */
const HIDING_EFFECTS: ReadonlySet<EnterEffect> = new Set<EnterEffect>(["wipe-left", "wipe-up", "iris"]);

/** Effects that belong together: a page keeps to two families besides text effects. */
const FAMILIES: Record<Exclude<EnterEffect, "words" | "words-blur" | "chars" | "lines">, string> = {
  fade: "fade",
  "fade-up": "fade",
  "fade-down": "fade",
  "fade-left": "fade",
  "fade-right": "fade",
  "zoom-in": "zoom",
  "zoom-out": "zoom",
  pop: "zoom",
  "blur-in": "blur",
  "blur-up": "blur",
  "wipe-left": "reveal",
  "wipe-up": "reveal",
  iris: "reveal",
  "flip-x": "turn",
  "flip-y": "turn",
  "rotate-in": "turn",
};
export const enterFamily = (effect: EnterEffect): string | null =>
  effect in FAMILIES ? FAMILIES[effect as keyof typeof FAMILIES] : null;

export const CAPS = {
  hovers: 12,
  scrolls: 8,
  backgrounds: 6,
  entrances: 40,
  stagger: 400,
  firstRowDelay: 600,
} as const;

type StyleSpec = {
  enter: readonly EnterEffect[];
  text: readonly EnterEffect[];
  fallback: EnterEffect;
  textFallback: EnterEffect;
  speed: MotionSpeed;
  ease: MotionEase;
  distance: MotionDistance;
  intensity: MotionIntensity;
  scroll: readonly ScrollEffect[];
  background: readonly BackgroundEffect[];
};

/** What each style allows and how it moves: entrances, speed, ease and distance follow the style, whatever the model says. */
export const STYLES: Record<MotionStyle, StyleSpec> = {
  subtle: {
    enter: ["fade", "fade-up"],
    text: ["lines"],
    fallback: "fade-up",
    textFallback: "lines",
    speed: "normal",
    ease: "soft",
    distance: "small",
    intensity: "subtle",
    scroll: ["parallax", "fade-scroll"],
    background: ["parallax", "ken-burns"],
  },
  elegant: {
    enter: ["fade-up", "fade", "fade-left", "fade-right", "zoom-out", "blur-in", "blur-up", "wipe-left", "wipe-up"],
    text: ["words", "words-blur", "lines"],
    fallback: "fade-up",
    textFallback: "words",
    speed: "normal",
    ease: "smooth",
    distance: "medium",
    intensity: "subtle",
    scroll: ["parallax", "fade-scroll", "blur-scroll", "scale-down"],
    background: ["parallax", "ken-burns", "zoom-scroll", "blur-scroll"],
  },
  lively: {
    enter: ["pop", "zoom-in", "flip-x", "flip-y", "fade-left", "fade-right", "fade-up", "rotate-in"],
    text: ["words", "chars", "words-blur"],
    fallback: "fade-up",
    textFallback: "words",
    speed: "fast",
    ease: "snappy",
    distance: "large",
    intensity: "medium",
    scroll: [
      "parallax",
      "parallax-fast",
      "drift-left",
      "drift-right",
      "scale-up",
      "rotate",
      "fade-scroll",
      "blur-scroll",
    ],
    background: ["parallax", "ken-burns", "zoom-scroll", "drift", "blur-scroll", "fade-scroll"],
  },
};
const DEFAULT_STYLE: MotionStyle = "elegant";
/** A video already moves: only these suit it. */
const VIDEO_BACKGROUND: readonly BackgroundEffect[] = ["parallax", "fade-scroll"];
/** Plans are refused for these: a header that animates every time a page opens is more nuisance than delight. */
const REFUSED_TYPES: readonly PageType[] = ["header"];

/** Why a page of this type is not given motion here, in plain words; null when it can be. */
export function motionPlanRefusal(type: PageType): string | null {
  return REFUSED_TYPES.includes(type)
    ? "Headers are left as they are: motion on a header would replay on every page. Give a whole page motion instead."
    : null;
}

// ---------------------------------------------------------------------------
// The page, indexed
// ---------------------------------------------------------------------------

type Kind = "row" | "column" | "block";
type Background = "none" | "color" | "image" | "video" | "gradient";

type Part = {
  id: string;
  kind: Kind;
  order: number;
  blockType?: BlockType;
  row: PageRow;
  column?: PageColumn;
  /** In the first row of the page's flow. */
  first: boolean;
  /** The ids of the row and column it is in (for a block), or the row (for a column). */
  parents: string[];
  motion?: PartMotion;
  bgMotion?: BackgroundMotion;
  bg: Background;
  textLength: number;
  /** How many parts are inside that can move on their own (columns of a row, blocks of a column). */
  children: number;
  /** How many components inside can have an entrance: a row or column with none is only a spacer. */
  content: number;
};

const bgKind = (background: { type: string } | undefined): Background =>
  background ? (background.type as Background) : "none";

const textLengthOf = (block: PageBlock): number => (TEXT_BLOCKS.has(block.type) ? blockText(block).length : 0);

/** Every row, column and block of the flow (modals left out), in the order the page reads. */
function indexPage(rows: readonly PageRow[]): { parts: Map<string, Part>; ordered: Part[] } {
  const parts = new Map<string, Part>();
  const ordered: Part[] = [];
  const add = (part: Part) => {
    ordered.push(part);
    // The first id wins if a page repeats one.
    if (!parts.has(part.id)) parts.set(part.id, part);
  };
  flowRows(rows).forEach((row, index) => {
    const first = index === 0;
    add({
      id: row.id,
      kind: "row",
      order: ordered.length,
      row,
      first,
      parents: [],
      motion: row.motion,
      bgMotion: row.backgroundMotion,
      bg: bgKind(row.background),
      textLength: 0,
      children: row.columns.length,
      content: row.columns.reduce((sum, c) => sum + c.blocks.filter((b) => ENTER_BLOCKS.has(b.type)).length, 0),
    });
    for (const column of row.columns) {
      add({
        id: column.id,
        kind: "column",
        order: ordered.length,
        row,
        column,
        first,
        parents: [row.id],
        motion: column.motion,
        bgMotion: column.backgroundMotion,
        bg: bgKind(column.background),
        textLength: 0,
        children: column.blocks.length,
        content: column.blocks.filter((b) => ENTER_BLOCKS.has(b.type)).length,
      });
      for (const block of column.blocks) {
        add({
          id: block.id,
          kind: "block",
          order: ordered.length,
          blockType: block.type,
          row,
          column,
          first,
          parents: [row.id, column.id],
          motion: block.motion,
          bg: "none",
          textLength: textLengthOf(block),
          children: 0,
          content: 1,
        });
      }
    }
  });
  return { parts, ordered };
}

const isTextPart = (part: Part) =>
  part.kind === "block" && part.blockType !== undefined && TEXT_BLOCKS.has(part.blockType);

/** Whether a part can have an entrance at all. */
const enterEligible = (part: Part) =>
  part.kind === "block" ? part.blockType !== undefined && ENTER_BLOCKS.has(part.blockType) : part.content > 0;

// ---------------------------------------------------------------------------
// The outline the model sees
// ---------------------------------------------------------------------------

/** The most characters of JSON an outline takes. */
export const OUTLINE_MAX_CHARACTERS = 6000;
export const SNIPPET_MAX = 80;

/**
 * Words a designer needs from a text, and no more: web and email addresses, phone numbers and anything that looks like a
 * price are taken out before a word leaves the page.
 */
export function redact(text: string): string {
  return text
    .replace(/\S+@\S+/g, " ")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/(?:€|\$|£|\bkr\.?)\s?\d[\d.,\s]*/gi, " ")
    .replace(/\d[\d.,\s]*\s?(?:€|\$|£|kr\.?|nok|sek|dkk|eur|usd|gbp)\b/gi, " ")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(block: PageBlock, limit: { heading: number; rich: number; other: number }): string | undefined {
  const max = block.type === "heading" ? limit.heading : block.type === "richText" ? limit.rich : limit.other;
  if (max <= 0) return undefined;
  // Only headings, prose, a picture's description and a video's title: never forms, reviews or buttons' addresses.
  if (block.type !== "heading" && block.type !== "richText" && block.type !== "image" && block.type !== "video")
    return undefined;
  const words = redact(blockText(block));
  if (!words) return undefined;
  return words.length > max ? `${words.slice(0, max - 1).trimEnd()}…` : words;
}

type Detail = { heading: number; rich: number; other: number; blocksPerColumn: number; detailedRows: number };
/** From most to least detail: each step is tried until the outline fits. */
const DETAIL: Detail[] = [
  { heading: SNIPPET_MAX, rich: SNIPPET_MAX, other: 60, blocksPerColumn: 12, detailedRows: 999 },
  { heading: SNIPPET_MAX, rich: 0, other: 0, blocksPerColumn: 12, detailedRows: 999 },
  { heading: 40, rich: 0, other: 0, blocksPerColumn: 12, detailedRows: 999 },
  { heading: 0, rich: 0, other: 0, blocksPerColumn: 12, detailedRows: 999 },
  { heading: 0, rich: 0, other: 0, blocksPerColumn: 5, detailedRows: 999 },
  { heading: 0, rich: 0, other: 0, blocksPerColumn: 5, detailedRows: 12 },
  { heading: 0, rich: 0, other: 0, blocksPerColumn: 3, detailedRows: 6 },
];

function buildOutline(rows: readonly PageRow[], detail: Detail): PageOutline {
  const flow = flowRows(rows);
  return {
    rows: flow.map((row, index): OutlineRow => {
      const out: OutlineRow = {
        id: row.id,
        kind: "row",
        ...(index === 0 && { firstRow: true as const }),
        layout: row.layout,
        ...(row.fullHeight && { fullHeight: true as const }),
        bg: bgKind(row.background),
        ...(row.motion && (row.motion.enter || row.motion.hover || row.motion.scroll) && { motion: true as const }),
        ...(row.backgroundMotion && { bgMotion: true as const }),
      };
      if (index >= detail.detailedRows) return out;
      out.columns = row.columns.map((column): OutlineColumn => {
        const shown = column.blocks.slice(0, detail.blocksPerColumn);
        const columnBg = bgKind(column.background);
        return {
          id: column.id,
          blocks: shown.map((block): OutlineBlock => {
            const text = snippet(block, detail);
            return {
              id: block.id,
              type: block.type,
              ...(text && { text }),
              ...(block.motion &&
                (block.motion.enter || block.motion.hover || block.motion.scroll) && { motion: true as const }),
            };
          }),
          ...(column.blocks.length > shown.length && { more: column.blocks.length - shown.length }),
          ...(columnBg !== "none" && { bg: columnBg }),
          ...(column.motion &&
            (column.motion.enter || column.motion.hover || column.motion.scroll) && { motion: true as const }),
          ...(column.backgroundMotion && { bgMotion: true as const }),
        };
      });
      return out;
    }),
  };
}

/**
 * The page described for the model: its rows in order, each with its columns and components (their kind and, for a
 * heading, prose, picture or video, a few redacted words), whether the first row of the flow, what its background is,
 * and whether the owner already gave a part motion. Modals are left out. At most `OUTLINE_MAX_CHARACTERS` of JSON:
 * the least useful detail goes first (prose, then headings' words, then whole columns of later rows) and rows' ids
 * last of all (only rows past what fits, marked `truncated`).
 */
export function outlinePage(rows: readonly PageRow[]): PageOutline {
  let outline: PageOutline = { rows: [] };
  for (const detail of DETAIL) {
    outline = buildOutline(rows, detail);
    if (JSON.stringify(outline).length <= OUTLINE_MAX_CHARACTERS) return outline;
  }
  // Still too long (a very long page): keep as many rows as fit.
  const all = outline.rows;
  let keep = all.length;
  while (
    keep > 1 &&
    JSON.stringify({ rows: all.slice(0, keep), truncated: all.length - keep }).length > OUTLINE_MAX_CHARACTERS
  )
    keep -= 1;
  return { rows: all.slice(0, keep), truncated: all.length - keep };
}

// ---------------------------------------------------------------------------
// Reading and checking a plan
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const own = (catalogue: object, id: unknown): id is string => typeof id === "string" && Object.hasOwn(catalogue, id);
const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const snap = (value: number, step: number, max: number) => Math.min(max, Math.max(0, Math.round(value / step) * step));

type Draft = { part: Part; enter?: EnterMotion; hover?: HoverMotion; scroll?: ScrollMotion; bg?: BackgroundMotion };

/** How a part's effect is checked: the target the catalogue lists it under. */
function targetOf(part: Part): MotionTarget {
  return part.kind === "block" ? "block" : part.kind;
}
const fitsEnter = (effect: EnterEffect, part: Part) =>
  enterFits(effect, targetOf(part)) || (isTextPart(part) && enterFits(effect, "text"));
const isTextEffect = (effect: EnterEffect) => {
  const targets = ENTER_EFFECTS[effect].targets as readonly MotionTarget[];
  return targets.length === 1 && targets[0] === "text";
};

function makeEnter(part: Part, raw: unknown, spec: StyleSpec): EnterMotion | null {
  if (!isObject(raw) || !own(ENTER_EFFECTS, raw.effect) || !enterEligible(part)) return null;
  let effect = raw.effect as EnterEffect;
  if (isTextEffect(effect)) {
    // Words, letters and lines are for headings and text only.
    if (!isTextPart(part)) return null;
    if (!spec.text.includes(effect)) effect = spec.textFallback;
    if (effect === "chars" && part.textLength > 40) effect = "words";
  } else {
    if (!fitsEnter(effect, part)) return null;
    if (!spec.enter.includes(effect)) effect = spec.fallback;
  }
  // A picture at the top of the page is never hidden by a wipe or an iris.
  if (part.first && part.blockType === "image" && HIDING_EFFECTS.has(effect)) effect = "fade";
  if (!fitsEnter(effect, part)) return null;
  const first = part.first;
  const wantedDelay = finite(raw.delay) ?? 0;
  const delay = snap(wantedDelay, 50, first ? CAPS.firstRowDelay : 2000);
  const staggerable =
    (part.kind === "row" && part.children >= 2) ||
    (part.kind === "column" && part.children >= 2) ||
    isTextEffect(effect);
  const wantedStagger = finite(raw.stagger) ?? 0;
  const stagger = staggerable ? snap(wantedStagger, 10, CAPS.stagger) : 0;
  return {
    effect,
    speed: spec.speed,
    ease: effect === "pop" ? "bounce" : spec.ease,
    distance: spec.distance,
    ...(delay > 0 && { delay }),
    trigger: first ? "load" : "view",
    ...(!first && { start: "middle" as const }),
    once: true,
    ...(stagger > 0 && { stagger }),
  };
}

function makeHover(part: Part, raw: unknown, spec: StyleSpec): HoverMotion | null {
  if (!isObject(raw) || !own(HOVER_EFFECTS, raw.effect) || part.kind === "row") return null;
  const allowed =
    part.kind === "column"
      ? part.row.columns.length >= 2
        ? HOVER_COLUMN
        : undefined
      : HOVER_BLOCKS[part.blockType as BlockType];
  if (!allowed || allowed.length === 0) return null;
  const effect = allowed.includes(raw.effect as HoverEffect) ? (raw.effect as HoverEffect) : allowed[0];
  if (!hoverFits(effect, targetOf(part))) return null;
  return { effect, intensity: spec.intensity };
}

function makeScroll(part: Part, raw: unknown, spec: StyleSpec): ScrollMotion | null {
  if (!isObject(raw) || !own(SCROLL_EFFECTS, raw.effect)) return null;
  const effect = raw.effect as ScrollEffect;
  if (part.kind === "block" && !(part.blockType && SCROLL_BLOCKS.has(part.blockType))) return null;
  if (!spec.scroll.includes(effect) || !scrollFits(effect, targetOf(part))) return null;
  if (isTextPart(part)) {
    // Text stays put at the top of the page, and elsewhere only fades or comes into focus.
    if (part.first || (effect !== "fade-scroll" && effect !== "blur-scroll")) return null;
  }
  return { effect, intensity: spec.intensity };
}

function makeBackground(part: Part, raw: unknown, spec: StyleSpec): BackgroundMotion | null {
  if (!isObject(raw) || part.kind === "block") return null;
  // Colours and gradients need no help (a gradient already moves); only pictures and videos.
  if (part.bg !== "image" && part.bg !== "video") return null;
  const allowed = part.bg === "video" ? spec.background.filter((e) => VIDEO_BACKGROUND.includes(e)) : spec.background;
  if (allowed.length === 0) return null;
  let effect: BackgroundEffect = "parallax";
  if (own(BACKGROUND_EFFECTS, raw.effect) && allowed.includes(raw.effect as BackgroundEffect))
    effect = raw.effect as BackgroundEffect;
  else if (!allowed.includes("parallax")) effect = allowed[0];
  const checked = backgroundMotionSchema.safeParse({ effect, intensity: spec.intensity });
  return checked.success && checked.data ? checked.data : null;
}

/** The most entrances a page gets from a plan: about one part in three, at least three. */
function entranceBudget(ordered: readonly Part[]): number {
  const eligible = ordered.filter(enterEligible).length;
  return Math.min(CAPS.entrances, Math.max(3, Math.ceil(eligible / 3)));
}

type RawItem = { id: unknown; enter?: unknown; hover?: unknown; scroll?: unknown; backgroundMotion?: unknown };

/** The one checker every plan goes through. Returns items in the page's order; parts with nothing left are left out. */
function finish(
  rawItems: readonly RawItem[],
  rows: readonly PageRow[],
  style: MotionStyle,
): { items: MotionPlanItem[]; parts: Map<string, Part> } {
  const spec = STYLES[style];
  const { parts, ordered } = indexPage(rows);
  const drafts = new Map<string, Draft>();
  const draftOf = (part: Part) => {
    let draft = drafts.get(part.id);
    if (!draft) drafts.set(part.id, (draft = { part }));
    return draft;
  };

  // 1. Each slot on its own: the part exists, the slot is free, the effect exists and suits the part and the style.
  for (const item of rawItems) {
    const part = typeof item.id === "string" ? parts.get(item.id) : undefined;
    if (!part) continue;
    const draft = draftOf(part);
    if (!draft.enter && !part.motion?.enter && item.enter !== undefined)
      draft.enter = makeEnter(part, item.enter, spec) ?? undefined;
    if (!draft.hover && !part.motion?.hover && item.hover !== undefined)
      draft.hover = makeHover(part, item.hover, spec) ?? undefined;
    if (!draft.scroll && !part.motion?.scroll && item.scroll !== undefined)
      draft.scroll = makeScroll(part, item.scroll, spec) ?? undefined;
    if (!draft.bg && !part.bgMotion && item.backgroundMotion !== undefined)
      draft.bg = makeBackground(part, item.backgroundMotion, spec) ?? undefined;
  }

  // 2. Columns of a row come in turn (one entrance with a stagger on the row) rather than each with a delay of its own;
  //    the exception is two columns coming in from opposite sides.
  for (const row of flowRows(rows)) {
    const rowPart = parts.get(row.id);
    if (!rowPart || row.columns.length < 2) continue;
    const rowDraft = drafts.get(row.id);
    const columnDrafts = row.columns.map((c) => drafts.get(c.id)).filter((d): d is Draft => Boolean(d?.enter));
    if (rowDraft?.enter && !rowDraft.enter.stagger) rowDraft.enter = { ...rowDraft.enter, stagger: 100 };
    if (columnDrafts.length < 2 || rowDraft?.enter || rowPart.motion?.enter) continue;
    const sides = new Set(columnDrafts.map((d) => d.enter?.effect));
    if (
      row.columns.length === 2 &&
      columnDrafts.length === 2 &&
      sides.size === 2 &&
      sides.has("fade-left") &&
      sides.has("fade-right")
    )
      continue;
    const lead = columnDrafts[0].enter as EnterMotion;
    draftOf(rowPart).enter = { ...lead, stagger: Math.min(CAPS.stagger, lead.stagger ?? 120) };
    for (const d of columnDrafts) d.enter = undefined;
  }

  const sorted = [...drafts.values()].sort((a, b) => a.part.order - b.part.order);

  // 3. No entrance inside an entrance, the owner's included.
  const entered = new Set(ordered.filter((p) => p.motion?.enter).map((p) => p.id));
  for (const draft of sorted) {
    if (!draft.enter) continue;
    if (draft.part.parents.some((id) => entered.has(id))) draft.enter = undefined;
    else entered.add(draft.part.id);
  }

  // 4. About one part in three: the owner's own entrances count too.
  const existingEnters = ordered.filter((p) => p.motion?.enter).length;
  let budget = Math.max(0, entranceBudget(ordered) - existingEnters);
  for (const draft of sorted) {
    if (!draft.enter) continue;
    if (budget > 0) budget -= 1;
    else draft.enter = undefined;
  }

  // 5. At most two families of entrance across the page (text effects apart).
  const counts = new Map<string, { n: number; first: number; effects: Map<EnterEffect, number> }>();
  sorted.forEach((draft, position) => {
    const effect = draft.enter?.effect;
    const family = effect && enterFamily(effect);
    if (!effect || !family) return;
    const entry = counts.get(family) ?? { n: 0, first: position, effects: new Map() };
    entry.n += 1;
    entry.effects.set(effect, (entry.effects.get(effect) ?? 0) + 1);
    counts.set(family, entry);
  });
  if (counts.size > 2) {
    const kept = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).slice(0, 2);
    const keptFamilies = new Set(kept.map(([family]) => family));
    const common = kept
      .flatMap(([, entry]) => [...entry.effects.entries()])
      .sort((a, b) => b[1] - a[1])
      .map(([effect]) => effect);
    for (const draft of sorted) {
      const effect = draft.enter?.effect;
      const family = effect && enterFamily(effect);
      if (!draft.enter || !effect || !family || keptFamilies.has(family)) continue;
      const replacement = common.find(
        (candidate) =>
          fitsEnter(candidate, draft.part) &&
          !(draft.part.first && draft.part.blockType === "image" && HIDING_EFFECTS.has(candidate)),
      );
      draft.enter = replacement
        ? { ...draft.enter, effect: replacement, ease: replacement === "pop" ? "bounce" : spec.ease }
        : undefined;
    }
  }

  // 6. Scroll effects: not on a part that has an entrance (they would fight), not inside another scroll effect.
  const scrolling = new Set(ordered.filter((p) => p.motion?.scroll).map((p) => p.id));
  let scrolls = 0;
  for (const draft of sorted) {
    if (!draft.scroll) continue;
    const entrance = draft.enter ?? (draft.part.motion?.enter ? draft.part.motion.enter : undefined);
    const inside = draft.part.parents.some((id) => scrolling.has(id));
    if (entrance || inside || scrolls >= CAPS.scrolls) draft.scroll = undefined;
    else {
      scrolls += 1;
      scrolling.add(draft.part.id);
    }
  }

  // 7. Hover and background caps.
  let hovers = 0;
  let backgrounds = 0;
  for (const draft of sorted) {
    if (draft.hover) {
      if (hovers >= CAPS.hovers) draft.hover = undefined;
      else hovers += 1;
    }
    if (draft.bg) {
      if (backgrounds >= CAPS.backgrounds) draft.bg = undefined;
      else backgrounds += 1;
    }
  }

  // 8. What is left, as items that pass the real schemas.
  const items: MotionPlanItem[] = [];
  for (const draft of sorted) {
    const motion = partMotionSchema.safeParse({
      ...(draft.enter && { enter: draft.enter }),
      ...(draft.hover && { hover: draft.hover }),
      ...(draft.scroll && { scroll: draft.scroll }),
    });
    const item: MotionPlanItem = { id: draft.part.id };
    if (motion.success && motion.data) Object.assign(item, motion.data);
    if (draft.bg) item.backgroundMotion = draft.bg;
    if (item.enter || item.hover || item.scroll || item.backgroundMotion) items.push(item);
  }
  return { items, parts };
}

// ---------------------------------------------------------------------------
// The summary, composed in code
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
const ADJECTIVE: Record<MotionStyle, string> = { subtle: "soft", elegant: "gentle", lively: "lively" };

/** What a plan does, in a sentence, from its items (never from words a model wrote). */
export function summarizePlan(items: readonly MotionPlanItem[], rows: readonly PageRow[], style: MotionStyle): string {
  const { parts } = indexPage(rows);
  const kindOf = (id: string) => parts.get(id);
  const said: string[] = [];

  const entering = items.filter((i) => i.enter);
  if (entering.length > 0) {
    const sections = entering.filter((i) => kindOf(i.id)?.kind !== "block").length;
    const components = entering.length - sections;
    const where = [
      sections > 0 && plural(sections, "section"),
      components > 0 && plural(components, "component"),
    ].filter(Boolean) as string[];
    said.push(`${ADJECTIVE[style]} entrances to ${list(where)}`);
  }
  const scrolling = items.filter((i) => i.scroll);
  if (scrolling.length > 0)
    said.push(
      `${scrolling.length === 1 ? "a scroll effect" : "scroll effects"} on ${plural(scrolling.length, "part")}`,
    );
  const backgrounds = items.filter((i) => i.backgroundMotion);
  if (backgrounds.length > 0) {
    const effects = new Set(backgrounds.map((i) => i.backgroundMotion?.effect));
    const [effect] = effects;
    const only = effects.size === 1 && effect ? BACKGROUND_EFFECTS[effect].label.toLowerCase() : "moving backgrounds";
    said.push(`${only} on ${plural(backgrounds.length, "background")}`);
  }
  const hovering = items.filter((i) => i.hover);
  if (hovering.length > 0) {
    const effects = new Set(hovering.map((i) => i.hover?.effect));
    const [effect] = effects;
    if (effects.size === 1 && effect) {
      const nouns = { button: 0, card: 0, picture: 0, part: 0 };
      for (const item of hovering) {
        const part = kindOf(item.id);
        const type = part?.blockType;
        if (type === "button" || type === "dualButton") nouns.button += 1;
        else if (part?.kind === "column") nouns.card += 1;
        else if (type === "image") nouns.picture += 1;
        else nouns.part += 1;
      }
      const where = (Object.entries(nouns) as [keyof typeof nouns, number][])
        .filter(([, count]) => count > 0)
        .map(([noun, count]) => plural(count, noun));
      said.push(`${HOVER_EFFECTS[effect].label.toLowerCase()} on hover for ${list(where)}`);
    } else said.push(`hover effects on ${plural(hovering.length, "part")}`);
  }
  if (said.length === 0)
    return "Nothing was added: the page already has motion where it helps, or there is nothing on it that motion would improve.";
  return `Added ${list(said)}.`;
}

const asStyle = (value: unknown): MotionStyle => (own(MOTION_STYLES, value) ? (value as MotionStyle) : DEFAULT_STYLE);

/**
 * A model's answer as a plan for this page, or null when nothing usable is left. Every id is checked against the page,
 * every effect against the catalogues and the part it goes on, and the whole against the rules above; the model's own
 * summary, if it wrote one, is never used.
 */
export function cleanMotionPlan(raw: unknown, rows: readonly PageRow[]): MotionPlan | null {
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  const style = asStyle(raw.style);
  const wanted = raw.items.filter(isObject).map(
    (item): RawItem => ({
      id: item.id,
      enter: item.enter,
      hover: item.hover,
      scroll: item.scroll,
      backgroundMotion: item.backgroundMotion,
    }),
  );
  const { items } = finish(wanted, rows, style);
  if (items.length === 0) return null;
  return { style, summary: summarizePlan(items, rows, style), items, aiUsed: true };
}

// ---------------------------------------------------------------------------
// The plan by rules alone
// ---------------------------------------------------------------------------

const BUTTONS: ReadonlySet<BlockType> = new Set<BlockType>(["button", "dualButton"]);
const hasCardLook = (column: PageColumn) =>
  Boolean(column.border || column.shadow || column.background?.type === "color");

/**
 * A tasteful plan from the page's structure alone (used with no AI, or when its answer cannot be used): the hero's
 * heading arrives word by word and the rest of the first row after it, sections rise into view (columns in turn, two
 * columns with a picture from opposite sides), pictures settle, pictures behind sections drift with the scroll and
 * buttons lift. Elegant, and the same every time.
 */
export function ruleBasedPlan(rows: readonly PageRow[]): MotionPlan {
  const style: MotionStyle = "elegant";
  const raw: RawItem[] = [];
  let hoverable = 0;
  let heroHeading = false;
  flowRows(rows).forEach((row, index) => {
    const first = index === 0;
    const bg = bgKind(row.background);
    const item: RawItem = { id: row.id };
    if (bg === "image" && !row.backgroundMotion) item.backgroundMotion = { effect: "parallax" };
    raw.push(item);
    for (const column of row.columns) {
      const columnItem: RawItem = { id: column.id };
      if (bgKind(column.background) === "image") columnItem.backgroundMotion = { effect: "parallax" };
      if (row.columns.length >= 3 && hasCardLook(column)) columnItem.hover = { effect: "lift" };
      raw.push(columnItem);
    }

    const blocks = row.columns.flatMap((column) => column.blocks);
    for (const block of blocks) {
      if (BUTTONS.has(block.type) && hoverable < CAPS.hovers) {
        raw.push({ id: block.id, hover: { effect: "lift" } });
        hoverable += 1;
      }
    }

    if (first) {
      // The hero comes in with the page: the heading first, what follows a little after, each in turn.
      let step = 0;
      for (const block of blocks) {
        if (!ENTER_BLOCKS.has(block.type)) continue;
        if (block.type === "heading" && !heroHeading) {
          heroHeading = true;
          raw.push({
            id: block.id,
            enter: { effect: blockText(block).length <= 80 ? "words" : "fade-up", stagger: 60 },
          });
        } else if (block.type === "image") {
          raw.push({ id: block.id, enter: { effect: "zoom-out", delay: Math.min(500, 100 * ++step) } });
        } else {
          raw.push({ id: block.id, enter: { effect: "fade-up", delay: Math.min(500, 100 * ++step + 100) } });
        }
      }
      return;
    }

    const columnsWithImage = row.columns.filter((column) => column.blocks.some((b) => b.type === "image"));
    if (row.columns.length === 2 && columnsWithImage.length > 0) {
      // Two sides, coming in towards each other.
      raw.push({ id: row.columns[0].id, enter: { effect: "fade-right" } });
      raw.push({ id: row.columns[1].id, enter: { effect: "fade-left", delay: 100 } });
    } else if (
      row.columns.length === 1 &&
      row.columns[0].blocks.length === 1 &&
      row.columns[0].blocks[0].type === "image"
    ) {
      raw.push({ id: row.columns[0].blocks[0].id, enter: { effect: "zoom-out" } });
    } else if (row.columns.length === 1 && (bg === "image" || bg === "video")) {
      raw.push({ id: row.columns[0].id, enter: { effect: "fade-up" } });
    } else {
      raw.push({ id: row.id, enter: { effect: "fade-up", stagger: row.columns.length >= 2 ? 120 : 0 } });
    }
  });
  const { items } = finish(raw, rows, style);
  return { style, summary: summarizePlan(items, rows, style), items, aiUsed: false };
}

// ---------------------------------------------------------------------------
// Putting a plan on a page
// ---------------------------------------------------------------------------

/**
 * A plan on a page: only motion fields change, only empty slots are filled (a part with its own entrance, hover or
 * scroll effect keeps it; a background that already has motion keeps it), only for parts that exist outside modals, and
 * a background only where there is a picture or a video. `changed` counts the slots filled, `parts` the parts touched.
 * Applying the same plan twice changes nothing the second time.
 */
export function applyMotionPlan(
  rows: PageRow[],
  plan: MotionPlan,
): { rows: PageRow[]; changed: number; parts: number } {
  const items = new Map<string, MotionPlanItem>();
  for (const item of plan.items) if (!items.has(item.id)) items.set(item.id, item);
  let changed = 0;
  const touched = new Set<string>();

  const fill = <T extends { id: string; motion?: PartMotion }>(part: T, allowEnter: boolean): T => {
    const item = items.get(part.id);
    if (!item) return part;
    const next: PartMotion = { ...part.motion };
    let n = 0;
    if (item.enter && allowEnter && !next.enter) {
      next.enter = item.enter;
      n += 1;
    }
    if (item.hover && !next.hover) {
      next.hover = item.hover;
      n += 1;
    }
    if (item.scroll && !next.scroll) {
      next.scroll = item.scroll;
      n += 1;
    }
    if (n === 0) return part;
    const checked = partMotionSchema.safeParse(next);
    if (!checked.success || !checked.data) return part;
    changed += n;
    touched.add(part.id);
    return { ...part, motion: checked.data };
  };
  const fillBackground = <T extends { id: string; backgroundMotion?: BackgroundMotion }>(
    part: T,
    background: { type: string } | undefined,
  ): T => {
    const wanted = items.get(part.id)?.backgroundMotion;
    if (!wanted || part.backgroundMotion || (background?.type !== "image" && background?.type !== "video")) return part;
    const checked = backgroundMotionSchema.safeParse(wanted);
    if (!checked.success || !checked.data) return part;
    changed += 1;
    touched.add(part.id);
    return { ...part, backgroundMotion: checked.data };
  };

  const next = rows.map((row) => {
    // A modal is not part of the page's flow: never touched.
    if (row.modal) return row;
    const columns = row.columns.map((column) => {
      const blocks = column.blocks.map((block) => fill(block, ENTER_BLOCKS.has(block.type)));
      const held: PageColumn = blocks.some((b, i) => b !== column.blocks[i]) ? { ...column, blocks } : column;
      return fillBackground(fill(held, true), column.background);
    });
    const held: PageRow = columns.some((c, i) => c !== row.columns[i]) ? { ...row, columns } : row;
    return fillBackground(fill(held, true), row.background);
  });
  return { rows: changed > 0 ? next : rows, changed, parts: touched.size };
}
