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

const rows: PageRow[] = [
  {
    id: "row-1",
    type: "row",
    layout: "1",
    columns: [{ id: "c-1", blocks: [{ id: "b-1", type: "heading", text: "Hello", level: 2 }] }],
  },
];

const builder = (over: Partial<ComponentProps<typeof PageBuilder>> = {}) =>
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

describe("the builder's A/B test button (D148)", () => {
  it("is on a row, a column and a component when the page can be tested", () => {
    const out = builder({ onTestPart: () => {} });
    expect([...out.matchAll(/aria-label="A\/B test ([^"]*)"/g)].map((m) => m[1])).toHaveLength(3);
    expect((out.match(/title="A\/B test this"/g) ?? []).length).toBe(3);
  });

  it("is nowhere when the page cannot be tested (Kaizen's pages, layouts, unpublished pages) or while translating", () => {
    expect(builder()).not.toContain("A/B test this");
    expect(
      builder({ onTestPart: () => {}, translate: { name: "Svenska", mainName: "Norsk", source: rows } }),
    ).not.toContain("A/B test this");
  });
});
