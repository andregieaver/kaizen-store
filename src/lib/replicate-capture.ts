/**
 * What the page replicator (D150) reads from an original page: a tree of the boxes the browser drew, with the styles
 * that make them look as they do. It is taken in a real browser at two widths (`replicate-extract.ts` runs in the
 * page), kept with the job (`page_replications.capture`) and turned into the builder's rows by `replicate-build.ts`.
 * Only this shape crosses between the browser, the database and the converter, so each can be tested alone.
 */

/** A box in the document's coordinates, in pixels: x, y, width, height. */
export type Box = [x: number, y: number, w: number, h: number];

/** A run of text in a text element: its words, and how they are marked. A `br` is a line break. */
export type Run = { t: string; b?: 1; i?: 1; u?: 1; href?: string; /** A link's colour, as the browser wrote it. */ c?: string; br?: 1 };

export type NodeMedia =
  | { kind: "img"; url: string; width: number; height: number; alt: string }
  | { kind: "svg" }
  | { kind: "canvas" }
  | { kind: "video"; url: string | null; poster: string | null; autoplay: boolean; loop: boolean; muted: boolean; controls: boolean }
  | { kind: "embed"; url: string; title: string }
  | { kind: "control"; type: string; label: string };

/** A place in the page worth telling a developer about: a selector as the original wrote it, and how far down it is. */
export type CaptureHit = { sel: string; y: number; note?: string };

/** What the page does that boxes and styles do not say; counts are complete, the samples are the first few. */
export type CaptureExtras = {
  /** Content drawn by `::before` and `::after` (icons, quotes, badges, decorative shapes). */
  pseudo: CaptureHit[];
  /** Elements with a running CSS animation. */
  animated: CaptureHit[];
  /** Elements that stick to the screen as the page scrolls. */
  sticky: CaptureHit[];
  /** Boxes that scroll sideways inside themselves (carousels, tables, tab bars). */
  scrollers: CaptureHit[];
  /** Elements that say what they are with a role (`tablist`, `dialog`, `slider`, …). */
  roles: CaptureHit[];
  total: { pseudo: number; animated: number; sticky: number; scrollers: number; roles: number };
};

export type CaptureNode = {
  /** Where it is in the page: its element-child indexes from the body, `0/3/1`. The same page gives the same key at every width. */
  p: string;
  tag: string;
  /** The element as a developer would name it: `section#hero.wide.dark`. Left out for a bare tag. */
  sel?: string;
  /** The element's own id, kept where it is one of the copy's (`rp…`), so a copy's boxes are found by it. */
  id?: string;
  box: Box;
  /** The computed styles that matter (`CAPTURE_STYLES`), as the browser wrote them; those at their default are left out. */
  s: Record<string, string>;
  /** A text element's words (every child is text or inline). */
  runs?: Run[];
  /** An `a`'s address, made absolute. */
  href?: string;
  media?: NodeMedia;
  /** A link or button that looks like a button. */
  button?: true;
  /** The addresses of its background pictures, made absolute. */
  bg?: string[];
  children: CaptureNode[];
};

export type CaptureFont = { family: string; weight: string; style: string; chars: number };

export type PageCapture = {
  viewport: { w: number; h: number };
  url: string;
  title: string;
  lang: string;
  description: string;
  docWidth: number;
  docHeight: number;
  /** The first background colour the page paints (html, then body), as the browser wrote it. */
  background: string;
  root: CaptureNode;
  fonts: CaptureFont[];
  /** What was left out: overlays kept off the screen (cookie banners, chat widgets), boxes that were hidden, and whether the node limit was reached. */
  left: { fixed: string[]; hidden: number; capped: boolean };
  extras?: CaptureExtras;
};

/** The two widths a page is looked at. */
export const VIEWPORTS = { desktop: { w: 1440, h: 900 }, mobile: { w: 390, h: 844 } } as const;
export type ViewportName = keyof typeof VIEWPORTS;

/** The page's height in a screenshot is cut at this, so a very long page does not fill the screen or the budget. */
export const SHOT_HEIGHT_MAX = 9000;
export const CAPTURE_NODES_MAX = 4000;

/** The computed styles read from every box. */
export const CAPTURE_STYLES = [
  "display",
  "position",
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  "columnGap",
  "rowGap",
  "gridTemplateColumns",
  "overflowX",
  "overflowY",
  "opacity",
  "transform",
  "color",
  "backgroundColor",
  "backgroundImage",
  "backgroundSize",
  "backgroundPosition",
  "backgroundRepeat",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "textDecorationLine",
  "whiteSpace",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopStyle",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomRightRadius",
  "borderBottomLeftRadius",
  "boxShadow",
  "objectFit",
  "objectPosition",
  "maxWidth",
  "minHeight",
  "aspectRatio",
  "filter",
  "listStyleType",
  "textShadow",
] as const;
export type CaptureStyle = (typeof CAPTURE_STYLES)[number];

// ---------------------------------------------------------------------------
// Reading values
// ---------------------------------------------------------------------------

/** A length in pixels (`12px`, `0`), or null for `auto`, `normal`, a percentage or anything else. */
export function px(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** A colour as `[r, g, b, a]` (a 0–1), or null. Reads what the browser's computed styles give: `rgb()`, `rgba()` and `color(srgb …)`. */
export function colourOf(value: string | undefined): [number, number, number, number] | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (text === "transparent") return [0, 0, 0, 0];
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+%?))?\s*\)$/.exec(text);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
    return [Math.round(Number(rgb[1])), Math.round(Number(rgb[2])), Math.round(Number(rgb[3])), Math.min(1, Math.max(0, alpha))];
  }
  const srgb = /^color\(srgb\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)(?:\s*\/\s*(\d*\.?\d+%?))?\s*\)$/.exec(text);
  if (srgb) {
    const to = (n: string) => Math.min(255, Math.max(0, Math.round(Number(n) * 255)));
    const alpha = srgb[4] === undefined ? 1 : srgb[4].endsWith("%") ? Number(srgb[4].slice(0, -1)) / 100 : Number(srgb[4]);
    return [to(srgb[1]), to(srgb[2]), to(srgb[3]), Math.min(1, Math.max(0, alpha))];
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const full = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), 1];
  }
  return null;
}

/** A colour as `#rrggbb`, or null if it is see-through or cannot be read. */
export function hexOf(value: string | undefined): string | null {
  const colour = colourOf(value);
  if (!colour || colour[3] < 0.5) return null;
  return `#${colour.slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Whether a colour paints anything. */
export const paints = (value: string | undefined): boolean => (colourOf(value)?.[3] ?? 0) > 0.02;

/** A colour as CSS that keeps its see-through (`rgba(...)`), or null when it cannot be read or paints nothing. */
export function cssColour(value: string | undefined): string | null {
  const colour = colourOf(value);
  if (!colour || colour[3] <= 0.01) return null;
  const [r, g, b, a] = colour;
  return a >= 0.995 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

/** The first family of a `font-family` list, unquoted. */
export function firstFamily(value: string | undefined): string {
  if (!value) return "";
  const first = value.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "").trim();
}

/** The text of a run list, as one string with line breaks as spaces. */
export const runsText = (runs: Run[] | undefined): string =>
  (runs ?? [])
    .map((run) => (run.br ? " " : (run.t ?? "")))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** Every node of a tree, parents before children. */
export function* walk(node: CaptureNode): Generator<CaptureNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

/** A node by its path key. */
export function indexByPath(root: CaptureNode): Map<string, CaptureNode> {
  const found = new Map<string, CaptureNode>();
  for (const node of walk(root)) found.set(node.p, node);
  return found;
}

export const bottomOf = (box: Box) => box[1] + box[3];
export const rightOf = (box: Box) => box[0] + box[2];

/** The urls in a `background-image` value, in order (gradients are not urls). */
export function backgroundUrls(value: string | undefined): string[] {
  if (!value || value === "none") return [];
  const urls: string[] = [];
  for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)) urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  return urls.filter((url) => url !== "");
}
