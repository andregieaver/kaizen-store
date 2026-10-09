import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/motion-attrs", () => ({
  partFx: vi.fn(() => ({ attrs: {}, style: {} })),
  backgroundFx: vi.fn(() => ({ attrs: {}, style: {} })),
  pageUsesMotion: vi.fn(() => false),
}));
vi.mock("@/lib/motion-runtime", () => ({ initMotion: vi.fn(() => () => {}) }));

import type { PageRow } from "@/lib/page-content";

import { PageBuilder } from "./page-builder";

/** The builder's canvas draws a row of several lines of columns, and offers a Column to drag into a row (D187). */

const col = (id: string) => ({ id, blocks: [{ id: `${id}-b`, type: "heading" as const, text: id, level: 2 as const }] });
const lined: PageRow = { id: "row-1", type: "row", layout: "2", moreLines: ["1"], columns: [col("a"), col("b"), col("c")] };
const plain: PageRow = { id: "row-2", type: "row", layout: "2", columns: [col("d"), col("e")] };

const builder = (rows: PageRow[], over: Partial<ComponentProps<typeof PageBuilder>> = {}) =>
  renderToString(
    createElement(PageBuilder, {
      pageType: "page",
      rows,
      onRows: () => {},
      saved: [],
      onSaved: () => {},
      upload: null,
      aside: createElement("p", null, "Page title"),
      grid: { pageId: null, owner: null, pageTerms: [], articleTerms: [], stores: [], menus: [], menusHref: "/menus", plans: null, actions: {} as never },
      fonts: { site: { heading: null, body: null } as never, style: undefined, install: async () => ({ ok: true as const }), theme: null },
      ...over,
    }),
  );

describe("the canvas", () => {
  it("draws each line of a row of lines in a box of its own, and a row of one line without one", () => {
    const out = builder([lined, plain]);
    expect(out.match(/data-builder-line="/g)).toHaveLength(2);
    // The row says how many lines it has to a screen reader.
    expect(out).toContain("2 lines of columns");
    expect(out).toMatch(/aria-label="Row 2, 2 columns"/);
    // All five columns are there, in order.
    expect([...out.matchAll(/data-builder-item="column" data-builder-id="([^"]+)"/g)].map((m) => m[1])).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("shows no place for a new line until a column is dragged", () => {
    expect(builder([lined])).not.toContain("data-builder-newline");
  });

  it("has a Column in the sidebar to drag into a row, or press", () => {
    const out = builder([plain]);
    expect(out).toContain('aria-label="Add column"');
  });
});
