import { describe, expect, it } from "vitest";

import { t } from "./i18n";
import { pageBlocks, pageInput } from "./page-content";
import { isPageRole, PAGE_ROLES, partOfRole, roleAddress, ROLE_COPY, ROLE_GROUPS, starterPage } from "./page-roles";
import { STORE_PART_KEYS, piecesOf, routeOfPart } from "./store-parts";

let n = 0;
const id = () => `id-${n++}`;
const home = "/s/demo/no";

describe("a store's special pages", () => {
  it("are the blog, search and 404 places, and the working pages", () => {
    expect(PAGE_ROLES).toEqual(["blog", "search", "not_found", "cart", "checkout", "order", "account", "sign_in", "wishlist", "subscription", "deliveries", "cookies"]);
    expect(isPageRole("blog")).toBe(true);
    expect(isPageRole("cart")).toBe(true);
    expect(isPageRole("basket")).toBe(false);
    expect(roleAddress("blog", home)).toBe("/s/demo/no/blog");
    expect(roleAddress("cart", home)).toBe("/s/demo/no/cart");
    expect(roleAddress("sign_in", home)).toBe("/s/demo/no/account");
    // No fixed address: the 404 page, and pages whose address carries an order or a secret.
    for (const role of ["not_found", "order", "subscription"] as const) expect(roleAddress(role, home)).toBeNull();
  });

  it("are each in one group of the admin's list", () => {
    expect(ROLE_GROUPS.flatMap((group) => group.roles).sort()).toEqual([...PAGE_ROLES].sort());
  });

  it("draw a working page through the component of the same name", () => {
    expect(PAGE_ROLES.filter((role) => partOfRole(role)).sort()).toEqual([...STORE_PART_KEYS].sort());
    expect(partOfRole("blog")).toBeNull();
    for (const part of STORE_PART_KEYS) {
      const blocks = pageBlocks(starterPage(part, t("en"), id, home)).filter((b) => b.type === "storePart");
      // The cart, checkout and order start from all their pieces (D117), the others from the one component.
      const pieces = piecesOf(part).filter((piece) => piece !== "cart_continue");
      if (pieces.length > 0) expect(blocks.map((b) => b.part)).toEqual(expect.arrayContaining(pieces));
      else expect(blocks).toEqual([expect.objectContaining({ type: "storePart", part })]);
      for (const block of blocks) expect(routeOfPart(block.part)).toBe(part);
    }
    // The cart and checkout bring no heading of their own, so the starter has one.
    for (const role of ["cart", "checkout", "sign_in"] as const) {
      expect(pageBlocks(starterPage(role, t("nb"), id, home)).some((b) => b.type === "heading")).toBe(true);
    }
  });

  it("start from a page that is valid, in the store's language, with an address of its own", () => {
    for (const lang of ["nb", "sv", "da", "en", "xx"]) {
      for (const role of PAGE_ROLES) {
        const page = starterPage(role, t(lang), id, home);
        const parsed = pageInput.safeParse(page);
        expect(parsed.success, `${lang} ${role}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
        expect(page.slug).toBe(ROLE_COPY[role].slug);
        expect(page.title).not.toBe("");
      }
    }
  });

  it("hold what each place needs", () => {
    const blog = pageBlocks(starterPage("blog", t("en"), id, home));
    expect(blog.some((b) => b.type === "contentGrid" && b.source.type === "articles")).toBe(true);
    const search = pageBlocks(starterPage("search", t("en"), id, home));
    expect(search.find((b) => b.type === "search")).toMatchObject({ type: "search" });
    const notFound = pageBlocks(starterPage("not_found", t("nb"), id, home));
    expect(notFound.find((b) => b.type === "search")).toMatchObject({ results: false });
    expect(notFound.find((b) => b.type === "button")).toMatchObject({ label: t("nb").toHome, href: home });
  });

  it("read a search component from what the browser sends", () => {
    const page = starterPage("search", t("en"), id, home);
    const box = { id: "b", type: "search", results: false };
    expect(pageInput.safeParse({ ...page, rows: [{ ...page.rows[0], columns: [{ id: "c", blocks: [box] }] }] }).success).toBe(true);
    expect(pageInput.safeParse({ ...page, rows: [{ ...page.rows[0], columns: [{ id: "c", blocks: [{ ...box, results: "no" }] }] }] }).success).toBe(false);
  });

  it("read a shop component from what the browser sends", () => {
    const page = starterPage("cart", t("en"), id, home);
    const block = { id: "b", type: "storePart", part: "wishlist" };
    const withBlock = (b: unknown) => ({ ...page, rows: [{ ...page.rows[0], columns: [{ id: "c", blocks: [b] }] }] });
    expect(pageInput.safeParse(withBlock(block)).success).toBe(true);
    expect(pageInput.safeParse(withBlock({ ...block, part: "cart_lines" })).success).toBe(true);
    expect(pageInput.safeParse(withBlock({ ...block, part: "basket" })).success).toBe(false);
    expect(pageInput.safeParse(withBlock({ id: "b", type: "storePart" })).success).toBe(false);
  });
});
