import { SIZES } from "./breakpoints";
import type { PageRow } from "./page-content";
import { valueAt } from "./responsive";

/**
 * Rows that meet (D262): a page's rows are drawn with room between them, except where a row and the one above it both draw a box of
 * their own (a background or a border), which then meet, as sections do. Each row's own margin still keeps it apart. Pure, for the site
 * and the builder's canvas, which ask it of the rows as drawn (the theme laid under them, so a section style's background counts).
 */

/** The room between rows that do not meet: the site's article and the canvas's list (`gap-8`). */
export const ROW_GAP = "2rem";

/**
 * Whether a row draws a box at every screen size: a background (of any kind) or a border. A modal is not in the page's flow, and a
 * row shown only at some sizes or to some visitors may be left out where the row next to it is drawn, so neither meets another.
 */
export function drawsBox(row: PageRow): boolean {
  if (row.modal) return false;
  if ((row.visibility?.hideAt?.length ?? 0) > 0) return false;
  if (row.visibility?.show !== undefined && row.visibility.show !== "always") return false;
  return SIZES.every((size) => Boolean(valueAt(row, "background", size)) || Boolean(valueAt(row, "border", size)));
}

/** Whether a row meets the row drawn above it, with no room between them. */
export const meetsAbove = (above: PageRow | undefined, row: PageRow): boolean => Boolean(above) && drawsBox(above!) && drawsBox(row);

/** The row drawn above a page's row in its flow: the nearest before it that is not a modal (a modal is drawn in a dialog, D121). */
export const rowAbove = (rows: readonly PageRow[], index: number): PageRow | undefined => rows.slice(0, index).findLast((row) => !row.modal);
