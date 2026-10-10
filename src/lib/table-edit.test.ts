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

import { entriesOf, moveEntry } from "./table-edit";

describe("moving a table's rows and dividers each by itself (D202)", () => {
  // Header, a, divider One, b, c, divider Two, d
  const table = { rows: [["h"], ["a"], ["b"], ["c"], ["d"]], sections: [null, null, "One", null, "Two"] as (string | null)[] };
  const names = (t: typeof table | ReturnType<typeof moveEntry>) => entriesOf(t, 1).map((e) => ("divider" in e ? `[${e.divider}]` : e.row[0]));

  it("lists the body as rows and dividers in order", () => {
    expect(names(table)).toEqual(["a", "[One]", "b", "c", "[Two]", "d"]);
  });

  it("moves a row without its divider", () => {
    // b dragged to the top: the divider One stays where it was among the rest.
    expect(names(moveEntry(table, 1, 2, 0))).toEqual(["b", "a", "[One]", "c", "[Two]", "d"]);
    expect(names(moveEntry(table, 1, 3, 5))).toEqual(["a", "[One]", "b", "[Two]", "d", "c"]);
  });

  it("moves a divider without its row, and keeps the header first", () => {
    const moved = moveEntry(table, 1, 1, 2);
    expect(names(moved)).toEqual(["a", "b", "[One]", "c", "[Two]", "d"]);
    expect(moved.rows[0]).toEqual(["h"]);
  });

  it("refuses to leave two dividers together or one at the end", () => {
    expect(moveEntry(table, 1, 1, 4)).toBe(table);
    expect(moveEntry(table, 1, 4, 5)).toBe(table);
  });

  it("works from the first row when there is no header", () => {
    const plain = { rows: [["a"], ["b"]], sections: [null, "One"] as (string | null)[] };
    expect(moveEntry(plain, 0, 0, 2)).toEqual({ rows: [["b"], ["a"]], sections: ["One"] });
  });
});
