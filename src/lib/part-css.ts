import { SIZES, SMALLER_SIZES, breakpointQueries, sizeRuns, sizesQuery, type Breakpoints, type QueryMode, type Size } from "./breakpoints";
import {
  ROW_LAYOUTS,
  ROW_PADDING,
  SHADOWS,
  imageDisplaySize,
  type Border,
  type ContentGridBlock,
  type PageBlock,
  type PageColumn,
  type PageRow,
  type PartBase,
  type Sides,
  type Spacing,
  type VerticalAlign,
} from "./page-content";
import { carouselAnywhere, carouselAt, hiddenAt, neverStacks, spacingAt, stackAt, valueAt } from "./responsive";

/**
 * The part stylesheet (D179, `docs/responsive-editing.md` 3): every setting of a row, column or block that can differ by
 * screen size is drawn by rules of a class of its own, written once per row with the store's screen sizes (media
 * queries on the site, container queries on the builder's canvas). Settings that never vary stay where they were.
 *
 * Two kinds of rule keep the cascade as it was, so owners' CSS (D100) and the page replicator's `#id` rules (D150) win
 * exactly where they did:
 *
 * - what was an inline style (spacing, borders, corners, shadows, colours, a picture's width) is `:where(.class) { …
 *   !important }`: like an inline style it beats every normal rule, and every important rule of the page beats it, as
 *   they beat an inline style;
 * - what was a Tailwind class (how columns stack, a grid's columns, alignment, what is hidden on phones) is
 *   `:where(.class) { … }` outside any layer: like a utility it gives way to any rule of the page with a selector of its
 *   own, and it beats the remaining utilities (unlayered rules beat layered ones).
 *
 * A part's rule class is named by a hash of what it says (`kzr-…`), so the same id on two pages (a copied page, an A/B
 * version, a page kept hidden after client navigation) can never take the other's rules; `kz-{id}` is the part's stable
 * hook for owners. Pure: the site, the canvas and tests use it alike.
 */

export type PartsMode = "site" | "canvas";

type Decl = Record<string, string>;

/**
 * One rule of a part. `sizes` holds what it says at each size (the whole of it); it is written as the base and, for each
 * smaller size, only what differs from the size above it (`upTo` queries), so it reads as `valueAt()` walks. `only` rules
 * hold at the sizes named and nowhere else (one condition per run of neighbouring sizes).
 */
export type PartRule =
  | { selector: string; important: boolean; where: boolean; sizes: Record<Size, Decl> }
  | { selector: string; important: false; where: boolean; only: Size[]; decl: Decl };

/** An element's class and its rules, `&` standing for the class until it is named. */
export type ElementStyle = { className: string; rules: PartRule[] };

const NONE: ElementStyle = { className: "", rules: [] };

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

const SIDES = ["top", "right", "bottom", "left"] as const;

/** Margin and padding as declarations, only the sides that have some (as `spacingStyle()`). */
function spacingDecl(spacing: Spacing, dropMargin = false): Decl {
  const out: Decl = {};
  for (const kind of ["margin", "padding"] as const) {
    if (kind === "margin" && dropMargin) continue;
    const sides: Sides | undefined = spacing[kind];
    if (!sides) continue;
    for (const side of SIDES) if (sides[side] > 0) out[`${kind}-${side}`] = `${sides[side]}px`;
  }
  return out;
}

/** A border, rounded corners and a shadow as declarations (as `frameStyle()`). */
function frameDecl(border: Border | null | undefined, radius: number | undefined, shadow: PartBase["shadow"] | null): Decl {
  const out: Decl = {};
  if (border) {
    out["border-style"] = border.style;
    out["border-color"] = border.color;
    for (const side of SIDES) out[`border-${side}-width`] = `${border.width[side]}px`;
  }
  if (radius) out["border-radius"] = `${radius}px`;
  if (shadow) out["box-shadow"] = SHADOWS[shadow].css;
  return out;
}

const frameAt = (part: PartBase, size: Size): Decl => frameDecl(valueAt(part, "border", size), valueAt(part, "radius", size), valueAt(part, "shadow", size));

/** A row's or column's colour, see-through with an opacity, and what is behind it blurred (D86), at a size. */
function colorDecl(part: PageRow | PageColumn, size: Size): Decl {
  const background = valueAt(part, "background", size);
  const blur = valueAt(part, "backdropBlur", size);
  const out: Decl = {};
  if (background?.type === "color") {
    out["background-color"] =
      background.opacity === undefined ? background.color : `color-mix(in srgb, ${background.color} ${background.opacity}%, transparent)`;
  }
  if (blur && (!background || background.type === "color")) {
    out["backdrop-filter"] = `blur(${blur}px)`;
    out["-webkit-backdrop-filter"] = `blur(${blur}px)`;
  }
  return out;
}

/** On the site, a part left out at the sizes it is hidden at (D179 4: `visibility.hideAt`); the canvas shows it (`canvasHiddenCss()`). */
function hiddenRules(part: PartBase, mode: PartsMode): PartRule[] {
  const hidden = mode === "site" ? SIZES.filter((size) => hiddenAt(part, size)) : [];
  return hidden.length > 0 ? [{ selector: "&", important: false, where: true, only: hidden, decl: { display: "none" } }] : [];
}

const perSize = (decl: (size: Size) => Decl): Record<Size, Decl> => Object.fromEntries(SIZES.map((size) => [size, decl(size)])) as Record<Size, Decl>;
const isEmpty = (sizes: Record<Size, Decl>) => SIZES.every((size) => Object.keys(sizes[size]).length === 0);

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** FNV-1a, twice with other starting values: 64 bits, written short. */
function hash(text: string): string {
  let out = "";
  for (const seed of [0x811c9dc5, 0x9e3779b9]) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(36);
  }
  return out;
}

/** The element's class named by what its rules say; none when they say nothing. */
function named(rules: PartRule[], suffix = ""): ElementStyle {
  const kept = rules.filter((rule) => ("sizes" in rule ? !isEmpty(rule.sizes) : Object.keys(rule.decl).length > 0 && rule.only.length > 0));
  if (kept.length === 0) return NONE;
  const className = `kzr-${hash(JSON.stringify(kept))}${suffix}`;
  return { className, rules: kept.map((rule) => ({ ...rule, selector: rule.selector.replaceAll("&", `.${className}`) })) };
}

/** A part's stable class (D179): its id, for owners' CSS; always there, on the site and the canvas. */
export const partClass = (part: { id: string }): string => `kz-${part.id}`;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

// As the classes they replace (`[justify-content:start]`, `items-start`, …).
const JUSTIFY: Record<VerticalAlign, string> = { top: "start", middle: "center", bottom: "end" };
const ITEMS: Record<VerticalAlign, string> = { top: "flex-start", middle: "center", bottom: "flex-end" };

/** A row's own box: its spacing (20 px of padding until set), frame and colour; inside a modal's panel (D121) the panel takes its margin and frame. */
export function rowStyle(row: PageRow, inPanel = false, mode: PartsMode = "site"): ElementStyle {
  return named([
    ...hiddenRules(row, inPanel ? "canvas" : mode),
    {
      selector: "&",
      important: true,
      where: true,
      sizes: perSize((size) => {
        const spacing = spacingAt(row, size);
        return {
          ...spacingDecl({ ...spacing, padding: spacing.padding ?? ROW_PADDING }, inPanel),
          ...(inPanel ? {} : frameAt(row, size)),
          ...colorDecl(row, size),
        };
      }),
    },
  ]);
}

/** A modal's panel (D121): the row's border, rounded corners and shadow, which it clips its content to. */
export const panelStyle = (row: PageRow): ElementStyle =>
  named([{ selector: "&", important: true, where: true, sizes: perSize((size) => frameAt(row, size)) }], "-p");

/** A column's share of its row at a size: its own, else the layout's (0 is as wide as what it holds, D80). */
const trackOf = (width: number) => (width === 0 ? "minmax(0, max-content)" : `minmax(0, ${width}fr)`);

/**
 * The row's columns: one under another where it stacks (on Small unless set; the last first where reversed), else side by
 * side in its layout's widths; 32 px apart unless set.
 */
export function rowGridStyle(row: PageRow): ElementStyle {
  const align = row.align ?? "top";
  const widths: readonly number[] = ROW_LAYOUTS[row.layout].widths;
  const grid: PartRule = {
    selector: "&",
    important: false,
    where: true,
    sizes: perSize((size) => {
      const gap = valueAt(row, "gap", size);
      const out: Decl = { gap: gap === undefined ? "2rem" : `${gap}px` };
      if (stackAt(row, size)) {
        out.display = "flex";
        out["flex-direction"] = valueAt(row, "reverse", size) ? "column-reverse" : "column";
        out["justify-content"] = JUSTIFY[align];
      } else {
        out.display = "grid";
        out["grid-template-columns"] = row.columns.map((column, i) => trackOf(valueAt(column, "width", size) ?? widths[i] ?? 1)).join(" ");
        out["align-items"] = row.equalHeight ? "stretch" : ITEMS[align];
      }
      return out;
    }),
  };
  // A column's place among the others, where set (D179).
  const order: PartRule[] = row.columns.map((column, i) => ({
    selector: `& > :nth-child(${i + 1})`,
    important: false,
    where: true,
    sizes: perSize((size) => {
      const value = valueAt(column, "order", size);
      return value === undefined ? ({} as Decl) : { order: String(value) };
    }),
  }));
  return named([grid, ...order], "-g");
}

/** Whether a row's or column's corners clip a picture, video or gradient behind it: rounded at some size. */
export const clipsAnywhere = (part: PageRow | PageColumn): boolean =>
  SIZES.some((size) => Boolean(valueAt(part, "radius", size))) &&
  (part.background?.type === "image" || part.background?.type === "video" || part.background?.type === "gradient");

/** A side-by-side column's components keep to one line in a row that never stacks (D80). */
export const inlineNowrap = (row: PageRow): boolean => neverStacks(row);

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export function columnStyle(column: PageColumn, mode: PartsMode = "site"): ElementStyle {
  return named([
    ...hiddenRules(column, mode),
    {
      selector: "&",
      important: true,
      where: true,
      sizes: perSize((size) => ({ ...spacingDecl(spacingAt(column, size)), ...frameAt(column, size), ...colorDecl(column, size) })),
    },
  ]);
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Related products' columns by size (D79) unless set: two on Small, four above. */
const RELATED_COLUMNS: Record<Size, number> = { xl: 4, lg: 4, md: 4, sm: 2 };

/** Where a picture narrower than its column sits (D151): auto margins, which text alignment cannot do to a box. */
const PICTURE_SIDE = { left: {}, center: { "margin-left": "auto", "margin-right": "auto" }, right: { "margin-left": "auto" } } as const;
const JUSTIFY_LINKS = { left: "flex-start", center: "center", right: "flex-end" } as const;

/** The class a menu's side-by-side links take their place along the line from (`MenuSection`). */
export const MENU_JUSTIFY_CLASS = "kz-menu-justify";

/**
 * Around a block: its spacing and frame (a button's frame is the button's own), a picture's width, related products'
 * columns; its alignment (a picture's place, a menu's links), what is hidden at a size on the site, and a dual button's
 * two one under another. A content grid's columns are its list's (`gridListStyle()`).
 */
export function blockStyle(block: PageBlock, mode: PartsMode): ElementStyle {
  const rules: PartRule[] = [];
  const picture = block.type === "image" && block.image !== null;
  rules.push({
    selector: "&",
    important: true,
    where: true,
    sizes: perSize((size) => {
      const out: Decl = { ...spacingDecl(spacingAt(block, size)), ...(block.type === "button" ? {} : frameAt(block, size)) };
      if (block.type === "image" && picture) {
        const shown = imageDisplaySize({ ...block, maxWidth: valueAt(block, "maxWidth", size) ?? undefined });
        if (shown) out["--picture-width"] = `${shown.width}px`;
      }
      if (block.type === "product" && block.part === "related") out["--grid-cols"] = String(valueAt(block, "columns", size) ?? RELATED_COLUMNS[size]);
      return out;
    }),
  });
  if (block.type === "button") {
    rules.push({ selector: "& [data-button-frame]", important: true, where: true, sizes: perSize((size) => frameAt(block, size)) });
  }
  if ("align" in block || (block.at && SMALLER_SIZES.some((s) => block.at?.[s]?.align))) {
    rules.push({
      selector: "&",
      important: false,
      where: true,
      sizes: perSize((size) => {
        const align = valueAt(block, "align", size);
        if (!align) return {} as Decl;
        return { "text-align": align, ...(picture ? PICTURE_SIDE[align] : {}) } as Decl;
      }),
    });
    if (block.type === "menu") {
      rules.push({
        selector: `& .${MENU_JUSTIFY_CLASS}`,
        important: false,
        where: true,
        sizes: perSize((size) => {
          const align = valueAt(block, "align", size);
          return align ? { "justify-content": JUSTIFY_LINKS[align] } : ({} as Decl);
        }),
      });
    }
  }
  if (mode === "site") {
    // A site's phone menu button is for Small; a part set so is left out at its sizes, leaving no gap (D80).
    const hidden = block.type === "site" && block.part === "menuButton" ? (["xl", "lg", "md"] as Size[]) : SIZES.filter((size) => hiddenAt(block, size));
    if (hidden.length > 0) rules.push({ selector: "&", important: false, where: true, only: hidden, decl: { display: "none" } });
  }
  if (block.type === "testimonials") {
    // One column on Small, at most two on Medium, all from Large (D91), on the store's screen sizes; a carousel takes them too.
    const columns = block.columns ?? 3;
    const at: Record<Size, number> = { xl: columns, lg: columns, md: Math.min(2, columns), sm: 1 };
    rules.push({ selector: "& [data-testimonial-list]", important: false, where: true, sizes: perSize((size) => ({ "--grid-cols": String(at[size]) })) });
  }
  if (block.type === "dualButton") {
    const stacked = SIZES.filter((size) => valueAt(block, "stack", size) === true);
    if (stacked.length > 0) {
      rules.push({
        selector: "& [data-dual-buttons]",
        important: false,
        where: true,
        only: stacked,
        decl: { display: "flex", "flex-direction": "column", "align-items": "stretch" },
      });
    }
  }
  return named(rules);
}

/**
 * A content grid's list of tiles (D51): its columns and gap at each size (custom properties the list reads, which were
 * inline), and where it is a carousel at some sizes, a grid of the same columns at the others (the track's own rules are
 * in globals.css, which these beat by naming the track too). Drawn wherever the grid is, in a row or a listing.
 */
export function gridListStyle(block: ContentGridBlock): ElementStyle {
  const rules: PartRule[] = [
    {
      selector: "&",
      important: true,
      where: true,
      sizes: perSize((size) => ({ "--grid-cols": String(valueAt(block, "columns", size) ?? block.columns), "--grid-gap": `${valueAt(block, "gap", size) ?? block.gap}px` })),
    },
  ];
  if (carouselAnywhere(block)) {
    const grid = SIZES.filter((size) => !carouselAt(block, size));
    if (grid.length > 0) {
      rules.push(
        {
          selector: "&[data-carousel-track]",
          important: false,
          where: false,
          only: grid,
          decl: { display: "grid", "grid-template-columns": "repeat(var(--cols), minmax(0, 1fr))", "overflow-x": "visible", "scroll-snap-type": "none" },
        },
        { selector: "&[data-carousel-track] > *", important: false, where: false, only: grid, decl: { flex: "none" } },
        { selector: "& ~ [data-carousel-controls]", important: false, where: false, only: grid, decl: { display: "none" } },
      );
    }
  }
  return named(rules, "-l");
}

/** Every rule of these blocks: their boxes, and a content grid's list. */
export function blockRules(blocks: PageBlock[], mode: PartsMode): PartRule[] {
  return blocks.flatMap((block) => [...blockStyle(block, mode).rules, ...(block.type === "contentGrid" ? gridListStyle(block).rules : [])]);
}

// ---------------------------------------------------------------------------
// The stylesheet
// ---------------------------------------------------------------------------

/** Every rule of these rows: each row's box (in its modal's panel on the site, D121), grid, columns and blocks. */
export function partRules(rows: PageRow[], mode: PartsMode): PartRule[] {
  const out: PartRule[] = [];
  for (const row of rows) {
    const panel = mode === "site" && Boolean(row.modal);
    out.push(...rowStyle(row, panel, mode).rules, ...rowGridStyle(row).rules);
    if (row.modal) out.push(...panelStyle(row).rules);
    // The canvas also previews a modal in its panel (`ModalBar`).
    if (row.modal && mode === "canvas") out.push(...rowStyle(row, true, mode).rules);
    for (const column of row.columns) out.push(...columnStyle(column, mode).rules, ...blockRules(column.blocks, mode));
  }
  return out;
}

const body = (decl: Decl, important: boolean) =>
  Object.entries(decl)
    .map(([property, value]) => `${property}:${value}${important ? "!important" : ""}`)
    .join(";");

/**
 * The rules as CSS: the base of each, then each smaller size's changes in its `upTo` query (larger first, so smaller
 * sizes win), then the rules that hold at some sizes only. A property a larger size sets and a smaller one does not is
 * given back (`revert-layer`) to whatever else styles the element. Each rule once, however often it is given.
 */
export function renderPartCss(rules: PartRule[], breakpoints: Breakpoints, mode: QueryMode = "media"): string {
  const seen = new Set<string>();
  const unique = rules.filter((rule) => {
    const key = JSON.stringify(rule);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const queries = breakpointQueries(breakpoints, mode);
  const selectorOf = (rule: PartRule) => (rule.where ? `:where(${rule.selector})` : rule.selector);
  const base: string[] = [];
  const bySize: Record<"lg" | "md" | "sm", string[]> = { lg: [], md: [], sm: [] };
  const only = new Map<string, string[]>();
  for (const rule of unique) {
    if ("only" in rule) {
      for (const run of sizeRuns(rule.only)) {
        const query = sizesQuery(breakpoints, run, mode);
        if (query === null) continue;
        const text = `${selectorOf(rule)}{${body(rule.decl, false)}}`;
        if (query === "always") base.push(text);
        else only.set(query, [...(only.get(query) ?? []), text]);
      }
      continue;
    }
    const first = body(rule.sizes.xl, rule.important);
    if (first) base.push(`${selectorOf(rule)}{${first}}`);
    let above = rule.sizes.xl;
    for (const size of SMALLER_SIZES) {
      const here = rule.sizes[size];
      const changed: Decl = {};
      for (const [property, value] of Object.entries(here)) if (above[property] !== value) changed[property] = value;
      for (const property of Object.keys(above)) if (!(property in here)) changed[property] = "revert-layer";
      const text = body(changed, rule.important);
      if (text) bySize[size].push(`${selectorOf(rule)}{${text}}`);
      above = here;
    }
  }
  const blocks = [base.join("\n")];
  for (const size of SMALLER_SIZES) if (bySize[size].length > 0) blocks.push(`${queries.upTo[size]}{\n${bySize[size].join("\n")}\n}`);
  for (const [query, texts] of only) blocks.push(`${query}{\n${texts.join("\n")}\n}`);
  return blocks.filter(Boolean).join("\n");
}

/** The stylesheet of these rows (and blocks drawn on their own, such as a listing's grid), for a `<style>` beside them. */
export const partCss = (
  rows: PageRow[],
  mode: PartsMode,
  breakpoints: Breakpoints,
  query: QueryMode = mode === "canvas" ? "container" : "media",
  blocks: PageBlock[] = [],
): string => renderPartCss([...partRules(rows, mode), ...blockRules(blocks, mode)], breakpoints, query);

// ---------------------------------------------------------------------------
// Hidden parts on the canvas (D179 phase 2)
// ---------------------------------------------------------------------------

/** An attribute selector's value, quoted. */
const quoted = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;

/**
 * The builder's canvas keeps a part that is hidden at a size (`visibility.hideAt`) where it can be edited: faded, with its
 * grey eye (`[data-builder-hidden]`, shown only at those sizes), or, with `hide`, left out as on the site. Container
 * queries on the canvas (`kz-page`), so they follow the size being edited; the canvas's items carry `data-builder-id`.
 */
export function canvasHiddenCss(rows: PageRow[], breakpoints: Breakpoints, hide: boolean): string {
  const parts: PartBase[] = rows.flatMap((row) => [row, ...row.columns.flatMap((column) => [column, ...column.blocks])]);
  const byQuery = new Map<string, string[]>();
  for (const part of parts as (PartBase & { id: string })[]) {
    const sizes = SIZES.filter((size) => hiddenAt(part, size));
    if (sizes.length === 0) continue;
    const item = `[data-builder-id=${quoted(part.id)}]`;
    const rules = hide
      ? [`${item}{display:none}`]
      : [`${item} > [class~=${quoted(partClass(part as { id: string }))}]{opacity:.4}`, `${item} > [data-builder-hidden]{display:inline-flex}`];
    for (const run of sizeRuns(sizes)) {
      const query = sizesQuery(breakpoints, run, "container");
      if (query === null) continue;
      byQuery.set(query, [...(byQuery.get(query) ?? []), ...rules]);
    }
  }
  return [...byQuery].map(([query, rules]) => (query === "always" ? rules.join("\n") : `${query}{\n${rules.join("\n")}\n}`)).join("\n");
}
