import {
  blockHasContent,
  BLOCKS_MAX,
  ROWS_MAX,
  pageBlocks,
  type PageBlock,
  type PageColumn,
  type PageRow,
} from "./page-content";
import type { PageLayout } from "./page-layout";
import { withoutUses } from "./global-parts";
import { copyRow, htmlIds } from "./page-rows";

/**
 * Putting a page layout template (D127) on a page: either in place of the page's rows or after them. Pure, so the
 * builder and its tests share it. The rows are always copies with fresh ids and custom ids the page does not already
 * use; nothing here saves anything, the page is only changed in the editor and saved when the person saves it.
 */

export type ApplyMode = "replace" | "add";

/** What a page holds now, of the parts a layout changes. */
export type PageNow = { rows: PageRow[]; css?: string };

/** The page's new rows and, when the layout changes it, its CSS (`css` undefined: keep the page's own). */
export type Applied = { rows: PageRow[]; css: string | undefined };

/** A page nobody has written anything on: every block is empty, so replacing it loses nothing. */
export const isBlankPage = (rows: readonly PageRow[]): boolean =>
  pageBlocks({ rows: rows as PageRow[] }).every((block) => !blockHasContent(block));

/** A template's content grids show this store's own products, not the categories and tags of whoever made it (D56). */
const forStoreBlock = (block: PageBlock): PageBlock =>
  block.type === "contentGrid"
    ? {
        ...block,
        source: block.source.type === "products" ? { type: "products" } : block.source,
        categories: [],
        tags: [],
      }
    : block;
const forStoreColumn = (column: PageColumn): PageColumn => ({ ...column, blocks: column.blocks.map(forStoreBlock) });

/** A row of a template made ready for this store: no marks of a global's uses, grids of its own products. */
export const forStoreRow = (row: PageRow): PageRow => {
  const plain = withoutUses("row", row);
  return { ...plain, columns: plain.columns.map(forStoreColumn) };
};

/** What the page would hold, or why the layout does not fit: the page's caps on rows and blocks. */
export function layoutRoomProblem(
  current: Pick<PageNow, "rows">,
  layout: Pick<PageLayout, "rows">,
  mode: ApplyMode,
): string | null {
  const rows = (mode === "add" ? current.rows.length : 0) + layout.rows.length;
  if (rows > ROWS_MAX) {
    return mode === "add"
      ? `The page would have ${rows} rows, and a page takes at most ${ROWS_MAX}. Replace its layout instead, or delete some rows first.`
      : `The layout has ${rows} rows, and a page takes at most ${ROWS_MAX}.`;
  }
  const blocks =
    (mode === "add" ? pageBlocks({ rows: current.rows }).length : 0) + pageBlocks({ rows: layout.rows }).length;
  if (blocks > BLOCKS_MAX) {
    return mode === "add"
      ? `The page would have ${blocks} blocks, and a page takes at most ${BLOCKS_MAX}. Replace its layout instead, or delete some blocks first.`
      : `The layout has ${blocks} blocks, and a page takes at most ${BLOCKS_MAX}.`;
  }
  return null;
}

/**
 * The CSS the page gets from a layout: replacing takes the layout's own CSS when it has some (a layout without any
 * leaves the page's alone rather than wiping it), adding only fills a page that has none. Undefined: no change.
 */
export function cssAfter(
  current: Pick<PageNow, "css">,
  layout: Pick<PageLayout, "css">,
  mode: ApplyMode,
): string | undefined {
  const own = (current.css ?? "").trim();
  const theirs = layout.css.trim();
  if (!theirs) return undefined;
  if (mode === "replace") return theirs === own ? undefined : theirs;
  return own ? undefined : theirs;
}

/** One line for the confirmation: what happens to the page's CSS, or null when nothing does. */
export function cssNote(
  current: Pick<PageNow, "css">,
  layout: Pick<PageLayout, "css">,
  mode: ApplyMode,
): string | null {
  const own = (current.css ?? "").trim();
  const theirs = layout.css.trim();
  if (!theirs) return own ? "This page's custom CSS stays as it is." : null;
  if (mode === "replace")
    return own
      ? "The layout's custom CSS replaces this page's own CSS."
      : "The layout's custom CSS is added to this page.";
  return own
    ? "This page keeps its own custom CSS; the layout's is not added."
    : "The layout's custom CSS is added to this page.";
}

/**
 * Applies a layout to a page. `foreign` is a template from another store (already made ready by the server): its marks
 * of a global's uses are dropped and its grids show this store's products. A layout the store saved itself keeps the uses
 * of its globals, as duplicating a row does. Refuses (`problem`) a result over the page's caps.
 */
export function applyPageLayout(
  current: PageNow,
  layout: Pick<PageLayout, "rows" | "css">,
  mode: ApplyMode,
  newId: () => string,
  foreign = false,
): ({ ok: true } & Applied) | { ok: false; problem: string } {
  const problem = layoutRoomProblem(current, layout, mode);
  if (problem) return { ok: false, problem };
  // Custom ids and modal keys already on the page stay the page's; the copies give up theirs when they clash (D48, D121).
  const taken = mode === "add" ? htmlIds(current.rows) : new Set<string>();
  const copies = layout.rows.map((row) => copyRow(foreign ? forStoreRow(row) : row, newId, taken));
  return {
    ok: true,
    rows: mode === "add" ? [...current.rows, ...copies] : copies,
    css: cssAfter(current, layout, mode),
  };
}

/**
 * What the person is told before a page that has something on it is replaced. The builder has no undo, so this says what
 * is true: nothing is saved until the page is, so reloading brings the saved rows back (a page never saved has none).
 * Null for a blank page, where nothing is lost.
 */
export function replaceWarning(rows: readonly PageRow[], pageSaved: boolean, noun: string): string | null {
  if (isBlankPage(rows)) return null;
  const count = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;
  return `This replaces the ${count} on this ${noun}. ${
    pageSaved
      ? "The builder has no undo, but nothing is saved until you save the page, so reloading it brings the old rows back."
      : "This page has not been saved yet, so the old rows cannot be brought back."
  }`;
}
