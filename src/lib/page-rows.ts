import {
  EMPTY_DOC,
  ROW_LAYOUTS,
  pageParts,
  type BlockType,
  type ImageBlock,
  type PartBase,
  type RichTextBlock,
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

/** The custom ids (D48) used on the page, so that a copy does not take one again. */
export function htmlIds(rows: PageRow[]): Set<string> {
  return new Set(pageParts(rows).flatMap((part) => (part.htmlId ? [part.htmlId] : [])));
}

/** A part keeps its custom id only while no other part has it; the id is then taken. */
function keepHtmlId<T extends PartBase>(part: T, taken: Set<string>): T {
  if (!part.htmlId) return part;
  if (!taken.has(part.htmlId)) {
    taken.add(part.htmlId);
    return part;
  }
  const rest = { ...part };
  delete rest.htmlId;
  return rest;
}

/**
 * Copies with new ids throughout: for duplicating, and for putting a saved
 * part on the page (D46). Custom ids in `taken` (the page's) are left out,
 * since an id is used once on a page.
 */
export const copyBlock = (block: PageBlock, id: NewId, taken = new Set<string>()): PageBlock =>
  keepHtmlId({ ...structuredClone(block), id: id() }, taken);
export const copyColumn = (column: PageColumn, id: NewId, taken = new Set<string>()): PageColumn =>
  keepHtmlId({ ...structuredClone(column), id: id(), blocks: column.blocks.map((b) => copyBlock(b, id, taken)) }, taken);
export const copyRow = (row: PageRow, id: NewId, taken = new Set<string>()): PageRow =>
  keepHtmlId({ ...structuredClone(row), id: id(), columns: row.columns.map((c) => copyColumn(c, id, taken)) }, taken);

/** A copy of the row, with new ids throughout, right after it. */
export function duplicateRow(rows: PageRow[], rowId: string, id: NewId): PageRow[] {
  const index = rows.findIndex((r) => r.id === rowId);
  if (index < 0) return rows;
  return insertRow(rows, copyRow(rows[index], id, htmlIds(rows)), index + 1);
}

/** A copy of the block right after it. */
export function duplicateBlock(rows: PageRow[], blockId: string, id: NewId): PageRow[] {
  const place = findBlock(rows, blockId);
  return place ? insertBlock(rows, place.columnId, copyBlock(place.block, id, htmlIds(rows)), place.index + 1) : rows;
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
  columns.splice(found.index + 1, 0, copyColumn(columns[found.index], id, htmlIds(rows)));
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

/** A row, a column or a block, by id: what a settings dialog is for. */
export type Styled = { kind: "row" | "column" | "block"; id: string };

/** Settings that can be changed on a row, a column or a block (not what they hold). */
export type RowPatch = Partial<Omit<PageRow, "id" | "type" | "layout" | "columns">>;
export type ColumnPatch = Partial<Omit<PageColumn, "id" | "blocks">>;
export type BlockPatch = Partial<Omit<RichTextBlock, "id" | "type" | "doc"> & Omit<ImageBlock, "id" | "type" | "image" | "caption">>;

/** Merges settings in; one set to undefined or false is taken out, so the page stays as small as it can. */
function merge<T extends object>(part: T, patch: object): T {
  const next = { ...part, ...patch } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === false) delete next[key];
  }
  return next as T;
}

export function patchRow(rows: PageRow[], rowId: string, patch: RowPatch): PageRow[] {
  return rows.map((row) => (row.id === rowId ? merge(row, patch) : row));
}

export function patchColumn(rows: PageRow[], columnId: string, patch: ColumnPatch): PageRow[] {
  return rows.map((row) =>
    row.columns.some((c) => c.id === columnId)
      ? { ...row, columns: row.columns.map((c) => (c.id === columnId ? merge(c, patch) : c)) }
      : row,
  );
}

export function patchBlock(rows: PageRow[], blockId: string, patch: BlockPatch): PageRow[] {
  return updateBlock(rows, blockId, (block) => merge(block, patch));
}

/** The row, column or block a target names. */
export function partOf(rows: PageRow[], target: Styled): PageRow | PageColumn | PageBlock | undefined {
  if (target.kind === "block") return findBlock(rows, target.id)?.block;
  if (target.kind === "row") return rows.find((r) => r.id === target.id);
  return rows.flatMap((r) => r.columns).find((c) => c.id === target.id);
}

/** Changes the settings every part has: margin and padding, id and classes (D47, D48). */
export function patchPart(rows: PageRow[], target: Styled, patch: Partial<PartBase>): PageRow[] {
  if (target.kind === "block") return patchBlock(rows, target.id, patch);
  if (target.kind === "row") return patchRow(rows, target.id, patch);
  return patchColumn(rows, target.id, patch);
}

/** Gives a row, column or block its margin and padding (D47); none when both are left out. */
export function setSpacing(rows: PageRow[], target: Styled, style: Spacing): PageRow[] {
  return patchPart(rows, target, { style: style.margin || style.padding ? style : undefined });
}

/** The spacing a row, column or block has now. */
export function spacingOf(rows: PageRow[], target: Styled): Spacing | undefined {
  return partOf(rows, target)?.style;
}
