import { TABLE_COLUMNS_MAX, TABLE_ROWS_MAX } from "./page-content";

/**
 * The edits of a table block's cells (D194), pure so the builder's grid and its tests share them. Rows stay rectangular: every
 * row has as many cells as the first, and a table always keeps one row and one column.
 */

export type Cells = string[][];

const width = (rows: Cells) => rows[0]?.length ?? 1;

/** A new empty row after `after` (the end by default; -1 puts it first); unchanged at the limit. */
export function addRow(rows: Cells, after: number = rows.length - 1): Cells {
  if (rows.length >= TABLE_ROWS_MAX) return rows;
  const at = Math.min(Math.max(after + 1, 0), rows.length);
  return [...rows.slice(0, at), Array.from({ length: width(rows) }, () => ""), ...rows.slice(at)];
}

/** A row taken out; the last one stays (emptied). */
export function removeRow(rows: Cells, index: number): Cells {
  if (rows.length <= 1) return rows.map((row) => row.map(() => ""));
  return rows.filter((_, i) => i !== index);
}

/** A new empty column after `after` (the end by default; -1 puts it first); unchanged at the limit. */
export function addColumn(rows: Cells, after: number = width(rows) - 1): Cells {
  if (width(rows) >= TABLE_COLUMNS_MAX) return rows;
  const at = Math.min(Math.max(after + 1, 0), width(rows));
  return rows.map((row) => [...row.slice(0, at), "", ...row.slice(at)]);
}

/** A column taken out; the last one stays (emptied). */
export function removeColumn(rows: Cells, index: number): Cells {
  if (width(rows) <= 1) return rows.map((row) => row.map(() => ""));
  return rows.map((row) => row.filter((_, i) => i !== index));
}

/** One cell's words changed. */
export function setCell(rows: Cells, r: number, c: number, text: string): Cells {
  return rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? text : cell)) : row));
}
