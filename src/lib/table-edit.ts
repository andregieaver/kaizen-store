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

// ---------------------------------------------------------------------------
// Section dividers (D197): `sections[r]` is the title of a divider above row r (null: none)
// ---------------------------------------------------------------------------

export type Sections = (string | null)[];
export type TableData = { rows: Cells; sections?: Sections };

/** The sections without trailing nothing; none at all when no row has one. */
function tidy(sections: Sections): Sections | undefined {
  let end = sections.length;
  while (end > 0 && sections[end - 1] == null) end--;
  return end === 0 ? undefined : sections.slice(0, end);
}

const padded = (table: TableData): Sections => Array.from({ length: table.rows.length }, (_, r) => table.sections?.[r] ?? null);

/** A new row after `after` (-1: first), the sections following their rows. */
export function addRowTo(table: TableData, after: number = table.rows.length - 1): TableData {
  const rows = addRow(table.rows, after);
  if (rows === table.rows) return table;
  const at = Math.min(Math.max(after + 1, 0), table.rows.length);
  const sections = padded(table);
  return { rows, sections: tidy([...sections.slice(0, at), null, ...sections.slice(at)]) };
}

/** A row taken out with the divider above it. */
export function removeRowFrom(table: TableData, index: number): TableData {
  const rows = removeRow(table.rows, index);
  if (table.rows.length <= 1) return { rows, sections: undefined };
  return { rows, sections: tidy(padded(table).filter((_, i) => i !== index)) };
}

/** A divider put above row `r` with this title (empty: a plain line), or taken away with null. */
export function setSection(table: TableData, r: number, title: string | null): TableData {
  if (r < 0 || r >= table.rows.length) return table;
  const sections = padded(table);
  sections[r] = title;
  return { rows: table.rows, sections: tidy(sections) };
}

/** What lies in a table's body, in order: rows and the dividers between them, each its own thing to drag (D202). */
export type Entry = { divider: string } | { row: string[] };

/** The body's entries from row `start` on (1 when the first row is a header, else 0): a divider before the row it lies above. */
export function entriesOf(table: TableData, start: number): Entry[] {
  const out: Entry[] = [];
  for (let r = start; r < table.rows.length; r++) {
    const title = table.sections?.[r];
    if (title != null) out.push({ divider: title });
    out.push({ row: table.rows[r] });
  }
  return out;
}

/** The table back from its head rows (the header, kept as it is) and its body's entries. */
function fromEntries(table: TableData, start: number, entries: Entry[]): TableData {
  const head = table.rows.slice(0, start);
  const rows: Cells = [...head];
  const sections: Sections = Array.from({ length: start }, (_, r) => table.sections?.[r] ?? null);
  let pending: string | null = null;
  for (const entry of entries) {
    if ("divider" in entry) pending = entry.divider;
    else {
      sections[rows.length] = pending;
      rows.push(entry.row);
      pending = null;
    }
  }
  return { rows, sections: tidy(sections) };
}

/**
 * An entry (a row, or a divider) moved to another place in the body, each by itself: a divider does not take the row under it, nor a
 * row its divider. Unchanged where it would leave two dividers together or one at the end, which have nothing to divide.
 */
export function moveEntry(table: TableData, start: number, from: number, to: number): TableData {
  const entries = entriesOf(table, start);
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return table;
  const next = [...entries];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  const bad = next.some((entry, i) => "divider" in entry && (i === next.length - 1 || "divider" in next[i + 1]));
  return bad ? table : fromEntries(table, start, next);
}
