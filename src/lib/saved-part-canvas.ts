import type { PageBlock, PageColumn, PageRow } from "./page-content";
import type { PageLayout } from "./page-layout";
import type { SavedPart } from "./saved-parts";

/**
 * A saved part edited on the builder's canvas (D46, D127): its content as the canvas's rows, and the rows back as its content. A row
 * is one row; a column sits alone in a row of one column; a component alone in that column; a page layout is its rows. Pure, for the
 * builder and its tests.
 */

/** The ids of the row and column a column or component is set in while it is on the canvas; they are never saved. */
export const HOLDER_ROW = "saved-part-row";
export const HOLDER_COLUMN = "saved-part-column";

const holder = (column: PageColumn): PageRow => ({ id: HOLDER_ROW, type: "row", layout: "1", columns: [column] });

/** The part's content as rows to put on the canvas. */
export function partRows(part: SavedPart): PageRow[] {
  if (part.kind === "page") return part.content.rows;
  if (part.kind === "row") return [part.content];
  if (part.kind === "column") return [holder(part.content)];
  return [holder({ id: HOLDER_COLUMN, blocks: [part.content] })];
}

/** Why the canvas's rows cannot be saved as the part: what the part holds was taken apart. */
export type PartShapeProblem = "oneRow" | "oneColumn" | "oneBlock";

export type PartFromRows =
  | { ok: true; content: PageRow | PageColumn | PageBlock | PageLayout }
  | { ok: false; problem: PartShapeProblem };

/** The canvas's rows as the part's content again, or why they are not one of its kind. */
export function partFromRows(part: SavedPart, rows: readonly PageRow[]): PartFromRows {
  if (part.kind === "page") return { ok: true, content: { ...part.content, rows: [...rows] } };
  if (part.kind === "row") return rows.length === 1 ? { ok: true, content: rows[0] } : { ok: false, problem: "oneRow" };
  const columns = rows.length === 1 ? rows[0].columns : [];
  if (columns.length !== 1) return { ok: false, problem: part.kind === "column" ? "oneColumn" : "oneBlock" };
  if (part.kind === "column") return { ok: true, content: columns[0] };
  const blocks = columns[0].blocks;
  return blocks.length === 1 ? { ok: true, content: blocks[0] } : { ok: false, problem: "oneBlock" };
}
