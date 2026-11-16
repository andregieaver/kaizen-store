import { describe, expect, it } from "vitest";

import { phoneShare } from "./column-share";
import type { PageColumn, PageRow } from "./page-content";

/** What part of the screen a column takes on a phone, for a picture's `sizes` (bloat review step 0.44). */

const col = (id: string, over: Partial<PageColumn> = {}): PageColumn => ({ id, blocks: [], ...over });
const row = (over: Record<string, unknown>, columns: PageColumn[]): PageRow => ({ id: "r", type: "row", layout: "2", columns, ...over }) as PageRow;

describe("a column's share of the screen on a phone", () => {
  it("is the whole screen where the row stacks, which it does on a phone unless set", () => {
    const columns = [col("a"), col("b")];
    const r = row({}, columns);
    expect(phoneShare(r, columns[0])).toBe(1);
    expect(phoneShare(r, columns[1])).toBe(1);
  });

  it("follows the layout's widths in a row that stays side by side", () => {
    const columns = [col("a"), col("b")];
    expect(phoneShare(row({ stack: false }, columns), columns[0])).toBe(0.5);
    const sidebar = row({ stack: false, layout: "right-sidebar" }, columns);
    expect(phoneShare(sidebar, columns[0])).toBeCloseTo(2 / 3);
    expect(phoneShare(sidebar, columns[1])).toBeCloseTo(1 / 3);
  });

  it("takes a column's own width at the smallest size over the layout's", () => {
    const columns = [col("a", { at: { sm: { width: 3 } } }), col("b", { width: 1 })];
    const r = row({ stack: false }, columns);
    expect(phoneShare(r, columns[0])).toBe(0.75);
    expect(phoneShare(r, columns[1])).toBe(0.25);
  });

  it("is the whole screen where a column is as wide as what it holds", () => {
    const columns = [col("a"), col("b")];
    expect(phoneShare(row({ stack: false, layout: "fit-end" }, columns), columns[0])).toBe(1);
  });

  it("reads a row kept side by side at the smallest size only", () => {
    const columns = [col("a"), col("b")];
    expect(phoneShare(row({ at: { sm: { stack: false } } }, columns), columns[0])).toBe(0.5);
  });

  it("is the whole screen for a column that is not in the row", () => {
    const columns = [col("a"), col("b")];
    expect(phoneShare(row({ stack: false }, columns), col("zzz"))).toBe(1);
  });
});
