import { describe, expect, it } from "vitest";

import { t } from "./i18n";
import { pageBlocks, pageInput } from "./page-content";
import { isPageRole, PAGE_ROLES, roleAddress, ROLE_COPY, starterPage } from "./page-roles";

let n = 0;
const id = () => `id-${n++}`;
const home = "/s/demo/no";

describe("a store's special pages", () => {
  it("are the blog, search and 404 places", () => {
    expect(PAGE_ROLES).toEqual(["blog", "search", "not_found"]);
    expect(isPageRole("blog")).toBe(true);
    expect(isPageRole("cart")).toBe(false);
    expect(roleAddress("blog", home)).toBe("/s/demo/no/blog");
    expect(roleAddress("not_found", home)).toBeNull();
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
});
