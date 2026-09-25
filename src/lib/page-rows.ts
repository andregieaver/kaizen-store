import {
  EMPTY_DOC,
  ROW_LAYOUTS,
  type BlockType,
  type PageBlock,
  type PageColumn,
  type PageRow,
  type RowLayout,
  type Spacing,
} from "./page-content";

/**
 * The page builder's edits (D43), as pure functions on a page's rows: each
 * returns new rows and leaves the old ones as they were. Shared by drag and
 * drop and by the buttons that do the same without a mouse.
 */

export type NewId = () => string;

/** Where a block is: its row, its column in that row, and its place in the column. */
export type BlockPlace = { rowId: string; columnId: string; index: number };

export function newRow(layout: RowLayout, id: NewId): PageRow {
  return {
    id: id(),
    type: "row",
    layout,
    columns: ROW_LAYOUTS[layout].widths.map(() => ({ id: id(), blocks: [] })),
  };
}

export function newBlock(type: BlockType, id: NewId): PageBlock {
  switch (type) {
    case "richText":
      return { id: id(), type, doc: EMPTY_DOC };
    case "image":
      return { id: id(), type, image: null, caption: "" };
  }
}

const clamp = (index: number, length: number) => Math.max(0, Math.min(index, length));

export function insertRow(rows: PageRow[], row: PageRow, index: number): PageRow[] {
  const next = [...rows];
  next.splice(clamp(index, rows.length), 0, row);
  return next;
}

/** Moves a row to `to`, its place counted after it has been taken out. */
export function moveRow(rows: PageRow[], rowId: string, to: number): PageRow[] {
  const from = rows.findIndex((r) => r.id === rowId);
  if (from < 0) return rows;
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(clamp(to, next.length), 0, row);
  return next;
}

export function removeRow(rows: PageRow[], rowId: string): PageRow[] {
  return rows.filter((r) => r.id !== rowId);
}

/**
 * Gives a row another layout. Columns are kept in order; when there are
 * fewer, the blocks of the columns that go move to the new last column,
 * so nothing written is lost.
 */
export function setRowLayout(rows: PageRow[], rowId: string, layout: RowLayout, id: NewId): PageRow[] {
  return rows.map((row) => {
    if (row.id !== rowId || row.layout === layout) return row;
    const count = ROW_LAYOUTS[layout].widths.length;
    const kept = row.columns.slice(0, count).map((c) => ({ ...c, blocks: [...c.blocks] }));
    const dropped = row.columns.slice(count).flatMap((c) => c.blocks);
    while (kept.length < count) kept.push({ id: id(), blocks: [] });
    kept[count - 1].blocks.push(...dropped);
    return { ...row, layout, columns: kept };
  });
}

function mapColumn(rows: PageRow[], columnId: string, change: (blocks: PageBlock[]) => PageBlock[]): PageRow[] {
  return rows.map((row) =>
    row.columns.some((c) => c.id === columnId)
      ? { ...row, columns: row.columns.map((c) => (c.id === columnId ? { ...c, blocks: change(c.blocks) } : c)) }
      : row,
  );
}

export function findBlock(rows: PageRow[], blockId: string): (BlockPlace & { block: PageBlock }) | null {
  for (const row of rows) {
    for (const column of row.columns) {
      const index = column.blocks.findIndex((b) => b.id === blockId);
      if (index >= 0) return { rowId: row.id, columnId: column.id, index, block: column.blocks[index] };
    }
  }
  return null;
}

export function insertBlock(rows: PageRow[], columnId: string, block: PageBlock, index: number): PageRow[] {
  return mapColumn(rows, columnId, (blocks) => {
    const next = [...blocks];
    next.splice(clamp(index, blocks.length), 0, block);
    return next;
  });
}

export function removeBlock(rows: PageRow[], blockId: string): PageRow[] {
  const place = findBlock(rows, blockId);
  return place ? mapColumn(rows, place.columnId, (blocks) => blocks.filter((b) => b.id !== blockId)) : rows;
}

/**
 * Moves a block into a column (its own or another, in any row) at `index`,
 * counted after it has been taken out.
 */
export function moveBlock(rows: PageRow[], blockId: string, columnId: string, index: number): PageRow[] {
  const place = findBlock(rows, blockId);
  if (!place) return rows;
  return insertBlock(removeBlock(rows, blockId), columnId, place.block, index);
}

export function updateBlock(rows: PageRow[], blockId: string, change: (block: PageBlock) => PageBlock): PageRow[] {
  const place = findBlock(rows, blockId);
  return place ? mapColumn(rows, place.columnId, (blocks) => blocks.map((b) => (b.id === blockId ? change(b) : b))) : rows;
}

/** The layout with `count` equal columns (1 to 6). */
export function equalLayout(count: number): RowLayout {
  return String(Math.max(1, Math.min(6, count))) as RowLayout;
}

/** Copies with new ids throughout: for duplicating, and for putting a saved part on the page (D46). */
export const copyBlock = (block: PageBlock, id: NewId): PageBlock => ({ ...structuredClone(block), id: id() });
export const copyColumn = (column: PageColumn, id: NewId): PageColumn => ({
  id: id(),
  blocks: column.blocks.map((b) => copyBlock(b, id)),
});
export const copyRow = (row: PageRow, id: NewId): PageRow => ({
  ...row,
  id: id(),
  columns: row.columns.map((c) => copyColumn(c, id)),
});

/** A copy of the row, with new ids throughout, right after it. */
export function duplicateRow(rows: PageRow[], rowId: string, id: NewId): PageRow[] {
  const index = rows.findIndex((r) => r.id === rowId);
  if (index < 0) return rows;
  return insertRow(rows, copyRow(rows[index], id), index + 1);
}

/** A copy of the block right after it. */
export function duplicateBlock(rows: PageRow[], blockId: string, id: NewId): PageRow[] {
  const place = findBlock(rows, blockId);
  return place ? insertBlock(rows, place.columnId, copyBlock(place.block, id), place.index + 1) : rows;
}

function findColumn(rows: PageRow[], columnId: string): { row: PageRow; index: number } | null {
  for (const row of rows) {
    const index = row.columns.findIndex((c) => c.id === columnId);
    if (index >= 0) return { row, index };
  }
  return null;
}

/** Whether a column can be copied: a row takes at most six columns. */
export function canDuplicateColumn(rows: PageRow[], columnId: string): boolean {
  const found = findColumn(rows, columnId);
  return Boolean(found && found.row.columns.length < 6);
}

/**
 * A copy of the column right after it. The row gets one more column, so its
 * columns become equal (a sidebar layout has a set number of columns).
 */
export function duplicateColumn(rows: PageRow[], columnId: string, id: NewId): PageRow[] {
  const found = findColumn(rows, columnId);
  if (!found || found.row.columns.length >= 6) return rows;
  const columns = [...found.row.columns];
  columns.splice(found.index + 1, 0, copyColumn(columns[found.index], id));
  return rows.map((r) => (r.id === found.row.id ? { ...r, layout: equalLayout(columns.length), columns } : r));
}

/** Takes a column and its blocks out; the rest become equal. A row keeps at least one column. */
export function removeColumn(rows: PageRow[], columnId: string): PageRow[] {
  const found = findColumn(rows, columnId);
  if (!found || found.row.columns.length <= 1) return rows;
  const columns = found.row.columns.filter((c) => c.id !== columnId);
  return rows.map((r) => (r.id === found.row.id ? { ...r, layout: equalLayout(columns.length), columns } : r));
}

/** Moves a column within its row; widths stay with the places, so it takes the width of its new place. */
export function moveColumn(rows: PageRow[], columnId: string, to: number): PageRow[] {
  const found = findColumn(rows, columnId);
  if (!found) return rows;
  const columns = [...found.row.columns];
  const [column] = columns.splice(found.index, 1);
  columns.splice(clamp(to, columns.length), 0, column);
  return rows.map((r) => (r.id === found.row.id ? { ...r, columns } : r));
}

/**
 * Moves a column, with all its blocks, to `index` among another row's
 * columns (or its own: then as `moveColumn`, keeping the layout). The
 * target row's columns become equal, one more of them; the row it left
 * becomes equal with one fewer, or goes if that was its only column. A row
 * already holding six columns takes no more.
 */
export function moveColumnTo(rows: PageRow[], columnId: string, rowId: string, index: number): PageRow[] {
  const found = findColumn(rows, columnId);
  const target = rows.find((r) => r.id === rowId);
  if (!found || !target) return rows;
  if (found.row.id === rowId) return moveColumn(rows, columnId, index);
  if (target.columns.length >= 6) return rows;
  const column = found.row.columns[found.index];
  return rows.flatMap((row) => {
    if (row.id === found.row.id) {
      const columns = row.columns.filter((c) => c.id !== columnId);
      return columns.length === 0 ? [] : [{ ...row, layout: equalLayout(columns.length), columns }];
    }
    if (row.id === rowId) {
      const columns = [...row.columns];
      columns.splice(clamp(index, columns.length), 0, column);
      return [{ ...row, layout: equalLayout(columns.length), columns }];
    }
    return [row];
  });
}

/**
 * Puts a column into a row at `index`; the row's columns become equal, one
 * more of them. A row already holding six columns takes no more.
 */
export function insertColumn(rows: PageRow[], rowId: string, column: PageColumn, index: number): PageRow[] {
  return rows.map((row) => {
    if (row.id !== rowId || row.columns.length >= 6) return row;
    const columns = [...row.columns];
    columns.splice(clamp(index, columns.length), 0, column);
    return { ...row, layout: equalLayout(columns.length), columns };
  });
}

/** Where spacing is set: a row, a column or a block, by id. */
export type Styled = { kind: "row" | "column" | "block"; id: string };

/** Gives a row, column or block its margin and padding (D47). */
export function setSpacing(rows: PageRow[], target: Styled, style: Spacing): PageRow[] {
  if (target.kind === "block") return updateBlock(rows, target.id, (b) => ({ ...b, style }));
  return rows.map((row) => {
    if (target.kind === "row") return row.id === target.id ? { ...row, style } : row;
    return row.columns.some((c) => c.id === target.id)
      ? { ...row, columns: row.columns.map((c) => (c.id === target.id ? { ...c, style } : c)) }
      : row;
  });
}

/** The spacing a row, column or block has now. */
export function spacingOf(rows: PageRow[], target: Styled): Spacing | undefined {
  if (target.kind === "block") return findBlock(rows, target.id)?.block.style;
  if (target.kind === "row") return rows.find((r) => r.id === target.id)?.style;
  return rows.flatMap((r) => r.columns).find((c) => c.id === target.id)?.style;
}
