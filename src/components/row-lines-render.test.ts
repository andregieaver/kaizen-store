import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { newPageContent, type PageColumn, type PageContent, type PageRow } from "@/lib/page-content";

import { PageArticle } from "./page-article";

// Drawn without a site's theme: what is tested here is the page's own (D182 lays a theme under it on the site).
const PLACE = { pageId: null, owner: null, theme: { elements: undefined, sections: undefined } };

vi.mock("server-only", () => ({}));

/** A row of several lines of columns, as the site draws it (D187). */

const para = (id: string, words: string) => ({
  id,
  type: "richText" as const,
  doc: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: words }] }] },
});
const col = (id: string, words: string): PageColumn => ({ id, blocks: [para(`${id}-b`, words)] });
const page = (row: PageRow): PageContent => ({ ...newPageContent(), title: "Page", rows: [row] });
const draw = (row: PageRow) => renderToString(createElement(PageArticle, { content: page(row), place: PLACE }));

describe("a row of lines on the site", () => {
  const two: PageRow = {
    id: "r1",
    type: "row",
    layout: "2",
    moreLines: ["1"],
    columns: [col("a", "Alpha"), col("b", "Bravo"), col("c", "Charlie")],
  };

  it("draws each line in a box of its own inside the row's grid, the columns in their order", () => {
    const out = draw(two);
    expect(["Alpha", "Bravo", "Charlie"].map((word) => out.indexOf(word))).toEqual([...["Alpha", "Bravo", "Charlie"].map((word) => out.indexOf(word))].sort((x, y) => x - y));
    // The grid's own children are the lines: a plain box, holding the columns.
    const grid = /<div class="[^"]*-g[^"]*"[^>]*>((?:<div>[\s\S]*?<\/div>)+)<\/div><\/div><\/div>/.exec(out);
    expect(grid).not.toBeNull();
    expect(out.match(/<div class="kz-[a-c] /g)).toHaveLength(3);
    expect(out).toMatch(/<div class="[^"]*-g[^"]*"><div><div[^>]*class="kz-a /);
  });

  it("draws a row of one line as before: the columns are the grid's own children", () => {
    const one: PageRow = { id: "r2", type: "row", layout: "2", columns: [col("a", "Alpha"), col("b", "Bravo")] };
    const out = draw(one);
    expect(out).toMatch(/<div class="[^"]*-g[^"]*"><div[^>]*class="kz-a /);
    expect(out).not.toMatch(/<div class="[^"]*-g[^"]*"><div><div/);
  });
});

/** Rows that meet (D262): two rows next to each other that both draw a box take back the page's room between them. */
describe("rows with boxes next to each other on the site", () => {
  const grey = { type: "color" as const, color: "#eeeeee" };
  const boxed = (id: string, extra: Partial<PageRow> = {}): PageRow => ({ id, type: "row", layout: "1", columns: [col(`${id}c`, id)], background: grey, ...extra });
  const drawAll = (...rows: PageRow[]) => renderToString(createElement(PageArticle, { content: { ...page(rows[0]), rows }, place: PLACE }));
  const MEETS = "margin-top:calc(2rem * -1)";

  it("meet where both draw a box, and keep the room where one does not", () => {
    const out = drawAll(boxed("one"), boxed("two"), { ...boxed("three"), background: undefined }, boxed("four"));
    expect(out.split(MEETS)).toHaveLength(2);
    expect(out.indexOf(MEETS)).toBeLessThan(out.indexOf(">two<"));
    expect(out.indexOf(MEETS)).toBeGreaterThan(out.indexOf(">one<"));
  });
});
