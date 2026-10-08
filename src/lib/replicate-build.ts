import { findClaims } from "./claims";
import { SIDE_BY_SIDE_GAP } from "./responsive";
import { allowedCssUrl } from "./custom-css";
import { isCustomPicture } from "./custom-picture";
import {
  BLOCKS_MAX,
  CUSTOM_ITEMS_MAX,
  ROWS_MAX,
  ROW_LAYOUTS,
  VIDEO_RATIOS,
  type Background,
  type ButtonBlock,
  type ContentGridBlock,
  type CustomGridItem,
  type HeadingBlock,
  type HeadingLevel,
  type ImageBlock,
  type PageBlock,
  type PageColumn,
  type PageRow,
  type RichTextBlock,
  type RowLayout,
  type SeparatorBlock,
  type VideoBlock,
  type VideoRatio,
} from "./page-content";
import type { ReplicaNote } from "./replicate";
import { fallbackStack, withGeneric } from "./replicate-fonts";
import {
  backgroundUrls,
  bottomOf,
  colourOf,
  cssColour,
  firstFamily,
  hexOf,
  alignTrees,
  indexByPath,
  kindKey,
  isExtraTile,
  paints,
  px,
  rightOf,
  runsText,
  walk,
  walkLive,
  type Box,
  type CaptureNode,
  type PageCapture,
} from "./replicate-capture";
import { docOf, isTextList, wordsOf } from "./replicate-richtext";
import { TRACK_TILES_READ, boxOfTrack, builtOf, contextOf, controlFor, emptyGridReport, isTinyPicture, mobileTiles, planGrid, readSlider, styleGrid, type GridContext, type GridEnv, type GridPlan, type GridReport, type SliderRead, type StyleEnv } from "./replicate-grid";
import { cleanDecls, ruleOf, type Decl, type StyleModel } from "./replicate-styles";

/**
 * Turns what was captured of an original page into the page builder's own rows, columns and blocks, with the exact
 * sizes, spacing and colours as a style model (D150). Nothing here is written by a model: the structure follows the boxes
 * the browser drew (sections become rows, boxes side by side become columns, text, pictures, buttons, videos and lines
 * become blocks) and every measure is the original's, at both widths. What the builder cannot hold is left out or
 * simplified, and `notes` says so.
 */

export type Picture = { url: string; width: number; height: number };

/** A row's strip of the original at each width: without its words (they are laid over it as blocks), and with them (the row is only the picture). */
export type Backdrop = { text: { desktop: Picture; phone: Picture | null }; plain: { desktop: Picture; phone: Picture | null } | null };

/** A row kept as a picture is found by where it is: its path (a section sliced into several rows has one path) and its top in the original. */
export const backdropKey = (path: string, top: number): string => `${path}@${Math.round(top)}`;

export type BuildInput = {
  desktop: PageCapture;
  mobile: PageCapture | null;
  /** The library's copy of a picture of the original, by its address; null if it could not be downloaded. */
  picture: (url: string) => Picture | null;
  /** The library's copy of an element photographed in the page (an icon, a canvas), by its path; null if there is none. */
  shot: (path: string) => Picture | null;
  /**
   * A row kept as a picture (D164): the strip of the original it covers, with its words not painted, at each width, by `backdropKey()` of the row's path and top. The row is that
   * picture with the original's words laid over it where they stood; null for a row built from the page's parts as usual.
   */
  backdrop?: (key: string) => Backdrop | null;
  /**
   * Rows kept as a picture that are only a picture (D164): the original with its words in it, and the words as hidden text for screen readers and search. A page's CSS is
   * limited, and a row of a hundred words laid by their places may not fit in it; the rows that cost the most are this.
   */
  backdropPlain?: ReadonlySet<string>;
  /** An uploaded video's address in the library, by its original address; null if it could not be copied. */
  video: (url: string) => { url: string } | null;
  /** The Google Fonts family a font of the original is installed as, or null. */
  font: (family: string) => string | null;
  /** Groups of cards (by the path of the box holding them) that were built as a grid and matched worse than columns would: built as columns now (D155). */
  reverted?: { path: string; match: number; pass: number; /** How the same cards matched as columns, when they were measured. */ columns?: number }[];
};

/** What a part of the copy answers to in the original, so a pass can compare them. */
export type PartInfo = {
  id: string;
  path: string;
  kind: "row" | "column" | "block";
  row: string;
  /** What the part is, in a few words, for the AI that looks at the copy ("heading: Make it better"). */
  label?: string;
  /** For a grid of custom items: the original's box that held its cards, to rebuild that group as columns if the grid matches worse (D155). */
  grid?: string;
  /** The box the original has for this part, at computers' width and at the phones'; a pass compares the copy with it. */
  target: Box | null;
  targetM: Box | null;
};

/** Something in the original that the copy does not have, or has only in part, named so a developer can find it. */
export type DroppedKind = "form-field" | "shape" | "picture-missing" | "graphic-unphotographed" | "video-missing" | "video-still-only" | "nested-boxes" | "background-layers" | "rows-cut" | "blocks-cut" | "columns-cut" | "grid-columns" | "grid-card" | "grid-items-cut" | "grid-reverted" | "grid-simplified" | "generated-text" | "row-as-picture";
export type Dropped = { kind: DroppedKind; sel: string; y: number; box: Box | null; text?: string };
export const DROPPED_MAX = 80;

export type BuildOutput = {
  rows: PageRow[];
  model: StyleModel;
  /** Rules every part shares, written once. */
  shared: string;
  title: string;
  description: string;
  notes: ReplicaNote[];
  parts: PartInfo[];
  counts: { rows: number; blocks: number; headings: number; texts: number; pictures: number; buttons: number; videos: number; grids?: number; items?: number };
  /** What was left out or made simpler, with where it was in the original. */
  dropped: Dropped[];
  /** The groups of repeated cards: the grids built, and the groups kept as columns with why (D155). */
  grids: GridReport;
};

/** The page's own gap between rows (`gap-8` of `PageArticle`): a row's margin is what it needs beyond it, so down to this much less. */
export const ROW_GAP = 32;

export const SHARED_CSS =
  ".rp.rp :is(h1,h2,h3,h4,h5,h6,p,ul,ol,li,blockquote){margin:0;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;text-align:inherit;line-height:inherit}\n" +
  ".rp.rp .rich-text{line-height:inherit;overflow-wrap:normal}\n.rp.rp .rich-text a{text-decoration:none;color:inherit}\n" +
  ".rp.rp{margin:0;width:auto;max-width:none;box-sizing:border-box;border:0 none;border-radius:0;box-shadow:none;font-style:normal;text-transform:none}\n" +
  ".rp.rp figure{margin:0}\n.rp.rp img{display:block;max-width:100%}\n.rp.rp hr{margin:0}";

// ---------------------------------------------------------------------------
// Looking at boxes
// ---------------------------------------------------------------------------

type Side = "Top" | "Right" | "Bottom" | "Left";
const SIDES: Side[] = ["Top", "Right", "Bottom", "Left"];

const hasSize = (n: CaptureNode) => n.box[2] >= 1 && n.box[3] >= 1;
const isText = (n: CaptureNode) => n.runs !== undefined;
const isLeaf = (n: CaptureNode) => n.runs !== undefined || n.media !== undefined || n.children.length === 0 || isTextList(n);

const borderOf = (n: CaptureNode, side: Side) => {
  const width = px(n.s[`border${side}Width`]) ?? 0;
  const style = n.s.borderTopStyle;
  return width > 0 && style !== "none" && paints(n.s[`border${side}Color`]) ? width : 0;
};

/** Whether a box paints anything of its own: a colour, pictures, a border, a shadow. */
function paintsBox(n: CaptureNode): boolean {
  if (paints(n.s.backgroundColor) || (n.bg?.length ?? 0) > 0) return true;
  if (n.s.backgroundImage && n.s.backgroundImage !== "none") return true;
  if (n.s.boxShadow && n.s.boxShadow !== "none") return true;
  return SIDES.some((side) => borderOf(n, side) > 0);
}

/** Whether a box shows anything: words, a picture, or paint. */
function hasContent(n: CaptureNode): boolean {
  if (n.runs !== undefined) return runsText(n.runs) !== "";
  if (n.media) return n.media.kind !== "control";
  if (isTextList(n)) return true;
  return paintsBox(n);
}

/** Whether a box, or something in it, shows anything. */
function significant(n: CaptureNode): boolean {
  if (!hasSize(n)) {
    // A box with no size of its own that does not clip (a nav of absolutely placed lists, a wrapper of floated boxes) shows what it holds.
    const clips = (v: string | undefined) => v === "hidden" || v === "clip" || v === "scroll" || v === "auto";
    return !isLeaf(n) && !clips(n.s.overflowX) && !clips(n.s.overflowY) && n.children.some(significant);
  }
  if (isLeaf(n)) return hasContent(n);
  return paintsBox(n) || n.children.some(significant);
}

/** Whether a box or something in it has words or a picture (what a copy has to keep), as opposed to only paint. */
function holdsContent(n: CaptureNode): boolean {
  if (n.runs !== undefined) return runsText(n.runs) !== "";
  if (n.media) return n.media.kind !== "control";
  if (isTextList(n)) return true;
  return n.children.some(holdsContent);
}

/**
 * A "skip to content" link: placed absolutely over the page's start and shown only to a keyboard (the capture cannot always tell how a page hides it:
 * behind the header, clipped, parked by a class), a link to a place on the same page by words that say so. It is no part of the page as it is seen.
 */
function skipLink(n: CaptureNode): boolean {
  if (n.s.position !== "absolute" || n.runs === undefined) return false;
  const text = runsText(n.runs).trim();
  return text.length <= 40 && /^(skip|jump|go) to (the )?(main |primary )?(content|navigation|menu|body)\b/i.test(text) && n.runs.every((run) => run.href === undefined || run.href.includes("#"));
}

/**
 * Decoration laid beside or over a section's content, which would make a grid in it unseen: a box taken out of the flow (positioned absolutely) that holds no
 * words or pictures (a layer of column rules, a hatched or coloured plate, a darkening layer), or a tall thin strip down the page's side (a gutter's rule or
 * hatching: under 65 px across, 400 px or more tall, no words or pictures). As a sibling it would make the section's content a second column of a "row"
 * and keep the cards in it from being seen. It is left out of the flow, and named (`shape`), only where leaving it out lets repeated cards be seen
 * (`flow()` tries a box without it first and keeps that only when it finds a grid): everywhere else it is a box of the page as it was before D155, which
 * `rowSpecs()` makes a separator or a painted column.
 */
function decoration(n: CaptureNode): boolean {
  if (!hasSize(n) || holdsContent(n)) return false;
  if (n.s.position === "absolute") return true;
  // Vertical only: a horizontal strip is a rule or a spacer, which the builder has a block for.
  return n.box[2] <= 64 && n.box[3] >= 400;
}

/**
 * What a box holds that shows: the slides of a script slider that are copies, hidden, or beyond its box are only read (D155, C2), never laid out; and a "skip to
 * content" link, which is no part of the page as it is seen (named, `shape`, wherever it is).
 */
const kids = (n: CaptureNode) => n.children.filter((c) => significant(c) && !isExtraTile(c) && !skipLink(c));

/** What a box holds that shows, without the decoration that would hide a grid from `flow()`. */
const kidsWithoutDecoration = (n: CaptureNode) => kids(n).filter((c) => !decoration(c));

/** Boxes side by side share a stretch of height: they are on one line. */
function lines(nodes: CaptureNode[]): CaptureNode[][] {
  const sorted = [...nodes].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  const result: { items: CaptureNode[]; top: number; bottom: number; fixed?: true }[] = [];
  for (const node of sorted) {
    const line = result[result.length - 1];
    // A bar fixed to the screen (a site's top bar) lies over the page's start: it is a line of its own, never a column beside the page.
    // A sticky bar the page's first section is drawn under (a header with no room of its own) is the same: a bar is a box across the line, not tall.
    const widest = Math.max(...nodes.map((c) => c.box[2]));
    const fixed = node.s.position === "fixed" || (node.s.position === "sticky" && node.box[2] >= widest * 0.8 && node.box[3] <= 220 && nodes.length > 1);
    if (fixed) {
      result.push({ items: [node], top: node.box[1], bottom: bottomOf(node.box), fixed: true });
      continue;
    }
    if (line && !line.fixed) {
      const overlap = Math.min(bottomOf(node.box), line.bottom) - Math.max(node.box[1], line.top);
      if (overlap > 2 && overlap > 0.3 * Math.min(node.box[3], line.bottom - line.top)) {
        line.items.push(node);
        line.top = Math.min(line.top, node.box[1]);
        line.bottom = Math.max(line.bottom, bottomOf(node.box));
        continue;
      }
    }
    result.push({ items: [node], top: node.box[1], bottom: bottomOf(node.box) });
  }
  return result.map((line) => line.items.sort((a, b) => a.box[0] - b.box[0]));
}

type Item =
  | { kind: "leaf"; node: CaptureNode }
  | { kind: "split"; cols: CaptureNode[]; scroller?: CaptureNode }
  | { kind: "box"; node: CaptureNode; items: Item[] }
  /** Repeated cards that become one grid of custom items (D155). */
  | { kind: "grid"; node: CaptureNode; plan: GridPlan };

/**
 * What lets `flow()` find a group of the same card: it asks `detect` at each box with the context (a footer, a menu) it stands in.
 * Only the page's own sections are asked (depth 0 and 1): a card inside a painted box inside a section is flattened as before.
 */
type FlowCtx = { depth: number; context: GridContext; detect: (parent: CaptureNode, kids: CaptureNode[], context: GridContext) => Item | null; /** Decoration left out of a box so that its cards could be seen: named. */ leftOut: (nodes: CaptureNode[]) => void };

/** Whether some items hold a grid, in a box that paints or not. */
const holdsGrid = (items: Item[]): boolean => items.some((item) => item.kind === "grid" || (item.kind === "box" && holdsGrid(item.items)));

/** What is in a box, top to bottom: pieces of content, boxes side by side, and boxes that paint. */
function flow(node: CaptureNode, ctx?: FlowCtx): Item[] {
  if (isLeaf(node)) return hasContent(node) ? [{ kind: "leaf", node }] : [];
  const here = ctx ? { ...ctx, context: contextOf(ctx.context, node) } : undefined;
  const all = kids(node);
  // Decoration beside the cards (a layer of rules, a plate) is looked past first: if the box is then a grid, or holds one, the decoration is left out and named;
  // if not, the box is read exactly as it was before grids were looked for.
  if (here && here.depth <= 1) {
    const clear = all.filter((c) => !decoration(c));
    if (clear.length < all.length && clear.length > 0) {
      const items = flowOf(node, clear, here);
      if (holdsGrid(items)) {
        here.leftOut(all.filter((c) => decoration(c)));
        return items;
      }
    }
  }
  return flowOf(node, all, here);
}

/** The items of a box with these children (`visible`), asking at each box of the page's own sections whether its children are one card repeated. */
function flowOf(node: CaptureNode, visible: CaptureNode[], here: FlowCtx | undefined): Item[] {
  if (here && here.depth <= 1) {
    const grid = here.detect(node, visible, here.context);
    if (grid) return [grid];
  }
  // A track that scrolls by itself with its previous and next buttons (and dots) beside it: those are the carousel's own, and the
  // track's cards are the group (D155). When the cards are not a grid, the buttons stand where they did, as columns, as before.
  if (here && here.depth <= 1 && visible.length > 1) {
    const track = visible.map((kid) => scrollTrackIn(kid)).find((found) => found !== null) ?? null;
    if (track && visible.every((kid) => scrollTrackIn(kid) === track || controlFor(track, kid))) {
      const grid = here.detect(track, kidsWithoutDecoration(track), contextOf(here.context, track));
      if (grid) return [grid];
    }
  }
  const items: Item[] = [];
  for (const line of lines(visible)) {
    if (line.length === 1) {
      const child = line[0];
      if (isLeaf(child)) items.push({ kind: "leaf", node: child });
      else if (paintsBox(child)) items.push({ kind: "box", node: child, items: flow(child, here && { ...here, depth: here.depth + 1 }) });
      else items.push(...flow(child, here));
    } else {
      items.push({ kind: "split", cols: line, ...(node.scroll && !node.slider ? { scroller: node } : {}) });
    }
  }
  return items;
}

/** Every piece of content in some items, in order: boxes side by side and boxes inside boxes are flattened. */
function leavesOf(items: Item[]): CaptureNode[] {
  const out: CaptureNode[] = [];
  for (const item of items) {
    if (item.kind === "leaf") out.push(item.node);
    else if (item.kind === "box") out.push(...leavesOf(item.items));
    else if (item.kind === "grid") out.push(...item.plan.group.leaves.flat());
    else for (const col of item.cols) out.push(...leavesOf(flow(col)));
  }
  return out;
}

/** Goes down through boxes that hold one box and paint nothing. */
function descend(node: CaptureNode): CaptureNode {
  let current = node;
  for (let guard = 0; guard < 40; guard++) {
    if (isLeaf(current) || paintsBox(current)) break;
    const next = kids(current);
    if (next.length !== 1) break;
    current = next[0];
  }
  return current;
}

/** The box that scrolls sideways in a box, or in the one box it holds (a wrapper round a track), or null. */
function scrollTrackIn(node: CaptureNode): CaptureNode | null {
  let current = node;
  for (let guard = 0; guard < 4; guard++) {
    if (current.scroll && !isLeaf(current)) return current;
    const next = kids(current);
    if (next.length !== 1 || isLeaf(current)) return null;
    current = next[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rows: what the builder will hold
// ---------------------------------------------------------------------------

type ColSpec = { path: string | null; paint: boolean; leaves: CaptureNode[]; /** Its content is one line of pieces (a menu, a row of buttons): the builder's side by side column. */ inline?: boolean };
/** `stack`: content one under another; `split`: boxes side by side; `card`: one painted box. */
type RowSpec = {
  frame: CaptureNode | null;
  kind: "stack" | "split" | "card" | "grid";
  cols: ColSpec[];
  nested: boolean;
  /** The box whose cards scroll sideways: the row is a track, not a grid that fits. */
  scroller?: CaptureNode;
  /** Repeated cards built as one grid block: `cols` are the cards, one each. */
  grid?: GridPlan;
};

function rowSpecs(items: Item[], frame: CaptureNode | null): RowSpec[] {
  const specs: RowSpec[] = [];
  let stack: CaptureNode[] = [];
  const flush = () => {
    if (stack.length === 0) return;
    specs.push({ frame, kind: "stack", cols: [{ path: null, paint: false, leaves: stack }], nested: false });
    stack = [];
  };
  for (const item of items) {
    if (item.kind === "leaf") stack.push(item.node);
    else if (item.kind === "grid") {
      flush();
      const { group } = item.plan;
      specs.push({
        frame,
        kind: "grid",
        cols: group.cards.map((card, i) => ({ path: card.p, paint: false, leaves: group.leaves[i] })),
        nested: false,
        grid: item.plan,
        ...(group.track === "scroller" ? { scroller: group.parent } : {}),
      });
    } else if (item.kind === "box") {
      flush();
      specs.push({ frame, kind: "card", cols: [{ path: item.node.p, paint: true, leaves: leavesOf(item.items) }], nested: item.items.some((i) => i.kind !== "leaf") });
    } else {
      flush();
      const cols = item.cols.map((col) => {
        const inside = flow(col);
        // A box holding one line of pieces is a column of components side by side, which the builder has.
        const line = inside.length === 1 && inside[0].kind === "split" && inside[0].cols.every((c) => flow(c).length === 1 && flow(c)[0].kind === "leaf");
        if (line) return { path: col.p, paint: paintsBox(col), leaves: leavesOf(inside), inline: true, nested: false };
        return { path: col.p, paint: paintsBox(col), leaves: leavesOf(inside), nested: inside.some((i) => i.kind === "split" || i.kind === "box") };
      });
      specs.push({ frame, kind: "split", cols, nested: cols.some((c) => c.nested), ...(item.scroller ? { scroller: item.scroller } : {}) });
    }
  }
  flush();
  return specs.filter((spec) => spec.cols.some((col) => col.leaves.length > 0));
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const round = (n: number) => Math.round(n * 10) / 10;
const pxs = (n: number) => `${round(n)}px`;
const near = (a: number, b: number, tolerance = 2) => Math.abs(a - b) <= tolerance;

/** A box's edges inside its border and padding, and the room those take. */
/** The box inside a column's node that paints it, down a chain of single children (a wrapper with padding round a card): null when the node paints itself or nothing does. */
function paintInside(n: CaptureNode): CaptureNode | null {
  let current = n;
  for (let guard = 0; guard < 6; guard++) {
    if (paintsBox(current)) return current === n ? null : current;
    const inner = current.children.filter((c) => c.s.position !== "absolute" || paintsBox(c));
    const only = inner.length === 1 ? inner[0] : current.children.length === 1 ? current.children[0] : null;
    if (!only) return null;
    current = only;
  }
  return null;
}

function content(n: CaptureNode) {
  const pt = px(n.s.paddingTop) ?? 0;
  const pr = px(n.s.paddingRight) ?? 0;
  const pb = px(n.s.paddingBottom) ?? 0;
  const pl = px(n.s.paddingLeft) ?? 0;
  const bt = borderOf(n, "Top");
  const br = borderOf(n, "Right");
  const bb = borderOf(n, "Bottom");
  const bl = borderOf(n, "Left");
  return {
    top: n.box[1] + bt + pt,
    left: n.box[0] + bl + pl,
    right: rightOf(n.box) - br - pr,
    bottom: bottomOf(n.box) - bb - pb,
    room: { top: pt + bt, right: pr + br, bottom: pb + bb, left: pl + bl },
  };
}

/** How a box sits across what holds it: filling it, centred, or to one side (with its width). */
function placed(x: number, w: number, parentX: number, parentW: number): Decl {
  const left = x - parentX;
  const right = parentX + parentW - (x + w);
  if (near(left, 0) && near(right, 0)) return { width: "auto", "max-width": "none", "margin-left": "0", "margin-right": "0" };
  if (left > 2 && near(left, right)) return { width: pxs(w), "max-width": "100%", "margin-left": "auto", "margin-right": "auto" };
  if (left > right + 2 && right <= 2) return { width: pxs(w), "max-width": "100%", "margin-left": "auto", "margin-right": "0" };
  return { width: pxs(w), "max-width": "100%", "margin-left": pxs(Math.max(0, left)), "margin-right": "0" };
}

/** The type of a text box as declarations; with `base`, only what differs from it. */
function typeDecl(n: CaptureNode, base?: CaptureNode): Decl {
  const out: Decl = {};
  const same = (key: string) => base !== undefined && base.s[key] === n.s[key];
  const size = px(n.s.fontSize);
  if (size && !same("fontSize")) out["font-size"] = pxs(size);
  const lh = n.s.lineHeight === "normal" ? "normal" : px(n.s.lineHeight);
  if (lh !== null && lh !== undefined && !same("lineHeight")) out["line-height"] = lh === "normal" ? "normal" : pxs(lh);
  if (n.s.fontWeight && !same("fontWeight")) out["font-weight"] = String(Number(n.s.fontWeight) || 400);
  if (!same("fontStyle")) out["font-style"] = n.s.fontStyle === "italic" ? "italic" : "normal";
  const ls = px(n.s.letterSpacing);
  if (ls !== null && !same("letterSpacing")) out["letter-spacing"] = ls === 0 ? "normal" : pxs(ls);
  if (!same("textTransform")) out["text-transform"] = n.s.textTransform ?? "none";
  const colour = cssColour(n.s.color);
  if (colour && !same("color")) out.color = colour;
  if (!same("textAlign")) {
    const align = n.s.textAlign;
    out["text-align"] = align === "center" ? "center" : align === "right" || align === "end" ? "right" : "left";
  }
  if (n.tag !== "a" && n.s.textDecorationLine && n.s.textDecorationLine !== "none" && !same("textDecorationLine")) out["text-decoration"] = n.s.textDecorationLine;
  if (n.s.textShadow && n.s.textShadow !== "none" && !same("textShadow")) out["text-shadow"] = n.s.textShadow;
  return out;
}

/** Splits a list of values at the commas outside brackets. */
function splitList(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}

/** Whether a text box is one line of its type: it must not wrap, whatever the fonts of the copy measure. */
const oneLine = (n: CaptureNode): boolean => {
  const lh = px(n.s.lineHeight) ?? (px(n.s.fontSize) ?? 16) * 1.3;
  return n.box[3] <= lh * 1.6;
};

/**
 * A section's background picture, carried on to the section's later rows: each row draws the same picture at the size and place it
 * has behind the whole section (as `cover` and centred put it), shifted up by how far down the section the row starts.
 */
function continued(picture: { url: string; width: number; height: number }, section: Box, offset: number): Decl {
  const scale = Math.max(section[2] / picture.width, section[3] / picture.height);
  const w = picture.width * scale;
  const h = picture.height * scale;
  return {
    "background-image": `url("${picture.url}")`,
    "background-repeat": "no-repeat",
    "background-size": `${round(w)}px ${round(h)}px`,
    "background-position": `${round((section[2] - w) / 2)}px ${round((section[3] - h) / 2 - offset)}px`,
  };
}

/** A box as a column's content area when the box is itself the one piece in it: no room of its own. */
function whole(n: CaptureNode) {
  return { top: n.box[1], left: n.box[0], right: rightOf(n.box), bottom: bottomOf(n.box), room: { top: 0, right: 0, bottom: 0, left: 0 } };
}

const HEADING_TAGS: Record<string, HeadingLevel> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

/** Typography that must match for two paragraphs to share a block. */
const paragraphKey = (n: CaptureNode) =>
  [n.s.fontSize, n.s.fontWeight, n.s.fontStyle, n.s.color, n.s.fontFamily, n.s.lineHeight, n.s.letterSpacing, n.s.textAlign, n.s.textTransform].join("|");

const isParagraph = (n: CaptureNode) => isText(n) && !n.button && !isTextList(n) && !HEADING_TAGS[n.tag] && n.tag !== "a" && n.tag !== "blockquote" && n.tag !== "li";

/** Paragraphs one under another with the same type and place become one rich text block; every other piece stands alone. */
function groups(leaves: CaptureNode[]): CaptureNode[][] {
  const out: CaptureNode[][] = [];
  for (const leaf of leaves) {
    const last = out[out.length - 1];
    const previous = last?.[last.length - 1];
    if (previous && isParagraph(previous) && isParagraph(leaf) && paragraphKey(previous) === paragraphKey(leaf) && near(previous.box[0], leaf.box[0]) && near(previous.box[2], leaf.box[2], 4) && leaf.box[1] >= bottomOf(previous.box) - 1) {
      last.push(leaf);
    } else out.push([leaf]);
  }
  return out;
}

/** A YouTube or Vimeo address as a video block's source. */
function embedSource(url: string): { source: "youtube" | "vimeo"; link: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
      const id = host === "youtu.be" ? u.pathname.slice(1) : u.pathname.startsWith("/embed/") ? u.pathname.split("/")[2] : u.searchParams.get("v");
      return id && /^[\w-]{6,20}$/.test(id) ? { source: "youtube", link: `https://www.youtube.com/watch?v=${id}` } : null;
    }
    if (host === "player.vimeo.com" || host === "vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id && /^\d{4,12}$/.test(id) ? { source: "vimeo", link: `https://vimeo.com/${id}` } : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** The video shape nearest a width and height. */
function nearestRatio(w: number, h: number): VideoRatio {
  const ratio = w / Math.max(1, h);
  const options: [VideoRatio, number][] = [["16:9", 16 / 9], ["4:3", 4 / 3], ["1:1", 1], ["9:16", 9 / 16], ["21:9", 21 / 9]];
  return options.sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio))[0][0];
}
void VIDEO_RATIOS;

// ---------------------------------------------------------------------------
// The geometry of a row at one width
// ---------------------------------------------------------------------------

type Get = (path: string) => CaptureNode | null | undefined;

type Band = {
  /** The row's own stretch of the page, with the room its section gives it above and below. */
  outerTop: number;
  outerBottom: number;
  left: number;
  right: number;
  /** Where its content is. */
  top: number;
  bottom: number;
  contentLeft: number;
  contentRight: number;
  cols: (CaptureNode | null)[];
  leaves: CaptureNode[];
};

/** Each row's band at one width; null for a row not on the page at that width. */
function bands(specs: RowSpec[], get: Get, docWidth: number): (Band | null)[] {
  // First the content of each row, then the room between rows of one section.
  const raw = specs.map((spec) => {
    const leaves = spec.cols.flatMap((c) => c.leaves.map((l) => get(l.p)).filter((l): l is CaptureNode => Boolean(l)));
    const cols = spec.cols.map((c) => (c.path ? (get(c.path) ?? null) : null));
    const found = cols.filter((c): c is CaptureNode => Boolean(c));
    const boxes = spec.kind === "stack" ? leaves : found;
    if (boxes.length === 0 || (spec.kind !== "stack" && found.length === 0)) return null;
    // A track's cards run past its edge: its content is as wide as the track shows.
    const track = spec.scroller ? get(spec.scroller.p) : null;
    const trackBox = track ? boxOfTrack(track) : null;
    return {
      cols,
      leaves,
      top: Math.min(...boxes.map((b) => b.box[1])),
      bottom: Math.max(...boxes.map((b) => bottomOf(b.box))),
      contentLeft: trackBox ? Math.max(trackBox[0], Math.min(...boxes.map((b) => b.box[0]))) : Math.min(...boxes.map((b) => b.box[0])),
      contentRight: trackBox ? Math.min(rightOf(trackBox), Math.max(...boxes.map((b) => rightOf(b.box)))) : Math.max(...boxes.map((b) => rightOf(b.box))),
    };
  });
  const result: (Band | null)[] = [];
  specs.forEach((spec, index) => {
    const r = raw[index];
    if (!r) {
      result.push(null);
      return;
    }
    const frame = spec.frame ? (get(spec.frame.p) ?? null) : null;
    let outerTop = r.top;
    let outerBottom = r.bottom;
    if (frame) {
      const before = raw.slice(0, index).reduce<number | null>((found, other, i) => (specs[i].frame?.p === spec.frame!.p && other ? i : found), null);
      const after = raw.slice(index + 1).some((other, i) => specs[index + 1 + i].frame?.p === spec.frame!.p && other);
      outerTop = before === null ? frame.box[1] : (raw[before]!.bottom);
      outerBottom = after ? r.bottom : bottomOf(frame.box);
    }
    result.push({
      outerTop,
      outerBottom,
      left: frame ? frame.box[0] : 0,
      right: frame ? rightOf(frame.box) : docWidth,
      top: r.top,
      bottom: r.bottom,
      contentLeft: r.contentLeft,
      contentRight: r.contentRight,
      cols: r.cols,
      leaves: r.leaves,
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

/**
 * A picture laid behind a whole section (an `img` placed absolutely over a box and as large as it, as hero art often is) is that
 * box's background: the box paints it, and the picture is no longer a piece of content in the flow. Works on a copy of the capture.
 */
export function liftBackdrops(capture: PageCapture): { capture: PageCapture; lifted: number } {
  const root = structuredClone(capture.root) as CaptureNode;
  let lifted = 0;
  /** Whether something else in `box` lies over the picture's place: words or another picture, mostly inside it. */
  const overlaid = (holder: CaptureNode, via: CaptureNode, picture: Box): boolean => {
    for (const other of holder.children) {
      if (other === via || !significant(other)) continue;
      for (const n of walk(other)) {
        if (n.runs === undefined && n.media === undefined) continue;
        const w = Math.min(rightOf(n.box), rightOf(picture)) - Math.max(n.box[0], picture[0]);
        const h = Math.min(bottomOf(n.box), bottomOf(picture)) - Math.max(n.box[1], picture[1]);
        if (w > 0 && h > 0 && w * h >= 0.5 * n.box[2] * n.box[3]) return true;
      }
    }
    return false;
  };
  const visit = (node: CaptureNode, ancestors: CaptureNode[]) => {
    for (const child of [...node.children]) {
      const m = child.media;
      if (m?.kind === "img" && (!child.s.objectFit || child.s.objectFit === "cover" || child.s.objectFit === "fill") && child.box[2] * child.box[3] >= 40_000) {
        const chain = [...ancestors, node];
        // From the lowest box that holds the picture outward, while the picture is nearly all of it: the first that has more in it
        // than the picture is the section the picture is behind. A picture alone in its frame stays a picture.
        for (let i = chain.length - 1; i >= 1; i--) {
          let a = chain[i];
          const holds = a.box[0] <= child.box[0] + 3 && rightOf(a.box) >= rightOf(child.box) - 3 && a.box[1] <= child.box[1] + 3 && bottomOf(a.box) >= bottomOf(child.box) - 3;
          if (!holds) continue;
          if (!(child.box[2] >= a.box[2] * 0.85 && child.box[3] >= a.box[3] * 0.85)) break;
          const via = chain[i + 1] ?? child;
          if (!overlaid(a, via, child.box)) continue;
          if (a.s.backgroundImage && a.s.backgroundImage !== "none") break;
          // The outermost box of exactly the same size paints it: a wrapper inside a column is no part of the builder's, the column is (lampan.no: the hero
          // pictures were lifted onto an inner `div` and the copy's heroes were blank, white words on white).
          const same = (outer: CaptureNode) => outer.box.every((v, k) => Math.abs(v - a.box[k]) <= 3);
          let target = a;
          for (let j = i - 1; j >= 1; j--) {
            const outer = chain[j];
            if (!same(outer) || (outer.s.backgroundImage && outer.s.backgroundImage !== "none")) break;
            target = outer;
          }
          // The corners of the box that held the picture go with it (a hero tile with rounded corners inside plain wrappers).
          const corners4 = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"] as const;
          if (target !== a && corners4.some((k) => a.s[k] !== undefined && a.s[k] !== "0px") && !corners4.some((k) => target.s[k] !== undefined && target.s[k] !== "0px")) {
            target.s = { ...target.s, ...Object.fromEntries(corners4.filter((k) => a.s[k] !== undefined).map((k) => [k, a.s[k]])) };
          }
          a = target;
          a.s = { ...a.s, backgroundImage: `url("${m.url}")`, backgroundSize: "cover", backgroundPosition: child.s.objectPosition ?? "50% 50%", backgroundRepeat: "no-repeat" };
          a.bg = [m.url, ...(a.bg ?? [])];
          const parent = chain[chain.length - 1];
          parent.children = parent.children.filter((c) => c !== child);
          lifted += 1;
          break;
        }
        // Not lifted: a picture alone in its box (an aspect-ratio frame with rounded corners) takes the box's corners.
        if (child.media && !(child.s.backgroundImage)) {
          const frame = chain[chain.length - 1];
          const corners = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"] as const;
          const framed = frame.box[0] <= child.box[0] + 3 && rightOf(frame.box) >= rightOf(child.box) - 3 && child.box[2] >= frame.box[2] * 0.85 && child.box[3] >= frame.box[3] * 0.85;
          if (framed && node.children.includes(child) && corners.some((k) => frame.s[k] !== undefined && frame.s[k] !== "0px") && !corners.some((k) => child.s[k] !== undefined && child.s[k] !== "0px")) {
            child.s = { ...child.s, ...Object.fromEntries(corners.filter((k) => frame.s[k] !== undefined).map((k) => [k, frame.s[k]])) };
          }
        }
      }
    }
    for (const child of node.children) visit(child, [...ancestors, node]);
  };
  visit(root, []);
  return { capture: { ...capture, root }, lifted };
}

/** Below this share of desktop nodes finding an element of the same kind at their path on the phone, the phone's nodes are found by structure. */
const PATHS_AGREE = 0.9;

const BUTTON_TEXT_STYLES = ["color", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textAlign", "textTransform", "textDecorationLine", "whiteSpace"] as const;

/**
 * A link or button that paints (a fill or a border) and holds one piece of text (often in a span of its own) is a button: the
 * text's words and type are folded into it, so it is one piece of content that keeps its own face wherever it stands, not a
 * box whose paint belongs to a column. A button with an icon or other content beside its words is left as it is. Works on a copy.
 */
export function foldButtons(capture: PageCapture): { capture: PageCapture; folded: number } {
  const root = structuredClone(capture.root) as CaptureNode;
  let folded = 0;
  const visit = (node: CaptureNode) => {
    const isButton = (node.tag === "a" || node.tag === "button") && node.runs === undefined && !node.media && node.children.length > 0 && hasSize(node);
    if (isButton && (paints(node.s.backgroundColor) || SIDES.some((side) => borderOf(node, side) > 0))) {
      const inside = [...walk(node)].slice(1);
      const texts = inside.filter((n) => n.runs !== undefined && runsText(n.runs) !== "");
      const other = inside.some((n) => n.media !== undefined || (n.runs === undefined && n.children.length === 0 && paintsBox(n) && hasSize(n)));
      if (texts.length === 1 && !other) {
        const text = texts[0];
        node.runs = text.runs;
        node.button = true;
        node.children = [];
        for (const key of BUTTON_TEXT_STYLES) if (text.s[key] !== undefined && node.s[key] === undefined) node.s = { ...node.s, [key]: text.s[key] };
        folded += 1;
        return;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return { capture: { ...capture, root }, folded };
}

/** What a capture needs done before it is built: buttons folded, backdrops lifted. */
const prepared = (capture: PageCapture): PageCapture => liftBackdrops(foldButtons(capture).capture).capture;

export function buildReplica(input: BuildInput, newId: () => string): BuildOutput {
  const desktop = prepared(input.desktop);
  const mobile = input.mobile ? prepared(input.mobile) : null;
  const dIndex = indexByPath(desktop.root);
  const mIndex = mobile ? indexByPath(mobile.root) : null;
  // Script sliders (D155, C2): each track's real slides, and where they stand at phones' width. A library clones a different number of
  // slides at each width, so a slide's place among the track's children is not the same at both: the same slide is found by its place among the real ones.
  const sliderReads = new Map<string, SliderRead>();
  for (const n of walk(desktop.root)) {
    const read = readSlider(n);
    if (read) sliderReads.set(n.p, read);
  }
  const phoneTile = new Map<string, string>();
  if (mIndex) {
    for (const [path, read] of sliderReads) {
      const there = mIndex.get(path);
      const phoneRead = there ? readSlider(there) : null;
      if (phoneRead) for (const [from, to] of mobileTiles(read, phoneRead)) phoneTile.set(from, to);
    }
  }
  const phonePath = (p: string): string => {
    if (phoneTile.size === 0) return p;
    for (let q = p; ; ) {
      const hit = phoneTile.get(q);
      if (hit !== undefined) return hit + p.slice(q.length);
      const cut = q.lastIndexOf("/");
      if (cut < 0) return p;
      q = q.slice(0, cut);
    }
  };
  const getD: Get = (p) => dIndex.get(p);
  // A phone page with an element more or less somewhere shifts the paths after it: then the phone's node is found by what the elements are
  // (tag and classes, in order), not by path. Where paths agree with the elements, they stay the key (sliders' tiles included).
  const aligned = mobile ? alignTrees(desktop.root, mobile.root) : null;
  const pathAgrees = (() => {
    if (!mIndex) return 1;
    let same = 0;
    let all = 0;
    for (const [p, d] of dIndex) {
      all += 1;
      const m = mIndex.get(phonePath(p));
      if (m && kindKey(m) === kindKey(d)) same += 1;
    }
    return all === 0 ? 1 : same / all;
  })();
  const byStructure = aligned !== null && pathAgrees < PATHS_AGREE;
  const getM: Get | null = mIndex
    ? (p) => {
        const there = mIndex.get(phonePath(p));
        const d = dIndex.get(p);
        if (!aligned || !d) return there;
        if (!byStructure && there && kindKey(there) === kindKey(d)) return there;
        return aligned.get(p) ?? (byStructure ? undefined : there);
      }
    : null;
  const notes: ReplicaNote[] = [];
  const model: StyleModel = { rules: [] };
  const parts: PartInfo[] = [];
  const counts: BuildOutput["counts"] = { rows: 0, blocks: 0, headings: 0, texts: 0, pictures: 0, buttons: 0, videos: 0 };
  let seq = 0;
  const nextId = () => `rp${++seq}`;
  const skipped = { controls: 0, shapes: 0, missing: new Set<string>(), nested: 0 };
  const dropped: Dropped[] = [];
  const drop = (kind: DroppedKind, n: CaptureNode | null, text?: string) => {
    if (dropped.length >= DROPPED_MAX) return;
    const sel = n ? (n.sel ?? n.tag) : "";
    const y = n ? Math.round(n.box[1]) : 0;
    if (dropped.some((d) => d.kind === kind && d.sel === sel && d.y === y && d.text === text)) return;
    dropped.push({ kind, sel, y, box: n ? n.box : null, ...(text ? { text: text.slice(0, 120) } : {}) });
  };
  let h1Used = false;
  let claimed = false;
  /** Small pictures made of a drawn element (icons), the first to go when the page has more blocks than the builder takes. */
  const icons = new Set<string>();

  const note = (level: ReplicaNote["level"], text: string) => {
    if (!notes.some((n) => n.text === text)) notes.push({ level, text });
  };

  const put = (id: string, suffix: string, desktopDecl: Decl, mobileDecl: Decl = {}) => {
    const rule = ruleOf(model, id, suffix);
    Object.assign(rule.desktop, cleanDecls(desktopDecl));
    Object.assign(rule.mobile, cleanDecls(mobileDecl));
  };

  const fontOf = (n: CaptureNode): { native?: string; css?: string } => {
    const stack = n.s.fontFamily ?? "";
    const family = firstFamily(stack);
    if (family === "") return {};
    const installed = input.font(family);
    if (installed) return { native: installed };
    return { css: stack.length <= 240 ? withGeneric(stack) : fallbackStack(stack) };
  };

  /** The page's own colour behind a row that paints none, so what shows through is as the original's. */
  const pageColour = hexOf(desktop.background) ?? "#ffffff";

  // -- repeated cards as a grid of custom items (D155) ---------------------------------------------
  const grids = emptyGridReport();
  /**
   * The grids built, by their block's id, with what the report says of each: counted, and their drops made, only for the grids that are still in the page after the builder's
   * limits (fifty rows, a hundred blocks) have cut it, so the counts and the report never speak of a grid the draft does not hold.
   */
  const gridRecords = new Map<string, { path: string; colId: string; items: number; built: ReturnType<typeof builtOf>; emit: () => void }>();
  const gridEnv: GridEnv = { leaves: (card) => leavesOf(flow(card)), getD, getM, desktop, mobile };
  const styleEnv: StyleEnv = { typeDecl: (n) => typeDecl(n), fontOf, paintsBox, borderOf };
  const seenGroups = new Set<string>();
  /** Every box a group of cards was asked of, so a track that was never asked can be said not to have been looked at. */
  const asked = new Set<string>();
  const detect: FlowCtx["detect"] = (parent, visible, context) => {
    asked.add(parent.p);
    if (seenGroups.has(parent.p)) return null;
    // A script slider's group is its real slides, hidden ones and ones beyond its box included, never its copies.
    const read = sliderReads.get(parent.p) ?? null;
    const verdict = planGrid(parent, read ? read.real.filter(significant) : visible, gridEnv, context, read);
    if (verdict.kind === "none") return null;
    seenGroups.add(parent.p);
    const sel = parent.sel ?? parent.tag;
    const y = Math.round(parent.box[1]);
    if (verdict.kind === "kept") {
      const entry = { path: parent.p, sel, y, cards: verdict.cards, reason: verdict.reason, ...(read ? { slider: true } : {}) };
      if (verdict.noteworthy) {
        drop("grid-columns", parent, verdict.reason);
        grids.kept.push(entry);
      } else (grids.quiet ??= []).push(entry);
      return null;
    }
    const undone = input.reverted?.find((r) => r.path === parent.p);
    if (undone) {
      const reason = `rebuilt as columns after pass ${undone.pass}: the grid matched the original ${undone.match}% there${undone.columns === undefined ? "" : `, the columns ${undone.columns}%`}`;
      drop("grid-reverted", parent, reason);
      grids.kept.push({ path: parent.p, sel, y, cards: verdict.plan.group.cards.length, reason, reverted: { match: undone.match, pass: undone.pass, ...(undone.columns === undefined ? {} : { columns: undone.columns }) }, ...(read ? { slider: true } : {}) });
      return null;
    }
    return { kind: "grid", node: parent, plan: verdict.plan };
  };
  /** Decoration left out of a box so its cards could be seen (`flow()`): named. */
  const leftOutDecoration = (nodes: CaptureNode[]) => {
    for (const c of nodes) {
      skipped.shapes += 1;
      drop("shape", c, `decoration beside the content, ${Math.round(c.box[2])}×${Math.round(c.box[3])}px`);
    }
  };

  /** A box's own paint as declarations, and the native background where a simple one will do. */
  function paintDecl(n: CaptureNode, native?: { background?: Background }): Decl {
    const out: Decl = {};
    const colour = cssColour(n.s.backgroundColor);
    const layers = n.s.backgroundImage && n.s.backgroundImage !== "none" ? n.s.backgroundImage : "";
    const urls = backgroundUrls(layers);
    const alpha = colourOf(n.s.backgroundColor)?.[3] ?? 0;
    const hex = alpha >= 0.995 ? hexOf(n.s.backgroundColor) : null;
    if (layers !== "") {
      const single = urls.length === 1 && layers.trim().startsWith("url(") && splitList(layers).length === 1;
      const picture = single ? input.picture(urls[0]) : null;
      const coverCentred = /^cover$/i.test((n.s.backgroundSize ?? "").trim()) && /^(50% 50%|center|center center)$/i.test((n.s.backgroundPosition ?? "50% 50%").trim());
      if (native && picture && coverCentred) {
        native.background = { type: "image", image: picture, overlay: null };
        if (hex) out["background-color"] = hex;
      } else {
        const sizes = splitList(n.s.backgroundSize ?? "auto");
        const positions = splitList(n.s.backgroundPosition ?? "0% 0%");
        const repeats = splitList(n.s.backgroundRepeat ?? "repeat");
        const rewritten: string[] = [];
        const kept: number[] = [];
        splitList(layers).forEach((layer, index) => {
          const url = layer.startsWith("url(") ? backgroundUrls(layer)[0] : null;
          if (url) {
            const copy = input.picture(url);
            if (!copy) {
              skipped.missing.add(url);
              drop("picture-missing", n, `background ${url}`);
              return;
            }
            rewritten.push(`url("${copy.url}")`);
          } else rewritten.push(layer);
          kept.push(index);
        });
        if (rewritten.length > 0) {
          out["background-image"] = rewritten.join(", ");
          out["background-size"] = kept.map((i) => sizes[i % sizes.length]).join(", ");
          out["background-position"] = kept.map((i) => positions[i % positions.length]).join(", ");
          out["background-repeat"] = kept.map((i) => repeats[i % repeats.length]).join(", ");
        }
        if (colour) out["background-color"] = colour;
      }
    } else if (hex && native) native.background = { type: "color", color: hex };
    else if (colour) out["background-color"] = colour;
    for (const side of SIDES) {
      const width = borderOf(n, side);
      out[`border-${side.toLowerCase()}`] =
        width > 0 ? `${pxs(width)} ${n.s.borderTopStyle && n.s.borderTopStyle !== "none" ? n.s.borderTopStyle : "solid"} ${cssColour(n.s[`border${side}Color`]) ?? "currentcolor"}` : "0 none";
    }
    const radii = [n.s.borderTopLeftRadius, n.s.borderTopRightRadius, n.s.borderBottomRightRadius, n.s.borderBottomLeftRadius].map((r) => (r ?? "0px").split(" ")[0]);
    out["border-radius"] = radii.join(" ");
    if (radii.some((r) => r !== "0px") && (layers !== "" || n.bg)) out.overflow = "hidden";
    out["box-shadow"] = n.s.boxShadow && n.s.boxShadow !== "none" ? n.s.boxShadow : "none";
    return out;
  }

  const paintFlat = (n: CaptureNode): Decl => {
    const native: { background?: Background } = {};
    const decl = paintDecl(n, native);
    if (native.background?.type === "color") decl["background-color"] = native.background.color;
    return decl;
  };

  // -- a block ---------------------------------------------------------------
  /** Where blocks sit: their column's content box at each width, and where the last block ended. */
  type Frame = { left: number; width: number; leftM: number | null; widthM: number | null };

  function placeAt(group: CaptureNode[], top: number, topM: number | null, frame: Frame, inline: boolean): { d: Decl; m: Decl } {
    const first = group[0];
    if (inline) {
      // Side by side in their column: each keeps its own width, the column spaces them.
      const own = (n: CaptureNode): Decl => ({ "margin-top": "0px", "margin-left": "0", "margin-right": "0", width: pxs(n.box[2]), "max-width": "none" });
      const phoneFirst = getM?.(first.p) ?? null;
      return { d: own(first), m: getM ? (phoneFirst ? own(phoneFirst) : { display: "none" }) : {} };
    }
    const last = group[group.length - 1];
    const d: Decl = { "margin-top": pxs(Math.max(0, first.box[1] - top)), ...placed(first.box[0], Math.max(...group.map((g) => g.box[2])), frame.left, frame.width) };
    let m: Decl = {};
    if (getM) {
      const pf = getM(first.p);
      const pl = getM(last.p);
      if (pf && pl && frame.leftM !== null && frame.widthM !== null && topM !== null) {
        m = {
          "margin-top": pxs(Math.max(0, pf.box[1] - topM)),
          ...placed(pf.box[0], Math.max(...group.map((g) => getM(g.p)?.box[2] ?? 0)), frame.leftM, frame.widthM),
        };
      } else m = { display: "none" };
    }
    return { d, m };
  }

  /** The type of a text box as declarations; with `base` (the box above it that carries the type its text shares), only what differs from that. */
  function typography(n: CaptureNode): { decl: (x: CaptureNode, base?: CaptureNode | null) => Decl; native?: string } {
    const font = fontOf(n);
    return {
      decl: (x, base) => ({ ...typeDecl(x, base ?? undefined), ...(font.css && !(base && fontOf(base).css === font.css) ? { "font-family": font.css } : {}) }),
      native: font.native,
    };
  }

  /** Where a block is put by the caller (a row kept as a picture lays its words by their places), and the boxes whose type the block's own type is set against. */
  type Pin = { d: Decl; m: Decl; base: CaptureNode | null; baseM: CaptureNode | null };

  function makeBlock(group: CaptureNode[], frame: Frame, top: number, topM: number | null, rowId: string, inline = false, pin?: Pin): PageBlock | null {
    const leaf = group[0];
    const id = nextId();
    const phone = getM?.(leaf.p) ?? null;
    const base = { id: newId(), htmlId: id, className: "rp" };
    const media = leaf.media;
    const at = pin ? { d: pin.d, m: pin.m } : placeAt(group, top, topM, frame, inline);
    const union = (get: Get): Box | null => {
      const found = group.map((g) => get(g.p)).filter((g): g is CaptureNode => Boolean(g));
      if (found.length === 0) return null;
      const last = found[found.length - 1];
      return [found[0].box[0], found[0].box[1], Math.max(...found.map((f) => f.box[2])), bottomOf(last.box) - found[0].box[1]];
    };
    const register = () => parts.push({ id, path: leaf.p, kind: "block", row: rowId, target: union(getD), targetM: getM ? union(getM) : null });

    if (media?.kind === "control") return null;

    // Pictures, and what is photographed for want of a better way.
    if (media?.kind === "img" || media?.kind === "svg" || media?.kind === "canvas" || (media?.kind === "embed" && !embedSource(media.url))) {
      const picture = media.kind === "img" ? input.picture(media.url) : input.shot(leaf.p);
      if (!picture) {
        if (media.kind === "img") {
          skipped.missing.add(media.url);
          drop("picture-missing", leaf, media.url);
        } else {
          drop("graphic-unphotographed", leaf, media.kind === "embed" ? media.url : media.kind);
          note("warn", `A ${media.kind === "svg" ? "vector graphic" : media.kind === "canvas" ? "canvas drawing" : "widget"} could not be photographed, so it is left out.`);
        }
        return null;
      }
      const fit = leaf.s.objectFit && leaf.s.objectFit !== "fill" ? leaf.s.objectFit : "cover";
      const imageDecl = (n: CaptureNode): Decl => ({
        width: "100%",
        height: "auto",
        "aspect-ratio": `${round(n.box[2])} / ${round(n.box[3])}`,
        "object-fit": fit,
        "border-radius": (n.s.borderTopLeftRadius ?? "0px").split(" ")[0],
        // The builder's picture has the theme's surface colour behind it; a page's own picture shows what was behind it on the original.
        "background-color": "transparent",
      });
      put(id, "", at.d, at.m);
      put(id, " img", imageDecl(leaf), phone ? imageDecl(phone) : {});
      register();
      counts.pictures += 1;
      if ((media.kind === "svg" || media.kind === "canvas") && Math.max(leaf.box[2], leaf.box[3]) <= 40) icons.add(id);
      const alt = media.kind === "img" ? media.alt : media.kind === "embed" ? media.title : "";
      const block: ImageBlock = { ...base, type: "image", image: { url: picture.url, width: picture.width, height: picture.height, alt: alt.slice(0, 300) }, caption: "" };
      return block;
    }

    // Video.
    if (media?.kind === "video" || (media?.kind === "embed" && embedSource(media.url))) {
      put(id, "", at.d, at.m);
      if (media.kind === "embed") {
        const source = embedSource(media.url)!;
        register();
        counts.videos += 1;
        const block: VideoBlock = { ...base, type: "video", source: source.source, video: null, link: source.link, poster: null, title: media.title || "Video", ratio: nearestRatio(leaf.box[2], leaf.box[3]) };
        return block;
      }
      const copy = media.url ? input.video(media.url) : null;
      const poster = media.poster ? input.picture(media.poster) : null;
      if (!copy && !poster) {
        drop("video-missing", leaf, media.url ?? "no address");
        note("warn", "A video could not be copied (it is too large, streamed, or not a file a page can play), so it is left out.");
        return null;
      }
      register();
      if (!copy) {
        drop("video-still-only", leaf, media.url ?? "no address");
        note("warn", "A video could not be copied; its still picture is used instead.");
        counts.pictures += 1;
        // A picture is drawn at its own size unless told otherwise (D151): the poster is told to fill the video's measured box.
        const posterDecl = (n: CaptureNode): Decl => ({ width: "100%", height: "auto", "aspect-ratio": `${round(n.box[2])} / ${round(n.box[3])}`, "object-fit": "cover", "border-radius": (n.s.borderTopLeftRadius ?? "0px").split(" ")[0] });
        put(id, " img", posterDecl(leaf), phone ? posterDecl(phone) : {});
        const image: ImageBlock = { ...base, type: "image", image: { url: poster!.url, width: poster!.width, height: poster!.height, alt: "" }, caption: "" };
        return image;
      }
      counts.videos += 1;
      const block: VideoBlock = {
        ...base,
        type: "video",
        source: "upload",
        video: copy,
        link: "",
        poster: poster ? { url: poster.url, width: poster.width, height: poster.height } : null,
        title: "Video",
        ratio: nearestRatio(leaf.box[2], leaf.box[3]),
        controls: media.controls,
        autoplay: media.autoplay,
        loop: media.loop,
      };
      return block;
    }

    if (isText(leaf) || isTextList(leaf)) {
      const words = group.map(wordsOf).join(" ");
      if (words === "") return null;
      if (!claimed && findClaims(words).length > 0) {
        claimed = true;
        note("warn", "Some of the copied text makes claims (such as the best price, or being green) that a store must be able to stand behind. Read it before publishing.");
      }
      // A list is typed by its first item: the list's own box says no type (the items carry the words' face).
      const type = typography(isTextList(leaf) && leaf.children[0] ? leaf.children[0] : leaf);

      // A button.
      if (leaf.button && !isTextList(leaf)) {
        const filled = paints(leaf.s.backgroundColor);
        const outlined = !filled && SIDES.some((side) => borderOf(leaf, side) > 0);
        const face = (n: CaptureNode): "left" | "center" | "right" => {
          const a = n.s.textAlign;
          if (filled || outlined) return "center";
          return a === "center" ? "center" : a === "right" || a === "end" ? "right" : "left";
        };
        const faceOf = (n: CaptureNode): Decl => {
          const room = content(n).room;
          return {
            display: "inline-flex",
            width: "100%",
            "min-height": pxs(n.box[3]),
            "padding-top": pxs(room.top),
            "padding-right": pxs(room.right),
            "padding-bottom": pxs(room.bottom),
            "padding-left": pxs(room.left),
            ...paintFlat(n),
            ...type.decl(n),
            // A link set as plain text keeps the side its words stand on; a button's label is centred in its fill.
            "text-align": face(n),
            "justify-content": face(n) === "right" ? "flex-end" : face(n) === "center" ? "center" : "flex-start",
            "text-decoration": "none",
            "white-space": "nowrap",
          };
        };
        put(id, "", at.d, at.m);
        put(id, " a", faceOf(leaf), phone ? faceOf(phone) : {});
        register();
        counts.buttons += 1;
        const block: ButtonBlock = {
          ...base,
          type: "button",
          label: words.slice(0, 100),
          href: leaf.href ?? "#",
          variant: filled ? "filled" : outlined ? "outline" : "text",
          ...(type.native ? { typography: { text: { family: type.native } } } : {}),
        };
        return block;
      }

      // A heading.
      const level = HEADING_TAGS[leaf.tag];
      if (level && !isTextList(leaf)) {
        let used: HeadingLevel = level;
        if (level === 1) {
          if (h1Used) used = 2;
          h1Used = true;
        }
        put(id, "", { ...at.d, ...type.decl(leaf, pin?.base), ...(oneLine(leaf) ? { "white-space": "nowrap" } : {}) }, { ...at.m, ...(phone ? { ...type.decl(phone, pin?.baseM), "white-space": oneLine(phone) ? "nowrap" : "normal" } : {}) });
        register();
        counts.headings += 1;
        const block: HeadingBlock = { ...base, type: "heading", text: words.slice(0, 300), level: used, ...(type.native ? { typography: { text: { family: type.native } } } : {}) };
        return block;
      }

      // Words: rich text, a paragraph or several, a list or a quotation.
      const single = group.length === 1 && !isTextList(leaf);
      const faceOfText = (n: CaptureNode) => (isTextList(n) && n.children[0] ? n.children[0] : n);
      put(id, "", { ...at.d, ...type.decl(faceOfText(leaf), pin?.base), ...(single && oneLine(leaf) ? { "white-space": "nowrap" } : {}), ...(leaf.cut ? { "max-height": pxs(leaf.box[3]), overflow: "hidden" } : {}) }, { ...at.m, ...(phone ? { ...type.decl(faceOfText(phone), pin?.baseM), ...(single ? { "white-space": oneLine(phone) ? "nowrap" : "normal" } : {}) } : {}) });
      if (isTextList(leaf)) {
        // Items side by side (a menu strip: `display: inline-flex`, floats) stay in a row, with the gap between them.
        const across = (n: CaptureNode) => n.children.length > 1 && n.children.every((c) => Math.abs(c.box[1] - n.children[0].box[1]) <= 4) && n.children[1].box[0] >= rightOf(n.children[0].box) - 2;
        const listPad = (n: CaptureNode): Decl =>
          across(n)
            ? { display: "flex", "flex-wrap": "nowrap", "white-space": "nowrap", "column-gap": pxs(Math.max(0, n.children[1].box[0] - rightOf(n.children[0].box))), "padding-left": "0px", "list-style-type": "none" }
            : { display: "block", "padding-left": pxs(Math.max(0, px(n.s.paddingLeft) ?? 0)), "list-style-type": n.s.listStyleType ?? "disc" };
        put(id, " :is(ul,ol)", listPad(leaf), phone ? listPad(phone) : {});
        if (leaf.children.length > 1) {
          const gap = (n: CaptureNode) => (n.children.length > 1 && !across(n) ? Math.max(0, n.children[1].box[1] - bottomOf(n.children[0].box)) : 0);
          put(id, " li + li", { "margin-top": pxs(gap(leaf)) }, phone ? { "margin-top": pxs(gap(phone)) } : {});
        }
      }
      // Links keep the colour and underline the original's had.
      const linked = group.flatMap((g) => (isTextList(g) ? g.children.flatMap((c) => c.runs ?? []) : (g.runs ?? []))).find((r) => r.href);
      if (linked) put(id, " a", { color: cssColour(linked.c) ?? "inherit", "text-decoration": linked.u ? "underline" : "none" });
      group.slice(1).forEach((paragraph, index) => {
        const before = group[index];
        const phoneBefore = getM?.(before.p);
        const phoneThis = getM?.(paragraph.p);
        put(id, ` .rich-text > :nth-child(${index + 2})`, { "margin-top": pxs(Math.max(0, paragraph.box[1] - bottomOf(before.box))) }, phoneBefore && phoneThis ? { "margin-top": pxs(Math.max(0, phoneThis.box[1] - bottomOf(phoneBefore.box))) } : {});
      });
      register();
      counts.texts += 1;
      const block: RichTextBlock = { ...base, type: "richText", doc: docOf(group), ...(type.native ? { typography: { text: { family: type.native } } } : {}) };
      return block;
    }

    // A thin painted box is a line.
    if (paintsBox(leaf) && Math.min(leaf.box[2], leaf.box[3]) <= 6) {
      const colour = hexOf(leaf.s.backgroundColor) ?? hexOf(leaf.s.borderTopColor) ?? "#cccccc";
      put(id, "", at.d, at.m);
      register();
      const block: SeparatorBlock = { ...base, type: "separator", color: colour, thickness: Math.max(1, Math.min(16, Math.round(Math.min(leaf.box[2], leaf.box[3])))), line: "solid" };
      return block;
    }
    skipped.shapes += 1;
    drop("shape", leaf, `${Math.round(leaf.box[2])}×${Math.round(leaf.box[3])}px`);
    return null;
  }

  // -- a grid of custom items ---------------------------------------------------
  /** The column of a row that holds one grid block: the cards' words as items, their look as rules on the block. */
  function makeGrid(plan: GridPlan, rowId: string): PageColumn {
    const { group } = plan;
    const colId = nextId();
    const id = nextId();
    const parent = group.parent;
    const style = styleGrid(plan, gridEnv, styleEnv);
    const items: CustomGridItem[] = plan.drafts.map((draft) => {
      let picture: CustomGridItem["picture"] = null;
      if (draft.picture) {
        const leaf = draft.picture.leaf;
        // A file the page names (an `img`, or a box's background) is the library's copy of it; a graphic with no file is its photograph.
        const copy = draft.picture.url !== "" ? input.picture(draft.picture.url) : input.shot(leaf.p);
        if (copy && isCustomPicture(copy.url)) picture = { url: copy.url, width: copy.width, height: copy.height, alt: draft.picture.alt };
        else if (draft.picture.url !== "") {
          skipped.missing.add(draft.picture.url);
          drop("picture-missing", leaf, draft.picture.url);
        } else drop("graphic-unphotographed", leaf, leaf.media?.kind ?? "graphic");
      }
      return {
        id: newId(),
        title: draft.title,
        text: draft.text,
        picture,
        link: draft.link ? { kind: "url", url: draft.link } : null,
        buttonLabel: draft.buttonLabel,
        date: draft.date,
        badge: draft.badge,
        priceText: draft.priceText,
        details: draft.details.map((line) => ({ id: newId(), label: line.label, text: line.text })),
      };
    });
    const block: ContentGridBlock = { id: newId(), htmlId: id, className: "rp", type: "contentGrid", source: { type: "custom" }, categories: [], tags: [], sort: "newest", limit: CUSTOM_ITEMS_MAX, items, ...style.block };
    put(id, "", { "margin-top": "0px" });
    for (const rule of style.rules) put(id, rule.suffix, rule.desktop, rule.mobile);
    const union = (get: Get, clip: boolean): Box | null => {
      const found = group.cards.map((c) => get(c.p)).filter((c): c is CaptureNode => Boolean(c));
      if (found.length === 0) return null;
      const tracked = clip && group.track === "scroller" ? get(parent.p) : null;
      const track = tracked ? boxOfTrack(tracked) : null;
      const left = Math.min(...found.map((f) => f.box[0]));
      const right = Math.max(...found.map((f) => rightOf(f.box)));
      const x0 = track ? Math.max(left, track[0]) : left;
      const x1 = track ? Math.min(right, rightOf(track)) : right;
      const top = Math.min(...found.map((f) => f.box[1]));
      return [x0, top, Math.max(0, x1 - x0), Math.max(...found.map((f) => bottomOf(f.box))) - top];
    };
    const target = union(getD, true);
    const targetM = getM ? union(getM, true) : null;
    parts.push({ id: colId, path: parent.p, kind: "column", row: rowId, label: "column 1 of 1", target, targetM });
    parts.push({ id, path: parent.p, kind: "block", row: rowId, label: describeBlock(block), grid: parent.p, target, targetM });
    put(colId, "", { gap: "0px", "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px", "margin-top": "0px", "min-height": "0px" }, getM ? { "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px", "margin-top": "0px", "min-height": "0px" } : {});
    const built = builtOf(plan, items, style);
    gridRecords.set(id, {
      path: parent.p,
      colId,
      items: items.length,
      built,
      emit: () => {
        if (plan.cut > 0) drop("grid-items-cut", parent, `${plan.cut} cards beyond the ${CUSTOM_ITEMS_MAX} an item list holds`);
        if (plan.unread > 0) drop("grid-items-cut", parent, `${plan.unread} slides never read (the browser reads a track's first ${TRACK_TILES_READ})`);
        for (const failed of plan.failed) drop("grid-card", group.cards.find((c) => c.p === failed.card) ?? parent, `card ${group.cards.findIndex((c) => c.p === failed.card) + 1} of ${group.cards.length} holds ${failed.what.join("; ")}`);
        if (plan.simplified.length > 0) drop("grid-simplified", parent, plan.simplified.map((x) => `${x.what} in ${x.cards} of ${group.cards.length} cards`).join(", "));
        // A picture too small to be seen (a tracking pixel, a spacer) is no picture of a card's: left out, and named.
        for (const leaves of group.leaves) for (const leaf of leaves) if (isTinyPicture(leaf)) drop("shape", leaf, `a picture of ${Math.round(leaf.box[2])}×${Math.round(leaf.box[3])}px (a tracking pixel or a spacer) in a card`);
      },
    });
    return { id: newId(), htmlId: colId, blocks: [block] };
  }

  // -- rows ------------------------------------------------------------------
  // Form fields have no block (a form needs its own recipient): counted where they stand, as no row holds them.
  for (const n of walkLive(desktop.root)) {
    if (n.media?.kind === "control" && hasSize(n)) {
      skipped.controls += 1;
      drop("form-field", n, `${n.media.type}${n.media.label ? `: ${n.media.label.slice(0, 40)}` : ""}`);
    }
  }
  // A "skip to content" link is no part of the page as it is seen: named, so the report can say it is left out.
  for (const n of walkLive(desktop.root)) {
    for (const c of n.children) if (significant(c) && skipLink(c)) {
      skipped.shapes += 1;
      drop("shape", c, `decoration beside the content (a skip link), ${Math.round(c.box[2])}×${Math.round(c.box[3])}px`);
    }
  }
  const specs: RowSpec[] = [];
  let pending: Item[] = [];
  const flushPending = () => {
    if (pending.length > 0) specs.push(...rowSpecs(pending, null));
    pending = [];
  };
  const top = descend(desktop.root);
  const start: FlowCtx = { depth: 0, context: { footer: false, nav: false }, detect, leftOut: leftOutDecoration };
  // Where the descent stopped at a box that paints (the only section of the page, say), that box is the section.
  const topItems: Item[] = top !== desktop.root && paintsBox(top) && !isLeaf(top) ? [{ kind: "box", node: top, items: flow(top, { ...start, depth: 1, context: contextOf(start.context, top) }) }] : flow(top, start);
  for (const item of topItems) {
    if (item.kind === "box") {
      flushPending();
      const inside = rowSpecs(item.items, item.node);
      // A painted section with nothing in it is still its colour.
      specs.push(...(inside.length > 0 ? inside : [{ frame: item.node, kind: "stack" as const, cols: [{ path: item.node.p, paint: false, leaves: [] }], nested: false }]));
    } else pending.push(item);
  }
  flushPending();

  const dBands = bands(specs, getD, desktop.docWidth);
  const mBands = getM && mobile ? bands(specs, getM, mobile.docWidth) : null;
  const rows: PageRow[] = [];
  let previousBottom = 0;
  let previousBottomM = 0;
  const firstOfFrame = new Set<string>();
  // A painted box that makes several rows (a card with a heading, then two buttons) is drawn in slices: each row keeps the
  // sides, the first the top edge and its corners, the last the bottom edge and its corners, so the box is one box again.
  const frameRows = new Map<string, number>();
  for (const sp of specs) if (sp.frame) frameRows.set(sp.frame.p, (frameRows.get(sp.frame.p) ?? 0) + 1);
  const frameSeen = new Map<string, number>();
  const sliceFrame = (decl: Decl, first: boolean, last: boolean): Decl => {
    if (first && last) return decl;
    const out: Decl = { ...decl };
    const radii = (out["border-radius"] ?? "0px 0px 0px 0px").split(" ");
    while (radii.length < 4) radii.push(radii[0] ?? "0px");
    if (!first) {
      out["border-top"] = "0 none";
      radii[0] = "0px";
      radii[1] = "0px";
    }
    if (!last) {
      out["border-bottom"] = "0 none";
      radii[2] = "0px";
      radii[3] = "0px";
    }
    out["border-radius"] = radii.join(" ");
    out["box-shadow"] = "none";
    return out;
  };
  const frameImage = new Map<string, { url: string; width: number; height: number }>();
  let backdrops = 0;

  specs.forEach((spec, index) => {
    const band = dBands[index];
    if (!band) return;
    const phoneBand = mBands ? mBands[index] : null;
    const frame = spec.frame;
    const first = !frame || !firstOfFrame.has(frame.p);
    if (frame) firstOfFrame.add(frame.p);
    const nth = frame ? (frameSeen.get(frame.p) ?? 0) : 0;
    if (frame) frameSeen.set(frame.p, nth + 1);
    const lastOfFrame = !frame || nth + 1 >= (frameRows.get(frame.p) ?? 1);
    const rowId = nextId();
    const native: { background?: Background } = {};

    // A row kept as a picture of the original with its words laid over it (D164): the picture is the strip of the page, the words are blocks placed where they stood.
    const rowPath = frame ? frame.p : (band.leaves[0]?.p ?? spec.cols[0]?.path ?? "");
    const key = backdropKey(rowPath, band.outerTop);
    const kept = input.backdrop?.(key) ?? null;
    const plain = (input.backdropPlain?.has(key) ?? false) && Boolean(kept?.plain);
    const back = kept ? (plain && kept.plain ? kept.plain : kept.text) : null;
    if (back && allowedCssUrl(back.desktop.url) && (!mBands || !phoneBand || (back.phone !== null && allowedCssUrl(back.phone.url)))) {
      const heightD = band.outerBottom - band.outerTop;
      const heightM = phoneBand ? phoneBand.outerBottom - phoneBand.outerTop : 0;
      const paintBack = (picture: Picture): Decl => ({ "background-image": `url("${picture.url}")`, "background-size": "100% 100%", "background-position": "0px 0px", "background-repeat": "no-repeat", "background-color": "transparent" });
      const flat: Decl = { "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px", width: "auto", "max-width": "none", "margin-left": "0", "margin-right": "0" };
      put(
        rowId,
        "",
        { ...flat, "margin-top": pxs(Math.max(-ROW_GAP, band.outerTop - previousBottom - (rows.length > 0 ? ROW_GAP : 0))), ...paintBack(back.desktop) },
        phoneBand && back.phone ? { ...flat, "margin-top": pxs(Math.max(-ROW_GAP, phoneBand.outerTop - previousBottomM - (rows.length > 0 ? ROW_GAP : 0))), ...paintBack(back.phone) } : mBands ? { display: "none" } : {},
      );
      previousBottom = band.outerBottom;
      if (phoneBand) previousBottomM = phoneBand.outerBottom;
      put(rowId, " > :last-child > :first-child", { "column-gap": "0px", "row-gap": "0px", "grid-template-columns": "minmax(0, 1fr)" }, mBands ? { "grid-template-columns": "minmax(0, 1fr)" } : {});
      parts.push({ id: rowId, path: rowPath, kind: "row", row: rowId, label: "row (kept as a picture of the original, with its words over it)", target: [band.left, band.outerTop, band.right - band.left, heightD], targetM: phoneBand ? [phoneBand.left, phoneBand.outerTop, phoneBand.right - phoneBand.left, heightM] : null });
      const colId = nextId();
      put(colId, "", { gap: "0px", "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px", "margin-top": "0px", position: "relative", height: pxs(heightD), "min-height": "0px" }, mBands ? { "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px", "margin-top": "0px", height: pxs(heightM), "min-height": "0px" } : {});
      parts.push({ id: colId, path: rowPath, kind: "column", row: rowId, label: "column 1 of 1", target: [band.left, band.outerTop, band.right - band.left, heightD], targetM: phoneBand ? [phoneBand.left, phoneBand.outerTop, phoneBand.right - phoneBand.left, heightM] : null });
      const seen = new Set<string>();
      const words = spec.cols
        .flatMap((c) => c.leaves)
        .filter((leaf) => dIndex.has(leaf.p) && !seen.has(leaf.p) && seen.add(leaf.p) && (isText(leaf) || isTextList(leaf)) && hasSize(leaf) && wordsOf(leaf).trim() !== "")
        .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
      // The words share one type where they can: the most common type among them is the column's, and each block says only how it differs. Where each stands is all a block
      // says of its own besides (the page's CSS may hold 50 KB, and a row of a hundred words laid by their places would not fit in it otherwise).
      const typeKey = (n: CaptureNode) => [n.s.fontSize, n.s.lineHeight, n.s.fontWeight, n.s.fontStyle, n.s.letterSpacing, n.s.color, n.s.textAlign, n.s.textTransform, n.s.fontFamily].join("|");
      const commonOf = (nodes: CaptureNode[]): CaptureNode | null => {
        const tally = new Map<string, { n: CaptureNode; count: number }>();
        for (const n of nodes) {
          const typed = isTextList(n) && n.children[0] ? n.children[0] : n;
          const key = typeKey(typed);
          const found = tally.get(key);
          if (found) found.count += 1;
          else tally.set(key, { n: typed, count: 1 });
        }
        return [...tally.values()].sort((a, b) => b.count - a.count)[0]?.n ?? null;
      };
      if (plain) {
        // Only the picture: its words stay as hidden text, which screen readers and search read, and which costs the page's CSS one rule.
        const hiddenId = nextId();
        put(hiddenId, "", { position: "absolute", left: "0px", top: "0px", width: "1px", height: "1px", overflow: "hidden", opacity: "0", "max-width": "none", "margin-top": "0px", "margin-left": "0", "margin-right": "0" }, {});
        counts.texts += 1;
        const hidden: RichTextBlock = { id: newId(), htmlId: hiddenId, className: "rp", type: "richText", doc: docOf(words) };
        if (frame) drop("row-as-picture", frame, `${Math.round(heightD)}px tall, a picture only (${words.length} pieces of text kept hidden for screen readers and search)`);
        else drop("row-as-picture", band.leaves[0] ?? null, `${Math.round(heightD)}px tall, a picture only (${words.length} pieces of text kept hidden for screen readers and search)`);
        backdrops += 1;
        rows.push({ id: newId(), type: "row", layout: "1", width: "full", contentWidth: "full", columns: [{ id: newId(), htmlId: colId, blocks: words.length > 0 ? [hidden] : [] }], htmlId: rowId, className: "rp", background: { type: "color", color: pageColour } });
        return;
      }
      const baseD = commonOf(words);
      const phoneWords = words.map((w) => getM?.(w.p)).filter((w): w is CaptureNode => Boolean(w));
      const baseM = commonOf(phoneWords);
      if (baseD) put(colId, "", { ...typography(baseD).decl(baseD), "font-style": "normal" }, baseM ? { ...typography(baseM).decl(baseM), "font-style": "normal" } : {});
      put(colId, " > *", { position: "absolute", "max-width": "none", "margin-top": "0px", "margin-left": "0", "margin-right": "0" });
      const pin = (n: CaptureNode, top: number, docWidth: number): Decl => ({ left: `${round((n.box[0] / docWidth) * 100)}%`, top: pxs(n.box[1] - top), width: pxs(n.box[2]) });
      const blocks: PageBlock[] = [];
      for (const leaf of words) {
        const phone = getM?.(leaf.p) ?? null;
        const block = makeBlock(
          [leaf],
          { left: band.left, width: band.right - band.left, leftM: phoneBand ? phoneBand.left : null, widthM: phoneBand ? phoneBand.right - phoneBand.left : null },
          band.outerTop,
          phoneBand ? phoneBand.outerTop : null,
          rowId,
          false,
          { d: pin(leaf, band.outerTop, desktop.docWidth), m: mBands ? (phone && phoneBand && mobile ? pin(phone, phoneBand.outerTop, mobile.docWidth) : { display: "none" }) : {}, base: baseD, baseM },
        );
        if (!block) continue;
        const part = block.htmlId ? parts.find((x) => x.id === block.htmlId) : undefined;
        if (part) part.label = describeBlock(block);
        blocks.push(block);
      }
      if (frame) drop("row-as-picture", frame, `${Math.round(heightD)}px tall, ${words.length} pieces of text over the picture`);
      else drop("row-as-picture", band.leaves[0] ?? null, `${Math.round(heightD)}px tall, ${words.length} pieces of text over the picture`);
      backdrops += 1;
      rows.push({ id: newId(), type: "row", layout: "1", width: "full", contentWidth: "full", columns: [{ id: newId(), htmlId: colId, blocks }], htmlId: rowId, className: "rp", background: { type: "color", color: pageColour } });
      return;
    }

    // The row: the section's paint (on each of its rows, but a picture only on the first), its room and its place.
    const paintD = frame ? sliceFrame(paintDecl(frame, native), first, lastOfFrame) : {};
    if (frame && first && native.background?.type === "image") frameImage.set(frame.p, native.background.image);
    const image = frame ? frameImage.get(frame.p) : undefined;
    if (frame && !first) {
      if (native.background?.type === "image") delete native.background;
      for (const key of ["background-image", "background-size", "background-position", "background-repeat"]) delete paintD[key];
      if (image) Object.assign(paintD, continued(image, frame.box, band.outerTop - frame.box[1]));
      else if (frame.bg && frame.bg.length > 0) {
        drop("background-layers", frame, `${frame.bg.length} layer${frame.bg.length === 1 ? "" : "s"}`);
        note("warn", "A section with a complex background (layers or a gradient) is made of several rows; its background is on the first only.");
      }
    }
    if (!native.background && !paintD["background-color"] && !paintD["background-image"]) native.background = { type: "color", color: pageColour };
    const symmetric = near(band.contentLeft - band.left, band.right - band.contentRight) && band.contentLeft - band.left > 8;
    const rowD: Decl = {
      "margin-top": pxs(Math.max(-ROW_GAP, band.outerTop - previousBottom - (rows.length > 0 ? ROW_GAP : 0))),
      "padding-top": pxs(Math.max(0, band.top - band.outerTop)),
      "padding-bottom": pxs(Math.max(0, band.outerBottom - band.bottom)),
      "padding-left": symmetric ? "0px" : pxs(Math.max(0, band.contentLeft - band.left)),
      "padding-right": symmetric ? "0px" : pxs(Math.max(0, band.right - band.contentRight)),
      ...(frame ? placed(frame.box[0], frame.box[2], 0, desktop.docWidth) : {}),
      ...paintD,
    };
    previousBottom = band.outerBottom;
    let rowM: Decl = {};
    if (phoneBand) {
      const pFrame = frame ? getM!(frame.p) : null;
      rowM = {
        "margin-top": pxs(Math.max(-ROW_GAP, phoneBand.outerTop - previousBottomM - (rows.length > 0 ? ROW_GAP : 0))),
        "padding-top": pxs(Math.max(0, phoneBand.top - phoneBand.outerTop)),
        "padding-bottom": pxs(Math.max(0, phoneBand.outerBottom - phoneBand.bottom)),
        "padding-left": pxs(Math.max(0, phoneBand.contentLeft - phoneBand.left)),
        "padding-right": pxs(Math.max(0, phoneBand.right - phoneBand.contentRight)),
        ...(frame && pFrame ? placed(pFrame.box[0], pFrame.box[2], 0, mobile!.docWidth) : { width: "auto", "max-width": "none", "margin-left": "0", "margin-right": "0" }),
        ...(pFrame ? sliceFrame(paintDecl(pFrame), first, lastOfFrame) : {}),
      };
      if (!first) {
        for (const key of ["background-image", "background-size", "background-position", "background-repeat"]) delete rowM[key];
        if (image && pFrame) Object.assign(rowM, continued(image, pFrame.box, phoneBand.outerTop - pFrame.box[1]));
      }
      previousBottomM = phoneBand.outerBottom;
    } else if (mBands) {
      rowM = { display: "none" };
    }
    // A picture that fills a section on computers but is not there on phones is drawn by the section's CSS, so the phone's rule can take it away.
    if (frame && native.background?.type === "image" && getM) {
      const pFrame = getM(frame.p);
      const phoneHas = pFrame !== undefined && pFrame !== null && ((pFrame.bg?.length ?? 0) > 0 || (pFrame.s.backgroundImage !== undefined && pFrame.s.backgroundImage !== "none"));
      if (!phoneHas && allowedCssUrl(native.background.image.url)) {
        const picture = native.background.image;
        delete native.background;
        rowD["background-image"] = `url("${picture.url}")`;
        rowD["background-size"] = "cover";
        rowD["background-position"] = "50% 50%";
        rowD["background-repeat"] = "no-repeat";
        rowM["background-image"] = "none";
        if (!paintD["background-color"]) native.background = { type: "color", color: pageColour };
      }
    }
    put(rowId, "", rowD, rowM);
    if (symmetric) {
      put(rowId, " > :last-child", { width: "100%", "max-width": pxs(band.contentRight - band.contentLeft), "margin-left": "auto", "margin-right": "auto" }, { "max-width": "none", "margin-left": "0", "margin-right": "0" });
    }
    const bandBox = (b: Band): Box => [b.left, b.outerTop, b.right - b.left, b.outerBottom - b.outerTop];
    parts.push({ id: rowId, path: frame ? frame.p : (band.leaves[0]?.p ?? spec.cols[0]?.path ?? ""), kind: "row", row: rowId, label: `row (${spec.kind}${frame && native.background?.type === "color" ? `, background ${native.background.color}` : ""})`, target: bandBox(band), targetM: phoneBand ? bandBox(phoneBand) : null });

    // The columns' grid: widths in proportion, the gap between them, and at phones' width stacked or kept side by side.
    const colBoxes = band.cols;
    const split = spec.kind === "split" && colBoxes.every(Boolean) && colBoxes.length > 1;
    // A track of cards that scroll sideways keeps the cards' own widths and scrolls, instead of squeezing them into the row.
    const track = Boolean(spec.scroller) && split;
    const template = split ? colBoxes.map((c) => (track ? pxs(c!.box[2]) : `minmax(0, ${round(c!.box[2])}fr)`)).join(" ") : null;
    const gapOf = (boxes: (CaptureNode | null)[]) => {
      const found = boxes.filter((c): c is CaptureNode => Boolean(c));
      if (found.length < 2) return 0;
      const gaps = found.slice(1).map((c, i) => c.box[0] - rightOf(found[i].box));
      return Math.max(0, gaps.reduce((a, b) => a + b, 0) / gaps.length);
    };
    const phoneBoxes = phoneBand ? phoneBand.cols : null;
    const sideBySide =
      track || (split && phoneBoxes !== null && phoneBoxes.every(Boolean) && phoneBoxes.every((c) => Math.abs(c!.box[1] - phoneBoxes[0]!.box[1]) < Math.min(c!.box[3], phoneBoxes[0]!.box[3]) * 0.5));
    // Side by side on phones with a box past the screen's edge: a row that scrolls sideways there (lampan.no's hero tiles: 358 px each, the second out of view).
    const phoneTrack = split && phoneBoxes !== null && phoneBoxes.every(Boolean) && phoneBoxes.length > 1 && sideBySide && phoneBoxes.some((c) => rightOf(c!.box) > mobile!.docWidth + 2);
    const gridD: Decl = { "column-gap": pxs(gapOf(colBoxes)), "row-gap": "0px" };
    if (template) gridD["grid-template-columns"] = template;
    if (track) gridD["overflow-x"] = "auto";
    const gridM: Decl = {};
    if (track || phoneTrack) gridM["overflow-x"] = "auto";
    if (split && phoneBoxes && phoneBoxes.every(Boolean)) {
      if (sideBySide) {
        gridM["column-gap"] = pxs(gapOf(phoneBoxes));
        gridM["grid-template-columns"] = phoneBoxes.map((c) => (track || phoneTrack ? pxs(c!.box[2]) : `minmax(0, ${round(c!.box[2])}fr)`)).join(" ");
      } else {
        const sorted = [...phoneBoxes].sort((a, b) => a!.box[1] - b!.box[1]);
        gridM["row-gap"] = pxs(Math.max(0, sorted[1]!.box[1] - bottomOf(sorted[0]!.box)));
        gridM["column-gap"] = "0px";
      }
    }
    put(rowId, " > :last-child > :first-child", gridD, gridM);

    const columns: PageColumn[] = spec.grid ? [makeGrid(spec.grid, rowId)] : spec.cols.map((col, colIndex) => {
      const colNode = colBoxes[colIndex];
      const colId = nextId();
      const nativeCol: { background?: Background } = {};
      // A column that is one piece (a button) is that piece: its padding and paint are the piece's own.
      const colLeaf = Boolean(colNode) && col.leaves.length === 1 && col.leaves[0].p === colNode!.p;
      const room = colNode ? (colLeaf ? whole(colNode) : content(colNode)) : null;
      const phoneCol = colNode ? (getM?.(colNode.p) ?? null) : null;
      const phoneRoom = phoneCol ? (colLeaf ? whole(phoneCol) : content(phoneCol)) : null;
      const colD: Decl = { gap: "0px" };
      const colM: Decl = {};
      if (colNode && room) {
        Object.assign(colD, col.paint && !colLeaf ? paintDecl(colNode, nativeCol) : {});
        colD["padding-top"] = pxs(room.room.top);
        colD["padding-right"] = pxs(room.room.right);
        colD["padding-bottom"] = pxs(room.room.bottom);
        colD["padding-left"] = pxs(room.room.left);
        colD["margin-top"] = split && colNode.box[1] > band.top + 2 ? pxs(colNode.box[1] - band.top) : "0px";
        colD["min-height"] = col.paint && !colLeaf ? pxs(colNode.box[3]) : "0px";
        if (mBands) {
          if (phoneCol && phoneRoom) {
            // At phones' width the box that paints the column may be one inside it, inset by its wrapper's padding (lampan.no: a hero tile 328 wide in a cell 343 wide, with
            // rounded corners): the column then takes that box's place by margins and its paint, so its picture and corners are the tile's.
            const phonePaint = col.paint && !colLeaf ? paintInside(phoneCol) : null;
            const paintNode = phonePaint ?? phoneCol;
            Object.assign(colM, col.paint && !colLeaf ? paintDecl(paintNode) : {});
            colM["padding-top"] = pxs(phoneRoom.room.top);
            colM["padding-right"] = pxs(phonePaint ? Math.max(0, rightOf(phonePaint.box) - phoneRoom.right) : phoneRoom.room.right);
            colM["padding-bottom"] = pxs(phoneRoom.room.bottom);
            colM["padding-left"] = pxs(phonePaint ? Math.max(0, phoneRoom.left - phonePaint.box[0]) : phoneRoom.room.left);
            if (phonePaint) {
              colM["margin-left"] = pxs(Math.max(0, phonePaint.box[0] - phoneCol.box[0]));
              colM["margin-right"] = pxs(Math.max(0, rightOf(phoneCol.box) - rightOf(phonePaint.box)));
            }
            colM["margin-top"] = "0px";
            colM["min-height"] = col.paint && !colLeaf ? pxs(paintNode.box[3]) : "0px";
            // Stacked on phones but narrower than the row there (a logo, a badge): keeps its own width and place.
            if (split && !sideBySide && phoneBand && phoneCol.box[2] < (phoneBand.contentRight - phoneBand.contentLeft) * 0.9) {
              colM.width = pxs(phoneCol.box[2]);
              colM["margin-left"] = pxs(Math.max(0, phoneCol.box[0] - phoneBand.contentLeft));
            }
          } else colM.display = "none";
        }
      }
      put(colId, "", colD, colM);
      parts.push({ id: colId, path: colNode?.p ?? col.leaves[0]?.p ?? "", kind: "column", row: rowId, label: `column ${colIndex + 1} of ${spec.cols.length}`, target: colNode ? colNode.box : null, targetM: phoneCol ? phoneCol.box : null });

      // Blocks, top to bottom, each placed by how far it is below the last.
      const leafBoxes = col.leaves.filter((leaf) => dIndex.has(leaf.p));
      const phoneLeaves = col.leaves.map((leaf) => getM?.(leaf.p)).filter((l): l is CaptureNode => Boolean(l));
      const frameBox: Frame = room
        ? { left: room.left, width: room.right - room.left, leftM: phoneRoom ? phoneRoom.left : null, widthM: phoneRoom ? phoneRoom.right - phoneRoom.left : null }
        : {
            left: band.contentLeft,
            width: band.contentRight - band.contentLeft,
            leftM: phoneLeaves.length > 0 ? Math.min(...phoneLeaves.map((l) => l.box[0])) : null,
            widthM: phoneLeaves.length > 0 ? Math.max(...phoneLeaves.map((l) => rightOf(l.box))) - Math.min(...phoneLeaves.map((l) => l.box[0])) : null,
          };
      let cursor = room ? room.top : (leafBoxes[0]?.box[1] ?? 0);
      let cursorM: number | null = phoneRoom ? phoneRoom.top : phoneLeaves.length > 0 ? phoneLeaves[0].box[1] : null;
      const blocks: PageBlock[] = [];
      for (const group of groups(leafBoxes)) {
        const block = makeBlock(group, frameBox, cursor, cursorM, rowId, Boolean(col.inline));
        if (block) {
          const part = parts.find((p) => p.id === block.htmlId);
          if (part) part.label = describeBlock(block);
        }
        const end = group[group.length - 1];
        cursor = bottomOf(end.box);
        const phoneEnd = getM?.(end.p);
        if (phoneEnd) cursorM = bottomOf(phoneEnd.box);
        if (block) blocks.push(block);
      }
      const inlineProps = col.inline ? inlineColumn(leafBoxes, frameBox, colD, colM, phoneLeaves, phoneRoom ? { left: phoneRoom.left, width: phoneRoom.right - phoneRoom.left } : null) : {};
      if (col.inline) put(colId, "", colD, colM);
      return { id: newId(), htmlId: colId, blocks, ...(nativeCol.background ? { background: nativeCol.background } : {}), ...inlineProps };
    });

    if (spec.nested) {
      skipped.nested += 1;
      drop("nested-boxes", frame ?? colBoxes.find(Boolean) ?? null, `${spec.cols.length} columns with boxes inside`);
    }
    const columnBoxes = colBoxes.filter((c): c is CaptureNode => Boolean(c));
    const equal = split && spec.cols.every((c) => c.paint) && columnBoxes.every((c) => near(c.box[3], columnBoxes[0].box[3]));
    const align = split ? verticalAlign(columnBoxes) : undefined;
    const layout: RowLayout = split ? ((String(Math.min(6, spec.cols.length)) as RowLayout) in ROW_LAYOUTS ? (String(Math.min(6, spec.cols.length)) as RowLayout) : "1") : "1";
    const keptColumns = split ? columns.slice(0, Math.min(6, columns.length)) : columns.slice(0, 1);
    rows.push({
      id: newId(),
      type: "row",
      layout: split ? layout : "1",
      width: "full",
      contentWidth: "full",
      columns: keptColumns,
      htmlId: rowId,
      className: "rp",
      ...(native.background ? { background: native.background } : {}),
      // Side by side on phones too (D80): never stacked, as close on Small as such rows always were (D179).
      ...(sideBySide ? { stack: false, at: { sm: { gap: SIDE_BY_SIDE_GAP } } } : {}),
      ...(equal ? { equalHeight: true } : {}),
      ...(align ? { align } : {}),
    });
    if (split && columns.length > 6) {
      drop("columns-cut", frame, `${columns.length} boxes side by side, six kept`);
      note("warn", "A row of more than six boxes side by side was cut to six, as a row of the builder holds at most six columns.");
    }
  });

  // The limits of a page: fifty rows, a hundred blocks.
  let limited = rows;
  if (limited.length > ROWS_MAX) {
    const firstCut = parts.find((p) => p.kind === "row" && p.id === (limited[ROWS_MAX]?.htmlId ?? ""));
    dropped.push({ kind: "rows-cut", sel: "", y: Math.round(firstCut?.target?.[1] ?? 0), box: firstCut?.target ?? null, text: `${limited.length - ROWS_MAX} rows from here on` });
    note("warn", `The original is longer than a page of the builder can be (${ROWS_MAX} rows): the last ${limited.length - ROWS_MAX} rows are left out.`);
    limited = limited.slice(0, ROWS_MAX);
  }
  // Over the builder's block limit, small icons that were photographed go first, last ones first, before any words are lost.
  let total = limited.reduce((sum, row) => sum + row.columns.reduce((n, column) => n + column.blocks.length, 0), 0);
  if (total > BLOCKS_MAX) {
    let removed = 0;
    for (const row of [...limited].reverse()) {
      for (const column of [...row.columns].reverse()) {
        for (let i = column.blocks.length - 1; i >= 0 && total > BLOCKS_MAX; i--) {
          const id = column.blocks[i].htmlId;
          if (id && icons.has(id)) {
            column.blocks.splice(i, 1);
            total -= 1;
            removed += 1;
            counts.pictures -= 1;
          }
        }
      }
    }
    if (removed > 0) note("warn", `A page of the builder takes at most ${BLOCKS_MAX} blocks, so ${removed} small icon${removed === 1 ? " was" : "s were"} left out to keep all of the words.`);
  }
  let blockCount = 0;
  for (const row of limited) {
    for (const column of row.columns) {
      const room = Math.max(0, BLOCKS_MAX - blockCount);
      if (column.blocks.length > room) {
        if (!dropped.some((d) => d.kind === "blocks-cut")) dropped.push({ kind: "blocks-cut", sel: "", y: Math.round(parts.find((p) => p.kind === "row" && p.id === row.htmlId)?.target?.[1] ?? 0), box: null, text: `${column.blocks.length - room} blocks from here on` });
        note("warn", `A page of the builder takes at most ${BLOCKS_MAX} blocks, so the last blocks of the original are left out.`);
        column.blocks = column.blocks.slice(0, room);
      }
      blockCount += column.blocks.length;
    }
  }
  counts.rows = limited.length;
  counts.blocks = blockCount;
  // The grids that are still in the page: counted and reported; those the limits cut away are not (the summary must not claim a grid the draft lacks).
  const surviving = new Set(limited.flatMap((row) => row.columns.flatMap((column) => column.blocks.map((block) => block.htmlId ?? ""))));
  const gone = new Set<string>();
  const insideGrids: string[] = [];
  for (const [blockId, record] of gridRecords) {
    if (!surviving.has(blockId)) {
      gone.add(blockId);
      gone.add(record.colId);
      continue;
    }
    counts.grids = (counts.grids ?? 0) + 1;
    counts.items = (counts.items ?? 0) + record.items;
    grids.built.push(record.built);
    record.emit();
    insideGrids.push(record.path);
  }
  const keptParts = gone.size > 0 ? parts.filter((p) => !gone.has(p.id)) : parts;
  const within = (n: CaptureNode) => insideGrids.some((path) => n.p === path || n.p.startsWith(`${path}/`));
  // Words the page draws with CSS (a `::before` that says NEW) are in no run of text: they cannot be copied, and are said to be left out where they stood.
  const generated = [...walkLive(desktop.root)].filter((n) => (n.gen?.length ?? 0) > 0 && hasSize(n) && !within(n));
  for (const n of generated) drop("generated-text", n, n.gen!.join(" "));
  if (generated.length > 0) note("warn", `${generated.length} piece${generated.length === 1 ? "" : "s"} of text the page draws with CSS (a ::before or ::after, such as “${generated[0].gen![0]}”) ${generated.length === 1 ? "is" : "are"} not in the page's words, and so not in the copy.`);
  // Tracks that scroll sideways that no one asked for cards: in a column of a side-by-side layout, or deeper than a section's own boxes (D155 looks at those only).
  const unasked = [...walkLive(desktop.root)].filter((n) => (n.scroll || n.slider) && n.children.length >= 2 && hasSize(n) && !asked.has(n.p) && !within(n));
  if (unasked.length > 0) {
    const reason = "not looked at for repeated cards: it is in a column of a side-by-side layout, or deeper than a section's own boxes, where cards are not looked for, so it stays as it was";
    for (const n of unasked) drop("grid-columns", n, reason);
    const first = unasked[0];
    grids.kept.push({ path: first.p, sel: first.sel ?? first.tag, y: Math.round(first.box[1]), cards: unasked.reduce((sum, n) => sum + n.children.length, 0), reason: `${unasked.length === 1 ? "a track that scrolls sideways was" : `${unasked.length} tracks that scroll sideways were`} ${reason}` });
  }

  if (skipped.controls > 0) note("warn", `${skipped.controls} form field${skipped.controls === 1 ? " was" : "s were"} not copied: a form needs an email form block with its own recipient.`);
  if (skipped.missing.size > 0) note("warn", `${skipped.missing.size} picture${skipped.missing.size === 1 ? " could" : "s could"} not be downloaded and ${skipped.missing.size === 1 ? "is" : "are"} left out.`);
  if (skipped.nested > 0) note("warn", `${skipped.nested} section${skipped.nested === 1 ? " has" : "s have"} boxes inside boxes side by side, which the builder cannot nest; ${skipped.nested === 1 ? "its" : "their"} contents are stacked.`);
  if (backdrops > 0) note("warn", `${backdrops} row${backdrops === 1 ? " is" : "s are"} kept as a picture of the original with its words laid over it, because built from the page's parts ${backdrops === 1 ? "it" : "they"} matched the original badly: the pictures, links and layout in ${backdrops === 1 ? "it are" : "them are"} part of the picture, and only the words can be edited.`);
  if (skipped.shapes > 0) note("warn", `${skipped.shapes} decorative box${skipped.shapes === 1 ? " is" : "es are"} left out (shapes, overlays and empty boxes the builder has no block for).`);
  if (desktop.left.fixed.length > 0) note("warn", `Left out because they float over the page: ${desktop.left.fixed.slice(0, 6).join(", ")}.`);
  if (desktop.left.capped) note("warn", "The page is very large; only its first part was looked at.");

  return { rows: limited, model, shared: SHARED_CSS, title: desktop.title, description: desktop.description, notes, parts: keptParts, counts, dropped, grids };
}

/**
 * What makes a column of side-by-side components: where they sit along it, and the space between them (set on the column's
 * rule, for computers and for phones).
 */
function inlineColumn(
  leaves: CaptureNode[],
  frame: { left: number; width: number },
  desktopDecl: Decl,
  phoneDecl: Decl,
  phoneLeaves: CaptureNode[],
  phoneFrame: { left: number; width: number } | null,
): { inline: true; justify: "start" | "center" | "end" | "between" } {
  const along = (boxes: CaptureNode[], at: { left: number; width: number }) => {
    const sorted = [...boxes].sort((a, b) => a.box[0] - b.box[0]);
    const before = sorted[0].box[0] - at.left;
    const after = at.left + at.width - rightOf(sorted[sorted.length - 1].box);
    const gaps = sorted.slice(1).map((n, i) => n.box[0] - rightOf(sorted[i].box));
    const gap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    const justify = near(before, 0, 3) && near(after, 0, 3) && sorted.length > 2 ? "between" : near(before, after, 3) && before > 3 ? "center" : before > after + 3 ? "end" : "start";
    return { gap, justify } as const;
  };
  const d = along(leaves, frame);
  desktopDecl["column-gap"] = pxs(d.justify === "between" ? 8 : d.gap);
  desktopDecl["row-gap"] = "8px";
  if (phoneFrame && phoneLeaves.length > 0) phoneDecl["column-gap"] = pxs(along(phoneLeaves, phoneFrame).gap);
  return { inline: true, justify: d.justify };
}

function verticalAlign(nodes: CaptureNode[]): "middle" | "bottom" | undefined {
  if (nodes.length < 2) return undefined;
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  if (spread(nodes.map((n) => n.box[1])) <= 2) return undefined;
  if (spread(nodes.map((n) => n.box[1] + n.box[3] / 2)) <= 3) return "middle";
  if (spread(nodes.map((n) => bottomOf(n.box))) <= 3) return "bottom";
  return undefined;
}

/** A block in a few words: its kind and what it says. */
export function describeBlock(block: PageBlock): string {
  switch (block.type) {
    case "heading":
      return `heading h${block.level}: ${block.text.slice(0, 50)}`;
    case "button":
      return `button: ${block.label.slice(0, 40)}`;
    case "richText": {
      const first = block.doc.content[0] as { content?: { text?: string }[] } | undefined;
      const text = (first?.content ?? []).map((n) => n.text ?? "").join("").slice(0, 50);
      return `text (${block.doc.content.length} paragraph${block.doc.content.length === 1 ? "" : "s"}): ${text}`;
    }
    case "image":
      return `picture${block.image?.alt ? `: ${block.image.alt.slice(0, 40)}` : ""}`;
    case "contentGrid":
      return `grid of ${block.items?.length ?? 0} custom items${block.display === "carousel" ? " (a carousel)" : ""}`;
    default:
      return block.type;
  }
}
