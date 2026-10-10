import { z } from "zod";

import { cssProblem } from "./custom-css";
import {
  GRADIENT_COLORS_MAX,
  GRADIENT_COLORS_MIN,
  GRADIENT_FLOWS,
  GRADIENT_STYLES,
  backgroundMotionSchema,
  partMotionSchema,
  type BackgroundMotion,
  type GradientFlow,
  type GradientStyle,
  type PartMotion,
} from "./motion";
import { carouselSettingsSchema, type CarouselSettings } from "./carousel-settings";
import { HEX6, isOpacity } from "./colour";
import { customPictureProblem } from "./custom-picture";
import { isSafeAddress } from "./field-parts";
import { inlinePlain } from "./inline-text";
import { sourceTraits } from "./grid-source";
import { menuLinkSchema, type MenuLink } from "./navigation";
import { modalDomId, repeatedModalKey, rowModalSchema, type RowModal } from "./page-modal";
import { upgradeBlock, upgradeColumn, upgradeRow } from "./responsive";
import { displaysProblem, publicRows, showSchema, type Show } from "./visibility";
import { foldTypography, textGradientSchema, typographyAtSchema, typographyFamilies, typographyGroupsSchema, type TextGradient, type TypographyGroups, type TypographyGroupsAt } from "./typography";
import { SIZES, type Size, type SmallerSize } from "./breakpoints";
import { DESCRIPTION_MAX, EXCERPT_FIELD_MAX, TITLE_MAX, summarize } from "./seo";
import { slugify } from "./slug";
import { SHOP_PART_KEYS, type ShopPart } from "./store-parts";
import { termIdsSchema } from "./taxonomy";
import { ICONS, type IconName } from "./icons";
import { SOCIAL_NETWORKS, socialHref, type SocialNetwork } from "./social-links";
import { embedUrl } from "./video-embed";
import type { FeatureRequirement } from "./store-features";

/**
 * A page built from blocks (D42): its title, address, picture, search texts,
 * whether search engines and AI assistants may use it, and its content:
 * rows, each divided into columns (D43), each holding blocks: rich text, a
 * picture (D47), a heading or a button (D49), with settings of their own
 * (D48, D49). Shared by the admin
 * editor (in the browser) and the server, which checks everything again.
 */

export const PAGE_TITLE_MAX = 200;
export const PAGE_SLUG_MAX = 80;
export { EXCERPT_FIELD_MAX };
/** A page's whole address (parents and own part, `projects/project-a`), and how deep pages may nest. */
export const PAGE_PATH_MAX = 240;
export const PAGE_DEPTH_MAX = 4;
export const ALT_MAX = 300;
export const AUTHOR_MAX = 100;
export const BLOCKS_MAX = 100;
/** Characters of text in one rich-text block. */
export const RICH_TEXT_MAX = 50_000;

/** Kept in step with the `pages_slug_not_reserved` check: the platform's own routes at the root. */
export const RESERVED_PAGE_SLUGS: readonly string[] = [
  "account",
  "admin",
  "api",
  "app",
  "auth",
  "blog",
  "category",
  "cookies",
  "forgot-password",
  "help",
  "mail",
  "platform",
  "robots",
  "s",
  "setup",
  "sign-in",
  "sign-up",
  "sitemap",
  "status",
  "stores",
  "support",
  "tag",
  "unsubscribe",
  "www",
];

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

/**
 * Text marks the editor offers. `textStyle` is a colour (D180): `#rrggbb`, and how solid it is (0–100, solid unless set),
 * drawn by `<RichText>` as a style on a span, never as HTML.
 */
export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "link"; attrs: { href: string } }
  | { type: "textStyle"; attrs: TextColourAttrs };

export type TextColourAttrs = { color: string; opacity?: number };

export type TextNode = { type: "text"; text: string; marks?: Mark[] };
export type InlineNode = TextNode | { type: "hardBreak" };

export type BlockNode =
  | { type: "paragraph"; content?: InlineNode[] }
  | { type: "heading"; attrs: { level: 2 | 3 | 4 }; content?: InlineNode[] }
  | { type: "bulletList"; content: ListItemNode[] }
  | { type: "orderedList"; attrs?: { start?: number }; content: ListItemNode[] }
  | { type: "blockquote"; content: BlockNode[] }
  | { type: "horizontalRule" };

export type ListItemNode = { type: "listItem"; content: BlockNode[] };

/** A rich-text document as the editor (Tiptap, ProseMirror JSON) writes it, limited to what Kaizen shows. */
export type RichTextDoc = { type: "doc"; content: BlockNode[] };

export const EMPTY_DOC: RichTextDoc = { type: "doc", content: [{ type: "paragraph" }] };

/**
 * A link's address: http(s), mailto:, tel:, a path on the site or an anchor
 * on the page. Nothing else, so no `javascript:`.
 */
export function isLinkAddress(value: string): boolean {
  if (value.length === 0 || value.length > 2000 || /\s/.test(value)) return false;
  if (/^\/(?![/\\])/.test(value) || /^#\S*$/.test(value)) return true;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(value)) return true;
  if (/^tel:\+?[\d-]{3,20}$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Why a rich-text document was refused. */
class RichTextProblem extends Error {}

const MAX_DEPTH = 12;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function children(node: Json): unknown[] {
  if (node.content === undefined) return [];
  if (!Array.isArray(node.content)) throw new RichTextProblem("A text block could not be read.");
  return node.content;
}

function cleanMarks(value: unknown): Mark[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new RichTextProblem("A text block could not be read.");
  const marks: Mark[] = [];
  for (const mark of value) {
    if (!isObject(mark)) throw new RichTextProblem("A text block could not be read.");
    switch (mark.type) {
      case "bold":
      case "italic":
      case "underline":
        marks.push({ type: mark.type });
        break;
      case "link": {
        const href = isObject(mark.attrs) && typeof mark.attrs.href === "string" ? mark.attrs.href.trim() : "";
        if (!isLinkAddress(href)) {
          throw new RichTextProblem(
            `"${href.slice(0, 60)}" is not a link address. Use https://…, mailto:, tel: or a path starting with /.`,
          );
        }
        marks.push({ type: "link", attrs: { href } });
        break;
      }
      case "textStyle": {
        // A colour (D180), and nothing else Tiptap's text style may carry; one without a colour is no mark.
        const attrs = isObject(mark.attrs) ? mark.attrs : {};
        if (attrs.color === undefined || attrs.color === null || attrs.color === "") break;
        if (typeof attrs.color !== "string" || !HEX6.test(attrs.color)) throw new RichTextProblem("A text colour is written as # and six hex digits, like #1f2937.");
        const opacity = attrs.opacity;
        if (opacity !== undefined && opacity !== null && !isOpacity(opacity)) throw new RichTextProblem("A text colour's opacity is a whole number from 0 to 100.");
        const color = attrs.color.toLowerCase();
        if (marks.some((m) => m.type === "textStyle")) throw new RichTextProblem("A text has one colour.");
        marks.push({ type: "textStyle", attrs: typeof opacity === "number" && opacity < 100 ? { color, opacity } : { color } });
        break;
      }
      default:
        throw new RichTextProblem(`Text formatting "${String(mark.type)}" is not supported.`);
    }
  }
  return marks.length > 0 ? marks : undefined;
}

function cleanInline(value: unknown, budget: { chars: number }): InlineNode {
  if (!isObject(value)) throw new RichTextProblem("A text block could not be read.");
  if (value.type === "hardBreak") return { type: "hardBreak" };
  if (value.type !== "text" || typeof value.text !== "string") {
    throw new RichTextProblem(`"${String(value.type)}" is not supported inside a paragraph.`);
  }
  budget.chars -= value.text.length;
  if (budget.chars < 0) throw new RichTextProblem(`Keep each text block under ${RICH_TEXT_MAX.toLocaleString("en")} characters.`);
  const marks = cleanMarks(value.marks);
  return marks ? { type: "text", text: value.text, marks } : { type: "text", text: value.text };
}

function cleanListItem(value: unknown, depth: number, budget: { chars: number }): ListItemNode {
  if (!isObject(value) || value.type !== "listItem") throw new RichTextProblem("A list could not be read.");
  return { type: "listItem", content: children(value).map((child) => cleanBlock(child, depth + 1, budget)) };
}

function cleanBlock(value: unknown, depth: number, budget: { chars: number }): BlockNode {
  if (depth > MAX_DEPTH) throw new RichTextProblem("Lists and quotes are nested too deeply.");
  if (!isObject(value)) throw new RichTextProblem("A text block could not be read.");
  const inline = () => {
    const content = children(value).map((child) => cleanInline(child, budget));
    return content.length > 0 ? { content } : {};
  };
  switch (value.type) {
    case "paragraph":
      return { type: "paragraph", ...inline() };
    case "heading": {
      const level = isObject(value.attrs) ? Number(value.attrs.level) : NaN;
      if (level !== 2 && level !== 3 && level !== 4) throw new RichTextProblem("Headings in a page are level 2 to 4.");
      return { type: "heading", attrs: { level }, ...inline() };
    }
    case "bulletList":
      return { type: "bulletList", content: children(value).map((c) => cleanListItem(c, depth, budget)) };
    case "orderedList": {
      const start = isObject(value.attrs) ? Number(value.attrs.start ?? 1) : 1;
      const content = children(value).map((c) => cleanListItem(c, depth, budget));
      return Number.isInteger(start) && start !== 1 && start > 0 && start < 100_000
        ? { type: "orderedList", attrs: { start }, content }
        : { type: "orderedList", content };
    }
    case "blockquote":
      return { type: "blockquote", content: children(value).map((c) => cleanBlock(c, depth + 1, budget)) };
    case "horizontalRule":
      return { type: "horizontalRule" };
    default:
      throw new RichTextProblem(`"${String(value.type)}" is not supported in a text block.`);
  }
}

/**
 * The document with only what Kaizen shows: known blocks and marks, safe
 * link addresses, and nothing else (unknown attributes are dropped).
 */
export function cleanRichText(value: unknown): { ok: true; doc: RichTextDoc } | { ok: false; problem: string } {
  try {
    if (!isObject(value) || value.type !== "doc") throw new RichTextProblem("A text block could not be read.");
    const budget = { chars: RICH_TEXT_MAX };
    const content = children(value).map((child) => cleanBlock(child, 0, budget));
    return { ok: true, doc: { type: "doc", content: content.length > 0 ? content : EMPTY_DOC.content } };
  } catch (error) {
    if (error instanceof RichTextProblem) return { ok: false, problem: error.message };
    throw error;
  }
}

/** The document's words, one line per block, for excerpts and search. */
export function richTextPlain(doc: RichTextDoc): string {
  const lines: string[] = [];
  const inline = (nodes: InlineNode[] = []) =>
    nodes.map((node) => (node.type === "text" ? node.text : " ")).join("");
  const walk = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      switch (node.type) {
        case "paragraph":
        case "heading":
          lines.push(inline(node.content));
          break;
        case "bulletList":
        case "orderedList":
          for (const item of node.content) walk(item.content);
          break;
        case "blockquote":
          walk(node.content);
          break;
        case "horizontalRule":
          break;
      }
    }
  };
  walk(doc.content);
  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Rows and columns
// ---------------------------------------------------------------------------

/**
 * How a row divides its width: each column's share, 0 for a column as wide
 * as what it holds (D80, such as a header's logo and icons beside a menu
 * that takes the rest). A page is rows, one under another; each row has
 * these columns, and each column holds blocks. On phones the columns stack
 * unless the row keeps them side by side.
 */
export const ROW_LAYOUTS = {
  "1": { label: "1 column", widths: [1] },
  "2": { label: "2 columns", widths: [1, 1] },
  "3": { label: "3 columns", widths: [1, 1, 1] },
  "4": { label: "4 columns", widths: [1, 1, 1, 1] },
  "5": { label: "5 columns", widths: [1, 1, 1, 1, 1] },
  "6": { label: "6 columns", widths: [1, 1, 1, 1, 1, 1] },
  "left-sidebar": { label: "Left sidebar", widths: [1, 2] },
  "right-sidebar": { label: "Right sidebar", widths: [2, 1] },
  "both-sidebars": { label: "Left and right sidebars", widths: [1, 2, 1] },
  "fit-sides": { label: "Sides fit, middle fills", widths: [0, 1, 0] },
  "fit-middle": { label: "Middle fits", widths: [1, 0, 1] },
  "fit-end": { label: "Last fits", widths: [1, 0] },
} as const satisfies Record<string, { label: string; widths: readonly number[] }>;

export type RowLayout = keyof typeof ROW_LAYOUTS;
export const ROW_LAYOUT_KEYS = Object.keys(ROW_LAYOUTS) as [RowLayout, ...RowLayout[]];
/** A line of a row's columns holds at most this many (the widest layout's), and a row at most this many lines (D187). */
export const LINE_COLUMNS_MAX = 6;
export const ROW_LINES_MAX = 6;

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Space on each side, in pixels (D47). */
export type Sides = { top: number; right: number; bottom: number; left: number };
/** A row's, column's or block's margin (outside) and padding (inside); none when left out. */
export type Spacing = { margin?: Sides; padding?: Sides };
export const SPACING_MAX = 240;
/**
 * A row's padding until it is given its own: 20 px on each side, so rows
 * keep off the window's edges now that the page adds no room of its own at
 * the sides. A row set to 0 keeps 0.
 */
export const ROW_PADDING: Sides = { top: 20, right: 20, bottom: 20, left: 20 };
/** Where a picture or video background is anchored when it is cut to fit (D184). */
export const BACKGROUND_ALIGNS = ["top", "middle", "bottom"] as const;
export type BackgroundAlign = (typeof BACKGROUND_ALIGNS)[number];
/** A row's height as a share of the screen's, in per cent (D184). */
export const ROW_HEIGHT_VH = { min: 5, max: 300 } as const;
/** How wide a row's content may be made, in pixels (`PageRow.contentMax`, the theme's `layout.maxWidth`). */
export const CONTENT_MAX_MIN = 320;
export const CONTENT_MAX_MAX = 3200;
/** A column's share is a whole number up to this; dragging the edges between columns makes shares of 100 (a percent each). */
export const COLUMN_SHARE_MAX = 100;
/** A row's spacing as drawn: its own, with the default padding where it has none. */
export const rowSpacing = (style: Spacing | undefined): Spacing => ({ ...style, padding: style?.padding ?? ROW_PADDING });

/** A colour as `#rrggbb`. */
export type Color = string;

export const BORDER_STYLES = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" } as const;
export type BorderStyle = keyof typeof BORDER_STYLES;
/** A border (D49): its width on each side, in pixels, its colour and its line. */
export type Border = { width: Sides; color: Color; style: BorderStyle };
export const BORDER_MAX = 20;
export const RADIUS_MAX = 200;

/** Shadows to choose from (D49), each with its CSS. */
export const SHADOWS = {
  sm: { label: "Small", css: "0 1px 3px rgb(0 0 0 / 0.12), 0 1px 2px rgb(0 0 0 / 0.08)" },
  md: { label: "Medium", css: "0 4px 12px rgb(0 0 0 / 0.12)" },
  lg: { label: "Large", css: "0 10px 30px rgb(0 0 0 / 0.15)" },
  xl: { label: "Extra large", css: "0 20px 50px rgb(0 0 0 / 0.2)" },
} as const;
export type Shadow = keyof typeof SHADOWS;

/**
 * What every row, column and block can have (D47–D49): margin and padding,
 * a border, rounded corners and a shadow, and an id and classes of its own
 * for the site (the editor leaves those out, so a class cannot hide what
 * is being edited).
 */
export type PartBase = {
  style?: Spacing;
  border?: Border;
  /** Corner radius in pixels. */
  radius?: number;
  shadow?: Shadow;
  htmlId?: string;
  className?: string;
  /** Entrance, hover and scroll effects (D128, `src/lib/motion.ts`). */
  motion?: PartMotion;
  /**
   * A use of a global row, column or component (D98): the saved part's id,
   * on the part the use starts at. What it holds is the global's own, the
   * same on every page (`src/lib/global-parts.ts`).
   */
  global?: string;
  /** Inside a global's use: this part is the page's own, not shared with the global's other uses (D98). */
  local?: true;
  /**
   * The settings that differ at the smaller screen sizes (D179, `src/lib/responsive.ts`): the part's own are its Extra large
   * values, and each size holds only what it changes, read with `valueAt()` from smaller to larger.
   */
  at?: SizeOverrides;
  /** Where the part shows (D179): `hideAt` leaves it out at those sizes (CSS); `show` by sign-in or conditions (phase 4, the server). */
  visibility?: Visibility;
  /**
   * Its text's look per kind of text (D179 phase 3, `src/lib/typography.ts`): family, weight, size, line height, alignment,
   * letter spacing, transform, decoration, style, variant and shadow; a row's or column's is inherited by what it holds.
   */
  typography?: TypographyGroups;
};

/** The one kind of background a part can take per screen size (D179): a colour; a picture, video or gradient is the part's own. */
export type ColorBackground = { type: "color"; color: Color; opacity?: number };

/**
 * What a part can set per screen size (D179, `docs/responsive-editing.md` 3): its spacing, frame and colour; a row's
 * stacking, order and gap; a column's share of the row and its place; a block's alignment, a picture's width, a grid's
 * columns, gap and carousel, a dual button's stacking. Each kind of part reads the keys that concern it.
 */
export type PartSizeSettings = {
  style?: Spacing;
  /** `null` at a size: none there, though a larger size has one (D179 phase 2); the same for a shadow, colour, blur and width. */
  border?: Border | null;
  radius?: number;
  shadow?: Shadow | null;
  background?: ColorBackground | null;
  backdropBlur?: number | null;
  /** A row's columns (or a dual button's two) one under another. */
  stack?: boolean;
  /** A row's stacked columns, last first. */
  reverse?: boolean;
  /** Pixels between a row's columns, or a grid's tiles. */
  gap?: number;
  /** A column's share of its row (as a layout's widths: 0 is as wide as what it holds); the row's layout unless set. */
  width?: number;
  /** A column's place in its row. */
  order?: number;
  align?: TextAlign;
  maxWidth?: number | null;
  /** A row's content width in pixels, over the theme's (null: the theme's, though a larger size sets one). */
  contentMax?: number | null;
  /** A row's height as a share of the screen's, in per cent (D184); at least that tall. null: as tall as its content. */
  height?: number | null;
  /** A grid's columns. */
  columns?: number;
  /** A grid shown as a grid or as a carousel. */
  display?: "grid" | "carousel";
  /** Its typography at the size, per kind of text: what differs (D179 phase 3). */
  typography?: TypographyGroupsAt;
};
/** Per smaller size, what differs from the size above (D179). */
export type SizeOverrides = Partial<Record<SmallerSize, PartSizeSettings>>;
/** Where a part shows (D179 6): by screen size for now. */
/**
 * Where a part shows (D179): `hideAt` leaves it out at those sizes (CSS); `show` is who sees it (phase 4, `src/lib/visibility.ts`):
 * never, signed in, signed out or by conditions, decided by the server (`<VisiblePart>`); always when unset.
 */
export type Visibility = { hideAt?: Size[]; show?: Show };
/**
 * A row's or column's background (D48): a colour, or a picture with an
 * optional colour over it. A colour can be see-through (`opacity` 0–99; solid
 * when left out), so what is behind shows through it, blurred if the part
 * has `backdropBlur` (D86).
 */
export type Background =
  | { type: "color"; color: Color; opacity?: number }
  | {
      type: "image";
      image: { url: string; width: number; height: number };
      /** A colour laid over the picture, `opacity` 0–100, so text on it can be read. */
      overlay: { color: Color; opacity: number } | null;
      /** How soft the picture is drawn, in pixels (up to `BLUR_MAX`); none when left out. */
      blur?: number;
    }
  | GradientBackground;
/** Colours that move (D128): no picture to load; `flow` is how fast they move by themselves. */
export type GradientBackground = {
  type: "gradient";
  style: GradientStyle;
  colors: Color[];
  /** Degrees, for the shifting kind; 135 when left out. */
  angle?: number;
  flow?: GradientFlow;
  /** A fine noise over it. */
  grain?: boolean;
  /** How solid the gradient is, 0 to 100 (D183); solid unless set, so what is behind the part shows through. */
  opacity?: number;
  /** A colour over the gradient, as a picture takes one (D183). */
  overlay?: { color: Color; opacity: number } | null;
};
/** How soft a background picture or video may be drawn, in pixels. */
export const BLUR_MAX = 100;
/** How much what is behind a part may be blurred (D86): kept low, as a large backdrop blur is costly for the browser to draw. */
export const BACKDROP_BLUR_MAX = 20;
/**
 * A row's background video: plays without sound, on a loop, with a colour
 * and blur over it as a picture takes. `poster` is a still from it, shown
 * until it plays and instead of it for people who prefer less motion.
 */
export type VideoBackground = {
  type: "video";
  video: { url: string };
  poster: { url: string; width: number; height: number } | null;
  overlay: { color: Color; opacity: number } | null;
  blur?: number;
};
/** A row's background: a column's, or a video (rows only). */
export type RowBackground = Background | VideoBackground;

export type TextAlign = "left" | "center" | "right";
/**
 * Text alignment by screen as pages had it before D179 (D48): phones, from tablets (768 px) and from computers (1024 px) up;
 * each unset follows the smaller. Read on load into a part's `align` and its overrides (`upgradeBlock()`); the editor's
 * three screens still show it so (`alignView()`) until the per-size editor.
 */
export type TextAlignments = { mobile?: TextAlign; tablet?: TextAlign; desktop?: TextAlign };

/** How a picture is cropped (D48); none keeps its own shape. */
export const IMAGE_SHAPES = {
  landscape: "Landscape",
  portrait: "Portrait",
  panorama: "Panorama",
  square: "Square",
  circle: "Circle",
} as const;
export type ImageShape = keyof typeof IMAGE_SHAPES;

/** A picture is drawn at its own size and never larger (D151); `maxWidth` makes it narrower, in pixels. */
export const IMAGE_WIDTH_MIN = 16;
/** The bound `image.width` already has. */
export const IMAGE_WIDTH_MAX = 10_000;
/** Each crop's width over its height. Kept in step with the aspect classes in `SHAPES` (page-block.tsx); a test holds them. */
export const IMAGE_SHAPE_RATIO: Record<ImageShape, number> = { landscape: 4 / 3, portrait: 3 / 4, panorama: 3, square: 1, circle: 1 };
/** A picture taken from a custom field is not known by its size where it is drawn (`field-binding.ts`); this stands in for it. */
export const BOUND_PICTURE_SIZE = { width: 1600, height: 1200 } as const;


/**
 * A block taking what it shows from a custom field of the thing the page
 * belongs to (D118, `src/lib/field-binding.ts`): a heading's text, a rich
 * text's words, a picture, a button's address. The block's own content is
 * what shows where the field has none, when `fallback` is on; else such a
 * block is left out. Kept only on the blocks that can take a field.
 */
export type FieldBinding = {
  fieldId: string;
  fallback?: boolean;
  /** Whose field: the thing the page is on (none), or the store itself (D120), which any store page, layout, header or footer can take. */
  source?: FieldSource;
};
export type Bindable = { bind?: FieldBinding };
/** Whose custom fields a component shows (D120): the thing it is on, or the store itself. */
export type FieldSource = "store";

/** Rich text (D42); its alignment, font and the rest of its look are its typography (D179). */
export type RichTextBlock = PartBase & Bindable & { id: string; type: "richText"; doc: RichTextDoc };
/**
 * A picture (D47): uploaded and shrunk in the browser; none yet while it is being set up. It is drawn at its own size and
 * never larger (D151), shrinking only to fit a narrower column or a phone; `maxWidth` makes it narrower and `align` places it.
 */
export type ImageBlock = PartBase & Bindable & {
  id: string;
  type: "image";
  image: { url: string; width: number; height: number; alt: string } | null;
  caption: string;
  /** Where the picture leads when pressed (a web address, a page like /about, #anchor, mailto: or tel:); none for a plain picture. */
  href?: string;
  newTab?: boolean;
  shape?: ImageShape;
  /** The widest it is drawn, in pixels. Left out: the picture's own width (for a crop, the crop's own width). Never enlarges. */
  maxWidth?: number;
  /** Where it sits when narrower than its column, as text is aligned; left unless set. The caption follows. */
  align?: TextAlign;
};

/**
 * How big a picture block draws its picture, in pixels, and the only place that is worked out: the picture's own size (for a
 * crop, the largest crop of that shape inside it, so a crop is never enlarged), no wider than `maxWidth`. Null without a picture.
 */
export function imageDisplaySize(block: Pick<ImageBlock, "image" | "shape" | "maxWidth">): { width: number; height: number } | null {
  const picture = block.image;
  if (!picture) return null;
  const ratio = block.shape ? IMAGE_SHAPE_RATIO[block.shape] : picture.width / picture.height;
  const own = Math.min(picture.width, picture.height * ratio);
  const width = Math.max(1, Math.round(Math.min(own, block.maxWidth ?? Infinity)));
  return { width, height: Math.max(1, Math.round(width / ratio)) };
}
/** Heading levels: 1 is the page's main heading, used once (D49). */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
/** How large a heading looked, apart from its level, before the Typography panel (D49; folded into it on read, D179). */
export const HEADING_SIZES = { sm: "Small", md: "Medium", lg: "Large", xl: "Extra large", "2xl": "Huge" } as const;
export type HeadingSize = keyof typeof HEADING_SIZES;
/** The size a heading has unless one is chosen. */
export const HEADING_DEFAULT_SIZE: Record<HeadingLevel, HeadingSize> = { 1: "xl", 2: "lg", 3: "md", 4: "sm", 5: "sm", 6: "sm" };
export const FONT_WEIGHTS = { normal: "Normal", medium: "Medium", semibold: "Semibold", bold: "Bold" } as const;
export type FontWeight = keyof typeof FONT_WEIGHTS;
export const HEADING_MAX = 300;

/** A heading (D49): one line of text at a level, with its look. */
export type HeadingBlock = PartBase & Bindable & {
  id: string;
  type: "heading";
  text: string;
  level: HeadingLevel;
  /** Its size, weight (the theme's unless set, D60), alignment, font and colour are its typography (D179, D180); its size by level unless set. */
};

export const BUTTON_VARIANTS = { filled: "Filled", outline: "Outline", text: "Text link" } as const;
export type ButtonVariant = keyof typeof BUTTON_VARIANTS;
export const BUTTON_SIZES = { sm: "Small", md: "Medium", lg: "Large" } as const;
export type ButtonSize = keyof typeof BUTTON_SIZES;
export const BUTTON_SHAPES = { rounded: "Rounded", pill: "Pill", square: "Square" } as const;
export type ButtonShape = keyof typeof BUTTON_SHAPES;
export const BUTTON_LABEL_MAX = 100;

/**
 * A button (D49): a link that looks like a button. Shown once it has both
 * its text and its address; the defaults are filled, medium and rounded.
 */
export type ButtonBlock = PartBase & Bindable & {
  id: string;
  type: "button";
  label: string;
  /** Its weight (medium unless set) and font are its typography (D179). */
  href: string;
  newTab?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  fullWidth?: boolean;
  /** Where the button sits, as text is aligned. */
  align?: TextAlign;
  /** The fill (or an outline's line and text); the site's text colour unless chosen. Its text colour is its typography (D180). */
  fill?: Color;
};

/** What a content grid shows (D51): its kinds of content; articles come with the articles themselves. */
export const GRID_CONTENT = { pages: "Pages", articles: "Articles", products: "Products", custom: "Custom items" } as const;
export type GridContent = keyof typeof GRID_CONTENT;
/**
 * Where a grid's items come from: the pages of the page's owner, or
 * products. On Kaizen's pages a store and market are named; on a store's
 * own pages (D53) they are the store's products in the shopper's market.
 */
export type GridSource =
  /** `parent`: only the pages nested directly under that address (`projects`), or `@this` for the page the grid is on. */
  | { type: "pages"; parent?: string }
  | { type: "articles" }
  /** Items the owner writes by hand (D155): they live in the block (`ContentGridBlock.items`), as testimonials' do. */
  | { type: "custom" }
  | { type: "products"; storeId?: string; market?: string; /** Products picked for each shopper by the store's recommendations (D139), on a store's own pages. */ recommend?: GridRecommend };

/**
 * A product grid that recommends (D139): which of upsells, cross-sells and complements it mixes, and whether a line says why
 * each product is shown. The grid's categories and tags keep it to those products, its limit says how many.
 */
export type GridRecommend = { mix: { upsell: boolean; crossSell: boolean; complement: boolean }; explain: boolean };
export const DEFAULT_GRID_RECOMMEND: GridRecommend = { mix: { upsell: true, crossSell: true, complement: true }, explain: true };
/** A grid's source with only what moves between stores: no store or market, the recommendation options kept. */
export const ownProducts = (source: GridSource): GridSource =>
  source.type === "products"
    ? { type: "products", ...(source.recommend && { recommend: source.recommend }) }
    : // Another owner's parent page is not this one's; "the page it is on" moves with the grid.
      source.type === "pages" && source.parent !== "@this"
      ? { type: "pages" }
      : source;
export const GRID_SORTS = {
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title, A to Z",
  priceLow: "Price, low to high",
  priceHigh: "Price, high to low",
} as const;
export type GridSort = keyof typeof GRID_SORTS;
/** Sorts that need prices: products only. */
export const PRICE_SORTS: readonly GridSort[] = ["priceLow", "priceHigh"];
export const GRID_LIMIT_MAX = 48;
/** The most custom fields a content grid's tile shows (D120). */
export const TILE_FIELDS_MAX = 3;
export const GRID_GAP_MAX = 96;
export const GRID_COLUMNS_MAX = { mobile: 2, tablet: 4, desktop: 8 } as const;
/** A grid's columns by screen as pages had them before D179: now its `columns` (Extra large) and overrides (`upgradeBlock()`). */
export type GridColumns = { mobile: number; tablet: number; desktop: number };
/** A tile's parts, each on or off per grid. */
export const GRID_ELEMENTS = { image: "Picture", heading: "Heading", excerpt: "Excerpt", price: "Price", button: "Button" } as const;
export type GridElement = keyof typeof GRID_ELEMENTS;
/** A tile's own box: background, padding, border, corners and shadow. */
/** A card's content space as four sides, or none when it is zero everywhere. */
export function contentSides(padding: number | Sides | undefined): Sides | null {
  if (padding === undefined) return null;
  const sides = typeof padding === "number" ? { top: padding, right: padding, bottom: padding, left: padding } : padding;
  return sides.top + sides.right + sides.bottom + sides.left > 0 ? sides : null;
}

export type GridTile = {
  background?: Color;
  /** The card's text colour: its words, and (through the muted colour) its secondary words. */
  color?: Color;
  /** Space inside the card, around the picture and the words. */
  padding?: number;
  /** Space around the words only (not the picture), so a picture can reach the card's edge while the words keep clear of it: one number for every side, or each side's. */
  contentPadding?: number | Sides;
  border?: Border;
  radius?: number;
  shadow?: Shadow;
};

/** Custom grid items (D155): the most one grid holds, beyond `ITEMS_MAX` because a copied grid can be large; still one block. */
export const CUSTOM_ITEMS_MAX = 60;
export const CUSTOM_TITLE_MAX = 200;
export const CUSTOM_TEXT_MAX = 600;
export const CUSTOM_ALT_MAX = 200;
export const CUSTOM_BUTTON_MAX = 60;
export const CUSTOM_BADGE_MAX = 40;
export const CUSTOM_PRICE_TEXT_MAX = 60;
export const CUSTOM_DETAIL_LABEL_MAX = 60;
export const CUSTOM_DETAIL_TEXT_MAX = 120;

/** Where a custom item goes: the menu link shape (D52, D85), by slug, resolved where it is shown so a copy never carries another store's ids. */
export type ItemLink = MenuLink;

/**
 * One item of a grid of custom items (D155): the fields a tile of a page, an article or a product shows, in the owner's own
 * words. `priceText` is plain text, never a price: no VAT label, no cart, nothing a shopper pays.
 */
export type CustomGridItem = {
  /** Keeps the item's texts' translations. */
  id: string;
  title: string;
  /** Plain text, clamped by the grid's `excerptLines`. */
  text: string;
  picture: { url: string; width: number; height: number; alt: string } | null;
  link: ItemLink | null;
  /** Empty uses the grid's, then "Read more". */
  buttonLabel: string;
  /** YYYY-MM-DD, drawn like an article's date. */
  date: string | null;
  /** The owner's words over the picture ("New", "-20 %"). */
  badge: string;
  /** Plain text in a price's place ("From 199 kr"): not a live price. */
  priceText: string;
  /**
   * At most `TILE_FIELDS_MAX` lines, one each, as custom fields' tile lines. Each has an id of its own (unique in the item),
   * which its translations are kept by, so taking a line out or moving one never puts a translation on another line.
   */
  details: { id: string; label: string; text: string }[];
};

/** An item shows once it has something to show: a title, a picture or text. */
export const customItemShows = (item: CustomGridItem): boolean =>
  item.title.trim() !== "" || item.text.trim() !== "" || item.picture !== null;

/**
 * A content grid (D51): items of one kind, chosen by categories and tags
 * (a category includes its subcategories; with both, an item needs one of
 * each), sorted and limited, shown as tiles in columns by screen. Each
 * tile has a picture, heading, excerpt, price (products) and button,
 * each switched on or off, styled like the components they resemble.
 */
export type ContentGridBlock = PartBase & {
  id: string;
  type: "contentGrid";
  /** The tiles' fonts and sizes are its typography (D179): the tiles' text, their titles, excerpts and prices. */
  source: GridSource;
  categories: string[];
  tags: string[];
  sort: GridSort;
  limit: number;
  /** Columns at Extra large; the smaller sizes' in `at` (D179). */
  columns: number;
  show: Record<GridElement, boolean>;
  /** The button's text; empty uses "Read more" or "View product" in the content's language. */
  buttonLabel: string;
  /** Shown when nothing matches; empty shows nothing. */
  emptyText: string;
  /**
   * A "Filter and sort" button over a product grid on a store's page
   * (D83): shoppers narrow and order its products, the grid following at
   * once, with the choices in the address as on the listing pages (D78).
   */
  filters?: boolean;
  /** Pictures cropped alike keep the tiles even; landscape unless chosen. */
  /**
   * `theme` draws product tiles as the store theme's product cards (D60):
   * their picture shape, card style and alignment. The default for
   * products; landscape for pages and articles.
   */
  imageShape?: ImageShape | "original" | "theme";
  headingLevel: Exclude<HeadingLevel, 1>;
  /** Lines of excerpt at most. */
  excerptLines: number;
  /**
   * Custom fields (D120) a tile shows under its title, one line each (up to
   * `TILE_FIELDS_MAX`, by field id): only the plain ones of products, pages and articles.
   */
  tileFields?: string[];
  button?: Pick<ButtonBlock, "variant" | "size" | "shape" | "fill">;
  tile?: GridTile;
  /** Space between tiles, in pixels. */
  gap: number;
  /**
   * Tiles in a row that scrolls sideways (`Carousel`), the columns as many to a screen; a grid unless set. Per size in `at`
   * (D179): a carousel on Small only is a grid from Medium up (the replicator's copy of a page whose product rows scroll on
   * a phone only).
   */
  display?: "carousel";
  /** A carousel shows part of the next tile, so it is seen to scroll. */
  peek?: boolean;
  /** What a carousel does besides scrolling (D155, B): arrows, dots, where a tile rests, going round, autoplay. The default is arrows only. */
  carousel?: CarouselSettings;
  /** The items of a grid of custom items (D155; `source.type` "custom"), in the owner's order; never with another source. */
  items?: CustomGridItem[];
};

/**
 * The parts of a product's page (D79), each a component a product layout
 * places: they show the product the layout is used for, so they belong
 * only in product layouts.
 */
export const PRODUCT_PARTS = {
  back: "Back link",
  gallery: "Pictures",
  title: "Title",
  price: "Price",
  campaigns: "Campaigns",
  notice: "Business-only notice",
  host: "Host",
  buy: "Buy",
  description: "Description",
  withdrawal: "Right of withdrawal",
  safety: "Product safety",
  related: "Related products",
  fields: "Custom fields",
  field: "Custom field",
  loop: "Field loop",
} as const;
export type ProductPart = keyof typeof PRODUCT_PARTS;
export const RELATED_MAX = 12;

/**
 * The product parts that stand behind a store feature (D178): drawn only while it is on, left out of the builder's palette while it is
 * off, and shown as switched off on the canvas of a layout that holds one (`src/lib/part-features.ts`).
 */
export const PRODUCT_PART_FEATURES: Partial<Record<ProductPart, FeatureRequirement>> = {
  notice: "business",
  // A stay's or rental's host (D71): hosts are part of Stays and rentals.
  host: "bookings",
};

/** How custom fields (D118) are drawn: a specification table, `label: value` lines or small cards. */
export const FIELD_DISPLAYS = { table: "Table", list: "List", cards: "Cards" } as const;
export type FieldDisplay = keyof typeof FIELD_DISPLAYS;

/**
 * The field loop (D120): a repeater's rows, each drawn as a small layout made
 * of slots filled from the row's sub fields (a picture, a title, a text, a
 * link, a badge), in a product layout (the `loop` part) or on a page.
 */
export const LOOP_LAYOUTS = { cards: "Cards", list: "List", grid: "Grid of pictures", columns: "Columns" } as const;
export type LoopLayout = keyof typeof LOOP_LAYOUTS;
export const LOOP_SLOTS = { image: "Picture", title: "Title", text: "Text", link: "Link", badge: "Badge" } as const;
export type LoopSlot = keyof typeof LOOP_SLOTS;
/** Which sub field (by id) fills each slot of a row; a slot left out draws nothing. */
export type LoopSlots = Partial<Record<LoopSlot, string>>;
export const LOOP_COLUMNS = [2, 3, 4] as const;
export type LoopColumns = (typeof LOOP_COLUMNS)[number];
/** What a field loop is set to, in a page's block and (its layout, columns, slots and link) in a product layout's part. */
export type LoopConfig = {
  /** The repeater (a top-level field, by id) and its group. */
  fieldId?: string;
  groupId?: string;
  layout?: LoopLayout;
  /** Columns on larger screens, for the grid and columns layouts. */
  columns?: LoopColumns;
  slots?: LoopSlots;
  /** The whole card is the link (else the title is); never a link inside a link. */
  linkWholeCard?: boolean;
  showHeading?: boolean;
  heading?: string;
};

/**
 * A part of the product's page (D79). Each part takes only the settings
 * that concern it, all optional, with defaults that draw the page as it
 * was before layouts: the title (with the wishlist heart) at the theme's
 * heading size, a large price, headings over the description, safety
 * information and related products in the shopper's language unless one
 * of the store's own is given.
 */
export type ProductBlock = PartBase & {
  id: string;
  type: "product";
  part: ProductPart;
  /** The title's size and the text's alignment are its typography (D179). */
  /** The title: the wishlist heart beside it; on unless off. */
  wishlist?: boolean;
  /** The price: large unless off. */
  large?: boolean;
  /** The pictures: the strip of small pictures below; on unless off. */
  thumbnails?: boolean;
  /** Description, safety, related: a heading over them; on unless off. */
  showHeading?: boolean;
  /** That heading's own text; empty uses the built-in one in the shopper's language. */
  heading?: string;
  /** Related products: how many at most, and columns (Extra large; the smaller sizes' in `at`, two on Small and four above unless set). */
  limit?: number;
  columns?: number;
  /** Custom fields (D118): the group (none: all the product's groups in order); a single `field` names its group too. */
  groupId?: string;
  /** A single custom field: its id (`f_…`). */
  fieldId?: string;
  /** Custom fields: how they are drawn; a table unless set. */
  display?: FieldDisplay;
  /** Custom fields: each field's label beside its value; on unless off. */
  showLabel?: boolean;
  /** Custom fields: the store's own (D120) rather than the product's. */
  source?: FieldSource;
  /** The field loop part (D120): a repeater's rows (`fieldId`, `groupId`, `heading` as above) as cards, a list or columns. */
  loop?: Pick<LoopConfig, "layout" | "columns" | "slots" | "linkWholeCard">;
};

/**
 * The parts of a site's header and footer (D80), each a component a header
 * or footer layout places: they show the site's own logo, menus, countries
 * and details, so they belong only in headers and footers. A store's cart,
 * wishlist, search, countries and buyer switch are a store's alone;
 * Kaizen's sign-up button is Kaizen's.
 */
export const SITE_PARTS = {
  logo: "Logo",
  menuButton: "Phone menu button",
  search: "Search",
  account: "Account or sign in",
  wishlist: "Wishlist",
  cart: "Cart",
  markets: "Countries",
  buyerSwitch: "Business or private",
  colorMode: "Light or dark",
  signUp: "Start your store",
  business: "Business details",
  cookies: "Cookies link",
  withdrawal: "Withdrawal link",
} as const;
export type SitePart = keyof typeof SITE_PARTS;
/** The site parts that stand behind a store feature (D178), as `PRODUCT_PART_FEATURES` for a header's or footer's parts. */
export const SITE_PART_FEATURES: Partial<Record<SitePart, FeatureRequirement>> = {
  buyerSwitch: "business",
  // The online shop's own (D178 step 5): a website has no search of products, My account, wishlists or cart to link to.
  search: "shop",
  account: "shop",
  wishlist: "shop",
  cart: "shop",
};
const STORE_PARTS: readonly SitePart[] = ["search", "wishlist", "cart", "markets", "buyerSwitch", "colorMode", "withdrawal"];
const KAIZEN_PARTS: readonly SitePart[] = ["signUp"];

/** The site parts an owner's headers and footers offer: a store's (with a store id) or Kaizen's (null). */
export const sitePartsFor = (storeId: string | null): SitePart[] =>
  (Object.keys(SITE_PARTS) as SitePart[]).filter((part) => !(storeId === null ? STORE_PARTS : KAIZEN_PARTS).includes(part));

export const LOGO_HEIGHT = { min: 16, max: 160, header: 40, footer: 32 } as const;

/**
 * A part of the site's header or footer (D80). Each takes only the settings
 * that concern it, all optional: the logo's height, and the countries as a
 * drop-down list or as links, side by side or one under another. Menus are
 * menu components (`MenuBlock`, D85), which any page can have.
 */
export type SiteBlock = PartBase & {
  id: string;
  type: "site";
  part: SitePart;
  align?: TextAlign;
  /** The logo's height in pixels; the header's or footer's usual one unless set. */
  height?: number;
  /** The countries as links: side by side (the default) or one under another. */
  direction?: "row" | "column";
  /** The countries: a drop-down list (the default) or links to each. */
  display?: "dropdown" | "list";
};

/**
 * One of the owner's menus (D85), chosen by id, in any page, header or
 * footer: its links side by side (links under a link open below it) or one
 * under another, optionally left out on phones (where the phone's menu has
 * the main one).
 */
export type MenuBlock = PartBase & {
  id: string;
  type: "menu";
  /** The menu; none chosen yet shows nothing. */
  menuId?: string;
  direction?: "row" | "column";
  align?: TextAlign;
};

/**
 * The store's search (D112): its search box and, unless `results` is off,
 * what was searched for, as the standard search page shows it. A store's own
 * search page is built with it (its address `/search`), and a page that is
 * only about finding something, such as the 404 page, takes just the box.
 * A store's pages only.
 */
export type SearchBlock = PartBase & {
  id: string;
  type: "search";
  /** Show the results as well as the box (on by default); the box alone leads to the search page. */
  results?: boolean;
};

/**
 * Kaizen's plans (D142): what each plan costs and includes, drawn as cards and, if wanted, the
 * comparison table (D132) under them. The plans, their prices, fees and features are the platform's
 * (`commerce.plans`, `plan_prices`, `plan_features`), read where the page is shown, so a change to a
 * plan shows on the page with no edit to it. Kaizen's own pages only; stores sell their own things.
 */
export type PlansBlock = PartBase & {
  id: string;
  type: "plans";
  /** The currency the prices show in; none: the platform's first. */
  currency?: string;
  /** Which price each card shows; both (the default) shows the monthly price and the yearly one under it. */
  interval?: "month" | "year";
  /** The plan marked as the one to choose ("Most popular"); an id of Kaizen's plans. */
  highlightId?: string;
  /** Show the comparison table of features under the cards. */
  comparison?: boolean;
  /** The words on each card's button, and where it leads (sign-up unless chosen). */
  buttonLabel: string;
  buttonHref: string;
};

/**
 * The custom fields (D118) of the page or article it is on: one group, one
 * field of it, or with none chosen all the groups that apply to the page, as a
 * table, list or cards. Only fields the owner made public are drawn, in the
 * shopper's language, and it draws nothing when the page has no value for
 * them. A store's pages and articles only.
 */
export type CustomFieldBlock = PartBase & {
  id: string;
  type: "customField";
  /** The group; none chosen: every group that applies to the page. */
  groupId?: string;
  /** One field of the group; none: the whole group. */
  fieldId?: string;
  display?: FieldDisplay;
  /** Each field's label beside its value; on unless off. */
  showLabel?: boolean;
  /** The group's name over the fields, or `heading`'s own words; on unless off. */
  showHeading?: boolean;
  heading?: string;
  /** Whose fields (D120): the page's own, or the store's, which headers, footers and product layouts hold too. */
  source?: FieldSource;
};

/**
 * A repeater's rows of the page or article it is on (D120), each drawn as a
 * card, a list line or a column made of the row's sub fields (`slots`): the
 * builder's answer to ACF's repeater loop. It draws nothing when the field is
 * missing, private or has no rows. A store's pages and articles only.
 */
export type FieldLoopBlock = PartBase & LoopConfig & {
  id: string;
  type: "fieldLoop";
};

/**
 * One of a store's working pages (D113): the cart, checkout, order
 * confirmation, My account, sign-in, wishlists, a subscription, weekly
 * deliveries or the cookies page, drawn where a page built in the page
 * builder holds it; or (D117) one piece of the cart, checkout or order page,
 * to lay out as the owner likes. It draws only on its own route (the page chosen for that
 * role, `src/lib/page-roles.ts`), so it does nothing elsewhere. A store's
 * pages only.
 */
export type StorePartBlock = PartBase & {
  id: string;
  type: "storePart";
  part: ShopPart;
};

/** A separator line's look (D91). */
export const SEPARATOR_LINES = { solid: "Solid", dashed: "Dashed", dotted: "Dotted", double: "Double" } as const;
export type SeparatorLine = keyof typeof SEPARATOR_LINES;
export const SEPARATOR_THICKNESS_MAX = 16;
/** Where a line narrower than its column sits. */
export const SEPARATOR_POSITIONS = { left: "Left", center: "Centre", right: "Right" } as const;
export type SeparatorPosition = keyof typeof SEPARATOR_POSITIONS;

/**
 * A separator line (D91): a thematic break between parts of a page, drawn
 * as a line of its own style, thickness, colour and width. The defaults
 * are a solid, one-pixel line in the site's border colour across the column.
 */
export type SeparatorBlock = PartBase & {
  id: string;
  type: "separator";
  line?: SeparatorLine;
  /** Pixels; 1 unless set. */
  thickness?: number;
  /** The site's border colour unless chosen. */
  color?: Color;
  /** Its share of the column, 10–100 %; the whole column unless set. */
  width?: number;
  position?: SeparatorPosition;
};

/** One of a dual button's two (D91): its text, address and colours; the pair share size, corners and weight. */
export type DualButtonSide = Pick<ButtonBlock, "label" | "href" | "newTab" | "variant" | "fill">;

/**
 * Two buttons side by side (D91), such as "Shop now" and "Read more": each
 * its own text, address and style (a new one's second is an outline),
 * sharing size, corners, weight, the space between and
 * their place; one under another on phones if set. Each shows once it has
 * both its text and its address.
 */
export type DualButtonBlock = PartBase & {
  id: string;
  type: "dualButton";
  first: DualButtonSide;
  second: DualButtonSide;
  size?: ButtonSize;
  shape?: ButtonShape;
  /** Their weight (medium unless set) and font are its typography (D179). */
  /** Pixels between them; 12 unless set. */
  gap?: number;
  /** One under another, each the column's width (per size in `at`, D179). */
  stack?: boolean;
  align?: TextAlign;
};
export const DUAL_GAP_MAX = 64;

/** Whether a button (or a dual button's side) shows: it has its text and its address. */
export const buttonShows = (button: { label: string; href: string }) => button.label.trim() !== "" && button.href.trim() !== "";

/** Items a component holds at most (tabs, sections, questions, testimonials). */
export const ITEMS_MAX = 30;
export const ITEM_TITLE_MAX = 200;

/** A titled piece of rich text: an accordion's section or a tab (D91). Its id keeps its texts' translations. */
export type PanelItem = { id: string; title: string; body: RichTextDoc };

export const ACCORDION_LOOKS = { lines: "Lines between", boxed: "Boxes" } as const;
export type AccordionLook = keyof typeof ACCORDION_LOOKS;

/**
 * An accordion (D91): sections that open and close under their titles,
 * drawn as the browser's own `details`, so they work without script and
 * the browser's find opens the one holding what was searched for. The
 * first may start open, and only one may be open at a time if set.
 */
export type AccordionBlock = PartBase & {
  id: string;
  type: "accordion";
  items: PanelItem[];
  openFirst?: boolean;
  /** Opening one closes the others. */
  single?: boolean;
  look?: AccordionLook;
  /** The titles' size is the `title` typography (D179). */
};

export const TABS_LOOKS = { underline: "Underline", pills: "Pills", boxed: "Boxed" } as const;
export type TabsLook = keyof typeof TABS_LOOKS;
export const TABS_ALIGNS = { start: "Start", center: "Centre", stretch: "Spread across" } as const;
export type TabsAlign = keyof typeof TABS_ALIGNS;

/**
 * Tabs (D91): titled pieces of rich text, one shown at a time under a row
 * of tabs, as the ARIA tabs pattern has them. Each panel is in the page,
 * so search engines read them all; tabs without a title are left out.
 */
export type TabsBlock = PartBase & {
  id: string;
  type: "tabs";
  items: PanelItem[];
  look?: TabsLook;
  tabsAlign?: TabsAlign;
};

/**
 * Frequently asked questions (D91): each a question and its answer, drawn
 * as the accordion is, with the questions and answers also given to search
 * engines and AI assistants as schema.org's FAQPage unless switched off.
 * A question shows once it has both.
 */
export type FaqBlock = PartBase & {
  id: string;
  type: "faq";
  /** Each item's title is the question and its text the answer. */
  items: PanelItem[];
  openFirst?: boolean;
  single?: boolean;
  look?: AccordionLook;
  /** The FAQPage data; on unless off. */
  structuredData?: boolean;
};

/** A question that shows: it has both its question and an answer. */
export const faqShows = (item: PanelItem) => item.title.trim() !== "" && !richTextIsEmpty(item.body);

export const VIDEO_SOURCES = { upload: "Uploaded video", youtube: "YouTube", vimeo: "Vimeo" } as const;
export type VideoSource = keyof typeof VIDEO_SOURCES;
export const VIDEO_RATIOS = { "16:9": "16:9", "4:3": "4:3", "1:1": "Square", "9:16": "Upright 9:16", "21:9": "Wide 21:9" } as const;
export type VideoRatio = keyof typeof VIDEO_RATIOS;
export const VIDEO_TITLE_MAX = 200;

/**
 * A video (D91): one uploaded to the site, played by the browser with or
 * without controls (and, if set, starting muted and looping, still for
 * those who prefer less motion); or one on YouTube or Vimeo, shown as its
 * poster and a play button, whose player loads only when pressed. Its
 * title names it to screen readers and the player.
 */
export type VideoBlock = PartBase & {
  id: string;
  type: "video";
  source: VideoSource;
  /** The uploaded video. */
  video: { url: string } | null;
  /** A YouTube or Vimeo address. */
  link: string;
  /** Shown before it plays: an uploaded video's still, or a picture chosen. */
  poster: { url: string; width: number; height: number } | null;
  title: string;
  /** 16:9 unless set. */
  ratio?: VideoRatio;
  /** An uploaded video: the browser's controls, on unless off. */
  controls?: boolean;
  /** An uploaded video: starts by itself, muted, looping. */
  autoplay?: boolean;
  loop?: boolean;
};

export const HTML_MAX = 50_000;
export const HTML_HEIGHT_MAX = 4000;

/**
 * The owner's own HTML (D91), with its styles and scripts, run in a
 * sandboxed frame of its own origin (`HtmlFrame`, `src/lib/html-frame.ts`)
 * so nothing in it can reach the site's or the admin's cookies and
 * storage. It grows to its content unless a height is set; content from
 * other services can wait until the visitor presses Show. Its title names
 * the frame to screen readers.
 */
export type HtmlBlock = PartBase & {
  id: string;
  type: "html";
  html: string;
  title: string;
  /** Pixels; fits its content unless set. */
  height?: number;
  /** Shows a button first and loads nothing until it is pressed. */
  waitForClick?: boolean;
};

export const TESTIMONIAL_QUOTE_MAX = 1000;
export const TESTIMONIAL_NAME_MAX = 100;
export const TESTIMONIAL_LOOKS = { cards: "Cards", plain: "Plain", quote: "Large quotes" } as const;
export type TestimonialLook = keyof typeof TESTIMONIAL_LOOKS;
export const TESTIMONIAL_COLUMNS = [1, 2, 3, 4] as const;
export type TestimonialColumns = (typeof TESTIMONIAL_COLUMNS)[number];

/** One testimonial: what someone said, who they are, and if given their stars (1–5) and picture. */
export type Testimonial = {
  id: string;
  quote: string;
  name: string;
  /** Their title, company or town. */
  role: string;
  rating?: number;
  picture: { url: string; width: number; height: number } | null;
};

/**
 * Testimonials (D91): what customers said, written in by the owner or
 * their business's reviews on Google (fetched as the page is shown), as
 * cards, plain or large quotes in up to four columns (one on phones), with
 * their stars if given. A testimonial shows once it has its words.
 */
export type TestimonialsBlock = PartBase & {
  id: string;
  type: "testimonials";
  /** The owner's own (`items`) unless Google's reviews of their business (set up under Integrations). */
  source?: "google";
  items: Testimonial[];
  /** Google reviews: only those with at least these stars, and at most this many (Google gives five). */
  minRating?: number;
  limit?: number;
  /** 3 unless set; phones show one. */
  columns?: TestimonialColumns;
  look?: TestimonialLook;
  /** Stars show unless off. */
  showRating?: boolean;
  /** Side by side in a row that scrolls sideways (`Carousel`), the columns as many to a screen. */
  display?: "carousel";
  /** What the carousel does besides scrolling (D155, B), as a content grid's. */
  carousel?: CarouselSettings;
};

/** A testimonial that shows: it has its words. */
export const testimonialShows = (item: Testimonial) => item.quote.trim() !== "";

export const SOCIAL_LOOKS = { plain: "Icons", filled: "Filled", outline: "Outlined" } as const;
export type SocialLook = keyof typeof SOCIAL_LOOKS;
export const SOCIAL_SHAPES = { circle: "Circle", rounded: "Rounded", square: "Square" } as const;
export type SocialShape = keyof typeof SOCIAL_SHAPES;
export const SOCIAL_COLORS = { brand: "Each network's own", theme: "The site's", custom: "Chosen" } as const;
export type SocialColors = keyof typeof SOCIAL_COLORS;
export const SOCIAL_GAP_MAX = 48;

/** One link: the network and what the owner typed (an address; an email address or phone number for those). */
export type SocialLink = { id: string; network: SocialNetwork; href: string };

/**
 * Social media buttons (D91): links to the business's profiles, each its
 * network's logo named for screen readers (and in words if set), opening
 * in a new tab, as plain icons or in a filled or outlined circle, rounded
 * or square, in each network's own colour, the site's or one chosen.
 */
export type SocialLinksBlock = PartBase & {
  id: string;
  type: "socialLinks";
  links: SocialLink[];
  look?: SocialLook;
  shape?: SocialShape;
  colors?: SocialColors;
  /** With `colors: "custom"`. */
  color?: string;
  size?: ButtonSize;
  /** Pixels between; 12 unless set. */
  gap?: number;
  position?: SeparatorPosition;
  /** The network's name beside its logo. */
  showNames?: boolean;
};

/** A link that shows: its address is one. */
export const socialLinkShows = (link: SocialLink) => socialHref(link.network, link.href) !== null;

export const ICON_LIST_TEXT_MAX = 300;
export const ICON_LIST_LAYOUTS = { column: "One under another", row: "Side by side" } as const;
export type IconListLayout = keyof typeof ICON_LIST_LAYOUTS;

/** One line of an icon list: its icon, its words, and where it links if anywhere. */
export type IconListItem = { id: string; icon: IconName; text: string; href: string };

/**
 * An icon list (D91): lines of text, each after an icon (the theme's
 * accent unless a colour is chosen), one under another or side by side,
 * each a link if given an address. The icons are decorative: the words
 * say what each line means.
 */
export type IconListBlock = PartBase & {
  id: string;
  type: "iconList";
  items: IconListItem[];
  layout?: IconListLayout;
  iconColor?: string;
  /** The icons filled with a gradient (D199), over the icon colour; two to four colours at an angle. */
  iconGradient?: TextGradient;
  iconSize?: ButtonSize;
  /** Pixels between lines; 12 unless set. */
  gap?: number;
  /** Side by side: where the lines sit. */
  position?: SeparatorPosition;
};

/** A line that shows: it has words. */
export const iconItemShows = (item: IconListItem) => item.text.trim() !== "";

export const TABLE_ROWS_MAX = 60;
export const TABLE_COLUMNS_MAX = 12;
export const TABLE_CELL_MAX = 500;
/** How a table behaves on a narrow screen: scrolls sideways, or each row becomes a card with its column names beside the values. */
export const TABLE_MOBILE = { stack: "Stack each row", scroll: "Scroll sideways" } as const;
export type TableMobile = keyof typeof TABLE_MOBILE;

/**
 * A table: rows of cells (plain text that may hold inline markup), the first row its header when `header` is on. Every row has
 * as many cells as the first. On a phone it stacks (each row a card, cells labelled by their column's header) or scrolls sideways.
 */
export type TableBlock = PartBase & {
  id: string;
  type: "table";
  rows: string[][];
  /** The first row is the header: column names, read by screen readers and shown beside the values when stacked. */
  header?: boolean;
  /** The first column names its row (a row header). */
  rowHeaders?: boolean;
  striped?: boolean;
  /** A title for the table, read by screen readers and shown above it. */
  caption?: string;
  /** Phones: stack by default. */
  mobile?: TableMobile;
  /** The header row's text and background colours (`#rrggbb`); the theme's look unless set. */
  headerColor?: string;
  headerBackground?: string;
  /** The shaded rows' text and background colours (`#rrggbb`), while `striped` is on. */
  stripeColor?: string;
  stripeBackground?: string;
  /**
   * Section dividers (D197): by row, the title of a divider drawn above that row (an empty title is a plain line), null or missing for
   * none. Kept in step with `rows` by `table-edit.ts`; never above the header row.
   */
  sections?: (string | null)[];
  /** The section dividers' text and background colours (`#rrggbb`). */
  sectionColor?: string;
  sectionBackground?: string;
};

/** A table that shows: some cell has words. */
export const tableShows = (block: Pick<TableBlock, "rows">) => block.rows.some((row) => row.some((cell) => cell.trim() !== ""));

/** Kinds of question a form asks (D93). */
export const FORM_FIELD_KINDS = {
  name: "Name",
  text: "Short text",
  email: "Email address",
  phone: "Phone number",
  textarea: "Long text",
  select: "Choice from a list",
  checkbox: "Tick box",
} as const;
export type FormFieldKind = keyof typeof FORM_FIELD_KINDS;
export const FORM_FIELDS_MAX = 20;
export const FORM_OPTIONS_MAX = 20;
export const FORM_LABEL_MAX = 200;
export const FORM_TEXT_MAX = 500;
export const FORM_RECIPIENTS_MAX = 5;

/** Kinds whose words must be written: the others have their usual name in the page's language. */
export const LABELLED_KINDS: readonly FormFieldKind[] = ["text", "select", "checkbox"];

/**
 * One question: its kind, the words beside it (a name's, email's, phone's
 * or message's usual name in the page's language unless written), whether it must be answered, the
 * greyed hint inside it, and a choice's options.
 */
export type FormField = {
  id: string;
  kind: FormFieldKind;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

/** How a form's button looks: a button's look (D49). */
export type FormButton = Pick<ButtonBlock, "variant" | "size" | "shape" | "fill" | "fullWidth">;

/**
 * An email form (D93): the owner's questions; what a visitor sends is
 * emailed to the owner's `recipients` (never shown on the site), with the
 * visitor's email address to reply to when the form asks for one.
 * Texts left empty read in the page's language.
 */
export type EmailFormBlock = PartBase & {
    id: string;
    type: "emailForm";
    /** Where submissions are emailed: 1 to 5 addresses. */
    recipients: string[];
    /** The email's subject; the page's title unless written. */
    subject: string;
    fields: FormField[];
    submitLabel: string;
    /** Shown in place of the form once sent. */
    successMessage: string;
    /** A tick box the visitor must tick to send, such as agreeing to how their message is used. */
    consent?: string;
    button?: FormButton;
  };

export const NEWSLETTER_LAYOUTS = { inline: "Side by side", stacked: "One under another" } as const;
export type NewsletterLayout = keyof typeof NEWSLETTER_LAYOUTS;

/**
 * A newsletter sign-up (D93): an email address (and a name if asked),
 * with the visitor's consent in words they tick. Unless switched off, the
 * address is confirmed first (double opt-in): the visitor gets an email
 * with a link, and only then is the sign-up emailed to the `recipients`,
 * with the words consented to and when.
 */
export type NewsletterBlock = PartBase & {
    id: string;
    type: "newsletter";
    recipients: string[];
    askName?: boolean;
    /** The email field's greyed hint; the language's "Your email address" unless written. */
    placeholder: string;
    submitLabel: string;
    successMessage: string;
    /** The words the visitor ticks; the language's usual consent unless written. */
    consent: string;
    /** Double opt-in, on unless switched off. */
    confirm?: boolean;
    layout?: NewsletterLayout;
    button?: FormButton;
  };

/** A form that shows: it has somewhere to send to, and something to ask. */
export const formShows = (block: EmailFormBlock | NewsletterBlock) =>
  block.recipients.length > 0 && (block.type === "newsletter" || block.fields.length > 0);

/** One piece of a page's content. */
export type PageBlock =
  | RichTextBlock
  | ImageBlock
  | HeadingBlock
  | ButtonBlock
  | ContentGridBlock
  | ProductBlock
  | SiteBlock
  | MenuBlock
  | SearchBlock
  | PlansBlock
  | CustomFieldBlock
  | FieldLoopBlock
  | StorePartBlock
  | SeparatorBlock
  | DualButtonBlock
  | AccordionBlock
  | TabsBlock
  | FaqBlock
  | VideoBlock
  | HtmlBlock
  | TestimonialsBlock
  | SocialLinksBlock
  | IconListBlock
  | TableBlock
  | EmailFormBlock
  | NewsletterBlock;
export type BlockType = PageBlock["type"];

/** The whole column is a link (D48); `label` names it for screen readers, else its text does. */
export type ColumnLink = { href: string; label: string };

/** Where a column's components sit when side by side (D80). */
export const COLUMN_JUSTIFY = { start: "Start", center: "Centre", end: "End", between: "Spread out" } as const;
export type ColumnJustify = keyof typeof COLUMN_JUSTIFY;

export type PageColumn = PartBase & {
  id: string;
  blocks: PageBlock[];
  background?: Background;
  /** How the background moves (D128), with a picture, video or gradient. */
  backgroundMotion?: BackgroundMotion;
  /** What is behind the column blurred, in pixels (D86); only with no background or a colour. */
  backdropBlur?: number;
  link?: ColumnLink;
  /** Its components side by side, wrapping as needed, rather than one under another (D80). */
  inline?: boolean;
  /** Side by side, where they sit along the column: at its start unless set. */
  justify?: ColumnJustify;
  /** Its share of the row at Extra large (D179; as a layout's widths, 0 is as wide as what it holds): the layout's unless set. */
  width?: number;
  /** Its place among the row's columns at Extra large (D179). */
  order?: number;
};

export type VerticalAlign = "top" | "middle" | "bottom";

export type PageRow = PartBase & {
  id: string;
  type: "row";
  /** The layout of the row's first line of columns (its only line unless `moreLines` has others). */
  layout: RowLayout;
  columns: PageColumn[];
  /**
   * The layouts of the lines of columns under the first (D187, as Beaver Builder's column groups): a row's columns are one line,
   * or several, each with a layout of its own that divides its width. `columns` holds them all, line after line, each line the
   * number of columns its layout has. None for a row of one line, which is how rows were always.
   */
  moreLines?: RowLayout[];
  /** The row's own width: the content's (the default) or the whole screen's (D48). */
  width?: "content" | "full";
  /** In a full-width row, whether what is in it keeps to the content's width (the default) or spreads too. */
  contentWidth?: "content" | "full";
  /** How wide the row's content may be, in pixels (per size in `at`); the theme's content width unless set. */
  contentMax?: number;
  /**
   * At least this tall, as a per cent of the screen's height (D184, per size in `at`): with a fixed background, a window
   * onto it.
   */
  height?: number;
  /** The background stays where it is on the screen while the page scrolls, and the row's content moves over it (D184). */
  backgroundFixed?: boolean;
  /** Which part of a picture or video background shows where it is cut to fit (D184): its top, middle (the default) or bottom. */
  backgroundAlign?: BackgroundAlign;
  /** At least as tall as the screen. */
  fullHeight?: boolean;
  /**
   * Columns one under another rather than side by side (D179, per size in `at`): unless set, they stack on Small only. A
   * row kept side by side everywhere (D80, a header's) is `false`.
   */
  stack?: boolean;
  /** Where columns stack, the last comes first (per size in `at`). */
  reverse?: boolean;
  /** Pixels between the columns (per size in `at`); 32 unless set. */
  gap?: number;
  /** Columns as tall as the tallest; what is in them sits at `align`. */
  equalHeight?: boolean;
  /** Where columns' content sits, top (the default), middle or bottom. */
  align?: VerticalAlign;
  background?: RowBackground;
  /** How the background moves (D128), with a picture, video or gradient. */
  backgroundMotion?: BackgroundMotion;
  /** What is behind the row blurred, in pixels (D86): a header over a picture, say. Only with no background or a colour. */
  backdropBlur?: number;
  /**
   * The row is a modal (D121): taken out of the page's flow and drawn in a
   * dialog that a link, a class, a timer or exit intent opens.
   */
  modal?: RowModal;
};

/** The layouts of a row's lines of columns: its own, then those of the lines under it (D187). */
export const rowLayouts = (row: Pick<PageRow, "layout" | "moreLines">): RowLayout[] => [row.layout, ...(row.moreLines ?? [])];

/** How many columns lines with these layouts hold. */
export const columnsOfLayouts = (layouts: readonly RowLayout[]): number => layouts.reduce((sum, layout) => sum + ROW_LAYOUTS[layout].widths.length, 0);

/**
 * A row's columns by line, as its layouts divide them (D187). A row of one line is all its columns; where the columns do not
 * match the layouts (never in a saved page), the last line takes what is left, so nothing is left out.
 */
export function columnLines(row: Pick<PageRow, "layout" | "moreLines" | "columns">): PageColumn[][] {
  const layouts = rowLayouts(row);
  let at = 0;
  return layouts.map((layout, i) => {
    const count = ROW_LAYOUTS[layout].widths.length;
    const line = i === layouts.length - 1 ? row.columns.slice(at) : row.columns.slice(at, at + count);
    at += count;
    return line;
  });
}

/** Whether a rich-text document holds nothing but empty paragraphs. */
export function richTextIsEmpty(doc: RichTextDoc): boolean {
  return doc.content.every((node) => node.type === "paragraph" && !node.content?.length);
}

/** The field a block takes its content from, if it has one (D118). */
export const bindingOf = (block: PageBlock): FieldBinding | undefined =>
  block.type === "heading" || block.type === "richText" || block.type === "image" || block.type === "button" ? block.bind : undefined;

/**
 * Whether a block shows anything; empty ones are left out of the page. A block
 * bound to a field counts as having content: the field decides (D118).
 */
export function blockHasContent(block: PageBlock): boolean {
  return bindingOf(block) !== undefined || blockOwnContent(block);
}

/**
 * Whether a block shows where no field is read (a header or footer, Kaizen's
 * own pages, a preview): its own content, and for a bound block only when it
 * keeps that content when its field is empty.
 */
export function blockShowsUnbound(block: PageBlock): boolean {
  const bind = bindingOf(block);
  return bind ? Boolean(bind.fallback) && blockOwnContent(block) : blockOwnContent(block);
}

/**
 * Whether a row is drawn on the site: something in it shows, or it has a
 * background of its own. A row with nothing to show is left out of the page,
 * a modal's row (D121) too: its dialog is not there for a link or a class to
 * open (a row whose only component is a form with no address to send to).
 */
export const rowShows = (row: PageRow): boolean =>
  Boolean(row.background) || row.columns.some((c) => c.background || c.blocks.some(blockShowsUnbound));

/** Whether a block has content of its own, whatever it is bound to. */
export function blockOwnContent(block: PageBlock): boolean {
  switch (block.type) {
    case "richText":
      return !richTextIsEmpty(block.doc);
    case "image":
      return block.image !== null;
    case "heading":
      return block.text.trim() !== "";
    case "button":
      return block.label.trim() !== "" && block.href.trim() !== "";
    case "contentGrid":
      // Its items are looked up when it is shown; with none, it says so (or nothing). Custom items (D155) are the block's own words.
      return block.source.type !== "custom" || (block.items ?? []).some(customItemShows);
    case "product":
      // The product decides what shows: a part it has nothing for draws nothing.
      return true;
    case "site":
      // The site decides: a store's countries with one draws nothing.
      return true;
    case "menu":
      // A menu with no links draws nothing.
      return Boolean(block.menuId);
    case "search":
    case "storePart":
      return true;
    case "plans":
      // The platform's plans decide: with none on offer it draws nothing (D142).
      return true;
    case "customField":
      // The page's own values decide: with none for these fields it draws nothing (D118).
      return true;
    case "fieldLoop":
      // Configured once a repeater is chosen; the page's own rows decide what it draws (D120).
      return Boolean(block.fieldId);
    case "separator":
      return true;
    case "dualButton":
      return buttonShows(block.first) || buttonShows(block.second);
    case "accordion":
    case "tabs":
      return block.items.some((item) => item.title.trim() !== "");
    case "faq":
      return block.items.some(faqShows);
    case "video":
      return block.source === "upload" ? block.video !== null : embedUrl(block.source, block.link) !== null;
    case "html":
      return block.html.trim() !== "";
    case "socialLinks":
      return block.links.some(socialLinkShows);
    case "iconList":
      return block.items.some(iconItemShows);
    case "table":
      return tableShows(block);
    case "emailForm":
    case "newsletter":
      return formShows(block);
    case "testimonials":
      // Google's reviews are known only when the page is shown.
      return block.source === "google" || block.items.some(testimonialShows);
  }
}

/**
 * A block's words, for the page's excerpt and llms.txt: its text, a
 * picture's description and caption, a heading. A button's few words say
 * nothing about the page, so they are left out.
 */
export function blockText(block: PageBlock): string {
  switch (block.type) {
    case "richText":
      return richTextPlain(block.doc);
    case "image":
      return [block.image?.alt, block.caption && inlinePlain(block.caption)].filter(Boolean).join(" ");
    case "heading":
      return inlinePlain(block.text);
    case "accordion":
    case "tabs":
      return panelText(block.items);
    case "faq":
      return panelText(block.items.filter(faqShows));
    case "video":
      return block.title;
    case "iconList":
      return block.items
        .filter(iconItemShows)
        .map((item) => inlinePlain(item.text))
        .join(" ");
    case "table":
      return [block.caption && inlinePlain(block.caption), ...block.rows.map((row) => row.map(inlinePlain).filter(Boolean).join(" "))].filter(Boolean).join(" ");
    case "testimonials":
      // Google's reviews are Google's words, not the page's.
      if (block.source === "google") return "";
      return block.items
        .filter(testimonialShows)
        .map((item) => [inlinePlain(item.quote), item.name].filter(Boolean).join(" "))
        .join(" ");
    case "button":
    case "contentGrid":
    case "product":
    case "site":
    case "menu":
    case "search":
    case "plans":
    case "storePart":
    case "customField":
    case "fieldLoop":
    case "separator":
    case "dualButton":
    case "socialLinks":
    // A form's words are questions, not what the page says.
    case "emailForm":
    case "newsletter":
    // Its words are in its own frame, not the page's.
    case "html":
      return "";
  }
}

/** Titled items' words: each title and its text. */
const panelText = (items: PanelItem[]) => items.map((item) => `${inlinePlain(item.title)} ${richTextPlain(item.body)}`.trim()).join(" ");

/** CSS for a part's border, rounded corners and shadow (D49); nothing for what it does not have. */
export function frameStyle(part: Pick<PartBase, "border" | "radius" | "shadow">): Record<string, string> {
  const css: Record<string, string> = {};
  if (part.border) {
    css.borderStyle = part.border.style;
    css.borderColor = part.border.color;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      css[`border${side[0].toUpperCase()}${side.slice(1)}Width`] = `${part.border.width[side]}px`;
    }
  }
  if (part.radius) css.borderRadius = `${part.radius}px`;
  if (part.shadow) css.boxShadow = SHADOWS[part.shadow].css;
  return css;
}

/** CSS for a spacing: only the sides that have some. */
export function spacingStyle(style: Spacing | undefined): Record<string, string> {
  const css: Record<string, string> = {};
  for (const kind of ["margin", "padding"] as const) {
    const sides = style?.[kind];
    if (!sides) continue;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      if (kind === "margin" ? sides[side] !== 0 : sides[side] > 0) css[`${kind}${side[0].toUpperCase()}${side.slice(1)}`] = `${sides[side]}px`;
    }
  }
  return css;
}

export const ROWS_MAX = 50;

export type PageThumbnail = { url: string; width: number; height: number; alt: string };

export type PageContent = {
  title: string;
  slug: string;
  /** Shown at the top of the page, in lists and when the page is shared. */
  thumbnail: PageThumbnail | null;
  /** A short text of its own for lists and content grids (a tile's excerpt); empty uses the search description, then the start of the content. */
  excerpt?: string;
  /** Search texts; empty uses the title and the start of the content. */
  seo: { title: string; description: string };
  /** Search engines may list it (else `noindex`, and left out of the sitemap). */
  searchEngines: boolean;
  /** AI assistants and AI crawlers may read it (else left out of llms.txt and closed to them in robots.txt). */
  aiAssistants: boolean;
  /** Its categories and tags, by id (D50); published with the page. */
  categories: string[];
  tags: string[];
  /** An article's author, by name (D57); empty shows the store or Kaizen. Pages have none. */
  author?: string;
  /** The content: rows of columns of blocks. */
  rows: PageRow[];
  /** A header's place over the page (D80); only headers have one. */
  overlay?: HeaderOverlay;
  /** A footer is revealed from under the page as it scrolls (D184); only footers have it. */
  footerReveal?: boolean;
  /**
   * Its texts in the owner's other languages (D55), by locale: only those
   * that differ from the page's own (`src/lib/page-translation.ts`).
   */
  translations?: Record<string, PageTranslation>;
  /** The owner's own CSS for this page, header, footer or layout (D100), checked by `cssProblem()`. */
  css?: string;
};

/**
 * Where a header lies over the page rather than above it (D80): on every
 * page, on the front page, or on pages in these page categories or tags
 * (by id) — and only on a page whose first row has a background of its own,
 * which then runs up behind the header. At the top of the page the header
 * is see-through, its text in `textColor` if set; scrolled, it has its
 * background again.
 */
export type HeaderOverlay = {
  where: "everywhere" | "front" | "terms";
  categories: string[];
  tags: string[];
  textColor?: Color;
};

/** A text of a page in another language: plain, or rich text for a rich text block (D55). */
export type PageText = string | RichTextDoc;
/** A page's texts in one language, by their place on the page (`block.{id}.text`, …). */
export type PageTranslation = Record<string, PageText>;

/** Every row, column and block, in page order. */
export function pageParts(rows: PageRow[]): (PageRow | PageColumn | PageBlock)[] {
  return rows.flatMap((row) => [row, ...row.columns.flatMap((column) => [column, ...column.blocks])]);
}

/** A custom id used by more than one part, if any. */
export function repeatedHtmlId(rows: PageRow[]): string | null {
  // A modal's dialog has the id `modal-{key}` (D121), which no other part may use.
  const seen = new Set<string>(rows.flatMap((row) => (row.modal ? [modalDomId(row.modal.key)] : [])));
  for (const part of pageParts(rows)) {
    const id = part.htmlId?.trim();
    if (!id) continue;
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

/** How a grid's pictures are cropped: its own choice, else the theme's cards for products (D60) and landscape for the rest. */
export const gridImageShape = (block: Pick<ContentGridBlock, "imageShape" | "source">) =>
  block.imageShape ?? (sourceTraits(block.source).products ? "theme" : "landscape");

/** The Google Fonts families a row, column or block uses (D59): its typography's, at every size and for every kind of text (D179). */
export const partFonts = (part: PageRow | PageColumn | PageBlock): string[] => {
  // A rich text drawn with the theme's paragraphs, headings and lists (D182) also uses the families those name.
  const inner = Object.values((part as { themeInner?: Record<string, ThemeElement> }).themeInner ?? {});
  return inner.length > 0 ? [...new Set([...typographyFamilies(part), ...inner.flatMap((element) => typographyFamilies(element))])] : typographyFamilies(part);
};
/** The families a block uses. */
export const blockFonts = (block: PageBlock): string[] => partFonts(block);

/** Every family a page's rows, columns and blocks use, once each. */
export const pageFonts = (content: Pick<PageContent, "rows">) => [...new Set(pageParts(content.rows).flatMap(partFonts))];

/** Every block on the page, row by row and column by column. */
export function pageBlocks(content: Pick<PageContent, "rows">): PageBlock[] {
  return content.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));
}

/**
 * Kept in step with the `pages_store_slug_not_reserved` check: a store's own
 * routes inside each of its markets (`/s/{store}/{market}/…`), D53.
 */
export const RESERVED_STORE_PAGE_SLUGS: readonly string[] = [
  "account",
  "blog",
  "cart",
  "category",
  "checkout",
  "cookies",
  "deliveries",
  "download",
  "order",
  "p",
  "products",
  "returns",
  "search",
  "subscription",
  "tag",
  "unsubscribe",
  "wishlist",
  "withdraw",
];

/**
 * Kept in step with the `pages_article_slug_not_reserved` check: the blog's
 * own routes under `/blog/` (D57), Kaizen's and every store's.
 */
export const RESERVED_ARTICLE_SLUGS: readonly string[] = ["category", "page", "tag"];

/** What is built in the page builder: pages, articles in the blog (D57), product layouts (D79), the site's headers and footers (D80), and A/B test variants of pages (D148). */
export const PAGE_TYPES = ["page", "article", "product_layout", "header", "footer", "variant"] as const;
/** The types that are parts of the site rather than pages at addresses of their own; a `variant` (D148) is a copy of a page made for an A/B test. */
export const LAYOUT_TYPES: readonly PageType[] = ["product_layout", "header", "footer", "variant"];
export type PageType = (typeof PAGE_TYPES)[number];

/**
 * The content whose categories and tags (D50) a page type uses: its own for
 * pages and articles. Product layouts (D79), headers and footers (D80) have
 * none; they read as pages
 * where a type is asked for, and saving one with any is refused.
 */
export const termContentOf = (type: PageType): "page" | "article" => (type === "article" ? "article" : "page");

/** The addresses an owner's pages (Kaizen's with null, or a store's) or articles cannot take. */
export const reservedPageSlugs = (storeId: string | null, type: PageType = "page"): readonly string[] =>
  LAYOUT_TYPES.includes(type)
    ? NO_RESERVED_SLUGS
    : type === "article"
      ? RESERVED_ARTICLE_SLUGS
      : storeId === null
        ? RESERVED_PAGE_SLUGS
        : RESERVED_STORE_PAGE_SLUGS;

/** Product layouts (D79), headers and footers (D80) have no address on the site: their name's own is only a key. */
const NO_RESERVED_SLUGS: readonly string[] = [];

/** Why an address is not well formed, or null. A page's address is its parents' and its own part, joined by `/` (`projects/project-a`). */
function slugFormatProblem(slug: string): string | null {
  if (slug.length === 0) return "Give the page an address.";
  if (slug.length > PAGE_PATH_MAX) return `Keep the address under ${PAGE_PATH_MAX} characters.`;
  const parts = slug.split("/");
  if (parts.length > PAGE_DEPTH_MAX) return `Pages nest at most ${PAGE_DEPTH_MAX} levels deep.`;
  for (const part of parts) {
    if (part.length === 0) return "An address cannot have an empty part.";
    if (part.length > PAGE_SLUG_MAX) return `Keep each part of the address under ${PAGE_SLUG_MAX} characters.`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part)) {
      return "An address is lowercase letters and digits, with single hyphens between words.";
    }
  }
  return null;
}

/** The parent part of a nested address (`projects` of `projects/project-a`); empty for a page at the top. */
export function pageParentPath(slug: string): string {
  const at = slug.lastIndexOf("/");
  return at < 0 ? "" : slug.slice(0, at);
}

/** A page's own part of its address (`project-a` of `projects/project-a`). */
export function pageSegment(slug: string): string {
  return slug.slice(slug.lastIndexOf("/") + 1);
}

/** A parent's address and a page's own part, joined. */
export function joinPagePath(parent: string, segment: string): string {
  return parent ? `${parent}/${segment}` : segment;
}

/** Why an address cannot be used, or null if it is fine; `reserved` is the owner's (Kaizen's by default). */
export function pageSlugProblem(slug: string, reserved: readonly string[] = RESERVED_PAGE_SLUGS): string | null {
  const problem = slugFormatProblem(slug);
  if (problem) return problem;
  // Only the first part is the platform's: `products/x` would be under a working page's address.
  const first = slug.split("/")[0];
  if (reserved.includes(first)) {
    return reserved === RESERVED_PAGE_SLUGS
      ? `The address /${first} is used by Kaizen itself. Choose another.`
      : reserved === RESERVED_ARTICLE_SLUGS
        ? `The address blog/${first} is used by the blog itself. Choose another.`
        : `The address ${first} is used by the store itself. Choose another.`;
  }
  return null;
}

/** The address suggested from a title: "Om oss & priser" becomes "om-oss-priser". */
export function pageSlugFromTitle(title: string, reserved: readonly string[] = RESERVED_PAGE_SLUGS): string {
  const slug = slugify(title, PAGE_SLUG_MAX);
  return reserved.includes(slug) ? `${slug}-page` : slug;
}

const itemId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Part of the page could not be read. Reload the page and try again.");

const side = z
  .number()
  .int("Spacing is whole pixels.")
  .min(0, "Spacing cannot be below 0.")
  .max(SPACING_MAX, `Keep spacing at ${SPACING_MAX} pixels or less.`);
const sides = z.object({ top: side, right: side, bottom: side, left: side });
// A margin may be negative, to pull a part over its neighbour (D197).
const marginSide = z
  .number()
  .int("Spacing is whole pixels.")
  .min(-SPACING_MAX, `Keep a margin at -${SPACING_MAX} pixels or more.`)
  .max(SPACING_MAX, `Keep spacing at ${SPACING_MAX} pixels or less.`);
const marginSides = z.object({ top: marginSide, right: marginSide, bottom: marginSide, left: marginSide });
const spacing = z.object({ margin: marginSides.optional(), padding: sides.optional() }).optional();

/** Ids the site's own layout uses, which a part of a page cannot take. */
export const RESERVED_HTML_IDS: readonly string[] = ["main"];
export const HTML_ID_MAX = 64;
export const CLASS_NAMES_MAX = 20;

/** Why an id cannot be used, or null. */
export function htmlIdProblem(value: string): string | null {
  if (value.length > HTML_ID_MAX) return `Keep an id under ${HTML_ID_MAX} characters.`;
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
    return "An id starts with a letter, followed by letters, digits, hyphens or underscores, without spaces.";
  }
  if (RESERVED_HTML_IDS.includes(value)) return `The id "${value}" is used by the site itself. Choose another.`;
  return null;
}

/** Why a list of classes cannot be used, or null. */
export function classNameProblem(value: string): string | null {
  const names = value.trim().split(/\s+/).filter(Boolean);
  if (names.length > CLASS_NAMES_MAX) return `Use at most ${CLASS_NAMES_MAX} classes.`;
  if (names.some((name) => name.length > 64 || /["'<>`\\]/.test(name))) {
    return "A class is up to 64 characters, without quotes, backslashes or angle brackets.";
  }
  return null;
}

/** Empty text is the same as none. */
const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.");

const borderWidth = z
  .number()
  .int("A border is whole pixels.")
  .min(0, "A border cannot be below 0.")
  .max(BORDER_MAX, `Keep a border at ${BORDER_MAX} pixels or less.`);

const borderSchema = z
  .object({
    width: z.object({ top: borderWidth, right: borderWidth, bottom: borderWidth, left: borderWidth }),
    color,
    style: z.enum(Object.keys(BORDER_STYLES) as [BorderStyle, ...BorderStyle[]]),
  })
  .optional();
const radiusSchema = z
  .number()
  .int("Rounded corners are whole pixels.")
  .min(0)
  .max(RADIUS_MAX, `Keep rounded corners at ${RADIUS_MAX} pixels or less.`)
  .optional();
const shadowSchema = z.enum(Object.keys(SHADOWS) as [Shadow, ...Shadow[]]).optional();
const colorBackground = z.object({ type: z.literal("color"), color, opacity: z.number().int().min(0).max(99).optional() });
/** How much what is behind a part is blurred (D86), with no background or a colour. */
const backdropBlur = z.number().int().min(1).max(BACKDROP_BLUR_MAX).optional();
const textAlign = z.enum(["left", "center", "right"]).optional();
const pictureWidth = z
  .number()
  .int("A picture's width is whole pixels.")
  .min(IMAGE_WIDTH_MIN, `Make a picture at least ${IMAGE_WIDTH_MIN} pixels wide.`)
  .max(IMAGE_WIDTH_MAX, `Keep a picture at most ${IMAGE_WIDTH_MAX} pixels wide.`)
  .optional();
const gridColumnCount = z.number().int().min(1, "A grid has at least one column.").max(GRID_COLUMNS_MAX.desktop, `A grid has at most ${GRID_COLUMNS_MAX.desktop} columns.`);
/** Pixels between a row's columns or a grid's tiles. */
const partGap = z.number().int().min(0).max(GRID_GAP_MAX, `Keep the space at ${GRID_GAP_MAX} pixels or less.`).optional();

/** A column's share of its row and its place among the others (D179); dragging its edge in the canvas gives shares of 100. */
const columnShare = z.number().int().min(0).max(COLUMN_SHARE_MAX, `A column's share is 0 to ${COLUMN_SHARE_MAX}.`).optional();
/** A row's height in per cent of the screen's (`PageRow.height`). */
const rowHeightVh = z.number().int("A height is whole per cents.").min(ROW_HEIGHT_VH.min, `Make a row at least ${ROW_HEIGHT_VH.min}% of the screen high.`).max(ROW_HEIGHT_VH.max, `Keep a row at most ${ROW_HEIGHT_VH.max}% of the screen high.`);
/** How wide a row's content may be (`PageRow.contentMax`), in pixels. */
const contentMaxWidth = z
  .number()
  .int("A width is whole pixels.")
  .min(CONTENT_MAX_MIN, `Make the content at least ${CONTENT_MAX_MIN} pixels wide.`)
  .max(CONTENT_MAX_MAX, `Keep the content at most ${CONTENT_MAX_MAX} pixels wide.`);
const columnOrder = z.number().int().min(-12).max(12, "A column's place is -12 to 12.").optional();

/** What a part may set at a smaller size (D179): the same rules as its own settings, each optional. */
const sizeSettings = z.object({
  style: spacing,
  // `null`: none at this size, though a larger size has one (D179 phase 2).
  border: borderSchema.or(z.null()),
  radius: radiusSchema,
  shadow: shadowSchema.or(z.null()),
  background: colorBackground.nullable().optional(),
  backdropBlur: backdropBlur.or(z.null()),
  stack: z.boolean().optional(),
  reverse: z.boolean().optional(),
  gap: partGap,
  width: columnShare,
  order: columnOrder,
  align: textAlign,
  maxWidth: pictureWidth.or(z.null()),
  contentMax: contentMaxWidth.or(z.null()).optional(),
  height: rowHeightVh.or(z.null()).optional(),
  columns: gridColumnCount.optional(),
  display: z.enum(["grid", "carousel"]).optional(),
  typography: typographyAtSchema,
});
/** A part's overrides by size, with sizes that set nothing left out. */
const sizeOverrides = z
  .object({ lg: sizeSettings.optional(), md: sizeSettings.optional(), sm: sizeSettings.optional() })
  .optional()
  .transform((at) => {
    if (!at) return undefined;
    const kept = Object.fromEntries(
      Object.entries(at).flatMap(([size, settings]) => {
        const own = settings ? Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined)) : {};
        return Object.keys(own).length > 0 ? [[size, own]] : [];
      }),
    ) as SizeOverrides;
    return Object.keys(kept).length > 0 ? kept : undefined;
  });
const visibility = z
  .object({ hideAt: z.array(z.enum(SIZES)).max(SIZES.length).optional(), show: showSchema.optional() })
  .optional()
  .transform((value): Visibility | undefined => {
    const hideAt = SIZES.filter((size) => value?.hideAt?.includes(size));
    // Always is what nothing set means (D179 phase 4), so it is not stored.
    const show = value?.show === "always" ? undefined : value?.show;
    const kept: Visibility = { ...(hideAt.length > 0 && { hideAt }), ...(show !== undefined && { show }) };
    return Object.keys(kept).length > 0 ? kept : undefined;
  });

/**
 * What the theme says for a kind of element (`ThemeSettings.elements`, `src/lib/theme-elements.ts`): the settings of a part
 * that make sense for every row, heading, paragraph, list or button of a store, each at the sizes a part can set them at.
 */
export type ThemeElement = {
  style?: Spacing;
  border?: Border;
  radius?: number;
  shadow?: Shadow;
  /** A row's colour behind it. */
  background?: ColorBackground;
  /** A row's width (D190): the content's (the default) or the whole screen's, as `PageRow.width`; a row's own choice wins. */
  width?: "content" | "full";
  /** In a full-width row, whether what is in it spreads too (D190), as `PageRow.contentWidth`; a row's own choice wins. */
  contentWidth?: "content" | "full";
  at?: SizeOverrides;
  typography?: TypographyGroups;
};

/** Settings left out are none; an element with nothing set is left out. */
export const themeElementSchema = z
  .object({
    style: spacing,
    border: borderSchema,
    radius: radiusSchema,
    shadow: shadowSchema,
    background: colorBackground.optional(),
    width: z.enum(["content", "full"]).optional(),
    contentWidth: z.enum(["content", "full"]).optional(),
    at: sizeOverrides,
    typography: typographyGroupsSchema,
  })
  .transform((value) => {
    const kept = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as ThemeElement;
    return Object.keys(kept).length > 0 ? kept : undefined;
  });

const partBase = {
  motion: partMotionSchema,
  style: spacing,
  border: borderSchema,
  radius: radiusSchema,
  shadow: shadowSchema,
  at: sizeOverrides,
  visibility,
  typography: typographyGroupsSchema,
  global: z.uuid().optional(),
  local: z.literal(true).optional(),
  htmlId: optionalText(
    z
      .string()
      .trim()
      .superRefine((value, ctx) => {
        const problem = htmlIdProblem(value);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      }),
  ),
  className: optionalText(
    z
      .string()
      .superRefine((value, ctx) => {
        const problem = classNameProblem(value);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      })
      .transform((value) => value.trim().split(/\s+/).join(" ")),
  ),
};

const picture = z.object({
  url: z.url({ protocol: /^https?$/, error: "A background picture has an invalid address." }).max(1000),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});
const overlay = z.object({ color, opacity: z.number().int().min(0).max(100) }).nullable();
const blur = z.number().int().min(1).max(BLUR_MAX).optional();
const imageBackground = z.object({ type: z.literal("image"), image: picture, overlay, blur });
const gradientBackground = z.object({
  type: z.literal("gradient"),
  style: z.enum(Object.keys(GRADIENT_STYLES) as [GradientStyle, ...GradientStyle[]]),
  colors: z.array(color).min(GRADIENT_COLORS_MIN).max(GRADIENT_COLORS_MAX),
  angle: z.number().int().min(0).max(360).optional(),
  flow: z.enum(Object.keys(GRADIENT_FLOWS) as [GradientFlow, ...GradientFlow[]]).optional(),
  grain: z.boolean().optional(),
  opacity: z.number().int().min(0).max(99).optional(),
  overlay: overlay.optional(),
});
const videoBackground = z.object({
  type: z.literal("video"),
  video: z.object({ url: z.url({ protocol: /^https?$/, error: "A background video has an invalid address." }).max(1000) }),
  poster: picture.nullable(),
  overlay,
  blur,
});

/** A column's background: a colour or a picture; only rows take a video. */
const background = z
  .discriminatedUnion("type", [colorBackground, imageBackground, gradientBackground], {
    error: (issue) =>
      (issue.input as { type?: unknown } | undefined)?.type === "video" ? "Only rows can have a background video." : undefined,
  })
  .optional();
const rowBackground = z.discriminatedUnion("type", [colorBackground, imageBackground, gradientBackground, videoBackground]).optional();


/** A custom field's id, as the store's field groups make them (`newFieldId()`). */
const FIELD_ID = /^f_[a-z0-9]{6,24}$/;
const fieldIdRule = z.string().regex(FIELD_ID, "A custom field component names an unknown field.");

/** A block taking its content from a custom field (D118); only the blocks that can take one have it. */
const bindRule = z
  .object({
    fieldId: z.string().regex(FIELD_ID, "A block takes its content from an unknown field."),
    fallback: z.boolean().optional(),
    source: z.literal("store").optional(),
  })
  .optional();

const richTextBlock = z.object({
  id: itemId,
  type: z.literal("richText"),
  doc: z.unknown().transform((value, ctx) => {
    const cleaned = cleanRichText(value);
    if (cleaned.ok) return cleaned.doc;
    ctx.addIssue({ code: "custom", message: cleaned.problem });
    return z.NEVER;
  }),
  bind: bindRule,
  ...partBase,
});

const imageBlock = z.object({
  id: itemId,
  type: z.literal("image"),
  image: z
    .object({
      url: z.url({ protocol: /^https?$/, error: "A picture has an invalid address." }).max(1000),
      width: z.number().int().min(1).max(10_000),
      height: z.number().int().min(1).max(10_000),
      alt: z.string().trim().max(ALT_MAX, `Keep a picture's description under ${ALT_MAX} characters.`),
    })
    .nullable(),
  caption: z.string().trim().max(ALT_MAX, `Keep a caption under ${ALT_MAX} characters.`).default(""),
  href: z
    .string()
    .trim()
    .max(2000)
    .refine((href) => href === "" || isLinkAddress(href), "A picture's link must be https://…, a page like /about, an anchor like #contact, mailto: or tel:.")
    .optional(),
  newTab: z.boolean().optional(),
  shape: z.enum(Object.keys(IMAGE_SHAPES) as [ImageShape, ...ImageShape[]]).optional(),
  maxWidth: pictureWidth,
  align: textAlign,
  bind: bindRule,
  ...partBase,
});

const headingBlock = z.object({
  id: itemId,
  type: z.literal("heading"),
  text: z.string().trim().max(HEADING_MAX, `Keep a heading under ${HEADING_MAX} characters.`),
  level: z.literal([1, 2, 3, 4, 5, 6], "A heading has an unknown level."),
  bind: bindRule,
  ...partBase,
});

const buttonBlock = z.object({
  id: itemId,
  type: z.literal("button"),
  label: z.string().trim().max(BUTTON_LABEL_MAX, `Keep a button's text under ${BUTTON_LABEL_MAX} characters.`),
  href: z
    .string()
    .trim()
    .refine((href) => href === "" || isLinkAddress(href), "A button's address must be https://…, a page like /about, an anchor like #contact, mailto: or tel:."),
  newTab: z.boolean().optional(),
  variant: z.enum(Object.keys(BUTTON_VARIANTS) as [ButtonVariant, ...ButtonVariant[]]).optional(),
  size: z.enum(Object.keys(BUTTON_SIZES) as [ButtonSize, ...ButtonSize[]]).optional(),
  shape: z.enum(Object.keys(BUTTON_SHAPES) as [ButtonShape, ...ButtonShape[]]).optional(),
  fullWidth: z.boolean().optional(),
  align: textAlign,
  fill: color.optional(),
  bind: bindRule,
  ...partBase,
});

/** A custom item's text: trimmed, at most `max` characters. */
const customText = (what: string, max: number) => z.string().trim().max(max, `Keep ${what} under ${max} characters.`).default("");

/** A custom grid item (D155): checked here and again where it is drawn. A link is the menu link's shape; a web address passes `isSafeAddress()`. */
export const customGridItemSchema = z.object({
  id: itemId,
  title: customText("an item's title", CUSTOM_TITLE_MAX),
  text: customText("an item's text", CUSTOM_TEXT_MAX),
  picture: z
    .object({
      // The library's or the site's own (`custom-picture.ts`): another site's would be fetched by every visitor's browser, with no consent.
      url: z
        .string()
        .max(1000, "An item's picture has an invalid address.")
        .superRefine((url, ctx) => {
          const problem = customPictureProblem(url);
          if (problem) ctx.addIssue({ code: "custom", message: problem });
        }),
      width: z.number().int().min(1).max(10_000),
      height: z.number().int().min(1).max(10_000),
      alt: z.string().trim().max(CUSTOM_ALT_MAX, `Keep a picture's description under ${CUSTOM_ALT_MAX} characters.`),
    })
    .nullable()
    .default(null),
  link: menuLinkSchema
    .refine((link) => link.kind !== "url" || isSafeAddress(link.url), "An item's link has an unsafe address.")
    .nullable()
    .default(null),
  buttonLabel: customText("an item's button text", CUSTOM_BUTTON_MAX),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "An item's date is written year-month-day.")
    .refine((day) => !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day), "An item's date is not a real day.")
    .nullable()
    .default(null),
  badge: customText("an item's badge", CUSTOM_BADGE_MAX),
  priceText: customText("an item's price text", CUSTOM_PRICE_TEXT_MAX),
  details: z
    .array(
      z.object({
        id: itemId,
        label: customText("a detail's label", CUSTOM_DETAIL_LABEL_MAX),
        text: customText("a detail's text", CUSTOM_DETAIL_TEXT_MAX),
      }),
    )
    .max(TILE_FIELDS_MAX, `An item shows at most ${TILE_FIELDS_MAX} detail lines.`)
    .refine((lines) => new Set(lines.map((line) => line.id)).size === lines.length, "Two detail lines have the same id. Reload the page and try again.")
    .default([]),
});

const contentGridBlock = z
  .object({
  id: itemId,
  type: z.literal("contentGrid"),
  source: z.discriminatedUnion(
    "type",
    [
      z.object({
        type: z.literal("pages"),
        parent: z
          .union([z.literal("@this"), z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/).max(240)], {
            error: "Choose the parent page whose pages the grid shows.",
          })
          .optional(),
      }),
      z.object({ type: z.literal("articles") }),
      z.object({ type: z.literal("custom") }),
      z.object({
        type: z.literal("products"),
        storeId: z.uuid("Choose the store whose products the grid shows.").optional(),
        market: z.string().regex(/^[A-Z]{2}$/, "Choose the market whose prices the grid shows.").optional(),
        recommend: z
          .object({
            mix: z.object({ upsell: z.boolean(), crossSell: z.boolean(), complement: z.boolean() }),
            explain: z.boolean(),
          })
          .optional(),
      }),
    ],
    "A content grid shows an unknown kind of content.",
  ),
  ...termIdsSchema.shape,
  sort: z.enum(Object.keys(GRID_SORTS) as [GridSort, ...GridSort[]]).default("newest"),
  // A grid of custom items may show as many as it can hold; one that looks its items up, `GRID_LIMIT_MAX` (checked below).
  limit: z.number().int().min(1, "A grid shows at least one item.").max(CUSTOM_ITEMS_MAX, `A grid shows at most ${GRID_LIMIT_MAX} items.`),
  columns: gridColumnCount,
  show: z.object({
    image: z.boolean(),
    heading: z.boolean(),
    excerpt: z.boolean(),
    price: z.boolean(),
    button: z.boolean(),
  }),
  buttonLabel: z.string().trim().max(BUTTON_LABEL_MAX, `Keep the button's text under ${BUTTON_LABEL_MAX} characters.`).default(""),
  emptyText: z.string().trim().max(300, "Keep the text for an empty grid under 300 characters.").default(""),
  filters: z.boolean().optional(),
  display: z.literal("carousel", "A content grid is shown in an unknown way.").optional(),
  peek: z.boolean().optional(),
  carousel: carouselSettingsSchema.optional(),
  imageShape: z.enum(["original", "theme", ...(Object.keys(IMAGE_SHAPES) as ImageShape[])]).optional(),
  headingLevel: z.literal([2, 3, 4, 5, 6], "A tile's heading has an unknown level."),
  excerptLines: z.number().int().min(1).max(6),
  tileFields: z
    .array(z.string().regex(FIELD_ID, "A grid's tile names an unknown field."))
    .max(TILE_FIELDS_MAX, `A tile shows at most ${TILE_FIELDS_MAX} fields.`)
    .optional(),
  button: z
    .object({
      variant: buttonBlock.shape.variant,
      size: buttonBlock.shape.size,
      shape: buttonBlock.shape.shape,
      fill: color.optional(),
    })
    .optional(),
  tile: z
    .object({
      background: color.optional(),
      color: color.optional(),
      padding: z.number().int().min(0).max(SPACING_MAX).optional(),
      contentPadding: z.union([z.number().int().min(0).max(SPACING_MAX), z.object({ top: side, right: side, bottom: side, left: side })]).optional(),
      border: partBase.border,
      radius: partBase.radius,
      shadow: partBase.shadow,
    })
    .optional(),
  gap: z.number().int().min(0).max(GRID_GAP_MAX, `Keep the space between tiles at ${GRID_GAP_MAX} pixels or less.`),
  items: z
    .array(customGridItemSchema)
    .max(CUSTOM_ITEMS_MAX, `A grid holds at most ${CUSTOM_ITEMS_MAX} custom items.`)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Two items have the same id. Reload the page and try again.")
    .optional(),
  ...partBase,
  })
  .superRefine((block, ctx) => {
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
    if (block.source.type === "custom") {
      // The owner's order and all of it: nothing to choose or sort (D155), and filters are for products.
      if (block.categories.length > 0 || block.tags.length > 0) issue("A grid of custom items has no categories or tags.", ["categories"]);
      if (block.filters) issue("Filters are for grids of products.", ["filters"]);
      if (block.tileFields && block.tileFields.length > 0) issue("A grid of custom items has no custom fields on its tiles.", ["tileFields"]);
    } else {
      if (block.items && block.items.length > 0) issue("Custom items belong to a grid of custom items.", ["items"]);
      if (block.limit > GRID_LIMIT_MAX) issue(`A grid shows at most ${GRID_LIMIT_MAX} items.`, ["limit"]);
    }
  });

const fieldDisplay = z.enum(Object.keys(FIELD_DISPLAYS) as [FieldDisplay, ...FieldDisplay[]]);

/** A field loop's layout, columns, slots and link (D120): the slots name sub fields by id. */
const loopSettings = z.object({
  layout: z.enum(Object.keys(LOOP_LAYOUTS) as [LoopLayout, ...LoopLayout[]]).optional(),
  columns: z.literal([...LOOP_COLUMNS]).optional(),
  slots: z
    .object({
      image: z.string().regex(FIELD_ID).optional(),
      title: z.string().regex(FIELD_ID).optional(),
      text: z.string().regex(FIELD_ID).optional(),
      link: z.string().regex(FIELD_ID).optional(),
      badge: z.string().regex(FIELD_ID).optional(),
    })
    .optional(),
  linkWholeCard: z.boolean().optional(),
});

const productBlock = z.object({
  id: itemId,
  type: z.literal("product"),
  part: z.enum(Object.keys(PRODUCT_PARTS) as [ProductPart, ...ProductPart[]], "A product component shows an unknown part."),
  wishlist: z.boolean().optional(),
  large: z.boolean().optional(),
  thumbnails: z.boolean().optional(),
  showHeading: z.boolean().optional(),
  heading: z.string().trim().max(HEADING_MAX, `Keep a heading under ${HEADING_MAX} characters.`).optional(),
  limit: z.number().int().min(1, "Show at least one related product.").max(RELATED_MAX, `Show at most ${RELATED_MAX} related products.`).optional(),
  columns: gridColumnCount.optional(),
  groupId: z.uuid().optional(),
  fieldId: fieldIdRule.optional(),
  display: fieldDisplay.optional(),
  showLabel: z.boolean().optional(),
  source: z.literal("store").optional(),
  loop: loopSettings.optional(),
  ...partBase,
});

const siteBlock = z.object({
  id: itemId,
  type: z.literal("site"),
  part: z.enum(Object.keys(SITE_PARTS) as [SitePart, ...SitePart[]], "A site component shows an unknown part."),
  align: textAlign,
  height: z
    .number()
    .int()
    .min(LOGO_HEIGHT.min, `Make the logo at least ${LOGO_HEIGHT.min} pixels tall.`)
    .max(LOGO_HEIGHT.max, `Keep the logo at most ${LOGO_HEIGHT.max} pixels tall.`)
    .optional(),
  direction: z.enum(["row", "column"]).optional(),
  display: z.enum(["dropdown", "list"]).optional(),
  ...partBase,
});

const menuBlock = z.object({
  id: itemId,
  type: z.literal("menu"),
  menuId: z.uuid("Choose a menu for each menu component.").optional(),
  direction: z.enum(["row", "column"]).optional(),
  align: textAlign,
  ...partBase,
});

const searchBlock = z.object({
  id: itemId,
  type: z.literal("search"),
  results: z.boolean().optional(),
  ...partBase,
});

const plansBlock = z.object({
  id: itemId,
  type: z.literal("plans"),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Choose a currency such as NOK or EUR.").optional(),
  interval: z.enum(["month", "year"]).optional(),
  highlightId: z.uuid().optional(),
  comparison: z.boolean().optional(),
  buttonLabel: z.string().trim().max(BUTTON_LABEL_MAX, `Keep the button's text under ${BUTTON_LABEL_MAX} characters.`).default(""),
  buttonHref: z
    .string()
    .trim()
    .refine((href) => href === "" || isLinkAddress(href), "A button's address must be https://…, a page like /about, an anchor like #contact, mailto: or tel:.")
    .default(""),
  ...partBase,
});

const customFieldBlock = z.object({
  id: itemId,
  type: z.literal("customField"),
  groupId: z.uuid().optional(),
  fieldId: fieldIdRule.optional(),
  display: fieldDisplay.optional(),
  showLabel: z.boolean().optional(),
  showHeading: z.boolean().optional(),
  heading: z.string().trim().max(HEADING_MAX, `Keep a heading under ${HEADING_MAX} characters.`).optional(),
  source: z.literal("store").optional(),
  ...partBase,
});

const fieldLoopBlock = z.object({
  id: itemId,
  type: z.literal("fieldLoop"),
  groupId: z.uuid().optional(),
  fieldId: fieldIdRule.optional(),
  ...loopSettings.shape,
  showHeading: z.boolean().optional(),
  heading: z.string().trim().max(HEADING_MAX, `Keep a heading under ${HEADING_MAX} characters.`).optional(),
  ...partBase,
});

const storePartBlock = z.object({
  id: itemId,
  type: z.literal("storePart"),
  part: z.enum(SHOP_PART_KEYS as [ShopPart, ...ShopPart[]]),
  ...partBase,
});

const separatorBlock = z.object({
  id: itemId,
  type: z.literal("separator"),
  line: z.enum(Object.keys(SEPARATOR_LINES) as [SeparatorLine, ...SeparatorLine[]]).optional(),
  thickness: z
    .number()
    .int()
    .min(1)
    .max(SEPARATOR_THICKNESS_MAX, `Keep a line at most ${SEPARATOR_THICKNESS_MAX} pixels thick.`)
    .optional(),
  color: color.optional(),
  width: z.number().int().min(10, "Make a line at least 10 % of its column.").max(100).optional(),
  position: z.enum(Object.keys(SEPARATOR_POSITIONS) as [SeparatorPosition, ...SeparatorPosition[]]).optional(),
  ...partBase,
});

const dualButtonSide = z.object({
  label: buttonBlock.shape.label,
  href: buttonBlock.shape.href,
  newTab: z.boolean().optional(),
  variant: buttonBlock.shape.variant,
  fill: color.optional(),
});

const dualButtonBlock = z.object({
  id: itemId,
  type: z.literal("dualButton"),
  first: dualButtonSide,
  second: dualButtonSide,
  size: buttonBlock.shape.size,
  shape: buttonBlock.shape.shape,
  gap: z.number().int().min(0).max(DUAL_GAP_MAX, `Keep the space between the buttons at ${DUAL_GAP_MAX} pixels or less.`).optional(),
  stack: z.boolean().optional(),
  align: textAlign,
  ...partBase,
});

const panelItems = z
  .array(
    z.object({
      id: itemId,
      title: z.string().trim().max(ITEM_TITLE_MAX, `Keep a title under ${ITEM_TITLE_MAX} characters.`),
      body: richTextBlock.shape.doc,
    }),
  )
  .max(ITEMS_MAX, `A component holds at most ${ITEMS_MAX} items.`)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Two items have the same id. Reload the page and try again.");

const accordionBlock = z.object({
  id: itemId,
  type: z.literal("accordion"),
  items: panelItems,
  openFirst: z.boolean().optional(),
  single: z.boolean().optional(),
  look: z.enum(Object.keys(ACCORDION_LOOKS) as [AccordionLook, ...AccordionLook[]]).optional(),
  ...partBase,
});

const tabsBlock = z.object({
  id: itemId,
  type: z.literal("tabs"),
  items: panelItems,
  look: z.enum(Object.keys(TABS_LOOKS) as [TabsLook, ...TabsLook[]]).optional(),
  tabsAlign: z.enum(Object.keys(TABS_ALIGNS) as [TabsAlign, ...TabsAlign[]]).optional(),
  ...partBase,
});

const faqBlock = z.object({
  id: itemId,
  type: z.literal("faq"),
  items: panelItems,
  openFirst: z.boolean().optional(),
  single: z.boolean().optional(),
  look: accordionBlock.shape.look,
  structuredData: z.boolean().optional(),
  ...partBase,
});

const videoBlock = z
  .object({
    id: itemId,
    type: z.literal("video"),
    source: z.enum(Object.keys(VIDEO_SOURCES) as [VideoSource, ...VideoSource[]], "A video comes from an unknown place."),
    video: z.object({ url: z.url({ protocol: /^https?$/, error: "A video has an invalid address." }).max(1000) }).nullable(),
    link: z.string().trim().max(500).default(""),
    poster: z
      .object({
        url: z.url({ protocol: /^https?$/, error: "A video's picture has an invalid address." }).max(1000),
        width: z.number().int().min(1).max(10_000),
        height: z.number().int().min(1).max(10_000),
      })
      .nullable(),
    title: z.string().trim().max(VIDEO_TITLE_MAX, `Keep a video's title under ${VIDEO_TITLE_MAX} characters.`).default(""),
    ratio: z.enum(Object.keys(VIDEO_RATIOS) as [VideoRatio, ...VideoRatio[]]).optional(),
    controls: z.boolean().optional(),
    autoplay: z.boolean().optional(),
    loop: z.boolean().optional(),
    ...partBase,
  })
  .refine((block) => block.source === "upload" || block.link === "" || embedUrl(block.source, block.link) !== null, {
    message: "Use the address of a video on YouTube or Vimeo, as its Share button gives it.",
    path: ["link"],
  });

const htmlBlock = z.object({
  id: itemId,
  type: z.literal("html"),
  html: z.string().max(HTML_MAX, `Keep the HTML under ${HTML_MAX.toLocaleString("en")} characters.`),
  title: z.string().trim().max(200, "Keep the HTML's title under 200 characters.").default(""),
  height: z.number().int().min(20, "Make the HTML at least 20 pixels tall.").max(HTML_HEIGHT_MAX, `Make the HTML at most ${HTML_HEIGHT_MAX} pixels tall.`).optional(),
  waitForClick: z.boolean().optional(),
  ...partBase,
});

const testimonialsBlock = z.object({
  id: itemId,
  type: z.literal("testimonials"),
  source: z.literal("google", "Testimonials come from an unknown place.").optional(),
  minRating: z.number().int().min(1).max(5, "Show reviews with 1 to 5 stars.").optional(),
  limit: z.number().int().min(1, "Show 1 to 5 reviews.").max(5, "Show 1 to 5 reviews.").optional(),
  items: z
    .array(
      z.object({
        id: itemId,
        quote: z.string().trim().max(TESTIMONIAL_QUOTE_MAX, `Keep a testimonial under ${TESTIMONIAL_QUOTE_MAX} characters.`),
        name: z.string().trim().max(TESTIMONIAL_NAME_MAX, `Keep a name under ${TESTIMONIAL_NAME_MAX} characters.`),
        role: z.string().trim().max(TESTIMONIAL_NAME_MAX, `Keep a title or place under ${TESTIMONIAL_NAME_MAX} characters.`),
        rating: z.number().int().min(1, "Give from 1 to 5 stars.").max(5, "Give from 1 to 5 stars.").optional(),
        picture: z
          .object({
            url: z.url({ protocol: /^https?$/, error: "A testimonial's picture has an invalid address." }).max(1000),
            width: z.number().int().min(1).max(10_000),
            height: z.number().int().min(1).max(10_000),
          })
          .nullable(),
      }),
    )
    .max(ITEMS_MAX, `A component holds at most ${ITEMS_MAX} items.`)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Two items have the same id. Reload the page and try again."),
  columns: z
    .number()
    .int()
    .refine((value) => (TESTIMONIAL_COLUMNS as readonly number[]).includes(value), "Show testimonials in 1 to 4 columns.")
    .transform((value) => value as TestimonialColumns)
    .optional(),
  look: z.enum(Object.keys(TESTIMONIAL_LOOKS) as [TestimonialLook, ...TestimonialLook[]]).optional(),
  showRating: z.boolean().optional(),
  display: z.literal("carousel", "Testimonials are shown in an unknown way.").optional(),
  carousel: carouselSettingsSchema.optional(),
  ...partBase,
});

const socialLinksBlock = z.object({
  id: itemId,
  type: z.literal("socialLinks"),
  links: z
    .array(
      z
        .object({
          id: itemId,
          network: z.enum(Object.keys(SOCIAL_NETWORKS) as [SocialNetwork, ...SocialNetwork[]], "Choose a network for each link."),
          href: z.string().trim().max(500, "Keep an address under 500 characters."),
        })
        .refine((link) => link.href === "" || socialHref(link.network, link.href) !== null, {
          message: "A link has an address that is not one. Use the profile's web address, or an email address or phone number for those.",
          path: ["href"],
        }),
    )
    .max(ITEMS_MAX, `A component holds at most ${ITEMS_MAX} items.`)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Two items have the same id. Reload the page and try again."),
  look: z.enum(Object.keys(SOCIAL_LOOKS) as [SocialLook, ...SocialLook[]]).optional(),
  shape: z.enum(Object.keys(SOCIAL_SHAPES) as [SocialShape, ...SocialShape[]]).optional(),
  colors: z.enum(Object.keys(SOCIAL_COLORS) as [SocialColors, ...SocialColors[]]).optional(),
  color: color.optional(),
  size: z.enum(Object.keys(BUTTON_SIZES) as [ButtonSize, ...ButtonSize[]]).optional(),
  gap: z.number().int().min(0).max(SOCIAL_GAP_MAX).optional(),
  position: z.enum(Object.keys(SEPARATOR_POSITIONS) as [SeparatorPosition, ...SeparatorPosition[]]).optional(),
  showNames: z.boolean().optional(),
  ...partBase,
});

const iconListBlock = z.object({
  id: itemId,
  type: z.literal("iconList"),
  items: z
    .array(
      z.object({
        id: itemId,
        icon: z.enum(Object.keys(ICONS) as [IconName, ...IconName[]], "Choose an icon for each line."),
        text: z.string().trim().max(ICON_LIST_TEXT_MAX, `Keep a line under ${ICON_LIST_TEXT_MAX} characters.`),
        href: z
          .string()
          .trim()
          .refine((href) => href === "" || isLinkAddress(href), "A line's address must be https://…, a page like /about, an anchor like #contact, mailto: or tel:.")
          .default(""),
      }),
    )
    .max(ITEMS_MAX, `A component holds at most ${ITEMS_MAX} items.`)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Two items have the same id. Reload the page and try again."),
  layout: z.enum(Object.keys(ICON_LIST_LAYOUTS) as [IconListLayout, ...IconListLayout[]]).optional(),
  iconColor: color.optional(),
  iconGradient: textGradientSchema.optional(),
  iconSize: z.enum(Object.keys(BUTTON_SIZES) as [ButtonSize, ...ButtonSize[]]).optional(),
  gap: z.number().int().min(0).max(SOCIAL_GAP_MAX).optional(),
  position: z.enum(Object.keys(SEPARATOR_POSITIONS) as [SeparatorPosition, ...SeparatorPosition[]]).optional(),
  ...partBase,
});

const tableColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.").transform((v) => v.toLowerCase()).optional();

const tableBlock = z.object({
  id: itemId,
  type: z.literal("table"),
  rows: z
    .array(z.array(z.string().max(TABLE_CELL_MAX, `Keep a cell under ${TABLE_CELL_MAX} characters.`)).min(1, "A table needs at least one column.").max(TABLE_COLUMNS_MAX, `A table has at most ${TABLE_COLUMNS_MAX} columns.`))
    .min(1, "A table needs at least one row.")
    .max(TABLE_ROWS_MAX, `A table has at most ${TABLE_ROWS_MAX} rows.`)
    .refine((rows) => rows.every((row) => row.length === rows[0].length), "Every row of a table needs the same number of cells."),
  header: z.boolean().optional(),
  rowHeaders: z.boolean().optional(),
  striped: z.boolean().optional(),
  caption: z.string().trim().max(200, "Keep a table's title under 200 characters.").optional(),
  mobile: z.enum(Object.keys(TABLE_MOBILE) as [TableMobile, ...TableMobile[]]).optional(),
  headerColor: tableColour,
  headerBackground: tableColour,
  stripeColor: tableColour,
  stripeBackground: tableColour,
  sectionColor: tableColour,
  sectionBackground: tableColour,
  sections: z.array(z.string().trim().max(200, "Keep a section title under 200 characters.").nullable()).max(TABLE_ROWS_MAX).optional(),
  ...partBase,
});

const formText = (what: string, max = FORM_TEXT_MAX) => z.string().trim().max(max, `Keep ${what} under ${max} characters.`);

const recipients = z
  .array(z.email("A form sends to an address that is not an email address.").trim().toLowerCase().max(254))
  .max(FORM_RECIPIENTS_MAX, `A form sends to at most ${FORM_RECIPIENTS_MAX} addresses.`)
  .refine((list) => new Set(list).size === list.length, "A form sends to the same address twice.");

const formButton = z
  .object({
    variant: buttonBlock.shape.variant,
    size: buttonBlock.shape.size,
    shape: buttonBlock.shape.shape,
    fill: color.optional(),
    fullWidth: z.boolean().optional(),
  })
  .optional();

const emailFormBlock = z.object({
  id: itemId,
  type: z.literal("emailForm"),
  recipients,
  subject: formText("a form's subject", FORM_LABEL_MAX).default(""),
  fields: z
    .array(
      z
        .object({
          id: itemId,
          kind: z.enum(Object.keys(FORM_FIELD_KINDS) as [FormFieldKind, ...FormFieldKind[]], "A question is of an unknown kind."),
          label: formText("a question", FORM_LABEL_MAX),
          required: z.boolean().optional(),
          placeholder: formText("a hint", FORM_LABEL_MAX).optional(),
          options: z
            .array(formText("a choice", FORM_LABEL_MAX).min(1, "A choice needs its words."))
            .max(FORM_OPTIONS_MAX, `A question offers at most ${FORM_OPTIONS_MAX} choices.`)
            .optional(),
        })
        .refine((field) => field.kind !== "select" || (field.options?.length ?? 0) > 0, {
          message: "A choice from a list needs at least one choice.",
          path: ["options"],
        })
        .refine((field) => !LABELLED_KINDS.includes(field.kind) || field.label !== "", {
          message: "A question needs its words.",
          path: ["label"],
        }),
    )
    .max(FORM_FIELDS_MAX, `A form asks at most ${FORM_FIELDS_MAX} questions.`)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Two questions have the same id. Reload the page and try again."),
  submitLabel: formText("a button's text", BUTTON_LABEL_MAX).default(""),
  successMessage: formText("the thank-you message").default(""),
  consent: formText("the tick box's words").optional(),
  button: formButton,
  ...partBase,
});

const newsletterBlock = z.object({
  id: itemId,
  type: z.literal("newsletter"),
  recipients,
  askName: z.boolean().optional(),
  placeholder: formText("a hint", FORM_LABEL_MAX).default(""),
  submitLabel: formText("a button's text", BUTTON_LABEL_MAX).default(""),
  successMessage: formText("the thank-you message").default(""),
  consent: formText("the consent's words").default(""),
  confirm: z.boolean().optional(),
  layout: z.enum(Object.keys(NEWSLETTER_LAYOUTS) as [NewsletterLayout, ...NewsletterLayout[]]).optional(),
  button: formButton,
  ...partBase,
});

/** The kinds of block, each as stored now (D179: `pageBlockSchema` reads older shapes into these). */
export const pageBlockUnion = z.discriminatedUnion("type", [
  richTextBlock,
  imageBlock,
  headingBlock,
  buttonBlock,
  contentGridBlock,
  productBlock,
  siteBlock,
  menuBlock,
  searchBlock,
  plansBlock,
  customFieldBlock,
  fieldLoopBlock,
  storePartBlock,
  separatorBlock,
  dualButtonBlock,
  accordionBlock,
  tabsBlock,
  faqBlock,
  videoBlock,
  htmlBlock,
  testimonialsBlock,
  socialLinksBlock,
  iconListBlock,
  tableBlock,
  emailFormBlock,
  newsletterBlock,
]);

/** One block, as stored: rich text, a picture, a heading, a button, a content grid, a part of a product's page or of the site's header or footer; one saved before D179 is read into the per-size shape. */
export const pageBlockSchema = z.preprocess((value) => foldTypography(upgradeBlock(value)), pageBlockUnion);

/**
 * A grid that no longer shows custom items (the owner chose Pages, Articles or Products after writing some) keeps them in the
 * editor while the page is open, so choosing Custom items again brings them back; saving drops them, as nothing shows them
 * and the schema refuses items on any other source.
 */
export function withoutStrandedItems(block: unknown): unknown {
  if (typeof block !== "object" || block === null) return block;
  const grid = block as { type?: unknown; source?: { type?: unknown }; items?: unknown };
  if (grid.type !== "contentGrid" || grid.items === undefined || grid.source?.type === "custom") return block;
  const { items, ...rest } = grid;
  void items;
  return rest;
}

const dropStrandedItems = (blocks: unknown): unknown => (Array.isArray(blocks) ? blocks.map(withoutStrandedItems) : blocks);

export const pageColumnSchema = z.preprocess(upgradeColumn, z.object({
  id: itemId,
  blocks: z.preprocess(dropStrandedItems, z.array(pageBlockSchema)),
  background,
  backgroundMotion: backgroundMotionSchema,
  backdropBlur,
  link: z
    .object({
      href: z
        .string()
        .trim()
        .refine(isLinkAddress, "A column's link needs an address: https://…, a page like /about, an anchor like #contact, mailto: or tel:."),
      label: z.string().trim().max(200, "Keep a column link's description under 200 characters.").default(""),
    })
    .optional(),
  inline: z.boolean().optional(),
  justify: z.enum(Object.keys(COLUMN_JUSTIFY) as [ColumnJustify, ...ColumnJustify[]]).optional(),
  width: columnShare,
  order: columnOrder,
  ...partBase,
}));

/** A row as stored; one saved before D179 is read into the per-size shape (`upgradeRow()`). */
export const pageRowSchema = z.preprocess(upgradeRow, z
  .object({
    id: itemId,
    type: z.literal("row"),
    layout: z.enum(ROW_LAYOUT_KEYS, "A row has an unknown layout."),
    columns: z.array(pageColumnSchema),
    moreLines: z.array(z.enum(ROW_LAYOUT_KEYS, "A row has an unknown layout.")).min(1).max(ROW_LINES_MAX - 1, `A row has at most ${ROW_LINES_MAX} lines of columns.`).optional(),
    width: z.enum(["content", "full"]).optional(),
    contentWidth: z.enum(["content", "full"]).optional(),
    contentMax: contentMaxWidth.optional(),
    height: rowHeightVh.optional(),
    backgroundFixed: z.boolean().optional(),
    backgroundAlign: z.enum(BACKGROUND_ALIGNS).optional(),
    fullHeight: z.boolean().optional(),
    stack: z.boolean().optional(),
    reverse: z.boolean().optional(),
    gap: partGap,
    equalHeight: z.boolean().optional(),
    align: z.enum(["top", "middle", "bottom"]).optional(),
    background: rowBackground,
    backgroundMotion: backgroundMotionSchema,
    backdropBlur,
    modal: rowModalSchema.optional(),
    ...partBase,
  })
  .refine((r) => r.columns.length === columnsOfLayouts(rowLayouts(r)), {
    message: "A row has the wrong number of columns for its layout. Reload the page and try again.",
  }));

/**
 * Pages saved before rows (a plain list of blocks) read as one row with
 * one column; they are stored as rows the next time they are saved.
 */
function upgradeLegacy(value: unknown): unknown {
  if (typeof value !== "object" || value === null || "rows" in value || !("blocks" in value)) return value;
  const { blocks, ...rest } = value as { blocks: unknown };
  return { ...rest, rows: [{ id: "legacy-row", type: "row", layout: "1", columns: [{ id: "legacy-column", blocks }] }] };
}

/** What the editor sends, with the checks shown to the admin. */
export const pageInput = z.preprocess(
  upgradeLegacy,
  z
    .object({
      title: z
        .string()
        .trim()
        .min(1, "Give the page a title.")
        .max(PAGE_TITLE_MAX, `Keep the title under ${PAGE_TITLE_MAX} characters.`),
      slug: z
        .string()
        .trim()
        // Only the form here: which addresses are taken depends on the owner (`savePage`).
        .superRefine((slug, ctx) => {
          const problem = slugFormatProblem(slug);
          if (problem) ctx.addIssue({ code: "custom", message: problem });
        }),
      thumbnail: z
        .object({
          url: z.url({ protocol: /^https?$/, error: "The picture has an invalid address." }).max(1000),
          width: z.number().int().min(1).max(10_000),
          height: z.number().int().min(1).max(10_000),
          alt: z.string().trim().max(ALT_MAX, `Keep the picture's description under ${ALT_MAX} characters.`),
        })
        .nullable(),
      excerpt: z.string().trim().max(EXCERPT_FIELD_MAX, `Keep the excerpt under ${EXCERPT_FIELD_MAX} characters.`).optional(),
      seo: z.object({
        title: z.string().trim().max(TITLE_MAX, `Keep the search title under ${TITLE_MAX} characters.`),
        description: z
          .string()
          .trim()
          .max(DESCRIPTION_MAX, `Keep the search description under ${DESCRIPTION_MAX} characters.`),
      }),
      searchEngines: z.boolean(),
      aiAssistants: z.boolean(),
      ...termIdsSchema.shape,
      author: z.string().trim().max(AUTHOR_MAX, `Keep the author's name under ${AUTHOR_MAX} characters.`).optional(),
      rows: z.array(pageRowSchema).max(ROWS_MAX, `A page takes at most ${ROWS_MAX} rows.`),
      footerReveal: z.boolean().optional(),
      overlay: z
        .object({
          where: z.enum(["everywhere", "front", "terms"]),
          ...termIdsSchema.shape,
          textColor: color.optional(),
        })
        .optional(),
      css: z
        .string()
        .trim()
        .superRefine((css, ctx) => {
          const problem = cssProblem(css);
          if (problem) ctx.addIssue({ code: "custom", message: `Custom CSS: ${problem}` });
        })
        .optional()
        .transform((css) => css || undefined),
      // Checked against the page and its owner's languages when saved (`cleanTranslations`).
      translations: z
        .record(
          z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, "A translation has an unknown language."),
          z.record(
            z.string().max(120),
            z.custom<PageText>((v) => typeof v === "string" || (typeof v === "object" && v !== null && !Array.isArray(v))),
          ),
        )
        .optional(),
    })
    .superRefine((page, ctx) => {
      if (pageBlocks(page).length > BLOCKS_MAX) {
        ctx.addIssue({ code: "custom", message: `A page takes at most ${BLOCKS_MAX} blocks.` });
      }
      const ids = page.rows.flatMap((r) => [r.id, ...r.columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])]);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", message: "Two parts of the page have the same id. Reload the page and try again." });
      }
      // A modal's headings are its own, not the page's main heading (D121).
      const mainHeadings = pageBlocks({ rows: page.rows.filter((row) => !row.modal) }).filter((b) => (b.type === "heading" && b.level === 1) || (b.type === "product" && b.part === "title")).length;
      if (mainHeadings > 1) {
        ctx.addIssue({ code: "custom", message: "A page has one main heading (H1). Make the others H2 or smaller." });
      }
      const sameModal = repeatedModalKey(page.rows);
      if (sameModal) ctx.addIssue({ code: "custom", message: `Two modals on the page have the address name "${sameModal}". Give each its own.` });
      const twice = repeatedHtmlId(page.rows);
      if (twice) ctx.addIssue({ code: "custom", message: `Two parts of the page have the id "${twice}". Give each its own.` });
      // Who sees a part (D179 phase 4): at most so many checked per request, never on what every buyer must see.
      const display = displaysProblem(page.rows);
      if (display) ctx.addIssue({ code: "custom", message: display });
    }),
);

/** A new page: nothing written yet, open to search engines and AI assistants. */
export function newPageContent(): PageContent {
  return {
    title: "",
    slug: "",
    thumbnail: null,
    seo: { title: "", description: "" },
    searchEngines: true,
    aiAssistants: true,
    categories: [],
    tags: [],
    rows: [],
  };
}

/** A stored page, or null if it cannot be read (then it is not shown). */
export function parsePageContent(value: unknown): PageContent | null {
  const parsed = pageInput.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The page's words, for the description when none is written. */
export function pageExcerpt(content: Pick<PageContent, "rows">, max?: number): string {
  // What a modal says is not what the page is about (D121); a part not every visitor sees is not either (D179 phase 4).
  return summarize(pageBlocks({ rows: publicRows(content.rows).filter((row) => !row.modal) }).map(blockText).join(" "), max);
}

/** Whether two versions of a page say the same (the draft and what is published). */
export function samePageContent(a: PageContent, b: PageContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
