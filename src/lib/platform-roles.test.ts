import { describe, expect, it } from "vitest";

import { pageInput, pageBlocks } from "./page-content";
import { isPlatformRole, isSpecialRole, isThemeStoreRole, PLATFORM_ROLE_COPY, PLATFORM_ROLES, platformStarterPage, SPECIAL_ROLES, THEME_STORE_ROLES } from "./platform-roles";
import { THEME_PAGE_PARTS } from "./theme-store-parts";

describe("Kaizena Flow's pages with a place of their own (D143)", () => {
  const ids = () => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  };

  it("names every role, with an address and words for the admin", () => {
    expect(PLATFORM_ROLES).toEqual(["front", "blog", "not_found", "themes", "theme"]);
    for (const role of PLATFORM_ROLES) {
      expect(PLATFORM_ROLE_COPY[role].name).toBeTruthy();
      expect(PLATFORM_ROLE_COPY[role].hint).toBeTruthy();
      expect(isPlatformRole(role)).toBe(true);
    }
    expect(isPlatformRole("cart")).toBe(false);
    // The Pages list's Special pages are the first three; the theme store's two are edited from Themes (D285), never offered there.
    expect(SPECIAL_ROLES).toEqual(["front", "blog", "not_found"]);
    expect(THEME_STORE_ROLES).toEqual(["themes", "theme"]);
    for (const role of THEME_STORE_ROLES) expect(isSpecialRole(role) || !isThemeStoreRole(role), role).toBe(false);
    for (const role of SPECIAL_ROLES) expect(isThemeStoreRole(role), role).toBe(false);
  });

  it("starts each page from one that is valid, at the role's own address, with what the standard page has", () => {
    for (const role of PLATFORM_ROLES) {
      const page = platformStarterPage(role, ids());
      expect(page.slug).toBe(PLATFORM_ROLE_COPY[role].slug);
      expect(pageInput.safeParse(page).success, role).toBe(true);
    }
    const front = pageBlocks(platformStarterPage("front", ids()));
    expect(front.map((b) => b.type)).toEqual(["heading", "richText", "button", "button", "heading", "plans"]);
    expect(front.filter((b) => b.type === "button").map((b) => (b.type === "button" ? b.href : ""))).toEqual(["/sign-up", "/admin"]);
    expect(pageBlocks(platformStarterPage("blog", ids())).some((b) => b.type === "contentGrid" && b.source.type === "articles")).toBe(true);
    expect(pageBlocks(platformStarterPage("not_found", ids())).some((b) => b.type === "button" && b.href === "/")).toBe(true);
  });

  it("leads a page's own address to its place, the 404 page's nowhere and a theme's page's to the list (D285)", () => {
    expect(PLATFORM_ROLES.map((role) => PLATFORM_ROLE_COPY[role].leadsTo)).toEqual(["/", "/blog", null, "/themes", "/themes"]);
  });

  it("starts the theme store's pages from the standard ones: the list under its heading, and every part of a theme's page in a row of its own (D285)", () => {
    const list = pageBlocks(platformStarterPage("themes", ids()));
    expect(list.map((b) => b.type)).toEqual(["heading", "richText", "themeStore"]);
    expect(list.find((b) => b.type === "heading")).toMatchObject({ text: "Themes", level: 1 });
    expect(list.at(-1)).toMatchObject({ type: "themeStore", part: "list" });
    const theme = platformStarterPage("theme", ids());
    expect(theme.rows.map((row) => row.columns.flatMap((c) => c.blocks).map((b) => (b.type === "themeStore" ? b.part : b.type)))).toEqual(THEME_PAGE_PARTS.map((part) => [part]));
    // The standard page's own words, which the page can change.
    expect(pageBlocks(theme).find((b) => b.type === "themeStore" && b.part === "features")).toMatchObject({
      heading: "What you get",
      text: "Your words, pictures and products stay as they are when you switch.",
    });
  });
});
