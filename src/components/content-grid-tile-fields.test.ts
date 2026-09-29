import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GridItem } from "@/lib/content-grid";
import type { ContentGridBlock } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";

import { ContentGridView } from "./content-grid";

/** A content grid's tiles draw the custom fields chosen for them under the title, one line each (D120). */

const block = { ...(newBlock("contentGrid", () => "g1") as ContentGridBlock), tileFields: ["f_material"] };
const item = (id: string, over: Partial<GridItem> = {}): GridItem => ({
  id,
  href: `/p/${id}`,
  title: `Product ${id}`,
  excerpt: "",
  image: null,
  price: null,
  ...over,
});
const html = (items: GridItem[]) =>
  renderToString(createElement(ContentGridView, { block, data: { items, lang: "en", locale: "en-GB" } }));

describe("fields on a grid's tiles, drawn", () => {
  it("draws each item's own lines as label and value, under its title", () => {
    const out = html([
      item("a", {
        fields: [
          { label: "Material", text: "Oak" },
          { label: "Weight", text: "250 g" },
        ],
      }),
      item("b", { fields: [{ label: "Material", text: "Steel" }] }),
      item("c"),
    ]);
    expect(out).toContain("Material:");
    expect(out).toContain("Oak");
    expect(out).toContain("250 g");
    expect(out).toContain("Steel");
    expect(out.indexOf("Product a")).toBeLessThan(out.indexOf("Oak"));
    expect(out.match(/Material:/g)).toHaveLength(2);
    // An item without lines draws none.
    expect(out.match(/<ul class="flex flex-col gap-0.5/g)).toHaveLength(2);
  });

  it("draws values as text, never as HTML", () => {
    const out = html([item("a", { fields: [{ label: "<b>x</b>", text: "<script>alert(1)</script>" }] })]);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<b>x</b>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("draws nothing extra without fields", () => {
    expect(html([item("a")])).not.toContain("gap-0.5");
  });
});
