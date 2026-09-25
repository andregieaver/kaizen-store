import { describe, expect, it } from "vitest";

import type { PageRow } from "./page-content";
import {
  canDuplicateColumn,
  copyColumn,
  copyRow,
  htmlIds,
  insertColumn,
  duplicateBlock,
  duplicateColumn,
  duplicateRow,
  findBlock,
  insertBlock,
  insertRow,
  moveBlock,
  moveColumn,
  moveColumnTo,
  moveRow,
  newBlock,
  newRow,
  patchColumn,
  patchPart,
  patchRow,
  removeColumn,
  removeRow,
  setRowLayout,
  setSpacing,
  spacingOf,
} from "./page-rows";

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

describe("duplicating and columns", () => {
  const filled = () => {
    let rows = [newRow("left-sidebar", id)];
    const [left, right] = rows[0].columns.map((c) => c.id);
    rows = insertBlock(rows, left, { ...newBlock("richText", id), id: "l" }, 0);
    rows = insertBlock(rows, right, { ...newBlock("richText", id), id: "r" }, 0);
    return { rows, left, right };
  };

  it("copies a row with new ids everywhere, right after it", () => {
    const { rows } = filled();
    const next = duplicateRow(rows, rows[0].id, id);
    expect(next).toHaveLength(2);
    expect(next[1].layout).toBe("left-sidebar");
    const ids = next.flatMap((r) => [r.id, ...r.columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])]);
    expect(new Set(ids).size).toBe(ids.length);
    // A copy, not the same objects: changing one leaves the other.
    expect(next[1].columns[0].blocks[0]).not.toBe(next[0].columns[0].blocks[0]);
  });

  it("copies a block right after it", () => {
    const { rows, left } = filled();
    const next = duplicateBlock(rows, "l", id);
    const blocks = next[0].columns.find((c) => c.id === left)!.blocks;
    expect(blocks[0].id).toBe("l");
    expect(blocks).toHaveLength(2);
    expect(blocks[1].id).not.toBe("l");
  });

  it("adds and takes out columns, making them equal, and keeps one", () => {
    const { rows, left, right } = filled();
    const three = duplicateColumn(rows, left, id);
    expect(three[0].layout).toBe("3");
    expect(text(three[0])[2]).toEqual(["r"]);
    const one = removeColumn(rows, left);
    expect(one[0].layout).toBe("1");
    expect(text(one[0])).toEqual([["r"]]);
    expect(removeColumn(one, right)).toBe(one);
    let six = [newRow("6", id)];
    expect(canDuplicateColumn(six, six[0].columns[0].id)).toBe(false);
    six = duplicateColumn(six, six[0].columns[0].id, id);
    expect(six[0].columns).toHaveLength(6);
  });

  it("moves a column within its row", () => {
    const { rows, left } = filled();
    expect(text(moveColumn(rows, left, 1)[0])).toEqual([["r"], ["l"]]);
  });
});

describe("moving a column to another row", () => {
  const two = () => {
    let rows = [newRow("left-sidebar", id), newRow("2", id)];
    rows = insertBlock(rows, rows[0].columns[1].id, { ...newBlock("richText", id), id: "a" }, 0);
    rows = insertBlock(rows, rows[0].columns[1].id, { ...newBlock("richText", id), id: "b" }, 1);
    return rows;
  };

  it("takes its blocks along and divides both rows evenly", () => {
    const rows = two();
    const moving = rows[0].columns[1].id;
    const next = moveColumnTo(rows, moving, rows[1].id, 1);
    expect(next[0].layout).toBe("1");
    expect(next[1].layout).toBe("3");
    expect(text(next[1])).toEqual([[], ["a", "b"], []]);
  });

  it("removes the row it left when that was its only column", () => {
    let rows = [newRow("1", id), newRow("3", id)];
    rows = insertBlock(rows, rows[0].columns[0].id, { ...newBlock("richText", id), id: "x" }, 0);
    const next = moveColumnTo(rows, rows[0].columns[0].id, rows[1].id, 99);
    expect(next).toHaveLength(1);
    expect(next[0].layout).toBe("4");
    expect(text(next[0])[3]).toEqual(["x"]);
  });

  it("refuses a row with six columns, and keeps the layout within its own row", () => {
    const rows = [newRow("1", id), newRow("6", id)];
    expect(moveColumnTo(rows, rows[0].columns[0].id, rows[1].id, 0)).toBe(rows);
    const own = two();
    const moved = moveColumnTo(own, own[0].columns[1].id, own[0].id, 0);
    expect(moved[0].layout).toBe("left-sidebar");
    expect(text(moved[0])).toEqual([["a", "b"], []]);
  });
});

describe("putting copies on the page", () => {
  it("copies a row with new ids and puts a column into a row, dividing it evenly", () => {
    const saved = newRow("both-sidebars", id);
    const copy = copyRow(saved, id);
    expect(copy.id).not.toBe(saved.id);
    expect(copy.columns.map((c) => c.id)).not.toEqual(saved.columns.map((c) => c.id));
    const rows = insertColumn([newRow("2", id)], "missing", { id: "x", blocks: [] }, 0);
    expect(rows[0].columns).toHaveLength(2);
    const row = newRow("2", id);
    const three = insertColumn([row], row.id, { id: "x", blocks: [] }, 0);
    expect(three[0].layout).toBe("3");
    expect(three[0].columns[0].id).toBe("x");
    const full = newRow("6", id);
    expect(insertColumn([full], full.id, { id: "y", blocks: [] }, 0)[0].columns).toHaveLength(6);
  });
});

describe("spacing and pictures", () => {
  it("sets margin and padding on a row, a column or a block", () => {
    let rows = [newRow("2", id)];
    const column = rows[0].columns[1].id;
    rows = insertBlock(rows, column, newBlock("image", id), 0);
    const block = rows[0].columns[1].blocks[0].id;
    const sides = { top: 8, right: 0, bottom: 16, left: 0 };
    rows = setSpacing(rows, { kind: "row", id: rows[0].id }, { margin: sides });
    rows = setSpacing(rows, { kind: "column", id: column }, { padding: sides });
    rows = setSpacing(rows, { kind: "block", id: block }, { margin: sides, padding: sides });
    expect(spacingOf(rows, { kind: "row", id: rows[0].id })).toEqual({ margin: sides });
    expect(spacingOf(rows, { kind: "column", id: column })).toEqual({ padding: sides });
    expect(spacingOf(rows, { kind: "block", id: block })).toEqual({ margin: sides, padding: sides });
    expect(rows[0].columns[0].style).toBeUndefined();
  });

  it("starts a picture block without a picture", () => {
    expect(newBlock("image", id)).toMatchObject({ type: "image", image: null, caption: "" });
  });

  it("starts a heading at level 2 and a button without text or address (D49)", () => {
    expect(newBlock("heading", id)).toMatchObject({ type: "heading", text: "", level: 2 });
    expect(newBlock("button", id)).toMatchObject({ type: "button", label: "", href: "" });
  });
});

describe("settings (D48)", () => {
  it("merges settings in and takes out those switched off", () => {
    let rows = [newRow("2", id)];
    const rowId = rows[0].id;
    rows = patchRow(rows, rowId, { width: "full", fullHeight: true, htmlId: "hero" });
    expect(rows[0]).toMatchObject({ width: "full", fullHeight: true, htmlId: "hero" });
    rows = patchRow(rows, rowId, { fullHeight: false, width: undefined });
    expect(rows[0]).not.toHaveProperty("fullHeight");
    expect(rows[0]).not.toHaveProperty("width");
    const column = rows[0].columns[0].id;
    rows = patchColumn(rows, column, { link: { href: "/about", label: "" } });
    expect(rows[0].columns[0].link).toEqual({ href: "/about", label: "" });
    rows = patchPart(rows, { kind: "column", id: column }, { className: "card" });
    expect(rows[0].columns[0]).toMatchObject({ className: "card", link: { href: "/about" } });
    rows = setSpacing(rows, { kind: "row", id: rowId }, {});
    expect(rows[0]).not.toHaveProperty("style");
  });

  it("leaves a custom id off a copy while the page uses it, and keeps a column's settings when copied", () => {
    let rows = [newRow("2", id)];
    const column = rows[0].columns[0].id;
    rows = patchColumn(rows, column, { htmlId: "offer", className: "card", style: { padding: { top: 8, right: 8, bottom: 8, left: 8 } } });
    const three = duplicateColumn(rows, column, id);
    expect(three[0].columns[1]).toMatchObject({ className: "card", style: { padding: { top: 8 } } });
    expect(three[0].columns[1].htmlId).toBeUndefined();
    expect(htmlIds(three)).toEqual(new Set(["offer"]));
    // A saved part put on a page that does not use its id keeps it.
    expect(copyColumn(rows[0].columns[0], id, new Set()).htmlId).toBe("offer");
    expect(copyRow(rows[0], id, htmlIds(rows)).columns[0].htmlId).toBeUndefined();
  });
});
