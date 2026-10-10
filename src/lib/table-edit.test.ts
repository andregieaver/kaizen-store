import { describe, expect, it } from "vitest";

import { TABLE_COLUMNS_MAX, TABLE_ROWS_MAX, pageBlockSchema } from "./page-content";
import { newBlock } from "./page-rows";
import { addColumn, addRow, removeColumn, removeRow, setCell } from "./table-edit";
import { spacingStyle } from "./page-content";

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

import { addRowTo, removeRowFrom, setSection } from "./table-edit";

describe("a table's section dividers (D197)", () => {
  const table = { rows: [["h"], ["a"], ["b"]], sections: [null, "One", null] as (string | null)[] };

  it("move with their rows when a row is added or taken out", () => {
    expect(addRowTo(table, 0).sections).toEqual([null, null, "One"]);
    expect(addRowTo(table, 1).sections).toEqual([null, "One"]);
    expect(removeRowFrom(table, 0).sections).toEqual(["One"]);
    expect(removeRowFrom(table, 1).sections).toBeUndefined();
  });

  it("are set, emptied (a plain line) and taken away", () => {
    expect(setSection({ rows: table.rows }, 2, "Two").sections).toEqual([null, null, "Two"]);
    expect(setSection(table, 1, "").sections).toEqual([null, ""]);
    expect(setSection(table, 1, null).sections).toBeUndefined();
  });

  it("pass the page's schema, with colours checked", () => {
    const block = { ...newBlock("table", () => "t1"), sections: [null, "One"], headerBackground: "#ABCDEF" };
    const parsed = pageBlockSchema.safeParse(block);
    expect(parsed.success && (parsed.data as { headerBackground?: string }).headerBackground).toBe("#abcdef");
    expect(pageBlockSchema.safeParse({ ...block, headerBackground: "red" }).success).toBe(false);
  });
});

describe("a negative margin (D197)", () => {
  it("is allowed by the schema, written as CSS, and padding still cannot be negative", () => {
    const base = newBlock("heading", () => "h1") as never;
    const ok = pageBlockSchema.safeParse({ ...(base as object), style: { margin: { top: -20, right: 0, bottom: 0, left: 0 } } });
    expect(ok.success ? [] : ok.error.issues).toEqual([]);
    expect(pageBlockSchema.safeParse({ ...(base as object), style: { padding: { top: -5, right: 0, bottom: 0, left: 0 } } }).success).toBe(false);
    expect(spacingStyle({ margin: { top: -20, right: 0, bottom: 0, left: 0 } })).toEqual({ marginTop: "-20px" });
  });
});

import { moveRow } from "./table-edit";

describe("moving a table's rows (D200)", () => {
  const table = { rows: [["h"], ["a"], ["b"], ["c"]], sections: [null, "One", null, "Two"] as (string | null)[] };

  it("takes a row and its divider to the new place", () => {
    expect(moveRow(table, 3, 1)).toEqual({ rows: [["h"], ["c"], ["a"], ["b"]], sections: [null, "Two", "One"] });
    expect(moveRow(table, 1, 3)).toEqual({ rows: [["h"], ["b"], ["c"], ["a"]], sections: [null, null, "Two", "One"] });
  });

  it("changes nothing for the same place or one that is not there", () => {
    expect(moveRow(table, 2, 2)).toBe(table);
    expect(moveRow(table, 2, 9)).toBe(table);
    expect(moveRow({ rows: [["a"], ["b"]] }, 0, 1)).toEqual({ rows: [["b"], ["a"]], sections: undefined });
  });
});
