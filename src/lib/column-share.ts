import { ROW_LAYOUTS, columnLines, rowLayouts, type PageColumn, type PageRow } from "./page-content";
import { stackAt, valueAt } from "./responsive";

/**
 * The part of a row's width a column takes on the smallest screen size, between 0 and 1: 1 where the row's columns are one under
 * another (the default on a phone), else the column's share of its line by the layout's widths or the column's own (`width`).
 * A hint for a picture's `sizes` (bloat review step 0.44), so 1 (the whole screen) is the safe answer whenever the share is not
 * known: a column as wide as what it holds (width 0), or one that is not in the row. Server only: it imports the page model.
 */
export function phoneShare(row: PageRow, column: PageColumn): number {
  if (stackAt(row, "sm")) return 1;
  const lines = columnLines(row);
  const layouts = rowLayouts(row);
  const i = lines.findIndex((line) => line.some((c) => c.id === column.id));
  if (i < 0) return 1;
  const widths = ROW_LAYOUTS[layouts[i]].widths as readonly number[];
  const shares = lines[i].map((c, j) => ({ id: c.id, w: valueAt(c, "width", "sm") ?? widths[j] ?? 1 }));
  if (shares.some((s) => s.w === 0)) return 1;
  const sum = shares.reduce((n, s) => n + s.w, 0);
  const own = shares.find((s) => s.id === column.id)?.w ?? 0;
  return sum > 0 && own > 0 ? own / sum : 1;
}
