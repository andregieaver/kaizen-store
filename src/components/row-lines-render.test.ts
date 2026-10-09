import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { newPageContent, type PageColumn, type PageContent, type PageRow } from "@/lib/page-content";

import { PageArticle } from "./page-article";

vi.mock("server-only", () => ({}));

/** A row of several lines of columns, as the site draws it (D187). */

const para = (id: string, words: string) => ({
  id,
  type: "richText" as const,
  doc: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: words }] }] },
});
const col = (id: string, words: string): PageColumn => ({ id, blocks: [para(`${id}-b`, words)] });
const page = (row: PageRow): PageContent => ({ ...newPageContent(), title: "Page", rows: [row] });
const draw = (row: PageRow) => renderToString(createElement(PageArticle, { content: page(row) }));

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
