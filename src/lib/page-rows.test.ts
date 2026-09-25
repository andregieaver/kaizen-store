import { describe, expect, it } from "vitest";

import type { PageRow } from "./page-content";
import { findBlock, insertBlock, insertRow, moveBlock, moveRow, newBlock, newRow, removeRow, setRowLayout } from "./page-rows";

let n = 0;
const id = () => `id${++n}`;
const text = (row: PageRow) => row.columns.map((c) => c.blocks.map((b) => b.id));

describe("rows", () => {
  it("makes a row with a column for each share of its layout", () => {
    expect(newRow("both-sidebars", id).columns).toHaveLength(3);
    expect(newRow("6", id).columns).toHaveLength(6);
  });

  it("inserts, moves and removes rows", () => {
    const [a, b, c] = [newRow("1", id), newRow("2", id), newRow("3", id)];
    let rows = insertRow([a, b], c, 1);
    expect(rows.map((r) => r.id)).toEqual([a.id, c.id, b.id]);
    rows = moveRow(rows, a.id, 2);
    expect(rows.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    expect(removeRow(rows, b.id).map((r) => r.id)).toEqual([c.id, a.id]);
  });

  it("keeps every block when a row gets fewer columns", () => {
    let rows = [newRow("3", id)];
    const [c1, c2, c3] = rows[0].columns.map((c) => c.id);
    for (const [column, block] of [[c1, "x"], [c2, "y"], [c3, "z"]] as const) {
      rows = insertBlock(rows, column, { ...newBlock("richText", id), id: block }, 0);
    }
    const two = setRowLayout(rows, rows[0].id, "right-sidebar", id);
    expect(text(two[0])).toEqual([["x"], ["y", "z"]]);
    const four = setRowLayout(rows, rows[0].id, "4", id);
    expect(text(four[0])).toEqual([["x"], ["y"], ["z"], []]);
    // The rows it was given are left as they were.
    expect(text(rows[0])).toEqual([["x"], ["y"], ["z"]]);
  });
});

describe("blocks", () => {
  it("moves a block within its column and into another row's column", () => {
    let rows = [newRow("1", id), newRow("2", id)];
    const first = rows[0].columns[0].id;
    const right = rows[1].columns[1].id;
    for (const block of ["a", "b", "c"]) rows = insertBlock(rows, first, { ...newBlock("richText", id), id: block }, 99);
    rows = moveBlock(rows, "a", first, 2);
    expect(text(rows[0])).toEqual([["b", "c", "a"]]);
    rows = moveBlock(rows, "b", right, 0);
    expect(text(rows[0])).toEqual([["c", "a"]]);
    expect(text(rows[1])).toEqual([[], ["b"]]);
    expect(findBlock(rows, "b")).toMatchObject({ rowId: rows[1].id, columnId: right, index: 0 });
  });
});
