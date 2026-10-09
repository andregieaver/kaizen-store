import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GridItem } from "@/lib/content-grid";
import type { ContentGridBlock } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";

import { ContentGridView } from "./content-grid";

/** A content grid's cards: background, text colour, frame, and the space inside and around the words. */

const base = newBlock("contentGrid", () => "g1") as ContentGridBlock;
const item: GridItem = { id: "a", href: "/a", title: "Alpha", excerpt: "Words", image: { url: "https://x.test/a.jpg", alt: "" }, price: null };
const html = (tile: ContentGridBlock["tile"]) =>
  renderToString(createElement(ContentGridView, { block: { ...base, tile }, data: { items: [item], lang: "en", locale: "en-GB" } }));

describe("a grid's cards, drawn", () => {
  it("take their background, text colour and padding as the card's own style", () => {
    const out = html({ background: "#102030", color: "#ffffff", padding: 12 });
    expect(out).toContain("background-color:#102030");
    expect(out).toContain("color:#ffffff");
    expect(out).toContain("--color-muted:#ffffff");
    expect(out).toContain("padding:12px");
  });

  it("keep the picture at the card's edge and the words clear of it when the words have their own space", () => {
    const out = html({ contentPadding: 16 });
    expect(out).toContain("--tile-content:16px");
    expect(out).toContain("[&amp;&gt;:not([data-tile-media])]:px-(--tile-content)");
    expect(out).toContain('data-tile-media=""');
  });

  it("draw nothing extra without them", () => {
    const out = html(undefined);
    expect(out).not.toContain("--tile-content");
    expect(out).not.toContain("--color-muted");
  });
});
