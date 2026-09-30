import { describe, expect, it } from "vitest";

import { BLOCKS_MAX, ROWS_MAX, pageBlocks, type PageBlock, type PageRow } from "./page-content";
import {
  applyPageLayout,
  cssAfter,
  cssNote,
  isBlankPage,
  layoutRoomProblem,
  replaceWarning,
} from "./page-layout-apply";
import { htmlIds, newBlock, newRow } from "./page-rows";

let n = 0;
const id = () => `n${++n}`;

const heading = (text: string, extra: Partial<PageBlock> = {}): PageBlock =>
  ({ ...newBlock("heading", id), text, ...extra }) as PageBlock;
const rowWith = (blocks: PageBlock[], extra: Partial<PageRow> = {}): PageRow => {
  const row = newRow("1", id);
  row.columns[0].blocks.push(...blocks);
  return { ...row, ...extra };
};
const layout = (rows: PageRow[], css = "") => ({ rows, css });
const ids = (rows: PageRow[]) =>
  rows.flatMap((r) => [r.id, ...r.columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])]);

describe("applying a page layout", () => {
  const own = [rowWith([heading("Old")]), rowWith([heading("Older")])];
  const incoming = layout([rowWith([heading("New one")]), rowWith([heading("New two")])], ".hero { color: red }");

  it("replaces the page's rows with copies that have fresh ids", () => {
    const result = applyPageLayout({ rows: own }, incoming, "replace", id);
    if (!result.ok) throw new Error(result.problem);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => (r.columns[0].blocks[0] as { text: string }).text)).toEqual(["New one", "New two"]);
    const before = new Set(ids(incoming.rows));
    expect(ids(result.rows).some((each) => before.has(each))).toBe(false);
    expect(new Set(ids(result.rows)).size).toBe(ids(result.rows).length);
    // The layout itself is never changed.
    expect(incoming.rows[0].columns[0].blocks).toHaveLength(1);
  });

  it("adds the layout after the current rows, which stay as they were", () => {
    const result = applyPageLayout({ rows: own }, incoming, "add", id);
    if (!result.ok) throw new Error(result.problem);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.slice(0, 2)).toEqual(own);
    expect(new Set(ids(result.rows)).size).toBe(ids(result.rows).length);
  });

  it("gives up a custom id the page already uses, and keeps one that is free", () => {
    const page = [rowWith([heading("A", { htmlId: "intro" })])];
    const taken = layout([rowWith([heading("B", { htmlId: "intro" }), heading("C", { htmlId: "free" })])]);
    const added = applyPageLayout({ rows: page }, taken, "add", id);
    if (!added.ok) throw new Error(added.problem);
    expect([...htmlIds(added.rows)].sort()).toEqual(["free", "intro"]);
    const blocks = pageBlocks({ rows: added.rows });
    expect(blocks.filter((b) => b.htmlId === "intro")).toHaveLength(1);
    // Replacing leaves nothing of the old page to clash with.
    const replaced = applyPageLayout({ rows: page }, taken, "replace", id);
    if (!replaced.ok) throw new Error(replaced.problem);
    expect([...htmlIds(replaced.rows)].sort()).toEqual(["free", "intro"]);
  });

  it("does not reuse a custom id twice inside the layout either", () => {
    const twice = layout([rowWith([heading("A", { htmlId: "same" })]), rowWith([heading("B", { htmlId: "same" })])]);
    const result = applyPageLayout({ rows: [] }, twice, "replace", id);
    if (!result.ok) throw new Error(result.problem);
    expect(pageBlocks({ rows: result.rows }).filter((b) => b.htmlId === "same")).toHaveLength(1);
  });

  it("gives a modal row a key of its own when the page has that one", () => {
    const modal = (): PageRow =>
      rowWith([heading("Offer")], {
        modal: { key: "promo", triggers: { click: true }, frequency: "always", size: "medium" },
      } as unknown as Partial<PageRow>);
    const result = applyPageLayout({ rows: [modal()] }, layout([modal()]), "add", id);
    if (!result.ok) throw new Error(result.problem);
    const keys = result.rows.map((r) => r.modal?.key);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toBe("promo");
  });

  it("drops the marks of a global's uses on a template from another store, and keeps its own layouts' as they are", () => {
    const used = rowWith([heading("Shared")], { global: "g1" });
    const foreign = applyPageLayout({ rows: [] }, layout([used]), "replace", id, true);
    if (!foreign.ok) throw new Error(foreign.problem);
    expect(foreign.rows[0].global).toBeUndefined();
    const mine = applyPageLayout({ rows: [] }, layout([used]), "replace", id, false);
    if (!mine.ok) throw new Error(mine.problem);
    expect(mine.rows[0].global).toBe("g1");
  });

  it("shows a template's grids the store's own products, without another store's categories", () => {
    const grid = {
      ...newBlock("contentGrid", id),
      source: { type: "products" },
      categories: ["their-category"],
      tags: ["their-tag"],
    } as unknown as PageBlock;
    const result = applyPageLayout({ rows: [] }, layout([rowWith([grid])]), "replace", id, true);
    if (!result.ok) throw new Error(result.problem);
    const made = result.rows[0].columns[0].blocks[0] as unknown as { categories: string[]; tags: string[] };
    expect(made.categories).toEqual([]);
    expect(made.tags).toEqual([]);
  });
});

describe("the page's caps", () => {
  const many = (count: number) => Array.from({ length: count }, () => rowWith([]));

  it("accepts exactly as many rows as a page takes, and refuses one more", () => {
    expect(layoutRoomProblem({ rows: [] }, { rows: many(ROWS_MAX) }, "replace")).toBeNull();
    expect(layoutRoomProblem({ rows: [] }, { rows: many(ROWS_MAX + 1) }, "replace")).toMatch(/takes at most 50/);
    expect(layoutRoomProblem({ rows: many(ROWS_MAX) }, { rows: many(1) }, "add")).toMatch(/takes at most 50/);
    // Replacing does not count the rows that go.
    expect(layoutRoomProblem({ rows: many(ROWS_MAX) }, { rows: many(1) }, "replace")).toBeNull();
  });

  it("counts blocks too, and says so", () => {
    const blocks = (count: number) => [rowWith(Array.from({ length: count }, () => heading("x")))];
    expect(layoutRoomProblem({ rows: [] }, { rows: blocks(BLOCKS_MAX) }, "replace")).toBeNull();
    expect(layoutRoomProblem({ rows: blocks(1) }, { rows: blocks(BLOCKS_MAX) }, "add")).toMatch(/takes at most 100/);
    const refused = applyPageLayout({ rows: blocks(1) }, layout(blocks(BLOCKS_MAX)), "add", id);
    expect(refused.ok).toBe(false);
  });
});

describe("the page's CSS", () => {
  it("replaces the page's own CSS with the layout's when it has some", () => {
    expect(cssAfter({ css: "a{}" }, { css: "b{}" }, "replace")).toBe("b{}");
    expect(cssAfter({}, { css: "b{}" }, "replace")).toBe("b{}");
    expect(cssNote({ css: "a{}" }, { css: "b{}" }, "replace")).toMatch(/replaces this page's own CSS/);
  });

  it("leaves the page's CSS alone when the layout has none", () => {
    expect(cssAfter({ css: "a{}" }, { css: "" }, "replace")).toBeUndefined();
    expect(cssAfter({ css: "a{}" }, { css: "  " }, "add")).toBeUndefined();
    expect(cssNote({ css: "a{}" }, { css: "" }, "replace")).toMatch(/stays/);
    expect(cssNote({}, { css: "" }, "replace")).toBeNull();
  });

  it("adds the layout's CSS only to a page that has none", () => {
    expect(cssAfter({}, { css: "b{}" }, "add")).toBe("b{}");
    expect(cssAfter({ css: "a{}" }, { css: "b{}" }, "add")).toBeUndefined();
    expect(cssNote({ css: "a{}" }, { css: "b{}" }, "add")).toMatch(/keeps its own/);
  });

  it("comes with the rows", () => {
    const result = applyPageLayout({ rows: [], css: "" }, { rows: [rowWith([])], css: "b{}" }, "replace", id);
    expect(result.ok && result.css).toBe("b{}");
  });
});

describe("a blank page", () => {
  it("is one with nothing written on it", () => {
    expect(isBlankPage([])).toBe(true);
    expect(isBlankPage([rowWith([newBlock("richText", id)])])).toBe(true);
    expect(isBlankPage([rowWith([heading("Hello")])])).toBe(false);
  });
});

describe("the warning before replacing", () => {
  it("counts the rows that go, and says the builder has no undo but a reload does", () => {
    const written = [rowWith([heading("Hello")]), rowWith([heading("World")])];
    const saved = replaceWarning(written, true, "page");
    expect(saved).toMatch(/replaces the 2 rows on this page/);
    expect(saved).toMatch(/no undo/);
    expect(saved).toMatch(/reloading it brings the old rows back/);
    expect(replaceWarning([written[0]], true, "article")).toMatch(/the 1 row on this article/);
  });

  it("does not promise a reload to a page that was never saved", () => {
    const warning = replaceWarning([rowWith([heading("Hello")])], false, "page");
    expect(warning).toMatch(/not been saved yet/);
    expect(warning).not.toMatch(/reloading/);
  });

  it("says nothing for a page with nothing on it", () => {
    expect(replaceWarning([rowWith([newBlock("richText", id)])], false, "page")).toBeNull();
    expect(replaceWarning([], true, "page")).toBeNull();
  });
});
