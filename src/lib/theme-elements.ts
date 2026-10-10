import { SIZES, SMALLER_SIZES, type Size, type SmallerSize } from "./breakpoints";
import {
  themeElementSchema,
  type Border,
  type ColorBackground,
  type PageBlock,
  type PageColumn,
  type PageRow,
  type PartBase,
  type PartSizeSettings,
  type Shadow,
  type Sides,
  type SizeOverrides,
  type Spacing,
  type ThemeElement,
} from "./page-content";
import { spacingAt, valueAt } from "./responsive";
import { siteFontFamilies, type SiteFonts } from "./fonts";
import { TYPOGRAPHY_KEYS, typographyAt, typographyFamilies, typographyValueAt, type Typography, type TypographyGroups, type TypographyKey, type TypographyOverride } from "./typography";
import { z } from "zod";

/**
 * Theme elements (D182, `docs/theme-elements.md`): what a store says once, in the page builder's Theme tab, for every row,
 * heading (H1 to H6), paragraph, list and button of its pages. An element holds what a part of that kind can hold (its
 * typography, spacing, border, corners and shadow, per screen size; a row also its colour and whether it spans the screen or keeps to the content's width, D190), and a part
 * of the page that sets the same thing itself wins, at the sizes it sets it at.
 *
 * The theme is laid under the page's parts before they are drawn (`themedRows()`): the part rules (`src/lib/part-css.ts`)
 * are written from the result, so a part's settings and the theme's meet in one place and the cascade never has to
 * choose between two rules. A rich text's own paragraphs, headings and lists are not parts: they take the element's
 * rules as `themeInner` of the block (`blockStyle()`), without what the block, its column or its row set themselves.
 * Pure, for the browser and the server.
 */

// ---------------------------------------------------------------------------
// The elements
// ---------------------------------------------------------------------------

export const THEME_ELEMENT_KEYS = ["row", "h1", "h2", "h3", "h4", "h5", "h6", "p", "list", "button"] as const;
export type ThemeElementKey = (typeof THEME_ELEMENT_KEYS)[number];

export const THEME_ELEMENT_LABELS: Record<ThemeElementKey, { name: string; hint: string }> = {
  row: { name: "Row", hint: "Every row: its width, spacing, colour and the text inside it." },
  h1: { name: "H1", hint: "Heading components at level 1 and first-level headings in text." },
  h2: { name: "H2", hint: "Heading components at level 2 and second-level headings in text." },
  h3: { name: "H3", hint: "Heading components at level 3 and third-level headings in text." },
  h4: { name: "H4", hint: "Heading components at level 4 and fourth-level headings in text." },
  h5: { name: "H5", hint: "Heading components at level 5 and fifth-level headings in text." },
  h6: { name: "H6", hint: "Heading components at level 6 and sixth-level headings in text." },
  p: { name: "P", hint: "Paragraphs in text components." },
  list: { name: "UL / OL", hint: "Bulleted and numbered lists in text components." },
  button: { name: "Button", hint: "Button components and the two of a dual button." },
};

/** The elements the theme stores: what has something set, nothing else. */
export type ThemeElements = Partial<Record<ThemeElementKey, ThemeElement>>;

export const themeElementsSchema = z
  .object(Object.fromEntries(THEME_ELEMENT_KEYS.map((key) => [key, themeElementSchema.optional()])) as Record<ThemeElementKey, z.ZodOptional<typeof themeElementSchema>>)
  .partial()
  .transform((value) => {
    const kept = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as ThemeElements;
    return Object.keys(kept).length > 0 ? kept : undefined;
  });

/** The inner elements of a rich text that take the theme's rules (a list's items too). */
export const INNER_KEYS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "list"] as const satisfies readonly ThemeElementKey[];
export type InnerKey = (typeof INNER_KEYS)[number];
/** The CSS each inner element is written on, inside the rich text. */
export const INNER_SELECTORS: Record<InnerKey, string> = {
  h1: "& h1",
  h2: "& h2",
  h3: "& h3",
  h4: "& h4",
  h5: "& h5",
  h6: "& h6",
  p: "& p",
  list: "& :is(ul, ol)",
};

/** A rich text block with the theme's inner rules laid under it (only ever made by `themedRows()`, never stored). */
export type ThemedBlock = PageBlock & { themeInner?: Partial<Record<InnerKey, ThemeElement>> };

/** Whether the theme says anything at all. */
export const hasThemeElements = (elements: ThemeElements | undefined): elements is ThemeElements => Boolean(elements) && Object.keys(elements!).length > 0;

// ---------------------------------------------------------------------------
// Laying the theme under a part
// ---------------------------------------------------------------------------

type Layered = Pick<PartBase, "style" | "border" | "radius" | "shadow" | "at" | "typography"> & { background?: unknown; contentMax?: number };

/** What a part (or an element) says at one size, every setting walked up from the size. */
type Resolved = {
  margin?: Sides;
  padding?: Sides;
  border?: Border | null;
  radius?: number;
  shadow?: Shadow | null;
  background?: unknown;
  contentMax?: number | null;
  text: TypographyOverride;
};

const asLayered = (part: object): Layered => part as Layered;

/** The settings of a part at a size: where the part itself says nothing, undefined. */
function resolvedAt(part: Layered, size: Size): Resolved {
  const spacing = spacingAt(part, size);
  return {
    margin: spacing.margin,
    padding: spacing.padding,
    border: valueAt(part, "border", size),
    radius: valueAt(part, "radius", size),
    shadow: valueAt(part, "shadow", size),
    background: valueAt(part as { at?: SizeOverrides; background?: ColorBackground }, "background", size) ?? (size === "xl" ? part.background : undefined),
    contentMax: valueAt(part, "contentMax", size),
    text: typographyAt(part, "text", size),
  };
}

/** A part's own value where it has one at the size (null counts: "none here"), else the theme's. */
const pick = <T>(own: T | undefined, theme: T | undefined): T | undefined => (own !== undefined ? own : theme);

/**
 * Which keys of a part's text typography its own settings (and its ancestors') hold at a size: the theme's element must not
 * set them again on an element inside, where a direct rule would beat the inherited one.
 */
export function typographyKeysSet(parts: readonly object[], size: Size): Set<TypographyKey> {
  const keys = new Set<TypographyKey>();
  for (const part of parts) for (const key of TYPOGRAPHY_KEYS) if (typographyValueAt(part as Layered, "text", key, size) !== undefined) keys.add(key);
  return keys;
}

/**
 * `part` with the theme's `element` laid under it: at every size, the part's own setting where it has one (anywhere on the
 * way up from the size), else the element's. The result is written out at every size, so the usual readers (`valueAt()`,
 * `spacingAt()`, `typographyAt()`) see exactly that. `skip` keys of the text are left to what the part inherits.
 */
export function layerUnder<P extends object>(part: P, element: ThemeElement | undefined, skip: (size: Size) => ReadonlySet<TypographyKey> = () => new Set()): P {
  if (!element) return part;
  const own = asLayered(part);
  const theme = asLayered(element);
  const out: Record<string, unknown> = { ...(part as Record<string, unknown>) };
  const at: Partial<Record<SmallerSize, PartSizeSettings>> = {};
  for (const size of SIZES) {
    const mine = resolvedAt(own, size);
    const given = resolvedAt(theme, size);
    const blocked = skip(size);
    const text: Record<string, unknown> = {};
    for (const key of TYPOGRAPHY_KEYS) {
      const value = pick(mine.text[key], blocked.has(key) ? undefined : given.text[key]);
      if (value !== undefined) text[key] = value;
    }
    const resolved = {
      margin: pick(mine.margin, given.margin),
      padding: pick(mine.padding, given.padding),
      border: pick(mine.border, given.border),
      radius: pick(mine.radius, given.radius),
      shadow: pick(mine.shadow, given.shadow),
      background: pick(mine.background, given.background),
      contentMax: pick(mine.contentMax, given.contentMax),
    };
    const settings: Record<string, unknown> = {};
    const style: Spacing = { ...(resolved.margin && { margin: resolved.margin }), ...(resolved.padding && { padding: resolved.padding }) };
    if (Object.keys(style).length > 0) settings.style = style;
    for (const key of ["border", "radius", "shadow", "contentMax"] as const) if (resolved[key] !== undefined) settings[key] = resolved[key];
    if (Object.keys(text).length > 0) settings.typography = { text };
    if (size === "xl") {
      Object.assign(out, settings);
      // The row's own background of any kind stays; the theme's colour only where it has none.
      if (resolved.background !== undefined) out.background = resolved.background;
      if (!("typography" in settings)) delete out.typography;
      else out.typography = { ...(part as { typography?: TypographyGroups }).typography, text };
    } else {
      const sized: Record<string, unknown> = { ...settings };
      if (resolved.background !== undefined && resolved.background !== (own.background ?? undefined) && (mine.background !== undefined || given.background !== undefined)) sized.background = resolved.background;
      if (Object.keys(sized).length > 0) at[size as SmallerSize] = sized as PartSizeSettings;
    }
  }
  // What the part says at a smaller size about other settings (stacking, gap, alignment, other kinds of text) stays.
  const kept = (part as { at?: SizeOverrides }).at;
  const merged: Partial<Record<SmallerSize, PartSizeSettings>> = {};
  for (const size of SMALLER_SIZES) {
    const rest: Record<string, unknown> = { ...(kept?.[size] ?? {}) };
    for (const key of ["style", "border", "radius", "shadow", "contentMax", "background"]) delete rest[key];
    const typography = { ...((rest.typography as Record<string, unknown> | undefined) ?? {}) };
    delete typography.text;
    const resolved = at[size] as Record<string, unknown> | undefined;
    const joined: Record<string, unknown> = { ...rest, ...(resolved ?? {}) };
    const text = (resolved?.typography as { text?: unknown } | undefined)?.text;
    if (text !== undefined || Object.keys(typography).length > 0) joined.typography = { ...typography, ...(text !== undefined && { text }) };
    else delete joined.typography;
    // A background a row's own smaller sizes say (a colour or none) is kept as the part has it.
    if (kept?.[size]?.background !== undefined) joined.background = kept[size]!.background;
    if (Object.keys(joined).length > 0) merged[size] = joined as PartSizeSettings;
  }
  if (Object.keys(merged).length > 0) out.at = merged;
  else delete out.at;
  // A row's width and what it holds (D190): its own choice where it has one, else the theme's.
  if ((part as { type?: string }).type === "row") {
    const widths = element as { width?: string; contentWidth?: string };
    for (const key of ["width", "contentWidth"] as const) if (widths[key] !== undefined && (part as Record<string, unknown>)[key] === undefined) out[key] = widths[key];
  }
  return out as P;
}

/** An element's text at each size with the keys left out that the ancestors set, as a plain element of its own. */
function innerElement(element: ThemeElement, blocked: (size: Size) => ReadonlySet<TypographyKey>): ThemeElement {
  const out = layerUnder({} as Record<string, unknown>, element, blocked) as ThemeElement;
  return out;
}

/** The heading element of a level. */
const headingKey = (level: number): ThemeElementKey => `h${Math.min(Math.max(Math.round(level), 1), 6)}` as ThemeElementKey;

/** What a block takes from the theme: its element, and whether its box (not its text alone) is styled. */
function elementOfBlock(block: PageBlock, elements: ThemeElements): ThemeElement | undefined {
  switch (block.type) {
    case "heading":
      return elements[headingKey(block.level)];
    case "button":
    case "dualButton":
      return elements.button;
    default:
      return undefined;
  }
}

/** A block with the theme laid under it, and a rich text's inner elements' rules. `above` are the row's and column's own settings. */
function themedBlock(block: PageBlock, elements: ThemeElements, above: readonly object[]): PageBlock {
  const element = elementOfBlock(block, elements);
  if (block.type === "richText") {
    const inner: Partial<Record<InnerKey, ThemeElement>> = {};
    const blocked = (size: Size) => typographyKeysSet([...above, block], size);
    for (const key of INNER_KEYS) {
      const own = elements[key];
      if (own) inner[key] = innerElement(own, blocked);
    }
    return Object.keys(inner).length > 0 ? ({ ...block, themeInner: inner } as ThemedBlock) : block;
  }
  if (!element) return block;
  // A dual button's frame is not the buttons' own: only its text takes the theme.
  const given: ThemeElement = block.type === "dualButton" ? { ...(element.typography && { typography: element.typography }), ...(element.at && { at: textOnly(element.at) }) } : element;
  return layerUnder(block, given, (size) => typographyKeysSet(above, size));
}

/** An element's overrides with only their typography. */
function textOnly(at: SizeOverrides): SizeOverrides | undefined {
  const out: SizeOverrides = {};
  for (const size of SMALLER_SIZES) {
    const typography = at[size]?.typography;
    if (typography) out[size] = { typography };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * A page's rows as they are drawn: each row, heading, button and rich text with the theme's element laid under what it
 * says itself. The rows are never saved like this; nothing is changed where the theme says nothing.
 */
export function themedRows(rows: PageRow[], elements: ThemeElements | undefined): PageRow[] {
  if (!hasThemeElements(elements)) return rows;
  return rows.map((row) => {
    const themedRow = layerUnder(row, elements.row);
    return {
      ...themedRow,
      columns: row.columns.map((column): PageColumn => ({
        ...column,
        blocks: column.blocks.map((block) => themedBlock(block, elements, [row, column])),
      })),
    };
  });
}

/** Blocks drawn on their own (a listing's grid): the theme's elements apply to them too. */
export function themedBlocks(blocks: PageBlock[], elements: ThemeElements | undefined): PageBlock[] {
  if (!hasThemeElements(elements)) return blocks;
  return blocks.map((block) => themedBlock(block, elements, []));
}

// ---------------------------------------------------------------------------
// The builder's editors
// ---------------------------------------------------------------------------

/** A part an element's editors can work on: the fields read and write the element as a part of this kind. */
export function elementAsPart(key: ThemeElementKey, element: ThemeElement | undefined): PartBase & { id: string; type: string; level?: number } & Record<string, unknown> {
  const base = { ...element, id: `theme-${key}` } as PartBase & { id: string };
  if (key === "row") return { ...base, type: "row" };
  if (key === "button") return { ...base, type: "button" };
  if (key === "p" || key === "list") return { ...base, type: "richText" };
  return { ...base, type: "heading", level: Number(key.slice(1)) };
}

/**
 * An element after a part's fields changed it: only what an element can hold is kept, and one with nothing is none. Not
 * checked here (a half-typed value stays while it is typed); `themeElementsSchema` checks it when it is saved.
 */
export function elementFromPart(part: Record<string, unknown>): ThemeElement | undefined {
  // A row's widths are the row element's alone (D190).
  const keys = ["style", "border", "radius", "shadow", "background", "at", "typography", ...(part.type === "row" ? ["width", "contentWidth"] : [])];
  const kept = Object.fromEntries(keys.flatMap((key) => (part[key] === undefined ? [] : [[key, part[key]]])));
  return Object.keys(kept).length > 0 ? (kept as ThemeElement) : undefined;
}

/**
 * What a row's own width choice writes (D190): the width it is changed to, only where that is not what the row would be without
 * its own (the theme's Row, else the content's width), so a row keeps following the theme until it says otherwise; and a row that
 * keeps to the content's width says nothing of what it holds.
 */
export function rowWidthPatch(
  theme: { width?: "content" | "full"; contentWidth?: "content" | "full" },
  change: { width?: "content" | "full"; contentWidth?: "content" | "full" },
): { width?: "content" | "full"; contentWidth?: "content" | "full" } {
  const patch: { width?: "content" | "full"; contentWidth?: "content" | "full" } = {};
  if (change.width !== undefined) {
    patch.width = change.width === (theme.width ?? "content") ? undefined : change.width;
    if (change.width === "content") patch.contentWidth = undefined;
  }
  if (change.contentWidth !== undefined) patch.contentWidth = change.contentWidth === (theme.contentWidth ?? "content") ? undefined : change.contentWidth;
  return patch;
}

/** The typography of an element at a size, as the rules write it. */
export const elementText = (element: ThemeElement, size: Size): Typography => typographyAt(element, "text", size) as Typography;

/** Every family a theme names: its heading and body fonts, and the elements' own. */
export function themeFontFamilies(settings: { fonts: SiteFonts; elements?: ThemeElements }): string[] {
  const own = Object.values(settings.elements ?? {}).flatMap((element) => (element ? typographyFamilies(element) : []));
  return [...new Set([...siteFontFamilies(settings.fonts), ...own])];
}
