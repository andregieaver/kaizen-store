import { describe, expect, it } from "vitest";

import type { PageRow } from "./page-content";
import { drawsBox, meetsAbove, rowAbove } from "./row-join";

const row = (extra: Partial<PageRow> = {}): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [] }], ...extra });
const grey = { type: "color", color: "#eeeeee" } as const;
const line = { width: { top: 1, right: 1, bottom: 1, left: 1 }, color: "#000000", style: "solid" } as const;

/** Rows that meet (D262): two rows that both draw a box have no room between them; any other pair keeps the page's room. */
describe("rows that meet", () => {
  it("counts a background of any kind, or a border, as a box", () => {
    expect(drawsBox(row({ background: grey }))).toBe(true);
    expect(drawsBox(row({ background: { type: "gradient", from: "#000000", to: "#ffffff", angle: 90 } as never }))).toBe(true);
    expect(drawsBox(row({ border: line }))).toBe(true);
    expect(drawsBox(row())).toBe(false);
    expect(drawsBox(row({ shadow: "lg" }))).toBe(false);
  });

  it("asks it at every screen size: a box taken away at one, or given at one only, is no box", () => {
    expect(drawsBox(row({ background: grey, at: { sm: { background: null } } }))).toBe(false);
    expect(drawsBox(row({ at: { md: { background: grey } } }))).toBe(false);
    expect(drawsBox(row({ background: grey, at: { sm: { border: line } } }))).toBe(true);
  });

  it("leaves a modal and a row shown only at some sizes or to some visitors apart", () => {
    expect(drawsBox(row({ background: grey, modal: { key: "m" } as never }))).toBe(false);
    expect(drawsBox(row({ background: grey, visibility: { hideAt: ["sm"] } }))).toBe(false);
    expect(drawsBox(row({ background: grey, visibility: { show: "signedIn" } as never }))).toBe(false);
    expect(drawsBox(row({ background: grey, visibility: { show: "always" } }))).toBe(true);
  });

  it("meets only where both rows draw a box", () => {
    expect(meetsAbove(row({ background: grey }), row({ border: line }))).toBe(true);
    expect(meetsAbove(row(), row({ background: grey }))).toBe(false);
    expect(meetsAbove(row({ background: grey }), row())).toBe(false);
    expect(meetsAbove(undefined, row({ background: grey }))).toBe(false);
  });

  it("looks past a modal for the row above, as a modal is not in the page's flow", () => {
    const modal = row({ id: "pop", modal: { key: "pop" } as never });
    const rows = [row({ id: "one" }), modal, row({ id: "two" })];
    expect(rowAbove(rows, 2)?.id).toBe("one");
    expect(rowAbove(rows, 0)).toBeUndefined();
  });
});
