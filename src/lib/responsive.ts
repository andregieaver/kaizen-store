import { SIZES, SMALLER_SIZES, type Size, type SmallerSize } from "./breakpoints";
import type { GridColumns, PageBlock, PageRow, PartSizeSettings, Sides, Spacing, TextAlign, TextAlignments } from "./page-content";

/**
 * Settings by screen size (D179, `docs/responsive-editing.md` 3). A part's settings as saved are its Extra large values;
 * `at` holds, for each smaller size, only the settings that differ, and a value at a size is read by walking up from it
 * (`sm → md → lg → base`, `valueAt()`): a value set on a larger size holds on the smaller ones until one sets its own.
 *
 * Pages saved before this model had a few switches for phones and values by screen read the other way (smaller to
 * larger). `upgradeRow()`, `upgradeColumn()` and `upgradeBlock()` fold them into the new shape on read (every schema of a
 * row, column and block runs them, so pages, saved parts, templates, A/B versions, layouts and design profiles are read
 * the same), and a page is stored in the new shape the next time it is saved. Pure, for the browser and the server.
 */

type Json = Record<string, unknown>;
type At = Partial<Record<SmallerSize, PartSizeSettings>>;
type WithAt = { at?: At };

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** The sizes a value at `size` is looked for in, from the size itself up to the base (Extra large). */
const walk = (size: Size): SmallerSize[] => (size === "xl" ? [] : SMALLER_SIZES.slice(0, SMALLER_SIZES.indexOf(size) + 1).reverse());

/**
 * A setting's value at a size: the size's own, else the next larger size's, up to the part's own value (Extra large).
 * Undefined where it is set nowhere on the way; the reader decides what that means (`stackAt()`, a default per size).
 */
export function valueAt<K extends keyof PartSizeSettings>(part: WithAt & Partial<Record<K, unknown>>, key: K, size: Size): PartSizeSettings[K] | undefined {
  for (const s of walk(size)) {
    const value = part.at?.[s]?.[key];
    if (value !== undefined) return value;
  }
  return (part as Partial<Record<K, PartSizeSettings[K]>>)[key];
}

/** A part's margin and padding at a size, each walked on its own (an override of padding alone keeps the larger margin). */
export function spacingAt(part: WithAt & { style?: Spacing }, size: Size): Spacing {
  const pick = (kind: "margin" | "padding"): Sides | undefined => {
    for (const s of walk(size)) {
      const value = part.at?.[s]?.style?.[kind];
      if (value !== undefined) return value;
    }
    return part.style?.[kind];
  };
  const margin = pick("margin");
  const padding = pick("padding");
  return { ...(margin && { margin }), ...(padding && { padding }) };
}

/** Whether a row's columns stack at a size: as set, else on Small only (as rows always have). */
export const stackAt = (row: Pick<PageRow, "stack" | "at">, size: Size): boolean => valueAt(row, "stack", size) ?? size === "sm";

/** A row whose columns never stack, at any size (D80: a header's logo, menu and icons): its inline columns keep to one line. */
export const neverStacks = (row: Pick<PageRow, "stack" | "at">): boolean => SIZES.every((size) => !stackAt(row, size));

/** Whether a part is hidden at a size by its visibility (D179 4: CSS, `display: none`). */
export const hiddenAt = (part: { visibility?: { hideAt?: Size[] } }, size: Size): boolean => part.visibility?.hideAt?.includes(size) ?? false;

/** A copy of `at` with `key` set (or taken away, for undefined) at a size; undefined when nothing is left. */
export function withAt<K extends keyof PartSizeSettings>(at: At | undefined, size: SmallerSize, key: K, value: PartSizeSettings[K] | undefined): At | undefined {
  const next: At = {};
  for (const s of SMALLER_SIZES) {
    const own = { ...(at?.[s] ?? {}) } as PartSizeSettings;
    if (s === size) {
      if (value === undefined) delete own[key];
      else own[key] = value;
    }
    if (Object.keys(own).length > 0) next[s] = own;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/** `at` without `key` at any size. */
const without = <K extends keyof PartSizeSettings>(at: At | undefined, key: K): At | undefined =>
  SMALLER_SIZES.reduce<At | undefined>((acc, size) => withAt(acc, size, key, undefined), at);

// ---------------------------------------------------------------------------
// Alignments: by screen, smaller to larger (D48), into a base and overrides
// ---------------------------------------------------------------------------

const ALIGNS: readonly string[] = ["left", "center", "right"];
const alignOf = (value: unknown): TextAlign | undefined => (typeof value === "string" && ALIGNS.includes(value) ? (value as TextAlign) : undefined);

/**
 * An alignment by screen as pages had it (phones, from tablets, from computers; each unset follows the smaller) as
 * the values of the four sizes. A screen with nothing set and a larger one set reads "left", the editor's and the
 * page's own default (left to right).
 */
function alignSizes(view: TextAlignments): Record<Size, TextAlign> | null {
  const mobile = alignOf(view.mobile);
  const tablet = alignOf(view.tablet) ?? mobile;
  const desktop = alignOf(view.desktop) ?? tablet;
  if (!desktop) return null;
  return { xl: desktop, lg: desktop, md: tablet ?? "left", sm: mobile ?? "left" };
}

/** An alignment by screen as a base value and the overrides of the sizes that differ from the size above them. */
function alignSettings(view: TextAlignments): { align?: TextAlign; md?: TextAlign; sm?: TextAlign } {
  const sizes = alignSizes(view);
  if (!sizes) return {};
  return { align: sizes.xl, ...(sizes.md !== sizes.xl && { md: sizes.md }), ...(sizes.sm !== sizes.md && { sm: sizes.sm }) };
}

/** A part's alignment as the editor's three screens show it (phones, tablets, computers), from the values at Small, Medium and Large. */
export function alignView(part: WithAt & { align?: TextAlign }): TextAlignments | undefined {
  const sm = valueAt(part, "align", "sm");
  const md = valueAt(part, "align", "md");
  const lg = valueAt(part, "align", "lg");
  const view: TextAlignments = {};
  if (sm && sm !== "left") view.mobile = sm;
  if (md && md !== (sm ?? "left")) view.tablet = md;
  if (lg && lg !== (md ?? sm ?? "left")) view.desktop = lg;
  return Object.keys(view).length > 0 ? view : undefined;
}

/** What setting an alignment by the editor's three screens changes on a part: its base alignment and its overrides. */
export function alignPatch(part: WithAt, view: TextAlignments | undefined): { align: TextAlign | undefined; at: At | undefined } {
  const settings = alignSettings(view ?? {});
  let at = without(part.at, "align");
  if (settings.md) at = withAt(at, "md", "align", settings.md);
  if (settings.sm) at = withAt(at, "sm", "align", settings.sm);
  return { align: settings.align, at };
}

// ---------------------------------------------------------------------------
// Columns of a grid: by screen (D51) into a base and overrides
// ---------------------------------------------------------------------------

/** A grid's columns as the editor shows them (phones, tablets, computers): the values at Small, Medium and Large. */
export function columnsView(part: WithAt & { columns?: number }, fallback: GridColumns): GridColumns {
  const has = part.columns !== undefined || SMALLER_SIZES.some((s) => part.at?.[s]?.columns !== undefined);
  if (!has) return fallback;
  return {
    mobile: valueAt(part, "columns", "sm") ?? fallback.mobile,
    tablet: valueAt(part, "columns", "md") ?? fallback.tablet,
    desktop: valueAt(part, "columns", "lg") ?? fallback.desktop,
  };
}

/** What setting columns by the editor's three screens changes: the base (computers) and the overrides of the smaller sizes. */
export function columnsPatch(part: WithAt, view: GridColumns): { columns: number; at: At | undefined } {
  let at = without(part.at, "columns");
  if (view.tablet !== view.desktop) at = withAt(at, "md", "columns", view.tablet);
  if (view.mobile !== view.tablet) at = withAt(at, "sm", "columns", view.mobile);
  return { columns: view.desktop, at };
}

// ---------------------------------------------------------------------------
// Switches for phones, as the editor keeps them until the per-size editor (phase 2)
// ---------------------------------------------------------------------------

/** A row kept side by side on phones (D80): its columns never stack, closer together on Small as they always were. */
export const rowSideBySide = (row: Pick<PageRow, "stack" | "at">): boolean => !stackAt(row, "sm");

export function sideBySidePatch(row: Pick<PageRow, "stack" | "at" | "gap">, on: boolean): Pick<PageRow, "stack" | "at"> {
  let at = without(row.at, "stack");
  at = without(at, "reverse");
  if (on) {
    if (valueAt({ at }, "gap", "sm") === undefined && row.gap === undefined) at = withAt(at, "sm", "gap", SIDE_BY_SIDE_GAP);
    return { stack: false, at };
  }
  if (at?.sm?.gap === SIDE_BY_SIDE_GAP) at = withAt(at, "sm", "gap", undefined);
  return { stack: undefined, at };
}

/** A row's columns, stacked on phones, last first. */
export const rowReversedOnPhones = (row: Pick<PageRow, "reverse" | "at">): boolean => valueAt(row, "reverse", "sm") === true;
export const reversePatch = (row: WithAt, on: boolean): Pick<PageRow, "at"> => ({ at: withAt(row.at, "sm", "reverse", on || undefined) });

/** A dual button's two, one under another on phones. */
export const stackedOnPhones = (block: Pick<PageBlock, "at"> & { stack?: boolean }): boolean => valueAt(block, "stack", "sm") === true;
export const stackPatch = (block: WithAt, on: boolean): WithAt => ({ at: withAt(block.at, "sm", "stack", on || undefined) });

/** A part left out on phones (a header's menu, say). */
export const hiddenOnPhones = (part: { visibility?: { hideAt?: Size[] } }): boolean => hiddenAt(part, "sm");
export function hideOnPhonesPatch(part: { visibility?: { hideAt?: Size[] } }, on: boolean): { visibility: { hideAt?: Size[] } | undefined } {
  const others = (part.visibility?.hideAt ?? []).filter((size) => size !== "sm");
  const hideAt = on ? SIZES.filter((size) => size === "sm" || others.includes(size)) : others;
  const rest = { ...part.visibility, hideAt: hideAt.length > 0 ? hideAt : undefined };
  if (rest.hideAt === undefined) delete rest.hideAt;
  return { visibility: Object.keys(rest).length > 0 ? rest : undefined };
}

/** A content grid that is a carousel on phones only (D155): a grid from Medium up. */
export const carouselOnPhonesOnly = (block: { display?: "carousel"; at?: At }): boolean =>
  valueAt(block, "display", "sm") === "carousel" && valueAt(block, "display", "xl") !== "carousel";

/** A grid shown as a carousel at a size. */
export const carouselAt = (block: { display?: "carousel"; at?: At }, size: Size): boolean => valueAt(block, "display", size) === "carousel";
/** Whether a grid is a carousel at any size: it is then drawn as one, laid out as a grid where it is not. */
export const carouselAnywhere = (block: { display?: "carousel"; at?: At }): boolean => SIZES.some((size) => carouselAt(block, size));

/** A grid's display: `carousel` everywhere, on phones only, or a grid. */
export function displayPatch(block: { at?: At }, display: "grid" | "carousel" | "phones"): { display: "carousel" | undefined; at: At | undefined } {
  const at = without(block.at, "display");
  if (display === "phones") return { display: undefined, at: withAt(at, "sm", "display", "carousel") };
  return { display: display === "carousel" ? "carousel" : undefined, at };
}

// ---------------------------------------------------------------------------
// The upgrade of saved shapes
// ---------------------------------------------------------------------------

/** The gap between a side-by-side row's columns on phones (Tailwind's `gap-2`), which rows kept side by side always had. */
export const SIDE_BY_SIDE_GAP = 8;

/**
 * `at` of a stored part with `key` set at a size. A setting saved the old way says all there is to say about its key, so
 * it takes the place of any override of that key (a stored part never has both; a test or a hand-made part may).
 */
function setAt(raw: Json, size: SmallerSize, key: string, value: unknown) {
  const at = isObject(raw.at) ? { ...raw.at } : {};
  const own = isObject(at[size]) ? { ...(at[size] as Json) } : {};
  own[key] = value;
  at[size] = own;
  raw.at = at;
}

/** `at` of a stored part without `key` at any size, before an old setting of that key is read into it. */
function clearAt(raw: Json, key: string) {
  if (!isObject(raw.at)) return;
  const at: Json = {};
  for (const size of SMALLER_SIZES) {
    const own = isObject(raw.at[size]) ? { ...(raw.at[size] as Json) } : undefined;
    if (!own) continue;
    delete own[key];
    if (Object.keys(own).length > 0) at[size] = own;
  }
  if (Object.keys(at).length > 0) raw.at = at;
  else delete raw.at;
}

/** A row as saved before D179, in the new shape; a row already in it is returned as it is. */
export function upgradeRow(value: unknown): unknown {
  if (!isObject(value) || !("sideBySide" in value || "reverseOnMobile" in value)) return value;
  const row: Json = { ...value };
  const sideBySide = row.sideBySide === true;
  const reverse = row.reverseOnMobile === true;
  delete row.sideBySide;
  delete row.reverseOnMobile;
  clearAt(row, "reverse");
  if (sideBySide) {
    // Never stacked; 8 px between columns on phones, 32 from tablets (`gap-2 md:gap-8`). Reversing never applied.
    row.stack = false;
    clearAt(row, "stack");
    clearAt(row, "gap");
    setAt(row, "sm", "gap", SIDE_BY_SIDE_GAP);
  } else if (reverse) setAt(row, "sm", "reverse", true);
  return row;
}

/** A column as saved before D179, in the new shape (columns had no switch of their own: as it is). */
export const upgradeColumn = (value: unknown): unknown => value;

/** Columns by screen as saved before D179, within the limits they always had (phones 2, tablets 4, computers 8); others are left for the schema to refuse. */
const OLD_COLUMNS_MAX = { mobile: 2, tablet: 4, desktop: 8 } as const;
const isGridColumns = (value: unknown): value is GridColumns =>
  isObject(value) &&
  (["mobile", "tablet", "desktop"] as const).every((screen) => {
    const count = value[screen];
    return typeof count === "number" && Number.isInteger(count) && count >= 1 && count <= OLD_COLUMNS_MAX[screen];
  });

/** A block as saved before D179, in the new shape; a block already in it is returned as it is. */
export function upgradeBlock(value: unknown): unknown {
  if (!isObject(value)) return value;
  const old =
    isObject(value.align) ||
    "hideOnPhones" in value ||
    "stackOnPhones" in value ||
    "carouselOn" in value ||
    isGridColumns(value.columns);
  if (!old) return value;
  const block: Json = { ...value };
  // An alignment by screen with a value that is not one is left as it is, so the schema refuses it as it always did.
  const screens = isObject(block.align) ? Object.values(block.align) : [];
  if (isObject(block.align) && screens.every((value) => value === undefined || alignOf(value) !== undefined)) {
    const settings = alignSettings(block.align as TextAlignments);
    delete block.align;
    clearAt(block, "align");
    if (settings.align) block.align = settings.align;
    if (settings.md) setAt(block, "md", "align", settings.md);
    if (settings.sm) setAt(block, "sm", "align", settings.sm);
  }
  if ("hideOnPhones" in block) {
    const hide = block.hideOnPhones === true;
    delete block.hideOnPhones;
    if (hide) {
      const visibility = isObject(block.visibility) ? { ...block.visibility } : {};
      const hideAt = Array.isArray(visibility.hideAt) ? (visibility.hideAt as Size[]) : [];
      visibility.hideAt = SIZES.filter((size) => size === "sm" || hideAt.includes(size));
      block.visibility = visibility;
    }
  }
  if ("stackOnPhones" in block) {
    const stack = block.stackOnPhones === true;
    delete block.stackOnPhones;
    clearAt(block, "stack");
    if (stack) setAt(block, "sm", "stack", true);
  }
  if ("carouselOn" in block) {
    const phones = block.carouselOn === "phones" && block.display === "carousel";
    delete block.carouselOn;
    if (phones) {
      // A carousel on phones, a grid from tablets' width.
      delete block.display;
      clearAt(block, "display");
      setAt(block, "sm", "display", "carousel");
    }
  }
  if (isGridColumns(block.columns)) {
    const { mobile, tablet, desktop } = block.columns;
    block.columns = desktop;
    clearAt(block, "columns");
    if (tablet !== desktop) setAt(block, "md", "columns", tablet);
    if (mobile !== tablet) setAt(block, "sm", "columns", mobile);
  }
  return block;
}

/**
 * Rows as saved before D179, with their columns and blocks, in the new shape: what the schemas do part by part on every read
 * (`pageRowSchema`, `pageColumnSchema`, `pageBlockSchema`), at once (for tests and the parity check). Takes rows or a
 * page's content (`{ rows }`).
 */
export function upgradeResponsive(rows: unknown): unknown {
  if (isObject(rows) && Array.isArray(rows.rows)) return { ...rows, rows: upgradeResponsive(rows.rows) };
  if (!Array.isArray(rows)) return rows;
  return rows.map((raw) => {
    const row = upgradeRow(raw);
    if (!isObject(row) || !Array.isArray(row.columns)) return row;
    return {
      ...row,
      columns: row.columns.map((rawColumn) => {
        const column = upgradeColumn(rawColumn);
        if (!isObject(column) || !Array.isArray(column.blocks)) return column;
        return { ...column, blocks: column.blocks.map(upgradeBlock) };
      }),
    };
  });
}
