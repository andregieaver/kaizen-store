import { describe, expect, it } from "vitest";

import { columnLines, newPageContent, pageInput, type PageColumn, type PageRow } from "./page-content";
import { partCss, partRules } from "./part-css";
import { DEFAULT_BREAKPOINTS } from "./breakpoints";
import {
  addColumn,
  canDuplicateColumn,
  clearLineShares,
  duplicateColumn,
  insertBlock,
  insertColumnAt,
  linesOf,
  locateColumn,
  moveColumnAt,
  newBlock,
  newRow,
  removeColumn,
  setLineLayout,
  setLineShares,
  spotAtIndex,
} from "./page-rows";

/**
 * Several lines of columns in a row (D187, as Beaver Builder's column groups): the model's edits, the checks a page is saved with
 * and the part stylesheet that lays the lines out.
 */

let n = 0;
const id = () => `l${++n}`;
const col = (name: string, extra: Partial<PageColumn> = {}): PageColumn => ({ id: name, blocks: [], ...extra });

/** A row of lines: each line's layout and its columns' ids. */
const rowOf = (lines: [PageRow["layout"], string[]][]): PageRow => ({
  id: "r",
  type: "row",
  layout: lines[0][0],
  ...(lines.length > 1 && { moreLines: lines.slice(1).map(([layout]) => layout) }),
  columns: lines.flatMap(([, names]) => names.map((name) => col(name))),
});
/** The row's lines as layout and column ids, to read a result at a glance. */
const shape = (row: PageRow) => linesOf(row).map((line) => [line.layout, line.columns.map((c) => c.id)]);

describe("a row's lines", () => {
  it("are its columns divided by its layouts, the first its own", () => {
    const row = rowOf([["2", ["a", "b"]], ["3", ["c", "d", "e"]], ["1", ["f"]]]);
    expect(shape(row)).toEqual([["2", ["a", "b"]], ["3", ["c", "d", "e"]], ["1", ["f"]]]);
    expect(columnLines(row).map((line) => line.length)).toEqual([2, 3, 1]);
    // A row of one line is all its columns, as rows always were.
    expect(shape(newRow("3", id))[0][0]).toBe("3");
    expect(linesOf(newRow("3", id))).toHaveLength(1);
  });

  it("leave no column out where the columns and the layouts disagree: the last line takes the rest", () => {
    const row = { ...rowOf([["2", ["a", "b"]]]), columns: ["a", "b", "c"].map((name) => col(name)) };
    expect(columnLines(row).map((line) => line.length)).toEqual([3]);
  });

  it("are saved with the page: the columns must match the layouts, and a row has at most six lines", () => {
    const page = (row: unknown) => pageInput.safeParse({ ...newPageContent(), title: "T", slug: "t", rows: [row] });
    const ok = rowOf([["2", ["a", "b"]], ["1", ["c"]]]);
    expect(page(ok).success).toBe(true);
    expect(page({ ...ok, columns: ok.columns.slice(0, 2) }).success).toBe(false);
    const six = rowOf(Array.from({ length: 6 }, (_, i) => ["1", [`x${i}`]] as [PageRow["layout"], string[]]));
    expect(page(six).success).toBe(true);
    const seven = rowOf(Array.from({ length: 7 }, (_, i) => ["1", [`y${i}`]] as [PageRow["layout"], string[]]));
    expect(page(seven).success).toBe(false);
    expect(page({ ...ok, moreLines: ["nope"] }).success).toBe(false);
  });
});

describe("putting a column in a row", () => {
  it("beside the others of a line shares that line's width evenly again, whatever was dragged before", () => {
    const row = {
      ...rowOf([["2", ["a", "b"]]]),
      columns: [col("a", { width: 70, at: { md: { width: 60 } } }), col("b", { width: 30 })],
    };
    const next = insertColumnAt([row], { rowId: "r", line: 0, index: 1 }, col("new"))[0];
    expect(next.layout).toBe("3");
    expect(next.columns.map((c) => c.id)).toEqual(["a", "new", "b"]);
    for (const c of next.columns) {
      expect(c.width).toBeUndefined();
      expect(c.at?.md?.width).toBeUndefined();
    }
  });

  it("only changes the line it joins: the other lines keep their layout and shares", () => {
    const row = rowOf([["left-sidebar", ["a", "b"]], ["2", ["c", "d"]]]);
    row.columns[0] = col("a", { width: 30 });
    const next = insertColumnAt([row], { rowId: "r", line: 1, index: 2 }, col("e"))[0];
    expect(shape(next)).toEqual([["left-sidebar", ["a", "b"]], ["3", ["c", "d", "e"]]]);
    expect(next.columns[0].width).toBe(30);
  });

  it("alone on a line of its own: above the first line, between two, or under the last", () => {
    const row = rowOf([["2", ["a", "b"]], ["1", ["c"]]]);
    expect(shape(insertColumnAt([row], { rowId: "r", newLine: 2 }, col("x"))[0])).toEqual([["2", ["a", "b"]], ["1", ["c"]], ["1", ["x"]]]);
    expect(shape(insertColumnAt([row], { rowId: "r", newLine: 1 }, col("x"))[0])).toEqual([["2", ["a", "b"]], ["1", ["x"]], ["1", ["c"]]]);
    // Above all of them it becomes the row's first line, and the old first line is the second.
    const above = insertColumnAt([row], { rowId: "r", newLine: 0 }, col("x"))[0];
    expect(shape(above)).toEqual([["1", ["x"]], ["2", ["a", "b"]], ["1", ["c"]]]);
    expect(above.layout).toBe("1");
    expect(above.moreLines).toEqual(["2", "1"]);
  });

  it("is refused by a line of six columns and by a row of six lines, and the rows are then as they were", () => {
    const full = [rowOf([["6", ["a", "b", "c", "d", "e", "f"]]])];
    expect(insertColumnAt(full, { rowId: "r", line: 0, index: 0 }, col("x"))).toBe(full);
    expect(canDuplicateColumn(full, "a")).toBe(false);
    expect(duplicateColumn(full, "a", id)).toBe(full);
    const tall = [rowOf(Array.from({ length: 6 }, (_, i) => ["1", [`t${i}`]] as [PageRow["layout"], string[]]))];
    expect(insertColumnAt(tall, { rowId: "r", newLine: 3 }, col("x"))).toBe(tall);
    expect(insertColumnAt(tall, { rowId: "missing", newLine: 0 }, col("x"))).toBe(tall);
  });

  it("at a place among all a row's columns lands in the line that holds it (a place between two lines is the end of the first)", () => {
    const row = rowOf([["2", ["a", "b"]], ["2", ["c", "d"]]]);
    expect(spotAtIndex(row, 1)).toEqual({ rowId: "r", line: 0, index: 1 });
    expect(spotAtIndex(row, 2)).toEqual({ rowId: "r", line: 0, index: 2 });
    expect(spotAtIndex(row, 3)).toEqual({ rowId: "r", line: 1, index: 1 });
    expect(spotAtIndex(row, 99)).toEqual({ rowId: "r", line: 1, index: 2 });
  });
});

describe("moving a column between lines", () => {
  it("within its own line only changes its place: the layout and the shares stay", () => {
    const row = rowOf([["left-sidebar", ["a", "b"]], ["2", ["c", "d"]]]);
    const next = moveColumnAt([row], "a", { rowId: "r", line: 0, index: 1 })[0];
    expect(shape(next)).toEqual([["left-sidebar", ["b", "a"]], ["2", ["c", "d"]]]);
  });

  it("onto a new line under its line leaves the line it came from evenly shared, the new line alone", () => {
    const row = rowOf([["left-sidebar", ["a", "b"]]]);
    const next = moveColumnAt([row], "b", { rowId: "r", newLine: 1 })[0];
    expect(shape(next)).toEqual([["1", ["a"]], ["1", ["b"]]]);
    expect(next.layout).toBe("1");
    expect(next.moreLines).toEqual(["1"]);
  });

  it("to another line of its row shares both evenly, and the line it was alone in is gone", () => {
    const row = rowOf([["3", ["a", "b", "c"]], ["1", ["d"]]]);
    const next = moveColumnAt([row], "d", { rowId: "r", line: 0, index: 1 })[0];
    expect(shape(next)).toEqual([["4", ["a", "d", "b", "c"]]]);
    expect(next.moreLines).toBeUndefined();
    const back = moveColumnAt([next], "b", { rowId: "r", newLine: 1 })[0];
    expect(shape(back)).toEqual([["3", ["a", "d", "c"]], ["1", ["b"]]]);
  });

  it("keeps a place that counts the lines as they were, though its own line goes", () => {
    const row = rowOf([["1", ["a"]], ["1", ["b"]], ["1", ["c"]]]);
    // `a` is alone on the first line; the line under `c` is place 3, which is 2 once `a`'s line is gone.
    expect(shape(moveColumnAt([row], "a", { rowId: "r", newLine: 3 })[0])).toEqual([["1", ["b"]], ["1", ["c"]], ["1", ["a"]]]);
    // Into the line of `c` (line 2), which is line 1 once `a`'s is gone.
    expect(shape(moveColumnAt([row], "a", { rowId: "r", line: 2, index: 1 })[0])).toEqual([["1", ["b"]], ["2", ["c", "a"]]]);
    // Onto the lines next to where it already is: the same arrangement.
    expect(shape(moveColumnAt([row], "b", { rowId: "r", newLine: 1 })[0])).toEqual(shape(row));
    expect(shape(moveColumnAt([row], "b", { rowId: "r", newLine: 2 })[0])).toEqual(shape(row));
  });

  it("to another row takes its blocks along; the row it left goes when that was its only column", () => {
    let rows = [newRow("1", id), rowOf([["2", ["a", "b"]], ["1", ["c"]]])];
    rows = insertBlock(rows, rows[0].columns[0].id, { ...newBlock("richText", id), id: "blk" }, 0);
    rows[1] = { ...rows[1], id: "r2" };
    const moved = moveColumnAt(rows, rows[0].columns[0].id, { rowId: "r2", newLine: 3 });
    expect(moved).toHaveLength(1);
    expect(shape(moved[0])).toEqual([["2", ["a", "b"]], ["1", ["c"]], ["1", [rows[0].columns[0].id]]]);
    expect(moved[0].columns[3].blocks.map((b) => b.id)).toEqual(["blk"]);
  });

  it("is refused by a full line, and the rows are then as they were", () => {
    const rows = [rowOf([["6", ["a", "b", "c", "d", "e", "f"]], ["1", ["g"]]])];
    expect(moveColumnAt(rows, "g", { rowId: "r", line: 0, index: 0 })).toBe(rows);
  });
});

describe("taking columns out and changing layouts", () => {
  it("a column leaves its line, which shares evenly again, or goes if it was alone; a row keeps one column", () => {
    const row = rowOf([["left-sidebar", ["a", "b"]], ["1", ["c"]]]);
    expect(shape(removeColumn([row], "a")[0])).toEqual([["1", ["b"]], ["1", ["c"]]]);
    expect(shape(removeColumn([row], "c")[0])).toEqual([["left-sidebar", ["a", "b"]]]);
    const one = [rowOf([["1", ["a"]]])];
    expect(removeColumn(one, "a")).toBe(one);
  });

  it("one line takes another layout, keeping its blocks; the other lines are as they were", () => {
    let rows = [rowOf([["2", ["a", "b"]], ["3", ["c", "d", "e"]]])];
    rows = insertBlock(rows, "e", { ...newBlock("richText", id), id: "x" }, 0);
    const next = setLineLayout(rows, "r", 1, "left-sidebar", id)[0];
    expect(shape(next).map(([layout]) => layout)).toEqual(["2", "left-sidebar"]);
    // The third column's text moved to the new last column of the line.
    expect(next.columns.find((c) => c.id === "d")!.blocks.map((b) => b.id)).toEqual(["x"]);
    expect(next.columns).toHaveLength(4);
    expect(setLineLayout(rows, "r", 5, "1", id)).toEqual(rows);
  });

  it("shares are set and given back for one line at a time", () => {
    const rows = [rowOf([["2", ["a", "b"]], ["2", ["c", "d"]]])];
    const set = setLineShares(rows, "r", 1, "xl", [70, 30]);
    expect(set[0].columns.map((c) => c.width)).toEqual([undefined, undefined, 70, 30]);
    // A line that does not have that many columns takes none.
    expect(setLineShares(rows, "r", 0, "xl", [1, 2, 3])).toEqual(rows);
    const cleared = clearLineShares(set, "r", 1, "xl");
    expect(cleared[0].columns.every((c) => c.width === undefined)).toBe(true);
  });

  it("a copy of a column is in the same line", () => {
    const row = rowOf([["1", ["a"]], ["2", ["b", "c"]]]);
    const next = duplicateColumn([row], "b", id)[0];
    expect(shape(next).map(([layout, ids]) => [layout, (ids as string[]).length])).toEqual([["1", 1], ["3", 3]]);
    expect(locateColumn(next, "c")).toEqual({ line: 1, index: 2 });
  });
});

describe("a new column pressed in the sidebar", () => {
  it("goes after the column last pointed at, in its line", () => {
    const row = rowOf([["1", ["a"]], ["2", ["b", "c"]]]);
    const next = addColumn([row], "b", id)[0];
    expect(linesOf(next)[1].columns.map((c) => c.id).slice(0, 1)).toEqual(["b"]);
    expect(linesOf(next)[1].columns).toHaveLength(3);
    expect(linesOf(next)[1].layout).toBe("3");
  });

  it("goes last in the last row's last line when no column was pointed at, and in a row of its own when there is none", () => {
    const row = rowOf([["1", ["a"]], ["1", ["b"]]]);
    const next = addColumn([row], null, id)[0];
    expect(linesOf(next)[1].columns.map((c) => c.id)[0]).toBe("b");
    expect(linesOf(next)[1].columns).toHaveLength(2);
    const fresh = addColumn([], null, id);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].columns).toHaveLength(1);
  });

  it("is put on a line of its own under a line that is full", () => {
    const row = rowOf([["6", ["a", "b", "c", "d", "e", "f"]]]);
    const next = addColumn([row], "f", id)[0];
    expect(linesOf(next)).toHaveLength(2);
    expect(linesOf(next)[1].columns).toHaveLength(1);
  });
});

describe("the part stylesheet of a row of lines", () => {
  const css = (row: PageRow) => partCss([row], "site", DEFAULT_BREAKPOINTS);
  const rule = (row: PageRow, text: string) => partRules([row], "site").map((r) => r.selector).filter((selector) => selector.includes(text));

  it("lays the lines one under another, each line a grid of its own columns", () => {
    const row = rowOf([["left-sidebar", ["a", "b"]], ["3", ["c", "d", "e"]]]);
    const out = css(row);
    expect(out).toContain("flex-direction:column");
    // The first line's tracks are the sidebar layout's, the second's three equal ones.
    expect(out).toContain("grid-template-columns:minmax(0, 1fr) minmax(0, 2fr)");
    expect(out).toContain("grid-template-columns:minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)");
    expect(rule(row, ":nth-child(1)").length).toBeGreaterThan(0);
    expect(rule(row, ":nth-child(2)").length).toBeGreaterThan(0);
  });

  it("gives a column its place within its own line", () => {
    const row = rowOf([["2", ["a", "b"]], ["2", ["c", "d"]]]);
    row.columns[3] = col("d", { order: 2 });
    expect(rule(row, "> :nth-child(2) > :nth-child(2)").length).toBeGreaterThan(0);
  });

  it("leaves a row of one line as it always was: the columns are the grid's own children", () => {
    const row = rowOf([["3", ["a", "b", "c"]]]);
    expect(rule(row, ":nth-child(1) >")).toEqual([]);
    expect(css(row)).toContain("grid-template-columns:minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)");
  });
});
