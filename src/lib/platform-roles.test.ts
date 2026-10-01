import { describe, expect, it } from "vitest";

import { pageInput, pageBlocks } from "./page-content";
import { isPlatformRole, PLATFORM_ROLE_COPY, PLATFORM_ROLES, platformStarterPage } from "./platform-roles";

describe("Kaizen's pages with a place of their own (D143)", () => {
  const ids = () => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  };

  it("names every role, with an address and words for the admin", () => {
    expect(PLATFORM_ROLES).toEqual(["front", "blog", "not_found"]);
    for (const role of PLATFORM_ROLES) {
      expect(PLATFORM_ROLE_COPY[role].name).toBeTruthy();
      expect(PLATFORM_ROLE_COPY[role].hint).toBeTruthy();
      expect(isPlatformRole(role)).toBe(true);
    }
    expect(isPlatformRole("cart")).toBe(false);
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
});
