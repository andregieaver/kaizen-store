import { EMPTY_DOC, ROW_LAYOUTS, type BlockType, type PageBlock, type PageRow, type RowLayout } from "./page-content";

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
