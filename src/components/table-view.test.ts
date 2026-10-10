import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TableBlock } from "@/lib/page-content";

import { TableView } from "./table-view";

const block = (over: Partial<TableBlock> = {}): TableBlock => ({
  id: "t1",
  type: "table",
  header: true,
  rows: [["Size", "Price"], ["Small", "<strong>10</strong> kr"], ["Large", "20 kr"]],
  ...over,
});
const draw = (b: TableBlock) => renderToString(createElement(TableView, { block: b }));

describe("a table on the site (D194)", () => {
  it("draws the first row as the header, the rest as the body, with markup read into elements", () => {
    const html = draw(block());
    expect(html).toMatch(/<thead[^>]*><tr[^>]*><th[^>]*scope="col"[^>]*>Size/);
    expect(html.match(/<tr/g)).toHaveLength(3);
    expect(html).toContain("<strong>10</strong>");
  });

  it("is all body without a header", () => {
    const html = draw(block({ header: false }));
    expect(html).not.toContain("<thead");
    expect(html.match(/<tr/g)).toHaveLength(3);
  });

  it("stacks on a phone by default: values carry their column's name, and the table is a table from Medium", () => {
    const html = draw(block());
    expect(html).toContain("kzb-md-table");
    expect(html).toMatch(/aria-hidden="true"[^>]*>Price<\/span>/);
    expect(html).not.toContain("overflow-x-auto");
  });

  it("scrolls sideways instead when asked, with no stacking classes", () => {
    const html = draw(block({ mobile: "scroll" }));
    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("kzb-md-table");
  });

  it("names rows by the first column, shades every other row and shows a title", () => {
    const html = draw(block({ rowHeaders: true, striped: true, caption: "Sizes" }));
    expect(html).toContain('scope="row"');
    expect(html).toContain("bg-surface");
    expect(html).toContain("<caption");
  });
});

describe("the stacked table's header from Medium up (D196)", () => {
  it("undoes every part of Tailwind's sr-only, clip-path included, so the header shows", async () => {
    const { BREAKPOINT_CLASSES } = await import("@/lib/part-css");
    expect(BREAKPOINT_CLASSES["kzb-md-not-sr"].decl).toMatchObject({ "clip-path": "none", position: "static", overflow: "visible" });
  });
});

describe("a table's colours and section dividers (D197)", () => {
  const wide = block({ rows: [["Size", "Price"], ["Small", "1"], ["Medium", "2"], ["Large", "3"], ["Huge", "4"]] });

  it("colours the header row and the shaded rows, only with the colours chosen", () => {
    const html = draw({ ...wide, striped: true, headerColor: "#ffffff", headerBackground: "#112233", stripeColor: "#000000", stripeBackground: "#eeeeee" });
    expect(html).toMatch(/<thead[^>]*><tr[^>]*style="color:#ffffff;background-color:#112233"/);
    expect(html.match(/background-color:#eeeeee/g)).toHaveLength(2);
    const plain = draw({ ...wide, striped: true });
    expect(plain).not.toContain("style=");
    expect(plain.match(/bg-surface/g)).toHaveLength(2);
  });

  it("colours the section dividers", () => {
    const html = draw({ ...wide, sections: [null, "Big", null], sectionColor: "#ffffff", sectionBackground: "#445566" });
    expect(html).toMatch(/scope="colgroup"[^>]*style="color:#ffffff;background-color:#445566"/);
  });

  it("draws a divider row across all columns above the row it names, never above the header, and shading skips it", () => {
    const html = draw({ ...wide, striped: true, sections: ["Ignored", null, "Big sizes", null, ""] });
    expect(html).toContain('colSpan="2"');
    expect(html.match(/scope="colgroup"/g)).toHaveLength(2);
    expect(html).toContain("Big sizes");
    expect(html).not.toContain("Ignored");
    // The divider comes before "Medium" (row 2) and not before the header.
    expect(html.indexOf("Big sizes")).toBeLessThan(html.indexOf("Medium"));
    expect(html.indexOf("Big sizes")).toBeGreaterThan(html.indexOf("Small"));
  });
});
