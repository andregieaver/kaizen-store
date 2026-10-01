import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { PLAN_ITEMS, SETTINGS_ITEMS, WEBSITE_ITEMS, sectionPrefixes, withBase } from "./platform-nav";

const ROOT = "src/app/admin/(gated)/platform";
/** Sections with no sidebar, and what is in them. */
const WITHOUT_SIDEBAR = ["stores", "customers", "requests", "assistant"];
/** Pages that are a section's first page, not in its sidebar. */
const HUBS = ["website", "settings"];

describe("the platform admin's sections (D144)", () => {
  const sections = { website: WEBSITE_ITEMS, plans: PLAN_ITEMS, settings: SETTINGS_ITEMS };

  it("lists each page once, in one sidebar", () => {
    const paths = Object.values(sections).flatMap((items) => items.map((i) => i.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("links only pages the admin map knows", () => {
    const known = new Set(ADMIN_PAGES.filter((p) => p.area === "platform").map((p) => p.path));
    for (const item of Object.values(sections).flat()) expect(known.has(item.path), item.path).toBe(true);
    for (const hub of HUBS) expect(known.has(`/${hub}`), hub).toBe(true);
  });

  it("puts every platform page in exactly one section, by its top-level address", () => {
    const inSidebar = new Set(Object.values(sections).flatMap((items) => items.map((i) => i.path.split("/")[1])));
    const dirs = readdirSync(ROOT).filter((name) => statSync(join(ROOT, name)).isDirectory());
    for (const dir of dirs) {
      const homes = [inSidebar.has(dir), WITHOUT_SIDEBAR.includes(dir), HUBS.includes(dir)].filter(Boolean).length;
      // A page's own folder is in its sidebar, or its section has no sidebar, or it is a hub; `[…]` folders belong to their parent.
      expect(homes, `${dir} is in ${homes} sections`).toBeGreaterThanOrEqual(1);
    }
  });

  it("names the pages of a sidebar under the platform's address, and marks only exact ones exact", () => {
    const links = withBase(PLAN_ITEMS);
    expect(links[0]).toEqual({ href: "/admin/platform/plans", label: "Editor", exact: true });
    expect(links[1]).toEqual({ href: "/admin/platform/plans/features", label: "Features" });
    expect(sectionPrefixes("/website", WEBSITE_ITEMS)[0]).toBe("/admin/platform/website");
    expect(sectionPrefixes(null, PLAN_ITEMS)[0]).toBe("/admin/platform/plans");
  });
});
