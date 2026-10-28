import { describe, expect, it } from "vitest";

import { newPageContent, type PageContent, type PageRow } from "./page-content";
import { parseStoreTheme } from "./theme";
import { compareLooks, compareVersions } from "./version-compare";

const row = (id: string, heading: string, extra: Partial<PageRow> = {}): PageRow =>
  ({
    id,
    type: "row",
    layout: "1",
    columns: [{ id: `${id}-col`, blocks: [{ id: `${id}-h`, type: "heading", text: heading, level: 2 }] }],
    ...extra,
  }) as PageRow;

const page = (rows: PageRow[], over: Partial<PageContent> = {}): PageContent => ({ ...newPageContent(), title: "Home", slug: "home", rows, ...over });

describe("comparing two versions of a page", () => {
  it("says nothing for the same page", () => {
    const p = page([row("a", "Hello"), row("b", "World")]);
    expect(compareVersions(p, structuredClone(p))).toEqual([]);
  });

  it("names the page's own fields that changed", () => {
    const before = page([row("a", "Hello")]);
    const after = { ...before, title: "Front", slug: "front", css: ".x{color:red}" };
    expect(compareVersions(before, after).map((d) => (d.kind === "field" ? d.field : d.kind))).toEqual(["title", "slug", "css"]);
  });

  it("gives a changed text with its label and both words", () => {
    const diff = compareVersions(page([row("a", "Hello")]), page([row("a", "Hello there")]));
    expect(diff).toEqual([{ kind: "text", key: "block.a-h.text", label: expect.any(String), before: "Hello", after: "Hello there" }]);
  });

  it("says rows added and removed by the row, not again by their words", () => {
    const diff = compareVersions(page([row("a", "One"), row("b", "Two")]), page([row("a", "One"), row("c", "Three")]));
    expect(diff).toEqual([
      { kind: "row_removed", row: 2 },
      { kind: "row_added", row: 2 },
    ]);
  });

  it("says only the row that moved, not every row after it", () => {
    const rows = ["a", "b", "c", "d"].map((id) => row(id, id));
    const moved = [rows[0], rows[2], rows[3], rows[1]];
    expect(compareVersions(page(rows), page(moved))).toEqual([{ kind: "row_moved", from: 2, to: 4 }]);
  });

  it("tells components added and removed in a row both versions have", () => {
    const before = row("a", "One");
    const after = structuredClone(before);
    after.columns[0].blocks = [{ id: "new", type: "heading", text: "Two", level: 3 } as never];
    const diff = compareVersions(page([before]), page([after]));
    expect(diff).toContainEqual({ kind: "block_removed", block: "heading", row: 1 });
    expect(diff).toContainEqual({ kind: "block_added", block: "heading", row: 1 });
  });

  it("tells a change of settings apart from a change of words", () => {
    const before = row("a", "One");
    const after = structuredClone(before);
    (after.columns[0].blocks[0] as { level: number }).level = 3;
    expect(compareVersions(page([before]), page([after]))).toEqual([{ kind: "settings", part: "block", block: "heading", row: 1 }]);
    const rowAfter = { ...structuredClone(before), layout: "1" as const, spacing: { padding: [40, 40, 40, 40] } } as never as PageRow;
    expect(compareVersions(page([before]), page([rowAfter]))).toEqual([{ kind: "settings", part: "row", block: null, row: 1 }]);
  });
});

describe("comparing two versions of a look", () => {
  it("names the areas that differ, in order", () => {
    const before = parseStoreTheme({ base: "minimal" });
    expect(compareLooks(before, structuredClone(before))).toEqual([]);
    const after = structuredClone(before);
    after.settings.fonts = { ...after.settings.fonts, heading: "lora" } as never;
    after.settings.corners = { ...after.settings.corners, radius: 999 } as never;
    expect(compareLooks(before, after)).toEqual(["fonts", "corners"]);
  });

  it("names the theme a look is built on", () => {
    const other = parseStoreTheme({ base: "minimal" });
    expect(compareLooks(other, { ...other, base: "bold" as never })).toContain("base");
  });
});
