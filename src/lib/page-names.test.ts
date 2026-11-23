import { describe, expect, it } from "vitest";

import { ADMIN_PAGES, adminMapText, findPages, pageName, type AdminArea, type AdminPage } from "./admin-map";
import { PAGES_WORDS, pageNameIn } from "./admin-words/pages";
import { currentIndex } from "./nav-current";
import { ACCOUNT_ITEMS, OWNER_BASE, OWNER_EVERY_TAB, ownerTabs } from "./owner-nav";
import { finderResults } from "./page-finder";
import { PLATFORM_BASE, PLATFORM_SECTIONS, platformItemsOf, platformNav, platformTabs } from "./platform-nav";
import { FEATURE_IDS } from "./store-features";
import { STORE_SECTIONS, storeNav } from "./store-nav";

/**
 * One source for a page's name (code review step 1.19, finding FN8, D881): the menu names each page and says which section it is in;
 * the admin map takes both from it at all three levels (`group`, `navLabel`), so the AI manager, the page finder and the docs say what
 * the menu says. Before, the map's hand-kept titles and groups differed from the menu on 31 pages, and the platform's groups ("Kaizena
 * Flow site", "Platform") were none of its tabs.
 */

/**
 * Map titles kept fuller than the menu's word on purpose, each with its reason. The menu's word is still the page's `navLabel`, and it is
 * what every reader shows (`pageName()`); the title only adds words to search by. A new difference fails until it is fixed or listed.
 */
const FULLER_TITLES: Record<string, string> = {
  "store:analytics": "the section's own page: the sidebar calls it Overview under the Analytics tab",
  "store:analytics.tax": "what the page holds (VAT, OSS and IOSS reports); the sidebar's VAT is short for it under Analytics",
  "platform:plans": "the section's own page: the sidebar calls it Editor under the Plans tab",
  "platform:support.stores": "Stores alone is the platform's Stores tab: the sidebar's word is read under Support",
  "account:stores": "the level's name, as the level switcher says it; its tab is Home",
};

const key = (page: Pick<AdminPage, "area" | "id">) => `${page.area}:${page.id}`;
const at = (area: AdminArea, path: string) => ADMIN_PAGES.filter((p) => p.area === area && p.path === path);
const filled = (p: string) => p.replace(/\[[A-Za-z]+\]/g, "x1");

/** Every page the menus name, with the word and the section the menu gives it: sidebar items first, then the tabs' own pages. */
const named: { area: AdminArea; path: string; label: string; section: string }[] = [
  { area: "store", path: "", label: "Home", section: "Home" },
  ...STORE_SECTIONS.flatMap((s) => [
    ...s.groups.flatMap((g) => g.items.map((i) => ({ area: "store" as const, path: i.path, label: i.label, section: s.label }))),
    ...(s.groups.some((g) => g.items.some((i) => i.path === s.start)) ? [] : [{ area: "store" as const, path: s.start, label: s.label, section: s.label }]),
  ]),
  { area: "platform", path: "", label: "Home", section: "Home" },
  ...PLATFORM_SECTIONS.flatMap((s) => [
    ...platformItemsOf(s).map((i) => ({ area: "platform" as const, path: i.path, label: i.label, section: s.label })),
    ...(platformItemsOf(s).some((i) => i.path === s.start) ? [] : [{ area: "platform" as const, path: s.start, label: s.label, section: s.label }]),
  ]),
  ...ACCOUNT_ITEMS.map((i) => ({ area: "account" as const, path: i.path, label: i.label, section: "Account" })),
  ...ownerTabs(OWNER_EVERY_TAB)
    .map((t) => ({ area: "account" as const, path: t.href.slice(OWNER_BASE.length), label: t.label, section: t.label }))
    .filter((t) => !ACCOUNT_ITEMS.some((i) => i.path === t.path)),
];

describe("a page's name and section come from the menu (D881)", () => {
  it("calls every page in a menu by the menu's word and puts it in the menu's section, at all three levels", () => {
    const wrong: string[] = [];
    for (const want of named) {
      const pages = at(want.area, want.path);
      if (pages.length === 0) wrong.push(`${want.area} ${want.path || "/"}: no page in the map`);
      for (const page of pages) {
        if (page.navLabel !== want.label) wrong.push(`${key(page)}: menu word ${page.navLabel} (the menu says ${want.label})`);
        if (page.group !== want.section) wrong.push(`${key(page)}: group ${page.group} (the menu's section is ${want.section})`);
        if (page.title !== want.label && !FULLER_TITLES[key(page)]) wrong.push(`${key(page)}: title "${page.title}" where the menu says "${want.label}"`);
      }
    }
    expect(wrong).toEqual([]);
    expect(named.length).toBeGreaterThan(200);
  });

  it("keeps a fuller title only where it is listed, and every listed one still differs", () => {
    for (const [id, why] of Object.entries(FULLER_TITLES)) {
      const page = ADMIN_PAGES.find((p) => key(p) === id);
      expect(page, id).toBeDefined();
      expect(page!.title, `${id}: ${why}`).not.toBe(page!.navLabel);
      expect(page!.navLabel, id).toBeDefined();
    }
  });

  it("gives a menu word only to a page the menu names", () => {
    const menu = new Set(named.map((n) => `${n.area}:${n.path}`));
    expect(ADMIN_PAGES.filter((p) => p.navLabel !== undefined && !menu.has(`${p.area}:${p.path}`)).map(key)).toEqual([]);
  });

  it("puts every page of the map in the section whose tab the frame marks on its address", () => {
    const store = storeNav("/admin/s", [...FEATURE_IDS]);
    const platform = platformNav();
    const owner = ownerTabs(OWNER_EVERY_TAB);
    const marked = (page: AdminPage): string | undefined => {
      const path = filled(page.path);
      if (page.area === "store") return store.tabs[currentIndex(`/admin/s${path}`, store.tabs, store.areas)]?.label;
      if (page.area === "platform") return platform.tabs[currentIndex(`${PLATFORM_BASE}${path}`, platform.tabs, platform.areas)]?.label;
      return owner[currentIndex(`${OWNER_BASE}${path}`, owner)]?.label;
    };
    expect(ADMIN_PAGES.filter((p) => marked(p) !== p.group).map((p) => `${key(p)} ${p.path}: ${p.group} (marked ${marked(p)})`)).toEqual([]);
  });

  it("gives each platform page a group that is one of the platform's tabs", () => {
    const tabs = new Set(platformTabs().map((t) => t.label));
    expect(ADMIN_PAGES.filter((p) => p.area === "platform" && !tabs.has(p.group)).map((p) => `${key(p)}: ${p.group}`)).toEqual([]);
    expect(new Set(ADMIN_PAGES.filter((p) => p.area === "platform").map((p) => p.group)).size).toBe(tabs.size);
  });

  it("is what the readers say: the AI's map, the page finder and a page's name in Norwegian", () => {
    const all = { features: [...FEATURE_IDS], owner: true };
    const store = adminMapText("store", all);
    const line = (text: string, group: string) => text.split("\n").find((l) => l.startsWith(`${group}: `)) ?? "";
    expect(line(store, "Support")).toContain("Inbox [support]");
    expect(line(store, "Support")).toContain("Requests [support.requests]");
    expect(line(store, "Analytics")).toContain("Overview [analytics]");
    expect(line(store, "Settings")).toContain("Tax [tax]");
    expect(store).not.toContain("Support inbox");
    const platform = adminMapText("platform");
    expect(line(platform, "Settings")).toContain("Header and footer [navigation]");
    expect(line(platform, "Settings")).toContain("Team [team]");
    expect(line(platform, "Website")).toContain("Headers [headers]");
    expect(platform).not.toMatch(/^(Platform|Kaizena Flow site):/m);
    expect(finderResults("store", "support inbox", { storeSlug: "s", flags: all })[0]).toMatchObject({ title: "Inbox", group: "Support", href: "/admin/s/support" });
    expect(finderResults("platform", "platform team")[0]).toMatchObject({ title: "Team", group: "Settings", href: "/admin/platform/team" });
    expect(finderResults("store", "mva-melding", { storeSlug: "s", flags: all, lang: "nb" })[0]).toMatchObject({ title: "Merverdiavgift", href: "/admin/s/analytics/tax" });
    // A fuller title still finds the page; the menu's word names it.
    const vat = findPages("store", "oss ioss reports", PAGES_WORDS.nb, all)[0];
    expect(vat?.id).toBe("analytics.tax");
    expect(pageName(vat!)).toBe("VAT");
    expect(pageNameIn("nb", ADMIN_PAGES.find((p) => key(p) === "platform:support")!)).toBe("Innboks");
    expect(pageNameIn("nb", ADMIN_PAGES.find((p) => key(p) === "store:order")!)).toBe("Bestilling");
  });
});
