import { describe, expect, it } from "vitest";

import { mapTexts } from "./page-translation";
import { blockText, newPageContent, pageBlocks, pageInput, pageParts, withParts, type ColumnsBlock, type HeadingBlock, type PageBlock, type PageRow } from "./page-content";
import {
  addColumn,
  copyRow,
  findBlock,
  findHolder,
  insertBlock,
  insertColumnAt,
  moveBlock,
  moveColumnAt,
  nestColumn,
  newBlock,
  newColumnsBlock,
  patchBlock,
  patchColumn,
  removeBlock,
  removeColumn,
  setLineShares,
} from "./page-rows";
import { partCss } from "./part-css";
import { publicRows } from "./visibility";
import { DEFAULT_BREAKPOINTS } from "./breakpoints";

/** Columns inside a column (D294): one level deep, edited by the same functions as a row's columns. */

let n = 0;
const id = () => `id${++n}`;

const heading = (blockId: string, text: string): PageBlock => ({ id: blockId, type: "heading", text, level: 2 });

function page(): PageRow[] {
  const nested: ColumnsBlock = {
    id: "nest",
    type: "columns",
    layout: "2",
    columns: [
      { id: "n1", blocks: [heading("h1", "Left")] },
      { id: "n2", blocks: [heading("h2", "Right")] },
    ],
  };
  return [
    {
      id: "row",
      type: "row",
      layout: "2",
      columns: [
        { id: "c1", blocks: [heading("top", "Above"), nested] },
        { id: "c2", blocks: [] },
      ],
    },
  ];
}

const nestOf = (rows: PageRow[]) => rows[0].columns.flatMap((c) => c.blocks).find((b): b is ColumnsBlock => b.type === "columns");

describe("the Columns component's content", () => {
  it("is saved and read as stored", () => {
    const parsed = pageInput.safeParse({ ...newPageContent(), title: "T", slug: "t", rows: page() });
    expect(parsed.success).toBe(true);
  });

  it("refuses a Columns component inside a nested column", () => {
    const rows = page();
    const inner = nestOf(rows)!;
    inner.columns[0].blocks.push({ id: "deep", type: "columns", layout: "1", columns: [{ id: "d1", blocks: [] }] });
    expect(pageInput.safeParse({ ...newPageContent(), title: "T", slug: "t", rows }).success).toBe(false);
  });

  it("refuses columns that do not match its layout", () => {
    const rows = page();
    nestOf(rows)!.columns.pop();
    expect(pageInput.safeParse({ ...newPageContent(), title: "T", slug: "t", rows }).success).toBe(false);
  });

  it("is seen by every walker of the page", () => {
    const rows = page();
    expect(pageParts(rows).map((p) => p.id)).toEqual(["row", "c1", "top", "nest", "n1", "h1", "n2", "h2", "c2"]);
    expect(pageBlocks({ rows }).map((b) => b.id)).toEqual(["top", "nest", "h1", "h2"]);
    expect(withParts(rows[0].columns[0].blocks).map((p) => p.id)).toEqual(["top", "nest", "n1", "h1", "n2", "h2"]);
    expect(blockText(nestOf(rows)!)).toBe("Left Right");
  });

  it("is translated by its blocks' own places", () => {
    const keys: string[] = [];
    mapTexts({ ...newPageContent(), title: "T", rows: page() }, (key, value) => {
      keys.push(key);
      return value;
    });
    expect(keys).toEqual(expect.arrayContaining(["block.h1.text", "block.h2.text"]));
  });

  it("leaves out for everyone a nested part shown to some", () => {
    const rows = page();
    nestOf(rows)!.columns[1].blocks[0] = { ...heading("h2", "Members"), visibility: { show: "signedIn" } };
    const shown = publicRows(rows);
    expect(nestOf(shown)!.columns[1].blocks).toEqual([]);
  });

  it("styles its columns and lays them out as a row's", () => {
    const rows = page();
    const nest = nestOf(rows)!;
    nest.gap = 8;
    nest.columns[0].style = { padding: { top: 11, right: 11, bottom: 11, left: 11 } };
    const css = partCss(rows, "site", DEFAULT_BREAKPOINTS);
    expect(css).toContain("gap:8px");
    expect(css).toContain("padding-top:11px");
  });
});

describe("editing nested columns", () => {
  it("finds, changes and removes a block in a nested column", () => {
    const rows = page();
    expect(findBlock(rows, "h2")).toMatchObject({ rowId: "nest", columnId: "n2" });
    const patched = patchBlock<HeadingBlock>(rows, "h2", { text: "Changed" });
    expect((nestOf(patched)!.columns[1].blocks[0] as { text: string }).text).toBe("Changed");
    expect(nestOf(removeBlock(rows, "h2"))!.columns[1].blocks).toEqual([]);
  });

  it("keeps the component's own settings when they change", () => {
    const patched = patchBlock<ColumnsBlock>(page(), "nest", { gap: 8 });
    expect(nestOf(patched)!.gap).toBe(8);
    expect(nestOf(patched)!.columns).toHaveLength(2);
  });

  it("removes the component itself", () => {
    expect(nestOf(removeBlock(page(), "nest"))).toBeUndefined();
  });

  it("moves a block into and out of a nested column", () => {
    const into = moveBlock(page(), "top", "n1", 0);
    expect(nestOf(into)!.columns[0].blocks.map((b) => b.id)).toEqual(["top", "h1"]);
    const out = moveBlock(page(), "h1", "c2", 0);
    expect(out[0].columns[1].blocks.map((b) => b.id)).toEqual(["h1"]);
  });

  it("never puts a Columns component in a nested column", () => {
    const rows = page();
    expect(insertBlock(rows, "n1", newBlock("columns", id), 0)).toBe(rows);
  });

  it("moves a row's column into the component and back out", () => {
    const into = moveColumnAt(page(), "c2", { rowId: "nest", line: 0, index: 2 });
    expect(into[0].columns.map((c) => c.id)).toEqual(["c1"]);
    expect(nestOf(into)!.columns.map((c) => c.id)).toEqual(["n1", "n2", "c2"]);
    expect(nestOf(into)!.layout).toBe("3");
    const back = moveColumnAt(into, "n1", { rowId: "row", line: 0, index: 1 });
    expect(back[0].columns.map((c) => c.id)).toEqual(["c1", "n1"]);
    expect(nestOf(back)!.columns.map((c) => c.id)).toEqual(["n2", "c2"]);
  });

  it("refuses to move the column holding the component into it", () => {
    const rows = page();
    expect(moveColumnAt(rows, "c1", { rowId: "nest", line: 0, index: 0 })).toBe(rows);
  });

  it("puts a nested column on a line of its own", () => {
    const moved = moveColumnAt(page(), "n2", { rowId: "nest", newLine: 1 });
    expect(nestOf(moved)!.layout).toBe("1");
    expect(nestOf(moved)!.moreLines).toEqual(["1"]);
    expect(pageInput.safeParse({ ...newPageContent(), title: "T", slug: "t", rows: moved }).success).toBe(true);
  });

  it("takes the component away when its last column leaves", () => {
    const one = removeColumn(page(), "n2");
    expect(nestOf(one)!.columns.map((c) => c.id)).toEqual(["n1"]);
    const out = moveColumnAt(one, "n1", { rowId: "row", line: 0, index: 2 });
    expect(nestOf(out)).toBeUndefined();
    expect(out[0].columns.map((c) => c.id)).toEqual(["c1", "c2", "n1"]);
  });

  it("adds, shares and sets a nested column as a row's", () => {
    const added = insertColumnAt(page(), { rowId: "nest", line: 0, index: 1 }, { id: "new", blocks: [] });
    expect(nestOf(added)!.columns.map((c) => c.id)).toEqual(["n1", "new", "n2"]);
    expect(nestOf(addColumn(page(), "n1", id))!.columns).toHaveLength(3);
    const shared = setLineShares(page(), "nest", 0, "xl", [30, 70]);
    expect(nestOf(shared)!.columns.map((c) => c.width)).toEqual([30, 70]);
    const linked = patchColumn(page(), "n1", { inline: true });
    expect(nestOf(linked)!.columns[0].inline).toBe(true);
    expect(findHolder(page(), "nest")?.columns).toHaveLength(2);
  });

  it("copies with ids of its own", () => {
    const copy = copyRow(page()[0], id);
    const ids = pageParts([copy]).map((p) => p.id);
    expect(ids.some((value) => ["nest", "n1", "n2", "h1", "h2"].includes(value))).toBe(false);
  });

  it("nests a row's column into another column, in a Columns component of its own, at the place it is dropped", () => {
    const nested = nestColumn(page(), "c2", "c1", 1, id);
    expect(nested[0].columns.map((c) => c.id)).toEqual(["c1"]);
    expect(nested[0].layout).toBe("1");
    const blocks = nested[0].columns[0].blocks;
    expect(blocks.map((b) => b.type)).toEqual(["heading", "columns", "columns"]);
    expect((blocks[1] as ColumnsBlock).columns.map((c) => c.id)).toEqual(["c2"]);
    expect(pageInput.safeParse({ ...newPageContent(), title: "T", slug: "t", rows: nested }).success).toBe(true);
  });

  it("nests a column from another row, taking that row away when it was its only column", () => {
    const rows: PageRow[] = [...page(), { id: "r2", type: "row", layout: "1", columns: [{ id: "lone", blocks: [heading("hl", "Lone")] }] }];
    const nested = nestColumn(rows, "lone", "c2", 0, id);
    expect(nested.map((r) => r.id)).toEqual(["row"]);
    expect((nested[0].columns[1].blocks[0] as ColumnsBlock).columns[0].blocks.map((b) => b.id)).toEqual(["hl"]);
  });

  it("never nests deeper than one level", () => {
    const rows = page();
    expect(nestColumn(rows, "c2", "n1", 0, id)).toBe(rows);
    expect(nestColumn(rows, "c1", "c2", 0, id)).toBe(rows);
    expect(nestColumn(rows, "c2", "c2", 0, id)).toBe(rows);
  });

  it("puts new nested columns in a column, as many as the layout has, but never in a nested column", () => {
    const added = insertBlock(page(), "c2", newColumnsBlock("3", id), 0);
    expect((added[0].columns[1].blocks[0] as ColumnsBlock).columns).toHaveLength(3);
    const rows = page();
    expect(insertBlock(rows, "n1", newColumnsBlock("2", id), 0)).toBe(rows);
  });
});
