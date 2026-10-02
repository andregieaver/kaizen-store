import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GridItem } from "@/lib/content-grid";
import { IMAGE_SHAPES, type ContentGridBlock, type ImageShape } from "@/lib/page-content";
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

/**
 * A tile's picture fills its tile (D51). The picture block's own-size rule (D151) shares the crops' class strings (`SHAPES`)
 * but not its width: a tile is as wide as its grid cell, so its picture must keep `w-full` for every crop.
 */
describe("a grid tile's picture", () => {
  const tiles = ["original", "theme", ...(Object.keys(IMAGE_SHAPES) as ImageShape[])] as const;
  const withPicture = (imageShape: (typeof tiles)[number], source: ContentGridBlock["source"]) =>
    renderToString(
      createElement(ContentGridView, {
        block: { ...block, source, tileFields: [], imageShape },
        data: { items: [item("a", { image: { url: "https://cdn.example.com/a.webp", alt: "" } })], lang: "en", locale: "en-GB" },
      }),
    );
  /** The classes of the tile's one `<img>`. */
  const imgClasses = (out: string) => {
    const imgs = [...out.matchAll(/<img [^>]*?class="([^"]*)"/g)];
    expect(imgs).toHaveLength(1);
    return imgs[0][1].split(/\s+/);
  };

  it("keeps filling its tile, whatever the crop", () => {
    for (const shape of tiles) {
      for (const source of [{ type: "pages" }, { type: "products" }] as ContentGridBlock["source"][]) {
        const classes = imgClasses(withPicture(shape, source));
        expect(classes, `${shape} on ${source.type}`).toContain("w-full");
        expect(classes, `${shape} on ${source.type}`).toContain("h-auto");
      }
    }
  });

  it("is drawn in each crop's own aspect, as before", () => {
    for (const shape of Object.keys(IMAGE_SHAPES) as ImageShape[]) {
      const classes = imgClasses(withPicture(shape, { type: "pages" }));
      expect(classes.some((c) => c.startsWith("aspect-")), shape).toBe(true);
    }
    // The original keeps the picture's own shape: no crop.
    expect(imgClasses(withPicture("original", { type: "pages" })).some((c) => c.startsWith("aspect-"))).toBe(false);
  });
});
