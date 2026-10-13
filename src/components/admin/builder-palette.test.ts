import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The builder imports its owners' actions only as types, but its neighbours read the database; nothing here calls them.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { PageBuilder } from "./page-builder";

/** The palette as a store's page builder draws it, with the features the store keeps on (D178). */
const palette = (features: string[]) =>
  renderToString(
    createElement(PageBuilder, {
      pageType: "page",
      rows: [],
      onRows: () => {},
      saved: [],
      onSaved: () => {},
      upload: null,
      aside: null,
      shopParts: true,
      grid: { pageId: null, owner: "store", pageTerms: [], articleTerms: [], stores: [], menus: [], menusHref: "/menus", plans: null, features, actions: {} as never },
      fonts: { site: { heading: null, body: null } as never, style: undefined, install: async () => ({ ok: true as const }), theme: null },
    }),
  );

/** The palette's section headings, in order. */
const headings = (html: string) => [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]);

describe("the builder's palette and the store's features", () => {
  it("leaves out the shop's sections when the online shop is off, and keeps Cookies among the other components", () => {
    const html = palette([]);
    const shown = headings(html);
    expect(shown).not.toContain("Shop pages");
    expect(shown.some((h) => /pieces/i.test(h))).toBe(false);
    expect(shown).not.toContain("More");
    expect(html).toContain(">Cookies<");
    expect(html).not.toContain(">Checkout<");
  });

  it("shows the shop's pages and pieces while it is on, with Cookies in More", () => {
    const html = palette(["shop"]);
    const shown = headings(html);
    expect(shown).toContain("Shop pages");
    expect(shown).toContain("More");
    // Cookies comes after More's heading, beside the other components, not among the shop's pages.
    const more = html.indexOf(">More</h3>");
    expect(html.indexOf(">Cookies<")).toBeGreaterThan(more);
    expect(html).toContain(">Checkout<");
    expect(html.indexOf(">Checkout<")).toBeLessThan(more);
  });
});
