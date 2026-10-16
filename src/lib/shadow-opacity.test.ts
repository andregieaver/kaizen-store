import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_BREAKPOINTS } from "./breakpoints";
import { SHADOWS, frameStyle, newPageContent, pageInput, shadowCss, shadowOpacityOf, type PageRow } from "./page-content";
import { columnStyle, partCss, rowStyle } from "./part-css";
import { WIDTHS, partStyleAt } from "./part-css.testing";
import { setAt } from "./responsive";
import { themedRows } from "./theme-elements";

/**
 * A shadow's opacity (D262): a row's, column's or component's shadow as it comes, or fainter or darker by a slider; its darkest layer
 * at the opacity chosen and the others in the same proportion, per screen size like the shadow, and with the shadow it is of.
 */

const rowOf = (extra: Partial<PageRow> = {}, column: Record<string, unknown> = {}): PageRow => ({
  id: "r",
  type: "row",
  layout: "1",
  columns: [{ id: "c", blocks: [], ...column }],
  ...extra,
});
const sheet = (rows: PageRow[]) => partCss(rows, "site", DEFAULT_BREAKPOINTS);
const rowShadow = (row: PageRow, width: number) => partStyleAt(sheet([row]), rowStyle(row).className.split(" "), width)["box-shadow"];

describe("a shadow's opacity", () => {
  it("is the shadow's own until set: its darkest layer, in per cent", () => {
    expect(shadowOpacityOf("sm")).toBe(12);
    expect(shadowOpacityOf("lg")).toBe(15);
    expect(shadowCss("lg")).toBe(SHADOWS.lg.css);
    expect(shadowCss("lg", null)).toBe(SHADOWS.lg.css);
  });

  it("sets the darkest layer and keeps the others in proportion", () => {
    expect(shadowCss("lg", 60)).toBe("0 10px 30px rgb(0 0 0 / 0.6)");
    expect(shadowCss("sm", 24)).toBe("0 1px 3px rgb(0 0 0 / 0.24), 0 1px 2px rgb(0 0 0 / 0.16)");
    expect(shadowCss("md", 0)).toBe("0 4px 12px rgb(0 0 0 / 0)");
    expect(frameStyle({ shadow: "xl", shadowOpacity: 50 }).boxShadow).toBe("0 20px 50px rgb(0 0 0 / 0.5)");
  });

  it("is whole per cents from 0 to 100", () => {
    const page = (shadowOpacity: number) => pageInput.safeParse({ ...newPageContent(), title: "P", slug: "p", rows: [rowOf({ shadow: "md", shadowOpacity })] });
    expect(page(40).success).toBe(true);
    expect(page(101).success).toBe(false);
    expect(page(4.5).success).toBe(false);
  });

  it("is written for a row and a column, and differs by screen size", () => {
    const row = rowOf({ shadow: "lg", shadowOpacity: 40, ...setAt(rowOf({ shadow: "lg", shadowOpacity: 40 }), "sm", { shadowOpacity: 10 }) });
    expect(rowShadow(row, WIDTHS.xl)).toBe("0 10px 30px rgb(0 0 0 / 0.4)");
    expect(rowShadow(row, WIDTHS.sm)).toBe("0 10px 30px rgb(0 0 0 / 0.1)");
    const withColumn = rowOf({}, { shadow: "md", shadowOpacity: 30 });
    const column = withColumn.columns[0];
    expect(partStyleAt(sheet([withColumn]), columnStyle(column).className.split(" "), WIDTHS.xl)["box-shadow"]).toBe("0 4px 12px rgb(0 0 0 / 0.3)");
  });

  it("goes with the shadow it is of when the theme is laid under a part", () => {
    const elements = { row: { shadow: "lg" as const, shadowOpacity: 50 } };
    // The theme's shadow, with the theme's opacity.
    expect(rowShadow(themedRows([rowOf()], elements)[0], WIDTHS.xl)).toBe("0 10px 30px rgb(0 0 0 / 0.5)");
    // The row's own shadow, as it comes: the theme's opacity was for the theme's shadow.
    expect(rowShadow(themedRows([rowOf({ shadow: "sm" })], elements)[0], WIDTHS.xl)).toBe(SHADOWS.sm.css);
  });
});
