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
    expect(html).toContain("even:bg-surface");
    expect(html).toContain("<caption");
  });
});
