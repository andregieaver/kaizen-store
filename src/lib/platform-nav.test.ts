import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { advancedIn } from "./admin-view";
import { placeIndex } from "./nav-current";
import {
  PLATFORM_BASE,
  PLATFORM_HOME_PATHS,
  PLATFORM_SECTIONS,
  platformAreas,
  platformItemsOf,
  platformSection,
  platformSectionPaths,
  platformTabs,
  type PlatformSection,
} from "./platform-nav";

const ROOT = "src/app/admin/(gated)/platform";
const items = PLATFORM_SECTIONS.flatMap(platformItemsOf);
const known = new Set(ADMIN_PAGES.filter((p) => p.area === "platform").map((p) => p.path));
const areas = platformAreas();
/** The section a page after the platform's address is in, as the frame finds it (`placeIndex()`, D873): `home` for Home's pages. */
const placeOf = (path: string) => areas[placeIndex(`${PLATFORM_BASE}${path}`, areas)]?.section;

/** Every folder of the platform admin that holds a page or a route, as an address after its base (`/plans/analytics/payouts/[payoutId]`). */
function folders(dir = ROOT, rel = ""): string[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .flatMap((name) => {
      const here = `${rel}/${name}`;
      const files = readdirSync(join(dir, name));
      return [...(files.some((f) => /^(page|route)\.tsx?$/.test(f)) ? [here] : []), ...folders(join(dir, name), here)];
    });
}

describe("the platform admin's sections (D144), one structure (D877)", () => {
  it("lists each page once, in one sidebar", () => {
    const paths = items.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("links only pages the admin map knows: every section's tab, every sidebar page and Home's", () => {
    for (const item of items) expect(known.has(item.path), item.path).toBe(true);
    for (const section of PLATFORM_SECTIONS) expect(known.has(section.start), section.start).toBe(true);
    for (const page of PLATFORM_HOME_PATHS) expect(known.has(page.path), page.path).toBe(true);
  });

  it("puts every platform page folder in a section, or in Home", () => {
    const all = folders();
    expect(all.filter((path) => placeOf(path) === undefined)).toEqual([]);
    expect(all.length).toBeGreaterThan(100);
    // Every page of the admin map too, its own parameters as they are.
    expect([...known].filter((page) => placeOf(page) === undefined)).toEqual([]);
    // The two that were in none (code review FN9): the AI manager is Home's, as a store's is; the docs portal's folder the website's.
    expect(PLATFORM_HOME_PATHS.map((p) => p.path)).toEqual(["/assistant"]);
    expect(placeOf("/assistant/autopilot")).toBe("home");
    expect(platformTabs()[0].also).toEqual(["/admin/platform/assistant"]);
    expect(placeOf("/docs")).toBe("website");
    // A page with no item of its own is in the section whose address it is under.
    expect([placeOf("/docs/guide"), placeOf("/themes/submissions"), placeOf("/chat/questions"), placeOf("/ai/dream/[runId]")]).toEqual(["website", "themes", "support", "settings"]);
  });

  it("draws a tab for each section in its order after Home, a page of cards marked on itself alone, and Settings at the rail's foot", () => {
    const tabs = platformTabs({ requests: 2, support: 3 });
    expect(tabs.map((t) => t.label)).toEqual(["Home", "Website", "Themes", "Stores", "Customers", "Plans", "Access requests", "Support", "Settings"]);
    expect(tabs.slice(1).map((t) => [t.href, t.section])).toEqual(PLATFORM_SECTIONS.map((s) => [`${PLATFORM_BASE}${s.start}`, s.key]));
    expect(tabs.filter((t) => t.exact).map((t) => t.label)).toEqual(["Home", "Website", "Settings"]);
    expect(tabs.filter((t) => t.badge).map((t) => [t.label, t.badge])).toEqual([["Access requests", 2], ["Support", 3]]);
    expect(tabs.filter((t) => t.foot).map((t) => t.label)).toEqual(["Settings"]);
    // Themes beneath Website (D285); every tab leads to a page the admin map knows.
    expect(tabs.findIndex((t) => t.label === "Themes")).toBe(tabs.findIndex((t) => t.label === "Website") + 1);
    for (const tab of tabs) if (tab.href !== PLATFORM_BASE) expect(known.has(tab.href.slice(PLATFORM_BASE.length)), tab.href).toBe(true);
  });

  it("names the pages of a sidebar under the platform's address, with their icons (D454), and marks only exact ones exact", () => {
    const plans = areas.find((a) => a.section === "plans")!;
    expect(plans.groups[0].items[0]).toEqual({ href: "/admin/platform/plans", label: "Editor", icon: "credit-card", exact: true });
    // Left out of the Basic view (D884): drawn in Advanced, or while it is the page being viewed.
    expect(plans.groups[0].items[1]).toEqual({ href: "/admin/platform/plans/limits", label: "Limits", icon: "gauge", advanced: true });
    expect(plans.groups[0].items[2]).toEqual({ href: "/admin/platform/plans/features", label: "Plan features", icon: "toggle", advanced: true });
    // A page of cards is its section's alone (`exact`); its pages and the docs portal's folder are inside the section.
    const website = areas.find((a) => a.section === "website")!;
    expect(website.exact).toEqual(["/admin/platform/website"]);
    expect(website.prefixes).toEqual(expect.arrayContaining(["/admin/platform/docs", "/admin/platform/pages", "/admin/platform/docs/guide"]));
    expect(website.prefixes).not.toContain("/admin/platform/website");
    // A section with no sidebar holds its own address; Home its own and the AI manager.
    expect(areas.find((a) => a.section === "themes")).toEqual({ section: "themes", prefixes: ["/admin/platform/themes"], groups: [] });
    expect(areas[0]).toEqual({ section: "home", prefixes: ["/admin/platform/assistant"], exact: ["/admin/platform"], groups: [] });
    // Each section's sidebar is its groups, under their headings; its addresses are its own paths.
    for (const section of PLATFORM_SECTIONS) {
      const area = areas.find((a) => a.section === section.key)!;
      expect(area.groups.map((g) => g.heading), section.key).toEqual(section.groups.map((g) => g.heading));
      expect([...(area.exact ?? []), ...area.prefixes].sort(), section.key).toEqual(platformSectionPaths(section).map((p) => `${PLATFORM_BASE}${p}`).sort());
    }
  });

  it("puts Settings in six groups, each page in one, where one heading stood over every page (code review FN4, D884)", () => {
    const settings = PLATFORM_SECTIONS.find((s) => s.key === "settings")!;
    expect(settings.groups.map((g) => [g.heading, g.items.length])).toEqual([
      ["Site", 5],
      ["Money and tax", 4],
      ["AI", 4],
      ["Apps and connections", 4],
      ["Privacy and law", 3],
      ["Running the platform", 9],
    ]);
    // The sidebar draws them under its headings (in D873's one style), and the page of cards under the same words.
    expect(areas.find((a) => a.section === "settings")!.groups.map((g) => g.heading)).toEqual(settings.groups.map((g) => g.heading));
    expect(settings.groups.find((g) => g.heading === "Running the platform")!.items.map((i) => i.label)).toEqual([
      "Incidents",
      "Status page",
      "Usage and limits",
      "Emails",
      "Languages",
      "A/B tests",
      "Search test",
      "Team",
      "Change log",
    ]);
  });

  it("gives a page of cards its intro, and a section whose tab opens a page of its sidebar that page's area", () => {
    for (const section of PLATFORM_SECTIONS) {
      expect(Boolean(section.intro), section.key).toBe(section.hub);
      const first = platformItemsOf(section).find((i) => i.path === section.start);
      if (first) expect(first.area, section.key).toBe(section.area);
      else expect(section.hub || section.groups.length === 0, `${section.key} opens on a page of its own`).toBe(true);
    }
  });
});

describe("the platform's Basic view (D884, as a store's D454)", () => {
  const sidebars = PLATFORM_SECTIONS.filter((s) => s.groups.length > 0);
  const basicOf = (section: PlatformSection) => platformItemsOf(section).filter((i) => !advancedIn(section, i));

  it("keeps Basic to each section's everyday pages: some in every sidebar, at most 12 a section, and fewer than half in all", () => {
    let basic = 0;
    for (const section of sidebars) {
      const shown = basicOf(section);
      expect(shown.length, section.key).toBeGreaterThan(0);
      expect(shown.length, section.key).toBeLessThanOrEqual(12);
      basic += shown.length;
    }
    expect(basic).toBeLessThan(items.length / 2);
    // Each section's everyday pages, by name: a page joins Basic by a deliberate change here.
    expect(Object.fromEntries(sidebars.map((s) => [s.key, basicOf(s).map((i) => i.label)]))).toEqual({
      website: ["Pages", "Blog", "Media", "Menus", "Forms", "Design"],
      plans: ["Editor", "Accounts", "Plan analytics", "Discounts"],
      support: ["Inbox", "Support reports", "Chat assistant"],
      settings: ["Header and footer", "VAT rates", "Domains", "AI usage", "100-day challenge", "App listings", "Content notices", "Incidents", "Status page", "Usage and limits", "Emails", "Team"],
    });
    // Each of Settings' six groups keeps an everyday page, so Basic still shows every group.
    const settings = platformSection("settings");
    for (const group of settings.groups) expect(group.items.some((i) => !advancedIn(settings, i)), group.heading).toBe(true);
  });

  it("never leaves out of Basic the page a section's tab leads to", () => {
    const links = areas.flatMap((a) => a.groups.flatMap((g) => g.items));
    for (const section of PLATFORM_SECTIONS) {
      const start = links.find((l) => l.href === `${PLATFORM_BASE}${section.start}`);
      // A page of cards, or a section with no sidebar, opens on a page of its own, which no sidebar lists.
      if (!start) expect(section.hub || section.groups.length === 0, section.key).toBe(true);
      else expect(start.advanced, section.key).toBeUndefined();
    }
    // Where the tab leads is in Basic whatever its item says.
    expect(advancedIn({ start: "/plans" }, { path: "/plans" })).toBe(false);
    expect(advancedIn({ start: "/plans" }, { path: "/plans/limits" })).toBe(true);
  });

  it("marks in the sidebar the links Basic leaves out, each with its icon, and no other", () => {
    const links = areas.flatMap((a) => a.groups.flatMap((g) => g.items));
    expect(links).toHaveLength(items.length);
    expect(links.find((l) => l.label === "Duty rates")).toMatchObject({ icon: "container", advanced: true });
    expect(links.find((l) => l.label === "VAT rates")!.advanced).toBeUndefined();
    expect(links.filter((l) => l.advanced)).toHaveLength(sidebars.reduce((n, s) => n + platformItemsOf(s).length - basicOf(s).length, 0));
  });
});
