import { describe, expect, it } from "vitest";

import { pageInput, sitePartsFor, type PageContent } from "./page-content";
import { defaultFooter, defaultHeader, headerOverlays, siteBlocks, siteLayoutProblem } from "./site-layout";

const withBlocks = (base: PageContent, blocks: unknown[]): PageContent =>
  ({ ...base, rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks }] }] }) as PageContent;

describe("headers and footers (D80)", () => {
  it("starts headers and footers as the standard ones, which pass a page's checks and the site's rules", () => {
    for (const storeId of ["store", null]) {
      for (const [type, layout] of [
        ["header", defaultHeader(storeId)],
        ["footer", defaultFooter(storeId)],
      ] as const) {
        expect(pageInput.safeParse(layout).success).toBe(true);
        expect(siteLayoutProblem(storeId, type, layout)).toBeNull();
      }
    }
    expect(siteBlocks(defaultHeader("store")).map((b) => b.part)).toEqual([
      "menuButton",
      "logo",
      "markets",
      "search",
      "account",
      "wishlist",
      "cart",
    ]);
    expect(siteBlocks(defaultHeader(null)).map((b) => b.part)).toEqual(["menuButton", "logo", "account", "signUp"]);
  });

  it("starts headers and footers with the menus of the standard ones (D85)", () => {
    const menus = { header: "00000000-0000-4000-8000-000000000001", footer: "00000000-0000-4000-8000-000000000002" };
    const menuOf = (content: PageContent) => content.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks)).find((b) => b.type === "menu");
    expect(menuOf(defaultHeader("store", menus))).toMatchObject({ type: "menu", menuId: menus.header, hideOnPhones: true });
    expect(menuOf(defaultFooter(null, menus))).toMatchObject({ type: "menu", menuId: menus.footer, direction: "column" });
    // Without a menu chosen, the component waits for one.
    expect(menuOf(defaultHeader("store"))).toEqual({ id: "header-menu", type: "menu", hideOnPhones: true });
    expect(pageInput.safeParse(defaultHeader("store", menus)).success).toBe(true);
  });

  it("offers a store's parts to stores and Kaizen's to Kaizen", () => {
    expect(sitePartsFor("store")).toContain("cart");
    expect(sitePartsFor("store")).not.toContain("signUp");
    expect(sitePartsFor(null)).toContain("signUp");
    expect(sitePartsFor(null)).not.toContain("wishlist");
  });

  it("keeps site components in headers and footers, the owner's own, with no categories or tags", () => {
    const logo = { id: "l", type: "site", part: "logo" };
    expect(siteLayoutProblem("store", "page", withBlocks(defaultHeader("store"), [logo]))).toBe("Site components belong in headers and footers.");
    expect(siteLayoutProblem("store", "header", withBlocks(defaultHeader("store"), [{ id: "s", type: "site", part: "signUp" }]))).toBe(
      "A store's site has no Start your store button.",
    );
    expect(siteLayoutProblem(null, "header", withBlocks(defaultHeader(null), [{ id: "c", type: "site", part: "cart" }]))).toMatch(/no cart/);
    expect(siteLayoutProblem("store", "header", { ...defaultHeader("store"), tags: ["t"] })).toBe("A header has no categories or tags.");
  });

  it("keeps who runs the site and the cookies link in every footer", () => {
    const withoutCookies = withBlocks(defaultFooter("store"), [
      { id: "l", type: "site", part: "logo" },
      { id: "b", type: "site", part: "business" },
    ]);
    expect(siteLayoutProblem("store", "footer", withoutCookies)).toMatch(/business details and the cookies link/);
    // A header needs neither.
    expect(siteLayoutProblem("store", "header", withBlocks(defaultHeader("store"), [{ id: "l", type: "site", part: "logo" }]))).toBeNull();
  });

  it("checks site components' settings", () => {
    const layout = (block: Record<string, unknown>) => withBlocks(defaultHeader("store"), [{ id: "x", type: "site", ...block }]);
    expect(pageInput.safeParse(layout({ part: "logo", height: 56, hideOnPhones: true })).success).toBe(true);
    expect(pageInput.safeParse(layout({ part: "logo", height: 400 })).success).toBe(false);
    expect(pageInput.safeParse(layout({ part: "basket" })).success).toBe(false);
    // Menus are menu components now (D85), in any page.
    expect(pageInput.safeParse(layout({ part: "menu", menu: "footer" })).success).toBe(false);
    const menu = (block: Record<string, unknown>) => withBlocks(defaultHeader("store"), [{ id: "m", type: "menu", ...block }]);
    expect(pageInput.safeParse(menu({ menuId: "00000000-0000-4000-8000-000000000001", direction: "column" })).success).toBe(true);
    expect(pageInput.safeParse(menu({ menuId: "main" })).success).toBe(false);
    expect(siteLayoutProblem("store", "page", menu({}))).toBeNull();
  });

  it("lays the header over a page only where asked and only over a first row with a background", () => {
    const hero = [
      { id: "r", type: "row", layout: "1", background: { type: "color", color: "#123456" }, columns: [{ id: "c", blocks: [] }] },
    ] as PageContent["rows"];
    const plain = [
      { id: "p", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "h", type: "heading", text: "Om oss", level: 1 }] }] },
    ] as PageContent["rows"];
    const page = { front: false, categories: ["cat"], tags: [], rows: hero };
    expect(headerOverlays(undefined, page)).toBe(false);
    expect(headerOverlays({ where: "everywhere", categories: [], tags: [] }, page)).toBe(true);
    expect(headerOverlays({ where: "everywhere", categories: [], tags: [] }, { ...page, rows: plain })).toBe(false);
    // An empty first row does not count; the first row that shows does.
    expect(headerOverlays({ where: "everywhere", categories: [], tags: [] }, { ...page, rows: [{ ...plain[0], columns: [{ id: "e", blocks: [] }] }, ...hero] })).toBe(true);
    expect(headerOverlays({ where: "front", categories: [], tags: [] }, page)).toBe(false);
    expect(headerOverlays({ where: "front", categories: [], tags: [] }, { ...page, front: true })).toBe(true);
    expect(headerOverlays({ where: "terms", categories: ["cat"], tags: [] }, page)).toBe(true);
    expect(headerOverlays({ where: "terms", categories: [], tags: ["tag"] }, page)).toBe(false);
  });

  it("keeps the overlay a header's, with categories or tags when it is by them", () => {
    const overlay = { where: "terms" as const, categories: [], tags: [] };
    expect(siteLayoutProblem("store", "footer", { ...defaultFooter("store"), overlay: { ...overlay, where: "everywhere" } })).toBe("Only a header lies over the page.");
    expect(siteLayoutProblem("store", "header", { ...defaultHeader("store"), overlay })).toMatch(/Choose the page categories or tags/);
    expect(pageInput.safeParse({ ...defaultHeader("store"), overlay: { ...overlay, where: "sometimes" } }).success).toBe(false);
    expect(pageInput.safeParse({ ...defaultHeader("store"), overlay: { where: "everywhere", textColor: "#ffffff" } }).success).toBe(true);
  });
});
