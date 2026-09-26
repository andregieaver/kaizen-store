import { z } from "zod";

import { fontFamily } from "./fonts";
import { DESCRIPTION_MAX, TITLE_MAX, summarize } from "./seo";
import { slugify } from "./slug";
import { termIdsSchema } from "./taxonomy";

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

/** Text marks the editor offers. */
export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "link"; attrs: { href: string } };

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
  if (/^\/(?![/\\])/.test(value) || /^#[\w-]+$/.test(value)) return true;
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
 * How a row divides its width: each column's share. A page is rows, one
 * under another; each row has these columns, and each column holds blocks.
 * On phones the columns stack.
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
} as const satisfies Record<string, { label: string; widths: readonly number[] }>;

export type RowLayout = keyof typeof ROW_LAYOUTS;
export const ROW_LAYOUT_KEYS = Object.keys(ROW_LAYOUTS) as [RowLayout, ...RowLayout[]];

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Space on each side, in pixels (D47). */
export type Sides = { top: number; right: number; bottom: number; left: number };
/** A row's, column's or block's margin (outside) and padding (inside); none when left out. */
export type Spacing = { margin?: Sides; padding?: Sides };
export const SPACING_MAX = 240;

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
};
/** A row's or column's background (D48): a colour, or a picture with an optional colour over it. */
export type Background =
  | { type: "color"; color: Color }
  | {
      type: "image";
      image: { url: string; width: number; height: number };
      /** A colour laid over the picture, `opacity` 0–100, so text on it can be read. */
      overlay: { color: Color; opacity: number } | null;
    };

export type TextAlign = "left" | "center" | "right";
/** Text alignment by screen (D48): phones, from tablets (768 px) and from computers (1024 px) up; each unset follows the smaller. */
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

/**
 * A Google Fonts family a block's text uses (D59), over the site's own;
 * self-hosted, so it must be installed (`installFont`) before it shows.
 */
export type BlockFont = { font?: string };

export type RichTextBlock = PartBase & BlockFont & { id: string; type: "richText"; doc: RichTextDoc; align?: TextAlignments };
/** A picture (D47): uploaded and shrunk in the browser; none yet while it is being set up. */
export type ImageBlock = PartBase & {
  id: string;
  type: "image";
  /** The caption's font. */
  font?: string;
  image: { url: string; width: number; height: number; alt: string } | null;
  caption: string;
  shape?: ImageShape;
};
/** Heading levels: 1 is the page's main heading, used once (D49). */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
/** How large a heading looks, apart from its level. */
export const HEADING_SIZES = { sm: "Small", md: "Medium", lg: "Large", xl: "Extra large", "2xl": "Huge" } as const;
export type HeadingSize = keyof typeof HEADING_SIZES;
/** The size a heading has unless one is chosen. */
export const HEADING_DEFAULT_SIZE: Record<HeadingLevel, HeadingSize> = { 1: "xl", 2: "lg", 3: "md", 4: "sm", 5: "sm", 6: "sm" };
export const FONT_WEIGHTS = { normal: "Normal", medium: "Medium", semibold: "Semibold", bold: "Bold" } as const;
export type FontWeight = keyof typeof FONT_WEIGHTS;
export const HEADING_MAX = 300;

/** A heading (D49): one line of text at a level, with its look. */
export type HeadingBlock = PartBase & BlockFont & {
  id: string;
  type: "heading";
  text: string;
  level: HeadingLevel;
  size?: HeadingSize;
  /** The theme's heading weight unless chosen (D60). */
  weight?: FontWeight;
  align?: TextAlignments;
  textColor?: Color;
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
export type ButtonBlock = PartBase & BlockFont & {
  id: string;
  type: "button";
  label: string;
  /** Medium unless chosen. */
  weight?: FontWeight;
  href: string;
  newTab?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  fullWidth?: boolean;
  /** Where the button sits, by screen, as text is aligned. */
  align?: TextAlignments;
  /** The fill (or an outline's line and text); the site's text colour unless chosen. */
  fill?: Color;
  textColor?: Color;
};

/** What a content grid shows (D51): its kinds of content; articles come with the articles themselves. */
export const GRID_CONTENT = { pages: "Pages", articles: "Articles", products: "Products" } as const;
export type GridContent = keyof typeof GRID_CONTENT;
/**
 * Where a grid's items come from: the pages of the page's owner, or
 * products. On Kaizen's pages a store and market are named; on a store's
 * own pages (D53) they are the store's products in the shopper's market.
 */
export type GridSource = { type: "pages" } | { type: "articles" } | { type: "products"; storeId?: string; market?: string };
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
export const GRID_GAP_MAX = 96;
export const GRID_COLUMNS_MAX = { mobile: 2, tablet: 4, desktop: 6 } as const;
export type GridColumns = { mobile: number; tablet: number; desktop: number };
/** A tile's parts, each on or off per grid. */
export const GRID_ELEMENTS = { image: "Picture", heading: "Heading", excerpt: "Excerpt", price: "Price", button: "Button" } as const;
export type GridElement = keyof typeof GRID_ELEMENTS;
/** A tile's own box: background, padding, border, corners and shadow. */
export type GridTile = { background?: Color; padding?: number; border?: Border; radius?: number; shadow?: Shadow };

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
  /** The tiles' text: excerpt, price and button (D59). */
  font?: string;
  /** The tiles' headings, over `font`. */
  headingFont?: string;
  source: GridSource;
  categories: string[];
  tags: string[];
  sort: GridSort;
  limit: number;
  columns: GridColumns;
  show: Record<GridElement, boolean>;
  /** The button's text; empty uses "Read more" or "View product" in the content's language. */
  buttonLabel: string;
  /** Shown when nothing matches; empty shows nothing. */
  emptyText: string;
  /** Pictures cropped alike keep the tiles even; landscape unless chosen. */
  /**
   * `theme` draws product tiles as the store theme's product cards (D60):
   * their picture shape, card style and alignment. The default for
   * products; landscape for pages and articles.
   */
  imageShape?: ImageShape | "original" | "theme";
  headingLevel: Exclude<HeadingLevel, 1>;
  headingSize?: HeadingSize;
  /** Lines of excerpt at most. */
  excerptLines: number;
  button?: Pick<ButtonBlock, "variant" | "size" | "shape" | "fill" | "textColor">;
  tile?: GridTile;
  /** Space between tiles, in pixels. */
  gap: number;
};

/** One piece of a page's content. More kinds (products, …) come later. */
export type PageBlock = RichTextBlock | ImageBlock | HeadingBlock | ButtonBlock | ContentGridBlock;
export type BlockType = PageBlock["type"];

/** The whole column is a link (D48); `label` names it for screen readers, else its text does. */
export type ColumnLink = { href: string; label: string };

export type PageColumn = PartBase & {
  id: string;
  blocks: PageBlock[];
  background?: Background;
  link?: ColumnLink;
};

export type VerticalAlign = "top" | "middle" | "bottom";

export type PageRow = PartBase & {
  id: string;
  type: "row";
  layout: RowLayout;
  columns: PageColumn[];
  /** The row's own width: the content's (the default) or the whole screen's (D48). */
  width?: "content" | "full";
  /** In a full-width row, whether what is in it keeps to the content's width (the default) or spreads too. */
  contentWidth?: "content" | "full";
  /** At least as tall as the screen. */
  fullHeight?: boolean;
  /** On phones, where columns stack, the last comes first. */
  reverseOnMobile?: boolean;
  /** Columns as tall as the tallest; what is in them sits at `align`. */
  equalHeight?: boolean;
  /** Where columns' content sits, top (the default), middle or bottom. */
  align?: VerticalAlign;
  background?: Background;
};

/** Whether a rich-text document holds nothing but empty paragraphs. */
export function richTextIsEmpty(doc: RichTextDoc): boolean {
  return doc.content.every((node) => node.type === "paragraph" && !node.content?.length);
}

/** Whether a block shows anything; empty ones are left out of the page. */
export function blockHasContent(block: PageBlock): boolean {
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
      // Its items are looked up when it is shown; with none, it says so (or nothing).
      return true;
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
      return [block.image?.alt, block.caption].filter(Boolean).join(" ");
    case "heading":
      return block.text;
    case "button":
    case "contentGrid":
      return "";
  }
}

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
      if (sides[side] > 0) css[`${kind}${side[0].toUpperCase()}${side.slice(1)}`] = `${sides[side]}px`;
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
  /**
   * Its texts in the owner's other languages (D55), by locale: only those
   * that differ from the page's own (`src/lib/page-translation.ts`).
   */
  translations?: Record<string, PageTranslation>;
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
  const seen = new Set<string>();
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
  block.imageShape ?? (block.source.type === "products" ? "theme" : "landscape");

/** The Google Fonts families a block uses (D59). */
export function blockFonts(block: PageBlock): string[] {
  const fonts = [
    "font" in block ? block.font : undefined,
    block.type === "contentGrid" ? block.headingFont : undefined,
  ];
  return fonts.filter((font): font is string => Boolean(font));
}

/** Every family a page's blocks use, once each. */
export const pageFonts = (content: Pick<PageContent, "rows">) => [...new Set(pageBlocks(content).flatMap(blockFonts))];

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
  "download",
  "order",
  "p",
  "subscription",
  "tag",
  "unsubscribe",
  "wishlist",
];

/**
 * Kept in step with the `pages_article_slug_not_reserved` check: the blog's
 * own routes under `/blog/` (D57), Kaizen's and every store's.
 */
export const RESERVED_ARTICLE_SLUGS: readonly string[] = ["category", "page", "tag"];

/** What is built in the page builder: pages, and articles in the blog (D57). */
export const PAGE_TYPES = ["page", "article"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** The addresses an owner's pages (Kaizen's with null, or a store's) or articles cannot take. */
export const reservedPageSlugs = (storeId: string | null, type: PageType = "page"): readonly string[] =>
  type === "article" ? RESERVED_ARTICLE_SLUGS : storeId === null ? RESERVED_PAGE_SLUGS : RESERVED_STORE_PAGE_SLUGS;

/** Why an address is not well formed, or null. */
function slugFormatProblem(slug: string): string | null {
  if (slug.length === 0) return "Give the page an address.";
  if (slug.length > PAGE_SLUG_MAX) return `Keep the address under ${PAGE_SLUG_MAX} characters.`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return "An address is lowercase letters and digits, with single hyphens between words.";
  }
  return null;
}

/** Why an address cannot be used, or null if it is fine; `reserved` is the owner's (Kaizen's by default). */
export function pageSlugProblem(slug: string, reserved: readonly string[] = RESERVED_PAGE_SLUGS): string | null {
  const problem = slugFormatProblem(slug);
  if (problem) return problem;
  if (reserved.includes(slug)) {
    return reserved === RESERVED_PAGE_SLUGS
      ? `The address /${slug} is used by Kaizen itself. Choose another.`
      : reserved === RESERVED_ARTICLE_SLUGS
        ? `The address blog/${slug} is used by the blog itself. Choose another.`
        : `The address ${slug} is used by the store itself. Choose another.`;
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
const spacing = z.object({ margin: sides.optional(), padding: sides.optional() }).optional();

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

const partBase = {
  style: spacing,
  border: z
    .object({
      width: z.object({ top: borderWidth, right: borderWidth, bottom: borderWidth, left: borderWidth }),
      color,
      style: z.enum(Object.keys(BORDER_STYLES) as [BorderStyle, ...BorderStyle[]]),
    })
    .optional(),
  radius: z
    .number()
    .int("Rounded corners are whole pixels.")
    .min(0)
    .max(RADIUS_MAX, `Keep rounded corners at ${RADIUS_MAX} pixels or less.`)
    .optional(),
  shadow: z.enum(Object.keys(SHADOWS) as [Shadow, ...Shadow[]]).optional(),
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

const background = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("color"), color }),
    z.object({
      type: z.literal("image"),
      image: z.object({
        url: z.url({ protocol: /^https?$/, error: "A background picture has an invalid address." }).max(1000),
        width: z.number().int().min(1).max(10_000),
        height: z.number().int().min(1).max(10_000),
      }),
      overlay: z.object({ color, opacity: z.number().int().min(0).max(100) }).nullable(),
    }),
  ])
  .optional();

/** A block's own font (D59): a Google Fonts family, or none for the site's. */
const blockFont = optionalText(fontFamily);

const textAlign = z.enum(["left", "center", "right"]).optional();
const textAlignments = z.object({ mobile: textAlign, tablet: textAlign, desktop: textAlign }).optional();

const richTextBlock = z.object({
  id: itemId,
  type: z.literal("richText"),
  doc: z.unknown().transform((value, ctx) => {
    const cleaned = cleanRichText(value);
    if (cleaned.ok) return cleaned.doc;
    ctx.addIssue({ code: "custom", message: cleaned.problem });
    return z.NEVER;
  }),
  align: textAlignments,
  font: blockFont,
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
  shape: z.enum(Object.keys(IMAGE_SHAPES) as [ImageShape, ...ImageShape[]]).optional(),
  font: blockFont,
  ...partBase,
});

const headingBlock = z.object({
  id: itemId,
  type: z.literal("heading"),
  text: z.string().trim().max(HEADING_MAX, `Keep a heading under ${HEADING_MAX} characters.`),
  level: z.literal([1, 2, 3, 4, 5, 6], "A heading has an unknown level."),
  size: z.enum(Object.keys(HEADING_SIZES) as [HeadingSize, ...HeadingSize[]]).optional(),
  weight: z.enum(Object.keys(FONT_WEIGHTS) as [FontWeight, ...FontWeight[]]).optional(),
  align: textAlignments,
  textColor: color.optional(),
  font: blockFont,
  ...partBase,
});

const buttonBlock = z.object({
  id: itemId,
  type: z.literal("button"),
  label: z.string().trim().max(BUTTON_LABEL_MAX, `Keep a button's text under ${BUTTON_LABEL_MAX} characters.`),
  href: z
    .string()
    .trim()
    .refine((href) => href === "" || isLinkAddress(href), "A button's address must be https://…, a page like /about, mailto: or tel:."),
  newTab: z.boolean().optional(),
  variant: z.enum(Object.keys(BUTTON_VARIANTS) as [ButtonVariant, ...ButtonVariant[]]).optional(),
  size: z.enum(Object.keys(BUTTON_SIZES) as [ButtonSize, ...ButtonSize[]]).optional(),
  shape: z.enum(Object.keys(BUTTON_SHAPES) as [ButtonShape, ...ButtonShape[]]).optional(),
  fullWidth: z.boolean().optional(),
  align: textAlignments,
  fill: color.optional(),
  textColor: color.optional(),
  weight: z.enum(Object.keys(FONT_WEIGHTS) as [FontWeight, ...FontWeight[]]).optional(),
  font: blockFont,
  ...partBase,
});

const count = (max: number) => z.number().int().min(1).max(max);

const contentGridBlock = z.object({
  id: itemId,
  type: z.literal("contentGrid"),
  source: z.discriminatedUnion(
    "type",
    [
      z.object({ type: z.literal("pages") }),
      z.object({ type: z.literal("articles") }),
      z.object({
        type: z.literal("products"),
        storeId: z.uuid("Choose the store whose products the grid shows.").optional(),
        market: z.string().regex(/^[A-Z]{2}$/, "Choose the market whose prices the grid shows.").optional(),
      }),
    ],
    "A content grid shows an unknown kind of content.",
  ),
  ...termIdsSchema.shape,
  sort: z.enum(Object.keys(GRID_SORTS) as [GridSort, ...GridSort[]]).default("newest"),
  limit: z.number().int().min(1, "A grid shows at least one item.").max(GRID_LIMIT_MAX, `A grid shows at most ${GRID_LIMIT_MAX} items.`),
  columns: z.object({
    mobile: count(GRID_COLUMNS_MAX.mobile),
    tablet: count(GRID_COLUMNS_MAX.tablet),
    desktop: count(GRID_COLUMNS_MAX.desktop),
  }),
  show: z.object({
    image: z.boolean(),
    heading: z.boolean(),
    excerpt: z.boolean(),
    price: z.boolean(),
    button: z.boolean(),
  }),
  buttonLabel: z.string().trim().max(BUTTON_LABEL_MAX, `Keep the button's text under ${BUTTON_LABEL_MAX} characters.`).default(""),
  emptyText: z.string().trim().max(300, "Keep the text for an empty grid under 300 characters.").default(""),
  imageShape: z.enum(["original", "theme", ...(Object.keys(IMAGE_SHAPES) as ImageShape[])]).optional(),
  headingLevel: z.literal([2, 3, 4, 5, 6], "A tile's heading has an unknown level."),
  headingSize: z.enum(Object.keys(HEADING_SIZES) as [HeadingSize, ...HeadingSize[]]).optional(),
  excerptLines: z.number().int().min(1).max(6),
  button: z
    .object({
      variant: buttonBlock.shape.variant,
      size: buttonBlock.shape.size,
      shape: buttonBlock.shape.shape,
      fill: color.optional(),
      textColor: color.optional(),
    })
    .optional(),
  tile: z
    .object({
      background: color.optional(),
      padding: z.number().int().min(0).max(SPACING_MAX).optional(),
      border: partBase.border,
      radius: partBase.radius,
      shadow: partBase.shadow,
    })
    .optional(),
  gap: z.number().int().min(0).max(GRID_GAP_MAX, `Keep the space between tiles at ${GRID_GAP_MAX} pixels or less.`),
  font: blockFont,
  headingFont: blockFont,
  ...partBase,
});

/** One block, as stored: rich text, a picture, a heading, a button or a content grid. */
export const pageBlockSchema = z.discriminatedUnion("type", [
  richTextBlock,
  imageBlock,
  headingBlock,
  buttonBlock,
  contentGridBlock,
]);

export const pageColumnSchema = z.object({
  id: itemId,
  blocks: z.array(pageBlockSchema),
  background,
  link: z
    .object({
      href: z
        .string()
        .trim()
        .refine(isLinkAddress, "A column's link needs an address: https://…, a page like /about, mailto: or tel:."),
      label: z.string().trim().max(200, "Keep a column link's description under 200 characters.").default(""),
    })
    .optional(),
  ...partBase,
});

export const pageRowSchema = z
  .object({
    id: itemId,
    type: z.literal("row"),
    layout: z.enum(ROW_LAYOUT_KEYS, "A row has an unknown layout."),
    columns: z.array(pageColumnSchema),
    width: z.enum(["content", "full"]).optional(),
    contentWidth: z.enum(["content", "full"]).optional(),
    fullHeight: z.boolean().optional(),
    reverseOnMobile: z.boolean().optional(),
    equalHeight: z.boolean().optional(),
    align: z.enum(["top", "middle", "bottom"]).optional(),
    background,
    ...partBase,
  })
  .refine((r) => r.columns.length === ROW_LAYOUTS[r.layout].widths.length, {
    message: "A row has the wrong number of columns for its layout. Reload the page and try again.",
  });

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
      const mainHeadings = pageBlocks(page).filter((b) => b.type === "heading" && b.level === 1).length;
      if (mainHeadings > 1) {
        ctx.addIssue({ code: "custom", message: "A page has one main heading (H1). Make the others H2 or smaller." });
      }
      const twice = repeatedHtmlId(page.rows);
      if (twice) ctx.addIssue({ code: "custom", message: `Two parts of the page have the id "${twice}". Give each its own.` });
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
  return summarize(pageBlocks(content).map(blockText).join(" "), max);
}

/** Whether two versions of a page say the same (the draft and what is published). */
export function samePageContent(a: PageContent, b: PageContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
