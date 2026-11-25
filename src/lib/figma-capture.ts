import { z } from "zod";

import type { CaptureFont, CaptureNode, PageCapture, Run } from "./replicate-capture";

/**
 * A Figma frame as the page copy engine reads a page (D898 F2, `docs/design-tools.md`): the Kaizena Flow plugin (`figma-plugin/code.js`) reads
 * the frame the person selected (boxes, auto layout, fills, corners, shadows, text runs) and this turns it into a `PageCapture`, so the frame
 * gets what a copied page gets from `buildReplica()`: rows and columns from where things are, the style model, grids of repeated cards.
 * Auto layout is a flex box, a fill a background, a text a heading or a paragraph by its size, a frame that looks like a button a button, and
 * a picture or a drawn shape the library item the plugin sent for it. Pure: no database, no network.
 */

// ---------------------------------------------------------------------------
// What the plugin sends
// ---------------------------------------------------------------------------

const colour = z.object({ r: z.number().min(0).max(1), g: z.number().min(0).max(1), b: z.number().min(0).max(1), a: z.number().min(0).max(1) });
const paint = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SOLID"), color: colour }),
  z.object({ type: z.literal("IMAGE"), hash: z.string().regex(/^[0-9a-f]{1,80}$/), scale: z.string().max(20).optional() }),
  z.object({ type: z.literal("GRADIENT"), kind: z.string().max(40), stops: z.array(z.object({ at: z.number(), color: colour })).max(16) }),
]);
const run = z.object({
  t: z.string().max(20_000),
  family: z.string().max(100),
  style: z.string().max(60),
  weight: z.number().min(1).max(1000),
  size: z.number().min(1).max(1000),
  color: colour.nullable(),
  line: z.number().nullable(),
  tracking: z.number(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  upper: z.boolean().optional(),
  href: z.string().max(2000).optional(),
});
const box = z.tuple([z.number(), z.number(), z.number().min(0), z.number().min(0)]);
const layout = z.object({
  mode: z.enum(["HORIZONTAL", "VERTICAL", "GRID"]),
  wrap: z.boolean(),
  gap: z.number(),
  crossGap: z.number(),
  padding: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  main: z.string().max(20).optional(),
  cross: z.string().max(20).optional(),
});
const shadow = z.object({ inner: z.boolean(), x: z.number(), y: z.number(), blur: z.number(), spread: z.number(), color: colour });

type Paint = z.infer<typeof paint>;

export type FigmaNode = {
  id: string;
  type: string;
  name: string;
  box: [number, number, number, number];
  opacity?: number;
  fills?: z.infer<typeof paint>[];
  stroke?: z.infer<typeof colour>;
  strokeWeight?: number;
  corners?: number[];
  shadows?: z.infer<typeof shadow>[];
  layout?: z.infer<typeof layout>;
  clips?: boolean;
  text?: { align: string; runs: z.infer<typeof run>[] };
  shot?: string;
  children?: FigmaNode[];
};

export const figmaNode: z.ZodType<FigmaNode> = z.lazy(() =>
  z.object({
    id: z.string().max(100),
    type: z.string().max(40),
    name: z.string().max(200),
    box,
    opacity: z.number().min(0).max(1).optional(),
    fills: z.array(paint).max(12).optional(),
    stroke: colour.optional(),
    strokeWeight: z.number().min(0).max(500).optional(),
    corners: z.array(z.number().min(0)).length(4).optional(),
    shadows: z.array(shadow).max(8).optional(),
    layout: layout.optional(),
    clips: z.boolean().optional(),
    text: z.object({ align: z.string().max(20), runs: z.array(run).max(400) }).optional(),
    shot: z.string().max(120).optional(),
    children: z.array(figmaNode).max(400).optional(),
  }),
);

export const figmaFrame = z.object({
  name: z.string().max(200),
  width: z.number().min(1).max(20_000),
  height: z.number().min(1).max(100_000),
  tree: figmaNode,
  cut: z.boolean().optional(),
});
export type FigmaFrame = z.infer<typeof figmaFrame>;

/** A library item the plugin sent for a picture (`image:{hash}`) or a drawn shape (`shot:{node id}`). */
export type SentPicture = { url: string; width: number | null; height: number | null };

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const channel = (n: number) => Math.round(n * 255);
const rgba = (c: { r: number; g: number; b: number; a: number }) => (c.a >= 1 ? `rgb(${channel(c.r)}, ${channel(c.g)}, ${channel(c.b)})` : `rgba(${channel(c.r)}, ${channel(c.g)}, ${channel(c.b)}, ${Math.round(c.a * 100) / 100})`);
const pixels = (n: number) => `${Math.round(n * 100) / 100}px`;
const ALIGN: Record<string, string> = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between", BASELINE: "baseline" };
const TEXT_ALIGN: Record<string, string> = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" };

function gradientOf(fill: Extract<Paint, { type: "GRADIENT" }>): string {
  const stops = fill.stops.map((s) => `${rgba(s.color)} ${Math.round(s.at * 100)}%`).join(", ");
  return fill.kind === "GRADIENT_RADIAL" ? `radial-gradient(${stops})` : `linear-gradient(180deg, ${stops})`;
}

/** The family as a browser would write it, with a generic one after it. */
const familyOf = (family: string) => `"${family.replace(/"/g, "")}", sans-serif`;

/** The text style of a run, as computed styles: the most-used run's is the element's own. */
function textStyles(r: z.infer<typeof run>, align: string): Record<string, string> {
  const s: Record<string, string> = {
    fontFamily: familyOf(r.family),
    fontSize: pixels(r.size),
    fontWeight: String(Math.round(r.weight)),
    textAlign: TEXT_ALIGN[align] ?? "left",
  };
  if (r.color) s.color = rgba(r.color);
  if (r.line) s.lineHeight = pixels(r.line);
  if (r.tracking) s.letterSpacing = pixels(r.tracking);
  if (/italic/i.test(r.style)) s.fontStyle = "italic";
  if (r.upper) s.textTransform = "uppercase";
  if (r.underline || r.strike) s.textDecorationLine = r.underline ? "underline" : "line-through";
  return s;
}

function boxStyles(node: FigmaNode, pictures: Map<string, SentPicture>, bg: string[]): Record<string, string> {
  const s: Record<string, string> = {};
  if (node.layout && node.layout.mode !== "GRID") {
    s.display = "flex";
    s.flexDirection = node.layout.mode === "HORIZONTAL" ? "row" : "column";
    if (node.layout.wrap) s.flexWrap = "wrap";
    if (node.layout.main && ALIGN[node.layout.main]) s.justifyContent = ALIGN[node.layout.main];
    if (node.layout.cross && ALIGN[node.layout.cross]) s.alignItems = ALIGN[node.layout.cross];
    if (node.layout.gap) s[node.layout.mode === "HORIZONTAL" ? "columnGap" : "rowGap"] = pixels(node.layout.gap);
    if (node.layout.wrap && node.layout.crossGap) s[node.layout.mode === "HORIZONTAL" ? "rowGap" : "columnGap"] = pixels(node.layout.crossGap);
    const [top, right, bottom, left] = node.layout.padding;
    if (top) s.paddingTop = pixels(top);
    if (right) s.paddingRight = pixels(right);
    if (bottom) s.paddingBottom = pixels(bottom);
    if (left) s.paddingLeft = pixels(left);
  } else s.display = "block";
  for (const fill of node.fills ?? []) {
    if (fill.type === "SOLID" && !s.backgroundColor) s.backgroundColor = rgba(fill.color);
    else if (fill.type === "GRADIENT" && !s.backgroundImage) s.backgroundImage = gradientOf(fill);
    else if (fill.type === "IMAGE" && !s.backgroundImage) {
      const picture = pictures.get(`image:${fill.hash}`);
      if (picture) {
        s.backgroundImage = `url("${picture.url}")`;
        s.backgroundSize = fill.scale === "FIT" ? "contain" : fill.scale === "TILE" ? "auto" : "cover";
        s.backgroundPosition = "50% 50%";
        s.backgroundRepeat = fill.scale === "TILE" ? "repeat" : "no-repeat";
        bg.push(picture.url);
      }
    }
  }
  if (node.corners) {
    const [tl, tr, br, bl] = node.corners;
    if (tl) s.borderTopLeftRadius = pixels(tl);
    if (tr) s.borderTopRightRadius = pixels(tr);
    if (br) s.borderBottomRightRadius = pixels(br);
    if (bl) s.borderBottomLeftRadius = pixels(bl);
  }
  if (node.stroke && node.strokeWeight) {
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      s[`border${side}Width`] = pixels(node.strokeWeight);
      s[`border${side}Color`] = rgba(node.stroke);
    }
    s.borderTopStyle = "solid";
  }
  if (node.shadows?.length) {
    s.boxShadow = node.shadows.map((sh) => `${sh.inner ? "inset " : ""}${rgba(sh.color)} ${pixels(sh.x)} ${pixels(sh.y)} ${pixels(sh.blur)} ${pixels(sh.spread)}`).join(", ");
  }
  if (node.opacity !== undefined && node.opacity < 1) s.opacity = String(node.opacity);
  if (node.clips) s.overflowX = s.overflowY = "hidden";
  return s;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

const runsOf = (text: NonNullable<FigmaNode["text"]>): Run[] =>
  text.runs.flatMap((r) => {
    const parts = r.t.split("\n");
    return parts.flatMap((t, i) => {
      const own: Run[] = [];
      if (i > 0) own.push({ t: "", br: 1 });
      if (t) {
        own.push({
          t,
          ...(r.weight >= 600 ? { b: 1 as const } : {}),
          ...(/italic/i.test(r.style) ? { i: 1 as const } : {}),
          ...(r.underline ? { u: 1 as const } : {}),
          ...(r.href ? { href: r.href } : {}),
        });
      }
      return own;
    });
  });

/** The run that covers the most characters: its style is the element's. */
const mainRun = (text: NonNullable<FigmaNode["text"]>) => text.runs.reduce((best, r) => (r.t.length > best.t.length ? r : best), text.runs[0]);

/** A heading by size against the frame's body text: the largest sizes are headings, the rest paragraphs. */
function textTag(size: number, sizes: { h1: number; h2: number; h3: number }): string {
  if (size >= sizes.h1) return "h1";
  if (size >= sizes.h2) return "h2";
  if (size >= sizes.h3) return "h3";
  return "p";
}

const textNodes = (node: FigmaNode): FigmaNode[] => (node.text ? [node] : (node.children ?? []).flatMap(textNodes));

/** A small box with one line of text and its own fill or border: what a designer draws as a button. */
function looksLikeButton(node: FigmaNode): boolean {
  const kids = node.children ?? [];
  const texts = kids.filter((k) => k.text);
  const painted = (node.fills ?? []).some((f) => f.type === "SOLID" && f.color.a > 0.05) || Boolean(node.stroke && node.strokeWeight);
  return painted && texts.length === 1 && kids.length <= 2 && node.box[3] <= 80 && node.box[2] <= 480 && !texts[0].text!.runs.some((r) => r.t.includes("\n"));
}

const SHAPES = new Set(["RECTANGLE", "ELLIPSE", "VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"]);

/**
 * The capture of a frame: a body holding the frame's own box, and its parts as elements. `pictures` are the library items the plugin sent, by
 * their keys (`image:{hash}`, `shot:{node id}`); a picture not among them is left out.
 */
export function figmaToCapture(frame: FigmaFrame, pictures: ReadonlyMap<string, SentPicture>, file: string): PageCapture {
  const pics = new Map(pictures);
  const all = textNodes(frame.tree);
  const sizes = all.map((t) => mainRun(t.text!).size).sort((a, b) => b - a);
  const largest = sizes[0] ?? 16;
  const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 16;
  // Headings are text well above the body's size: the largest of them h1, then h2 and h3.
  const scale = { h1: Math.max(largest, body * 2.2), h2: Math.max(body * 1.6, 24), h3: Math.max(body * 1.25, 19) };
  let h1 = false;
  const fonts = new Map<string, CaptureFont>();

  /** Counts a text's typefaces, by family, weight and style. */
  function noteFonts(text: NonNullable<FigmaNode["text"]>) {
    for (const each of text.runs) {
      const style = /italic/i.test(each.style) ? "italic" : "normal";
      const key = `${each.family}|${Math.round(each.weight)}|${style}`;
      fonts.set(key, { family: each.family, weight: String(Math.round(each.weight)), style, chars: (fonts.get(key)?.chars ?? 0) + each.t.length });
    }
  }

  function convert(node: FigmaNode, path: string, top: boolean): CaptureNode | null {
    const [x, y, w, h] = node.box;
    if (w <= 0 || h <= 0) return null;
    const base = { p: path, box: [x, y, w, h] as [number, number, number, number], children: [] as CaptureNode[] };
    if (node.text) {
      const r = mainRun(node.text);
      noteFonts(node.text);
      let tag = textTag(r.size, scale);
      // One h1 to a page: the first of the largest; any other is an h2.
      if (tag === "h1") tag = h1 ? "h2" : ((h1 = true), "h1");
      const links = node.text.runs.filter((each) => each.href);
      const whole = links.length === node.text.runs.length && links.length > 0 ? links[0].href : undefined;
      return { ...base, tag: whole ? "a" : tag, s: textStyles(r, node.text.align), runs: runsOf(node.text), ...(whole ? { href: whole } : {}) };
    }
    const imageFill = (node.fills ?? []).find((f): f is Extract<Paint, { type: "IMAGE" }> => f.type === "IMAGE");
    if (node.shot || (SHAPES.has(node.type) && imageFill)) {
      const picture = pics.get(node.shot ?? `image:${imageFill?.hash ?? ""}`);
      if (!picture) return null;
      return {
        ...base,
        tag: "img",
        s: { ...boxStyles({ ...node, fills: (node.fills ?? []).filter((f) => f.type !== "IMAGE") }, pics, []), objectFit: "cover" },
        media: { kind: "img", url: picture.url, width: picture.width ?? Math.round(w), height: picture.height ?? Math.round(h), alt: "" },
      };
    }
    const bg: string[] = [];
    const s = boxStyles(node, pics, bg);
    if (looksLikeButton(node)) {
      const label = (node.children ?? []).find((k) => k.text)!;
      const r = mainRun(label.text!);
      noteFonts(label.text!);
      return { ...base, tag: "a", href: label.text!.runs.find((each) => each.href)?.href ?? "#", button: true, s: { ...s, ...textStyles(r, label.text!.align) }, runs: runsOf(label.text!) };
    }
    const children = (node.children ?? [])
      .map((child, i) => convert(child, `${path}/${i}`, false))
      .filter((c): c is CaptureNode => c !== null);
    // A shape without a picture or children is drawn by its box's own styles (a line, a block of colour).
    return { ...base, tag: top ? "section" : "div", ...(node.name && !/^(Frame|Group|Rectangle|Auto layout)\b/i.test(node.name) ? { sel: `div.${slugOf(node.name)}` } : {}), s, ...(bg.length ? { bg } : {}), children };
  }

  const kids = (frame.tree.children ?? []).map((child, i) => convert(child, `0/${i}`, true)).filter((c): c is CaptureNode => c !== null);
  const root: CaptureNode = {
    p: "",
    tag: "body",
    box: [0, 0, frame.width, frame.height],
    s: { display: "block" },
    children: [{ p: "0", tag: "main", box: [0, 0, frame.width, frame.height], s: boxStyles({ ...frame.tree, layout: undefined }, pics, []), children: kids }],
  };
  const background = (frame.tree.fills ?? []).find((f) => f.type === "SOLID");
  return {
    viewport: { w: Math.round(frame.width), h: 900 },
    url: `https://www.figma.com/#${encodeURIComponent(file)}/${encodeURIComponent(frame.name)}`,
    title: frame.name.slice(0, 190),
    lang: "",
    description: "",
    docWidth: Math.round(frame.width),
    docHeight: Math.round(frame.height),
    background: background && background.type === "SOLID" ? rgba(background.color) : "rgb(255, 255, 255)",
    root,
    fonts: [...fonts.values()],
    left: { fixed: [], hidden: 0, capped: Boolean(frame.cut) },
  };
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "part";

/** The picture keys a frame uses, so the server can check each one is the store's own library item. */
export function pictureKeys(frame: FigmaFrame): string[] {
  const keys = new Set<string>();
  const walkNode = (node: FigmaNode) => {
    if (node.shot) keys.add(node.shot);
    for (const fill of node.fills ?? []) if (fill.type === "IMAGE") keys.add(`image:${fill.hash}`);
    for (const child of node.children ?? []) walkNode(child);
  };
  walkNode(frame.tree);
  return [...keys];
}
