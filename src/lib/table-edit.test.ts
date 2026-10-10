import { describe, expect, it } from "vitest";

import { TABLE_COLUMNS_MAX, TABLE_ROWS_MAX, pageBlockSchema } from "./page-content";
import { newBlock } from "./page-rows";
import { addColumn, addRow, removeColumn, removeRow, setCell } from "./table-edit";

const grid = [["a", "b"], ["c", "d"]];

describe("a table's cells", () => {
  it("adds a row or a column where asked, empty, keeping the table rectangular", () => {
    expect(addRow(grid)).toEqual([["a", "b"], ["c", "d"], ["", ""]]);
    expect(addRow(grid, -1)).toEqual([["", ""], ["a", "b"], ["c", "d"]]);
    expect(addRow(grid, 0)).toEqual([["a", "b"], ["", ""], ["c", "d"]]);
    expect(addColumn(grid)).toEqual([["a", "b", ""], ["c", "d", ""]]);
    expect(addColumn(grid, -1)).toEqual([["", "a", "b"], ["", "c", "d"]]);
    expect(addColumn(grid, 0)).toEqual([["a", "", "b"], ["c", "", "d"]]);
  });

  it("takes a row or a column out, but keeps one of each", () => {
    expect(removeRow(grid, 0)).toEqual([["c", "d"]]);
    expect(removeColumn(grid, 1)).toEqual([["a"], ["c"]]);
    expect(removeRow([["x", "y"]], 0)).toEqual([["", ""]]);
    expect(removeColumn([["x"], ["y"]], 0)).toEqual([[""], [""]]);
  });

  it("stops at the limits and changes one cell only", () => {
    const tall = Array.from({ length: TABLE_ROWS_MAX }, () => ["x"]);
    expect(addRow(tall)).toBe(tall);
    const wide = [Array.from({ length: TABLE_COLUMNS_MAX }, () => "x")];
    expect(addColumn(wide)).toBe(wide);
    expect(setCell(grid, 1, 0, "z")).toEqual([["a", "b"], ["z", "d"]]);
    expect(grid[1][0]).toBe("c");
  });
});

describe("a table block", () => {
  it("starts as a 3 by 3 with a header, stacking on phones, and passes the page's schema", () => {
    const block = newBlock("table", () => "t1");
    expect(block).toMatchObject({ type: "table", header: true, mobile: "stack" });
    expect(pageBlockSchema.safeParse(block).success).toBe(true);
  });

  it("refuses rows of different lengths and tables over the limits", () => {
    const base = newBlock("table", () => "t1");
    expect(pageBlockSchema.safeParse({ ...base, rows: [["a", "b"], ["c"]] }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ ...base, rows: [] }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ ...base, rows: [[]] }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ ...base, rows: [Array.from({ length: TABLE_COLUMNS_MAX + 1 }, () => "")] }).success).toBe(false);
  });
});
