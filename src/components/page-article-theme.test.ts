import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Each site's theme: Kaizena Flow's own (no owner) gives buttons round corners and rows a grey background; a store's says nothing.
const asked = vi.hoisted(() => [] as (string | null)[]);
vi.mock("@/server/theme-elements", () => ({
  themeLayersFor: async (owner: string | null) => {
    asked.push(owner);
    return owner === null
      ? { elements: { button: { radius: 33 }, row: { background: { type: "color", color: "#eeeeee" } } }, sections: undefined }
      : { elements: undefined, sections: undefined };
  },
}));

import { newPageContent, type PageBlock, type PageRow } from "@/lib/page-content";

import { PageArticle } from "./page-article";

/**
 * Every row is drawn with its site's theme (D262): Kaizena Flow's own pages too, which have no owner, and which were drawn without one
 * before; a place that brings the layers is drawn with them and asks for nothing. Rows that meet are judged as they are drawn, so a
 * background the theme gives them counts.
 */

const button: PageBlock = { id: "b", type: "button", label: "Go", href: "/" } as PageBlock;
const row = (id: string, blocks: PageBlock[] = []): PageRow => ({ id, type: "row", layout: "1", columns: [{ id: `${id}c`, blocks }] });
const content = (...rows: PageRow[]) => ({ ...newPageContent(), title: "Page", rows });

async function draw(rows: PageRow[], place: Parameters<typeof PageArticle>[0]["place"]) {
  const { prerender } = await import("react-dom/static");
  const { prelude } = await prerender(createElement(PageArticle, { content: content(...rows), place }));
  return new Response(prelude).text();
}

describe("a page's rows in their site's theme", () => {
  it("draws Kaizena Flow's own page with Kaizena Flow's theme", async () => {
    const out = await draw([row("r1", [button])], { pageId: null, owner: null });
    expect(out).toContain("border-radius:33px");
    expect(asked).toContain(null);
  });

  it("uses the layers a place brings without asking for the site's (a store's page asks for its own, held in the browser by theme-elements-live)", async () => {
    asked.length = 0;
    const out = await draw([row("r1", [button])], { pageId: null, owner: null, theme: { elements: { button: { radius: 7 } }, sections: undefined } });
    expect(out).toContain("border-radius:7px");
    expect(asked).toEqual([]);
  });

  it("lets rows meet when the theme gives them their background", async () => {
    const out = await draw([row("r1", [button]), row("r2", [{ ...button, id: "b2" }])], { pageId: null, owner: null });
    expect(out.split("margin-top:calc(2rem * -1)")).toHaveLength(2);
  });
});
