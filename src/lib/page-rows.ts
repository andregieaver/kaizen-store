import {
  EMPTY_DOC,
  LINE_COLUMNS_MAX,
  PRODUCT_PARTS,
  ROW_LAYOUTS,
  ROW_LINES_MAX,
  SITE_PARTS,
  columnLines,
  pageParts,
  rowLayouts,
  type BlockType,
  type PartBase,
  type PageBlock,
  type ProductPart,
  type SitePart,
  type PageColumn,
  type PageRow,
  type RowLayout,
  type Spacing,
} from "./page-content";
import type { Size } from "./breakpoints";
import { copyWithUses } from "./global-parts";
import { clearAt, setAt } from "./responsive";
import { modalDomId, slugifyKey, uniqueKey } from "./page-modal";
import { isShopPart, type ShopPart } from "./store-parts";

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

/** A new block of a kind; a product or site component (D79, D80) shows `part`. */
export function newBlock(type: BlockType, id: NewId, part: ProductPart | SitePart | ShopPart = "title"): PageBlock {
  switch (type) {
    case "product":
      return { id: id(), type, part: part in PRODUCT_PARTS ? (part as ProductPart) : "title" };
    case "site":
      return { id: id(), type, part: part in SITE_PARTS ? (part as SitePart) : "logo" };
    case "storePart":
      return { id: id(), type, part: isShopPart(part) ? part : "cart" };
    case "menu":
    case "search":
    case "customField":
    case "separator":
      return { id: id(), type };
    case "plans":
      return { id: id(), type, buttonLabel: "", buttonHref: "" };
    case "fieldLoop":
      return { id: id(), type, layout: "cards", columns: 3, slots: {} };
    case "accordion":
    case "tabs":
    case "faq":
      return { id: id(), type, items: [{ id: id(), title: "", body: EMPTY_DOC }] };
    case "video":
      return { id: id(), type, source: "youtube", video: null, link: "", poster: null, title: "" };
    case "html":
      return { id: id(), type, html: "", title: "" };
    case "table":
      return { id: id(), type, header: true, mobile: "stack", rows: [["", "", ""], ["", "", ""], ["", "", ""]] };
    case "iconList":
      return {
        id: id(),
        type,
        items: [
          { id: id(), icon: "check", text: "", href: "" },
          { id: id(), icon: "check", text: "", href: "" },
        ],
      };
    case "socialLinks":
      return {
        id: id(),
        type,
        links: [
          { id: id(), network: "facebook", href: "" },
          { id: id(), network: "instagram", href: "" },
        ],
      };
    case "testimonials":
      return { id: id(), type, items: [{ id: id(), quote: "", name: "", role: "", picture: null }] };
    case "dualButton":
      return { id: id(), type, first: { label: "", href: "" }, second: { label: "", href: "", variant: "outline" } };
    case "emailForm":
      return {
        id: id(),
        type,
        recipients: [],
        subject: "",
        fields: [
          { id: id(), kind: "name", label: "", required: true },
          { id: id(), kind: "email", label: "", required: true },
          { id: id(), kind: "textarea", label: "", required: true },
        ],
        submitLabel: "",
        successMessage: "",
      };
    case "newsletter":
      return { id: id(), type, recipients: [], placeholder: "", submitLabel: "", successMessage: "", consent: "" };
    case "richText":
      return { id: id(), type, doc: EMPTY_DOC };
    case "image":
      return { id: id(), type, image: null, caption: "" };
    case "heading":
      return { id: id(), type, text: "", level: 2 };
    case "button":
      return { id: id(), type, label: "", href: "" };
    case "contentGrid":
      return {
        id: id(),
        type,
        source: { type: "pages" },
        categories: [],
        tags: [],
        sort: "newest",
        limit: 6,
        // Three columns on computers, two on tablets and one on phones (D179: Extra large and the smaller sizes' overrides).
        columns: 3,
        at: { md: { columns: 2 }, sm: { columns: 1 } },
        show: { image: true, heading: true, excerpt: true, price: true, button: true },
        buttonLabel: "",
        emptyText: "",
        headingLevel: 3,
        excerptLines: 3,
        gap: 24,
      };
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

/** A column without the shares it was given by hand, at any size. */
function withoutShares(column: PageColumn): PageColumn {
  const { width: _width, at, ...rest } = column;
  void _width;
  if (!at) return rest as PageColumn;
  const sizes = Object.fromEntries(
    Object.entries(at).flatMap(([size, settings]) => {
      const { width: _share, ...others } = settings ?? {};
      void _share;
      return Object.keys(others).length > 0 ? [[size, others]] : [];
    }),
  );
  return (Object.keys(sizes).length > 0 ? { ...rest, at: sizes } : rest) as PageColumn;
}

/**
 * One line of a row's columns (D187): the layout that shares its width, and its columns. A row is one line, or several, one under
 * another (Beaver Builder's column groups); every edit of its columns below works on a line, so the lines it does not touch keep
 * the layout and the shares they had.
 */
export type RowLine = { layout: RowLayout; columns: PageColumn[] };

/** A row's lines, as its layouts divide its columns. */
export function linesOf(row: PageRow): RowLine[] {
  const columns = columnLines(row);
  return rowLayouts(row).map((layout, i) => ({ layout, columns: columns[i] ?? [] }));
}

/**
 * A row from its lines: the first line's layout is the row's `layout`, the others' its `moreLines`. A line with no columns is
 * gone, and a row with none is nothing (null).
 */
function rowOf(row: PageRow, lines: RowLine[]): PageRow | null {
  const kept = lines.filter((line) => line.columns.length > 0);
  if (kept.length === 0) return null;
  const { moreLines: _more, ...rest } = row;
  void _more;
  return { ...rest, layout: kept[0].layout, columns: kept.flatMap((line) => line.columns), ...(kept.length > 1 && { moreLines: kept.slice(1).map((line) => line.layout) }) };
}

/** Columns that share the width of their line evenly: any share they were given by hand, at any size, is taken back. */
const evenLine = (columns: PageColumn[]): RowLine => ({ layout: equalLayout(columns.length), columns: columns.map(withoutShares) });

/** Where a column is in its row: its line, and its place in that line. */
export function locateColumn(row: PageRow, columnId: string): { line: number; index: number } | null {
  const lines = linesOf(row);
  for (let line = 0; line < lines.length; line += 1) {
    const index = lines[line].columns.findIndex((c) => c.id === columnId);
    if (index >= 0) return { line, index };
  }
  return null;
}

/**
 * Where a column goes in a row (D187): beside the others of a line, at `index` among them, or alone on a new line, at `newLine`
 * among the row's lines (0 above them all). A place counts the lines as they are now.
 */
export type ColumnSpot = { rowId: string; line: number; index: number } | { rowId: string; newLine: number };

/** The spot at a place among all of a row's columns (a place between two lines belongs to the end of the first), for the edits that still count that way. */
export function spotAtIndex(row: PageRow, index: number): ColumnSpot {
  const lines = linesOf(row);
  let start = 0;
  for (let line = 0; line < lines.length; line += 1) {
    const end = start + lines[line].columns.length;
    if (index <= end || line === lines.length - 1) return { rowId: row.id, line, index: clamp(index - start, lines[line].columns.length) };
    start = end;
  }
  return { rowId: row.id, line: 0, index: 0 };
}

/** The lines with a column put at a spot; null where it cannot go: a line holds six columns, a row six lines. */
function placeInLines(lines: RowLine[], spot: ColumnSpot, column: PageColumn): RowLine[] | null {
  if ("newLine" in spot) {
    if (lines.length >= ROW_LINES_MAX) return null;
    const next = [...lines];
    next.splice(clamp(spot.newLine, lines.length), 0, { layout: "1", columns: [column] });
    return next;
  }
  const at = clamp(spot.line, lines.length - 1);
  const line = lines[at];
  if (!line || line.columns.length >= LINE_COLUMNS_MAX) return null;
  const columns = [...line.columns];
  columns.splice(clamp(spot.index, columns.length), 0, column);
  return lines.map((l, i) => (i === at ? evenLine(columns) : l));
}

/**
 * A row's columns' shares in one of its lines at a size, as dragging the edges between them sets them: one whole number a
 * column (of 100), written the way the column's own field would (`setAt()`: at Extra large the column's own, below it an
 * override where it differs from the size above). The shares of a line that does not have that many columns are not set.
 */
export function setLineShares(rows: PageRow[], rowId: string, lineIndex: number, size: Size, shares: readonly number[]): PageRow[] {
  return rows.map((row) => {
    if (row.id !== rowId) return row;
    const lines = linesOf(row);
    const line = lines[lineIndex];
    if (!line || line.columns.length !== shares.length) return row;
    const next = lines.map((l, i) =>
      i === lineIndex ? { ...l, columns: l.columns.map((column, j) => ({ ...column, ...setAt(column, size, { width: shares[j] }) })) } : l,
    );
    return rowOf(row, next) ?? row;
  });
}

/** The shares of a row's first line (all of a row of one line). */
export function setColumnShares(rows: PageRow[], rowId: string, size: Size, shares: readonly number[]): PageRow[] {
  return setLineShares(rows, rowId, 0, size, shares);
}

/** A column without the share it was given at a size (at Extra large, the column's own). */
function withoutShareAt(column: PageColumn, size: Size): PageColumn {
  if (size === "xl") {
    const { width: _width, ...rest } = column;
    void _width;
    return rest as PageColumn;
  }
  const { at } = clearAt(column, size, "width");
  const { at: _at, ...rest } = column;
  void _at;
  return (at ? { ...rest, at } : rest) as PageColumn;
}

/** Gives the layout's shares back to a line at a size: every column's own share there is taken away. */
export function clearLineShares(rows: PageRow[], rowId: string, lineIndex: number, size: Size): PageRow[] {
  return rows.map((row) => {
    if (row.id !== rowId) return row;
    const lines = linesOf(row);
    if (!lines[lineIndex]) return row;
    const next = lines.map((l, i) => (i === lineIndex ? { ...l, columns: l.columns.map((column) => withoutShareAt(column, size)) } : l));
    return rowOf(row, next) ?? row;
  });
}

/** Gives the layout's shares back at a size to every line of a row. */
export function clearColumnShares(rows: PageRow[], rowId: string, size: Size): PageRow[] {
  return rows.map((row) => (row.id === rowId ? { ...row, columns: row.columns.map((column) => withoutShareAt(column, size)) } : row));
}

/**
 * Gives one of a row's lines another layout. Its columns are kept in order; when there are fewer, the blocks of the columns
 * that go move to the new last column, so nothing written is lost. The other lines are as they were.
 */
export function setLineLayout(rows: PageRow[], rowId: string, lineIndex: number, layout: RowLayout, id: NewId): PageRow[] {
  return rows.map((row) => {
    if (row.id !== rowId) return row;
    const lines = linesOf(row);
    const line = lines[lineIndex];
    if (!line || line.layout === layout) return row;
    const count = ROW_LAYOUTS[layout].widths.length;
    // A new layout brings its own shares: what dragging the columns' edges set belongs to the old one.
    const kept = line.columns.slice(0, count).map((c) => ({ ...withoutShares(c), blocks: [...c.blocks] }));
    const dropped = line.columns.slice(count).flatMap((c) => c.blocks);
    while (kept.length < count) kept.push({ id: id(), blocks: [] });
    kept[count - 1].blocks.push(...dropped);
    return rowOf(row, lines.map((l, i) => (i === lineIndex ? { layout, columns: kept } : l))) ?? row;
  });
}

/** Gives a row's first line (its only one, mostly) another layout. */
export function setRowLayout(rows: PageRow[], rowId: string, layout: RowLayout, id: NewId): PageRow[] {
  return setLineLayout(rows, rowId, 0, layout, id);
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

/**
 * The custom ids (D48) used on the page, so that a copy does not take one
 * again: with a modal's own (`modal-{key}`, D121), which is an id of the page.
 */
export function htmlIds(rows: PageRow[]): Set<string> {
  return new Set([
    ...pageParts(rows).flatMap((part) => (part.htmlId ? [part.htmlId] : [])),
    ...rows.flatMap((row) => (row.modal ? [modalDomId(row.modal.key)] : [])),
  ]);
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
 * since an id is used once on a page. A global's use (D98) stays one: its
 * ids keep their relation to the global's, and its custom ids are the
 * global's own.
 */
export const copyBlock = (block: PageBlock, id: NewId, taken = new Set<string>()): PageBlock =>
  block.global ? copyWithUses("block", structuredClone(block), id) : keepHtmlId(withFreshItems({ ...structuredClone(block), id: id() }, id), taken);

/** A copy of a grid of custom items (D155) gives each item an id of its own, which keeps that item's texts' translations apart from the original's. */
function withFreshItems<T extends PageBlock>(block: T, id: NewId): T {
  return block.type === "contentGrid" && block.items ? { ...block, items: block.items.map((item) => ({ ...item, id: id() })) } : block;
}
export const copyColumn = (column: PageColumn, id: NewId, taken = new Set<string>()): PageColumn =>
  column.global
    ? copyWithUses("column", structuredClone(column), id)
    : keepHtmlId({ ...structuredClone(column), id: id(), blocks: column.blocks.map((b) => copyBlock(b, id, taken)) }, taken);
export const copyRow = (row: PageRow, id: NewId, taken = new Set<string>()): PageRow =>
  row.global
    ? copyWithUses("row", structuredClone(row), id)
    : withFreshModalKey(
        keepHtmlId({ ...structuredClone(row), id: id(), columns: row.columns.map((c) => copyColumn(c, id, taken)) }, taken),
        taken,
      );

/**
 * A copy of a modal row (D121) keeps its setting but takes a key of its own
 * (`promo` → `promo-2`), since a modal's address name is used once on a page;
 * the id it takes is then taken.
 */
function withFreshModalKey(row: PageRow, taken: Set<string>): PageRow {
  if (!row.modal) return row;
  const key = uniqueKey(
    slugifyKey(row.modal.key),
    [...taken].flatMap((id) => (id.startsWith("modal-") ? [id.slice("modal-".length)] : [])),
  );
  taken.add(modalDomId(key));
  return { ...row, modal: { ...row.modal, key } };
}

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

/** Whether a column can be copied: a line holds at most six columns. */
export function canDuplicateColumn(rows: PageRow[], columnId: string): boolean {
  const found = findColumn(rows, columnId);
  const place = found ? locateColumn(found.row, columnId) : null;
  return Boolean(found && place && linesOf(found.row)[place.line].columns.length < LINE_COLUMNS_MAX);
}

/**
 * A copy of the column right after it, in its line. The line gets one more column, so its columns become equal (a sidebar
 * layout has a set number of columns).
 */
export function duplicateColumn(rows: PageRow[], columnId: string, id: NewId): PageRow[] {
  const found = findColumn(rows, columnId);
  const place = found ? locateColumn(found.row, columnId) : null;
  if (!found || !place) return rows;
  const lines = linesOf(found.row);
  if (lines[place.line].columns.length >= LINE_COLUMNS_MAX) return rows;
  const columns = [...lines[place.line].columns];
  columns.splice(place.index + 1, 0, copyColumn(columns[place.index], id, htmlIds(rows)));
  const next = rowOf(found.row, lines.map((l, i) => (i === place.line ? evenLine(columns) : l)));
  return next ? rows.map((r) => (r.id === found.row.id ? next : r)) : rows;
}

/** Takes a column and its blocks out; the rest of its line become equal, or the line goes if it was alone. A row keeps at least one column. */
export function removeColumn(rows: PageRow[], columnId: string): PageRow[] {
  const found = findColumn(rows, columnId);
  const place = found ? locateColumn(found.row, columnId) : null;
  if (!found || !place || found.row.columns.length <= 1) return rows;
  const lines = linesOf(found.row).flatMap((line, i): RowLine[] => {
    if (i !== place.line) return [line];
    const rest = line.columns.filter((c) => c.id !== columnId);
    return rest.length === 0 ? [] : [evenLine(rest)];
  });
  const next = rowOf(found.row, lines);
  return next ? rows.map((r) => (r.id === found.row.id ? next : r)) : rows;
}

/** Moves a column within its line; widths stay with the places, so it takes the width of its new place. */
export function moveColumn(rows: PageRow[], columnId: string, to: number): PageRow[] {
  const found = findColumn(rows, columnId);
  const place = found ? locateColumn(found.row, columnId) : null;
  if (!found || !place) return rows;
  return moveColumnAt(rows, columnId, { rowId: found.row.id, line: place.line, index: to });
}

/**
 * Moves a column, with all its blocks, to a spot (D187): beside the columns of a line of any row, or alone on a new line.
 * Within its own line it only changes its place, and the layout and shares stay. From a line to another, both lines share their
 * width evenly again, the one it left going if it was alone, and the row it left going if that was its only column. A line
 * already holding six columns takes no more, nor a row with six lines another; the rows are then as they were.
 */
export function moveColumnAt(rows: PageRow[], columnId: string, spot: ColumnSpot): PageRow[] {
  const found = findColumn(rows, columnId);
  const target = rows.find((r) => r.id === spot.rowId);
  const place = found ? locateColumn(found.row, columnId) : null;
  if (!found || !target || !place) return rows;
  const fromLines = linesOf(found.row);
  const column = fromLines[place.line].columns[place.index];
  const sameRow = found.row.id === target.id;

  // Within its own line the column only changes its place.
  if (sameRow && "line" in spot && spot.line === place.line) {
    const columns = [...fromLines[place.line].columns];
    columns.splice(place.index, 1);
    columns.splice(clamp(spot.index, columns.length), 0, column);
    const next = rowOf(found.row, fromLines.map((l, i) => (i === place.line ? { ...l, columns } : l)));
    return next ? rows.map((r) => (r.id === found.row.id ? next : r)) : rows;
  }

  // Taken out of its line: that line is shared evenly again, or goes if it was alone.
  const rest = fromLines[place.line].columns.filter((c) => c.id !== columnId);
  const gone = rest.length === 0;
  const left = fromLines.flatMap((line, i): RowLine[] => (i !== place.line ? [line] : gone ? [] : [evenLine(rest)]));
  // The spot counts the lines as they were; where its own line is gone, those under it have moved up one.
  let at: ColumnSpot = spot;
  if (sameRow && gone) {
    if ("newLine" in spot && spot.newLine > place.line) at = { rowId: spot.rowId, newLine: spot.newLine - 1 };
    else if ("line" in spot && spot.line > place.line) at = { rowId: spot.rowId, line: spot.line - 1, index: spot.index };
  }
  const placed = placeInLines(sameRow ? left : linesOf(target), at, column);
  if (!placed) return rows;
  return rows.flatMap((row) => {
    if (row.id === found.row.id && !sameRow) {
      const next = rowOf(row, left);
      return next ? [next] : [];
    }
    if (row.id === target.id) {
      const next = rowOf(row, placed);
      return next ? [next] : [];
    }
    return [row];
  });
}

/**
 * Moves a column, with all its blocks, to `index` among another row's columns (or its own: then within its line, keeping the
 * layout). The line it joins is the one holding that place (the last, for a place past the end).
 */
export function moveColumnTo(rows: PageRow[], columnId: string, rowId: string, index: number): PageRow[] {
  const found = findColumn(rows, columnId);
  const target = rows.find((r) => r.id === rowId);
  if (!found || !target) return rows;
  if (found.row.id === rowId) return moveColumn(rows, columnId, index);
  return moveColumnAt(rows, columnId, spotAtIndex(target, index));
}

/**
 * Puts a column at a spot (D187): the line it joins shares its width evenly again, one more column in it, or it is alone on a
 * new line. A line holding six columns takes no more, nor a row with six lines another.
 */
export function insertColumnAt(rows: PageRow[], spot: ColumnSpot, column: PageColumn): PageRow[] {
  const row = rows.find((r) => r.id === spot.rowId);
  if (!row) return rows;
  const lines = placeInLines(linesOf(row), spot, column);
  const next = lines ? rowOf(row, lines) : null;
  return next ? rows.map((r) => (r.id === row.id ? next : r)) : rows;
}

/** Puts a column into a row at `index` among all its columns, in the line that holds that place: as `insertColumnAt()`. */
export function insertColumn(rows: PageRow[], rowId: string, column: PageColumn, index: number): PageRow[] {
  const row = rows.find((r) => r.id === rowId);
  return row ? insertColumnAt(rows, spotAtIndex(row, index), column) : rows;
}

/**
 * A new empty column for the Column tile pressed rather than dragged (D187): after the column last pointed at, in its line;
 * else last in the page's last row; a full line gives it a line of its own under; with no row at all, a row of its own.
 */
export function addColumn(rows: PageRow[], near: string | null, id: NewId): PageRow[] {
  const column: PageColumn = { id: id(), blocks: [] };
  const found = near ? findColumn(rows, near) : null;
  const row = found?.row ?? rows[rows.length - 1];
  if (!row) return [{ ...newRow("1", id), columns: [column] }];
  const place = found ? locateColumn(row, near!) : null;
  const lines = linesOf(row);
  const line = place?.line ?? lines.length - 1;
  const index = place ? place.index + 1 : lines[line].columns.length;
  if (lines[line].columns.length >= LINE_COLUMNS_MAX) return insertColumnAt(rows, { rowId: row.id, newLine: line + 1 }, column);
  return insertColumnAt(rows, { rowId: row.id, line, index }, column);
}

/** A row, a column or a block, by id: what a settings dialog is for. */
export type Styled = { kind: "row" | "column" | "block"; id: string };

/** Settings that can be changed on a row, a column or a block (not what they hold). */
export type RowPatch = Partial<Omit<PageRow, "id" | "type" | "layout" | "columns">>;
export type ColumnPatch = Partial<Omit<PageColumn, "id" | "blocks">>;
/** Settings of a block of one kind (`T`), or those every block has. */
export type BlockPatch<T extends PageBlock = PageBlock> = Partial<Omit<T, "id" | "type">>;

/**
 * Settings that are on unless they are `false` (read as `x !== false`): for
 * these `false` is the setting, so it is kept, where any other `false` is
 * the same as the setting left out.
 */
const ON_UNLESS_OFF: ReadonlySet<string> = new Set([
  "wishlist",
  "large",
  "thumbnails",
  "showHeading",
  "showLabel",
  "results",
  "structuredData",
  "controls",
  "showRating",
  "confirm",
]);

/** Merges settings in; one set to undefined or false is taken out, so the page stays as small as it can (`false` stays for the settings that are on unless off). */
function merge<T extends object>(part: T, patch: object): T {
  const next = { ...part, ...patch } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || (value === false && !ON_UNLESS_OFF.has(key))) delete next[key];
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

export function patchBlock<T extends PageBlock = PageBlock>(rows: PageRow[], blockId: string, patch: BlockPatch<T>): PageRow[] {
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
