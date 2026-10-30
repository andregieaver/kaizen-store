import { describe, expect, it } from "vitest";

import type { PageBlock, PageColumn, PageRow } from "./page-content";
import { HOLDER_COLUMN, HOLDER_ROW, partFromRows, partRows } from "./saved-part-canvas";
import type { SavedPart } from "./saved-parts";

const heading = (id: string): PageBlock => ({ id, type: "heading", text: id, level: 2 });
const column = (id: string, blocks: PageBlock[]): PageColumn => ({ id, blocks });
const row = (id: string, columns: PageColumn[]): PageRow => ({ id, type: "row", layout: columns.length === 2 ? "2" : "1", columns });
const base = { id: "p", name: "Part", updatedAt: "2026-10-30T00:00:00Z", global: false, translations: {}, uses: 0, sharing: "private" as const };

describe("a saved part on the canvas (D46)", () => {
  it("puts a row on the canvas as it is, and takes it back while it is one row", () => {
    const hero = row("hero", [column("a", [heading("h1")]), column("b", [])]);
    const part: SavedPart = { ...base, kind: "row", content: hero };
    expect(partRows(part)).toEqual([hero]);
    const changed = { ...hero, className: "wide" };
    expect(partFromRows(part, [changed])).toEqual({ ok: true, content: changed });
    expect(partFromRows(part, [])).toEqual({ ok: false, problem: "oneRow" });
    expect(partFromRows(part, [hero, hero])).toEqual({ ok: false, problem: "oneRow" });
  });

  it("sets a column alone in a row of its own, never saved, and takes back that one column", () => {
    const side = column("side", [heading("h1"), heading("h2")]);
    const part: SavedPart = { ...base, kind: "column", content: side };
    const [holder] = partRows(part);
    expect(holder).toMatchObject({ id: HOLDER_ROW, layout: "1", columns: [side] });
    expect(partFromRows(part, [{ ...holder, columns: [{ ...side, blocks: [heading("h3")] }] }])).toEqual({
      ok: true,
      content: { ...side, blocks: [heading("h3")] },
    });
    expect(partFromRows(part, [row("x", [side, column("other", [])])])).toEqual({ ok: false, problem: "oneColumn" });
  });

  it("sets a component alone in a column and takes back just it", () => {
    const part: SavedPart = { ...base, kind: "block", content: heading("h1") };
    const [holder] = partRows(part);
    expect(holder.columns[0]).toMatchObject({ id: HOLDER_COLUMN, blocks: [heading("h1")] });
    expect(partFromRows(part, [{ ...holder, columns: [{ ...holder.columns[0], blocks: [heading("h9")] }] }])).toEqual({ ok: true, content: heading("h9") });
    expect(partFromRows(part, [{ ...holder, columns: [{ ...holder.columns[0], blocks: [] }] }])).toEqual({ ok: false, problem: "oneBlock" });
    expect(partFromRows(part, [{ ...holder, columns: [{ ...holder.columns[0], blocks: [heading("a"), heading("b")] }] }])).toEqual({ ok: false, problem: "oneBlock" });
  });

  it("puts a page layout's rows on the canvas and keeps its kind of page and CSS", () => {
    const layout = { pageType: "article" as const, rows: [row("r1", [column("c1", [])])], css: ".x{}" };
    const part: SavedPart = { ...base, kind: "page", content: layout };
    expect(partRows(part)).toEqual(layout.rows);
    const more = [...layout.rows, row("r2", [column("c2", [heading("h")])])];
    expect(partFromRows(part, more)).toEqual({ ok: true, content: { ...layout, rows: more } });
  });
});
