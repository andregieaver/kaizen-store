import { findClaims } from "./claims";
import {
  BLOCKS_MAX,
  ROWS_MAX,
  ROW_LAYOUTS,
  VIDEO_RATIOS,
  type Background,
  type ButtonBlock,
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
import {
  backgroundUrls,
  bottomOf,
  colourOf,
  cssColour,
  firstFamily,
  hexOf,
  indexByPath,
  paints,
  px,
  rightOf,
  runsText,
  walk,
  type Box,
  type CaptureNode,
  type PageCapture,
} from "./replicate-capture";
import { docOf, isTextList, wordsOf } from "./replicate-richtext";
import { cleanDecls, ruleOf, type Decl, type StyleModel } from "./replicate-styles";

/**
 * Turns what was captured of an original page into the page builder's own rows, columns and blocks, with the exact
 * sizes, spacing and colours as a style model (D150). Nothing here is written by a model: the structure follows the boxes
 * the browser drew (sections become rows, boxes side by side become columns, text, pictures, buttons, videos and lines
 * become blocks) and every measure is the original's, at both widths. What the builder cannot hold is left out or
 * simplified, and `notes` says so.
 */

export type Picture = { url: string; width: number; height: number };

export type BuildInput = {
  desktop: PageCapture;
  mobile: PageCapture | null;
  /** The library's copy of a picture of the original, by its address; null if it could not be downloaded. */
  picture: (url: string) => Picture | null;
  /** The library's copy of an element photographed in the page (an icon, a canvas), by its path; null if there is none. */
  shot: (path: string) => Picture | null;
  /** An uploaded video's address in the library, by its original address; null if it could not be copied. */
  video: (url: string) => { url: string } | null;
  /** The Google Fonts family a font of the original is installed as, or null. */
  font: (family: string) => string | null;
};

/** What a part of the copy answers to in the original, so a pass can compare them. */
export type PartInfo = {
  id: string;
  path: string;
  kind: "row" | "column" | "block";
  row: string;
  /** What the part is, in a few words, for the AI that looks at the copy ("heading: Make it better"). */
  label?: string;
  /** The box the original has for this part, at computers' width and at the phones'; a pass compares the copy with it. */
  target: Box | null;
  targetM: Box | null;
};

/** Something in the original that the copy does not have, or has only in part, named so a developer can find it. */
export type DroppedKind = "form-field" | "shape" | "picture-missing" | "graphic-unphotographed" | "video-missing" | "video-still-only" | "nested-boxes" | "background-layers" | "rows-cut" | "blocks-cut" | "columns-cut";
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
  counts: { rows: number; blocks: number; headings: number; texts: number; pictures: number; buttons: number; videos: number };
  /** What was left out or made simpler, with where it was in the original. */
  dropped: Dropped[];
};

/** The page's own gap between rows (`gap-8` of `PageArticle`): a row's margin is what it needs beyond it, so down to this much less. */
export const ROW_GAP = 32;

export const SHARED_CSS =
  ".rp.rp :is(h1,h2,h3,h4,h5,h6,p,ul,ol,li,blockquote){margin:0;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;text-align:inherit;line-height:inherit}\n" +
  ".rp.rp .rich-text{line-height:inherit;overflow-wrap:normal}\n.rp.rp .rich-text a{text-decoration:none;color:inherit}\n" +
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
  if (!hasSize(n)) return false;
  if (isLeaf(n)) return hasContent(n);
  return paintsBox(n) || n.children.some(significant);
}

const kids = (n: CaptureNode) => n.children.filter(significant);

/** Boxes side by side share a stretch of height: they are on one line. */
function lines(nodes: CaptureNode[]): CaptureNode[][] {
  const sorted = [...nodes].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  const result: { items: CaptureNode[]; top: number; bottom: number }[] = [];
  for (const node of sorted) {
    const line = result[result.length - 1];
    if (line) {
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

type Item = { kind: "leaf"; node: CaptureNode } | { kind: "split"; cols: CaptureNode[] } | { kind: "box"; node: CaptureNode; items: Item[] };

/** What is in a box, top to bottom: pieces of content, boxes side by side, and boxes that paint. */
function flow(node: CaptureNode): Item[] {
  if (isLeaf(node)) return hasContent(node) ? [{ kind: "leaf", node }] : [];
  const items: Item[] = [];
  for (const line of lines(kids(node))) {
    if (line.length === 1) {
      const child = line[0];
      if (isLeaf(child)) items.push({ kind: "leaf", node: child });
      else if (paintsBox(child)) items.push({ kind: "box", node: child, items: flow(child) });
      else items.push(...flow(child));
    } else {
      items.push({ kind: "split", cols: line });
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

// ---------------------------------------------------------------------------
// Rows: what the builder will hold
// ---------------------------------------------------------------------------

type ColSpec = { path: string | null; paint: boolean; leaves: CaptureNode[]; /** Its content is one line of pieces (a menu, a row of buttons): the builder's side by side column. */ inline?: boolean };
/** `stack`: content one under another; `split`: boxes side by side; `card`: one painted box. */
type RowSpec = { frame: CaptureNode | null; kind: "stack" | "split" | "card"; cols: ColSpec[]; nested: boolean };

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
    else if (item.kind === "box") {
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
      specs.push({ frame, kind: "split", cols, nested: cols.some((c) => c.nested) });
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
    return {
      cols,
      leaves,
      top: Math.min(...boxes.map((b) => b.box[1])),
      bottom: Math.max(...boxes.map((b) => bottomOf(b.box))),
      contentLeft: Math.min(...boxes.map((b) => b.box[0])),
      contentRight: Math.max(...boxes.map((b) => rightOf(b.box))),
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

export function buildReplica(input: BuildInput, newId: () => string): BuildOutput {
  const desktop = input.desktop;
  const mobile = input.mobile;
  const dIndex = indexByPath(desktop.root);
  const mIndex = mobile ? indexByPath(mobile.root) : null;
  const getD: Get = (p) => dIndex.get(p);
  const getM: Get | null = mIndex ? (p) => mIndex.get(p) : null;
  const notes: ReplicaNote[] = [];
  const model: StyleModel = { rules: [] };
  const parts: PartInfo[] = [];
  const counts = { rows: 0, blocks: 0, headings: 0, texts: 0, pictures: 0, buttons: 0, videos: 0 };
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
    return { css: stack.length <= 240 ? stack : family };
  };

  /** The page's own colour behind a row that paints none, so what shows through is as the original's. */
  const pageColour = hexOf(desktop.background) ?? "#ffffff";

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

  function typography(n: CaptureNode): { decl: (x: CaptureNode) => Decl; native?: string } {
    const font = fontOf(n);
    return { decl: (x) => ({ ...typeDecl(x), ...(font.css ? { "font-family": font.css } : {}) }), native: font.native };
  }

  function makeBlock(group: CaptureNode[], frame: Frame, top: number, topM: number | null, rowId: string, inline = false): PageBlock | null {
    const leaf = group[0];
    const id = nextId();
    const phone = getM?.(leaf.p) ?? null;
    const base = { id: newId(), htmlId: id, className: "rp" };
    const media = leaf.media;
    const at = placeAt(group, top, topM, frame, inline);
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
      });
      put(id, "", at.d, at.m);
      put(id, " img", imageDecl(leaf), phone ? imageDecl(phone) : {});
      register();
      counts.pictures += 1;
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
      const type = typography(leaf);

      // A button.
      if (leaf.button && !isTextList(leaf)) {
        const filled = paints(leaf.s.backgroundColor);
        const outlined = !filled && SIDES.some((side) => borderOf(leaf, side) > 0);
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
            "text-align": "center",
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
          ...(type.native ? { font: type.native } : {}),
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
        put(id, "", { ...at.d, ...type.decl(leaf), ...(oneLine(leaf) ? { "white-space": "nowrap" } : {}) }, { ...at.m, ...(phone ? { ...type.decl(phone), "white-space": oneLine(phone) ? "nowrap" : "normal" } : {}) });
        register();
        counts.headings += 1;
        const block: HeadingBlock = { ...base, type: "heading", text: words.slice(0, 300), level: used, ...(type.native ? { font: type.native } : {}) };
        return block;
      }

      // Words: rich text, a paragraph or several, a list or a quotation.
      const single = group.length === 1 && !isTextList(leaf);
      put(id, "", { ...at.d, ...type.decl(leaf), ...(single && oneLine(leaf) ? { "white-space": "nowrap" } : {}) }, { ...at.m, ...(phone ? { ...type.decl(phone), ...(single ? { "white-space": oneLine(phone) ? "nowrap" : "normal" } : {}) } : {}) });
      if (isTextList(leaf)) {
        const listPad = (n: CaptureNode) => ({ "padding-left": pxs(Math.max(0, px(n.s.paddingLeft) ?? 0)), "list-style-type": n.s.listStyleType ?? "disc" });
        put(id, " :is(ul,ol)", listPad(leaf), phone ? listPad(phone) : {});
        if (leaf.children.length > 1) {
          const gap = (n: CaptureNode) => (n.children.length > 1 ? Math.max(0, n.children[1].box[1] - bottomOf(n.children[0].box)) : 0);
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
      const block: RichTextBlock = { ...base, type: "richText", doc: docOf(group), ...(type.native ? { font: type.native } : {}) };
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

  // -- rows ------------------------------------------------------------------
  // Form fields have no block (a form needs its own recipient): counted where they stand, as no row holds them.
  for (const n of walk(desktop.root)) {
    if (n.media?.kind === "control" && hasSize(n)) {
      skipped.controls += 1;
      drop("form-field", n, `${n.media.type}${n.media.label ? `: ${n.media.label.slice(0, 40)}` : ""}`);
    }
  }
  const specs: RowSpec[] = [];
  let pending: Item[] = [];
  const flushPending = () => {
    if (pending.length > 0) specs.push(...rowSpecs(pending, null));
    pending = [];
  };
  const top = descend(desktop.root);
  // Where the descent stopped at a box that paints (the only section of the page, say), that box is the section.
  const topItems: Item[] = top !== desktop.root && paintsBox(top) && !isLeaf(top) ? [{ kind: "box", node: top, items: flow(top) }] : flow(top);
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
  const frameImage = new Map<string, { url: string; width: number; height: number }>();

  specs.forEach((spec, index) => {
    const band = dBands[index];
    if (!band) return;
    const phoneBand = mBands ? mBands[index] : null;
    const frame = spec.frame;
    const first = !frame || !firstOfFrame.has(frame.p);
    if (frame) firstOfFrame.add(frame.p);
    const rowId = nextId();
    const native: { background?: Background } = {};

    // The row: the section's paint (on each of its rows, but a picture only on the first), its room and its place.
    const paintD = frame ? paintDecl(frame, native) : {};
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
        ...(pFrame ? paintDecl(pFrame) : {}),
      };
      if (!first) {
        for (const key of ["background-image", "background-size", "background-position", "background-repeat"]) delete rowM[key];
        if (image && pFrame) Object.assign(rowM, continued(image, pFrame.box, phoneBand.outerTop - pFrame.box[1]));
      }
      previousBottomM = phoneBand.outerBottom;
    } else if (mBands) {
      rowM = { display: "none" };
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
    const template = split ? colBoxes.map((c) => `minmax(0, ${round(c!.box[2])}fr)`).join(" ") : null;
    const gapOf = (boxes: (CaptureNode | null)[]) => {
      const found = boxes.filter((c): c is CaptureNode => Boolean(c));
      if (found.length < 2) return 0;
      const gaps = found.slice(1).map((c, i) => c.box[0] - rightOf(found[i].box));
      return Math.max(0, gaps.reduce((a, b) => a + b, 0) / gaps.length);
    };
    const phoneBoxes = phoneBand ? phoneBand.cols : null;
    const sideBySide =
      split && phoneBoxes !== null && phoneBoxes.every(Boolean) && phoneBoxes.every((c) => Math.abs(c!.box[1] - phoneBoxes[0]!.box[1]) < Math.min(c!.box[3], phoneBoxes[0]!.box[3]) * 0.5);
    const gridD: Decl = { "column-gap": pxs(gapOf(colBoxes)), "row-gap": "0px" };
    if (template) gridD["grid-template-columns"] = template;
    const gridM: Decl = {};
    if (split && phoneBoxes && phoneBoxes.every(Boolean)) {
      if (sideBySide) {
        gridM["column-gap"] = pxs(gapOf(phoneBoxes));
        gridM["grid-template-columns"] = phoneBoxes.map((c) => `minmax(0, ${round(c!.box[2])}fr)`).join(" ");
      } else {
        const sorted = [...phoneBoxes].sort((a, b) => a!.box[1] - b!.box[1]);
        gridM["row-gap"] = pxs(Math.max(0, sorted[1]!.box[1] - bottomOf(sorted[0]!.box)));
        gridM["column-gap"] = "0px";
      }
    }
    put(rowId, " > :last-child > :first-child", gridD, gridM);

    const columns: PageColumn[] = spec.cols.map((col, colIndex) => {
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
            Object.assign(colM, col.paint && !colLeaf ? paintDecl(phoneCol) : {});
            colM["padding-top"] = pxs(phoneRoom.room.top);
            colM["padding-right"] = pxs(phoneRoom.room.right);
            colM["padding-bottom"] = pxs(phoneRoom.room.bottom);
            colM["padding-left"] = pxs(phoneRoom.room.left);
            colM["margin-top"] = "0px";
            colM["min-height"] = "0px";
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
      ...(sideBySide ? { sideBySide: true } : {}),
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

  if (skipped.controls > 0) note("warn", `${skipped.controls} form field${skipped.controls === 1 ? " was" : "s were"} not copied: a form needs an email form block with its own recipient.`);
  if (skipped.missing.size > 0) note("warn", `${skipped.missing.size} picture${skipped.missing.size === 1 ? " could" : "s could"} not be downloaded and ${skipped.missing.size === 1 ? "is" : "are"} left out.`);
  if (skipped.nested > 0) note("warn", `${skipped.nested} section${skipped.nested === 1 ? " has" : "s have"} boxes inside boxes side by side, which the builder cannot nest; ${skipped.nested === 1 ? "its" : "their"} contents are stacked.`);
  if (skipped.shapes > 0) note("warn", `${skipped.shapes} decorative box${skipped.shapes === 1 ? " is" : "es are"} left out (shapes, overlays and empty boxes the builder has no block for).`);
  if (desktop.left.fixed.length > 0) note("warn", `Left out because they float over the page: ${desktop.left.fixed.slice(0, 6).join(", ")}.`);
  if (desktop.left.capped) note("warn", "The page is very large; only its first part was looked at.");

  return { rows: limited, model, shared: SHARED_CSS, title: desktop.title, description: desktop.description, notes, parts, counts, dropped };
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
    default:
      return block.type;
  }
}
