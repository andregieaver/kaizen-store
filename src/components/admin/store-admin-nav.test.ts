import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

import { ADMIN_PAGES, type AdminArea } from "@/lib/admin-map";
import { SHELL_WORDS } from "@/lib/admin-words/shell";
import { ACCOUNT_EXTRA, ACCOUNT_ITEMS, OWNER_BASE, ownerAreas, ownerTabs } from "@/lib/owner-nav";
import { PLATFORM_BASE, platformAreas, platformNavAreas, platformTabs } from "@/lib/platform-nav";
import { FEATURE_IDS } from "@/lib/store-features";
import { HOME_PATHS, STORE_SECTIONS, navAreas, sectionOf, storeNav } from "@/lib/store-nav";
import { WORK_ROOT } from "@/lib/work-paths";

import { AdminTextProvider } from "./admin-text-context";
import { AreaMenu, AreaSidebar, StoreTabs, type NavArea, type NavItem } from "./store-admin-nav";

const areas: NavArea[] = [
  { prefixes: [], exact: ["/admin/p"], groups: [] },
  { prefixes: ["/admin/p/site", "/admin/p/pages"], groups: [{ heading: "Website", items: [{ href: "/admin/p/pages", label: "Pages" }] }] },
  { prefixes: ["/admin/p/stores"], groups: [] },
];
const fallback = [{ heading: "Other", items: [{ href: "/admin/p/x", label: "Elsewhere" }] }];
const html = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element);
const sidebar = () => html(createElement(AreaSidebar, { areas, fallback, label: "More" }));

beforeEach(() => {
  path.current = "/";
});

describe("a sidebar for each section (D144)", () => {
  it("shows the sidebar of the section the page is in, and the section's pages inside it", () => {
    path.current = "/admin/p/pages";
    expect(sidebar()).toContain("Pages");
    path.current = "/admin/p/pages/new";
    expect(sidebar()).toContain("Pages");
    path.current = "/admin/p/site";
    expect(sidebar()).toContain("Website");
  });

  it("draws nothing, not even its room, where the section has none", () => {
    path.current = "/admin/p";
    expect(sidebar()).toBe("");
    path.current = "/admin/p/stores/demo";
    expect(sidebar()).toBe("");
  });

  it("does not take an address that only starts the same way", () => {
    path.current = "/admin/p/pages-other";
    // In no area: the level's own sidebar, if it has one.
    expect(sidebar()).toContain("Elsewhere");
  });

  it("puts the tabs and the section's sidebar in the phone's menu", () => {
    const tabs: NavItem[] = [{ href: "/admin/p", label: "Home", exact: true }];
    path.current = "/admin/p/pages";
    const menu = html(createElement(AreaMenu, { tabs, areas, fallback, label: "All" }));
    expect(menu).toContain("Home");
    expect(menu).toContain("Pages");
    path.current = "/admin/p/stores";
    expect(html(createElement(AreaMenu, { tabs, areas, fallback, label: "All" }))).not.toContain("Pages");
  });
});

describe("the tabs", () => {
  const tabs: NavItem[] = [
    { href: "/admin/p", label: "Home", exact: true, icon: "home" },
    { href: "/admin/p/website", label: "Website", icon: "monitor", also: ["/admin/p/pages"] },
    { href: "/admin/p/requests", label: "Requests", icon: "bell", badge: 3 },
  ];
  const render = () => html(createElement(StoreTabs, { items: tabs, label: "Sections" }));
  const current = (markup: string) => [...markup.matchAll(/aria-current="page"[^>]*>(?:<svg.*?<\/svg>)?([A-Za-z]+)/g)].map((m) => m[1]);

  it("draws an icon before each label and marks the section a page is in", () => {
    path.current = "/admin/p/pages/abc";
    const out = render();
    expect(out.match(/<svg/g)).toHaveLength(3);
    expect(current(out)).toEqual(["Website"]);
    path.current = "/admin/p";
    expect(current(render())).toEqual(["Home"]);
    path.current = "/admin/p/website";
    expect(current(render())).toEqual(["Website"]);
  });

  it("marks an exact tab on its own address and on the addresses listed as its own, but not below its address (D147)", () => {
    const exact: NavItem[] = [
      { href: "/admin/s/settings", label: "Settings", exact: true, also: ["/admin/s/settings/company"] },
      { href: "/admin/s/website", label: "Website", also: ["/admin/s/settings/design"] },
    ];
    const marked = (at: string) => {
      path.current = at;
      return current(html(createElement(StoreTabs, { items: exact, label: "Sections" })));
    };
    expect(marked("/admin/s/settings")).toEqual(["Settings"]);
    expect(marked("/admin/s/settings/company/places/new")).toEqual(["Settings"]);
    // Design is inside the settings address but listed under Website.
    expect(marked("/admin/s/settings/design")).toEqual(["Website"]);
  });

  it("shows the count beside a tab", () => {
    expect(render()).toContain("3 waiting");
  });
});

/**
 * Say where you are (code review step 2.2, D873): every address the three levels know (their menus' links and every page of the admin
 * map, a record's id filled in) is walked through what the frame draws, the tabs (the rail and the phone's bar mark as they do), the
 * section's sidebar and the phone's menu. In each list one link at most is marked, and it is the right one.
 */
describe("one link marked in each list (D873)", () => {
  const filled = (p: string) => p.replace(/\[[A-Za-z]+\]/g, "x1");
  const pagesOf = (area: AdminArea) => ADMIN_PAGES.filter((p) => p.area === area).map((p) => filled(p.path));
  /** The labels marked in each list of a rendering: each `<ul>` (a sidebar's groups together are one list, the phone menu's sections another). */
  const lists = (markup: string) =>
    [...markup.matchAll(/<ul[^>]*>(.*?)<\/ul>/g)].map((m) => [...m[1].matchAll(/aria-current="page"[^>]*>(?:<svg.*?<\/svg>)?([^<]+)/g)].map((x) => x[1].replace(/&amp;/g, "&")));
  const tabsAt = (at: string, tabs: NavItem[], areas: NavArea[]) => {
    path.current = at;
    return lists(html(createElement(StoreTabs, { items: tabs, label: "Sections", areas }))).flat();
  };
  const sidebarAt = (at: string, areas: NavArea[]) => {
    path.current = at;
    return lists(html(createElement(AreaSidebar, { areas, fallback: [], label: "More" }))).flat();
  };

  const storeBase = "/admin/s";
  const store = storeNav(storeBase, [...FEATURE_IDS]);
  const who = { owner: true, work: true, support: true, domains: true, books: true };
  const levels: { name: string; tabs: NavItem[]; areas: NavArea[]; addresses: string[] }[] = [
    {
      name: "a store",
      tabs: store.tabs,
      areas: store.areas,
      addresses: ["", ...HOME_PATHS, ...navAreas(STORE_SECTIONS).map((a) => a.path), ...pagesOf("store")].map((p) => `${storeBase}${p}`),
    },
    {
      name: "the platform",
      tabs: platformTabs({ requests: 2, support: 1 }),
      areas: platformAreas(),
      addresses: ["", ...platformNavAreas().map((a) => a.path), ...pagesOf("platform")].map((p) => `${PLATFORM_BASE}${p}`),
    },
    {
      name: "the owner's level",
      tabs: ownerTabs(who, { support: 1 }),
      areas: ownerAreas(who),
      addresses: [WORK_ROOT, ...["", ...ACCOUNT_ITEMS.map((i) => i.path), ...ACCOUNT_EXTRA, ...pagesOf("account")].map((p) => `${OWNER_BASE}${p}`)],
    },
  ];

  it.each(levels)("$name: no address marks two sections, nor two of a section's pages, in the tabs, the sidebar or the phone's menu", ({ tabs, areas, addresses }) => {
    const twice: string[] = [];
    for (const at of new Set(addresses)) {
      const marked = { tabs: tabsAt(at, tabs, areas), sidebar: sidebarAt(at, areas) };
      path.current = at;
      const [sections = [], ...pages] = lists(html(createElement(AreaMenu, { tabs, areas, fallback: [], label: "All pages" })));
      for (const [where, labels] of Object.entries({ ...marked, menuSections: sections, menuPages: pages.flat() })) {
        if (labels.length > 1) twice.push(`${at} ${where}: ${labels.join(", ")}`);
      }
    }
    expect(twice).toEqual([]);
    expect(addresses.length).toBeGreaterThan(30);
  });

  it("marks for every page of a store the section sectionOf() names (Home for Home's), and each page's own link in its sidebar", () => {
    const wrong: string[] = [];
    for (const p of new Set(pagesOf("store"))) {
      const want = sectionOf(p)?.label ?? (p === "" || HOME_PATHS.some((home) => p === home || p.startsWith(`${home}/`)) ? "Home" : undefined);
      const got = tabsAt(`${storeBase}${p}`, store.tabs, store.areas)[0];
      if (got !== want) wrong.push(`${p}: ${got} (${want})`);
    }
    for (const item of store.areas.flatMap((a) => a.groups.flatMap((g) => g.items))) {
      const got = sidebarAt(item.href, store.areas);
      if (got.join() !== item.label) wrong.push(`${item.href}: ${got.join()} (${item.label})`);
    }
    expect(wrong).toEqual([]);
    // The three of FN6: a page under another's address lights alone.
    expect(sidebarAt(`${storeBase}/orders/drafts`, store.areas)).toEqual(["Draft orders"]);
    expect(sidebarAt(`${storeBase}/articles/comments`, store.areas)).toEqual(["Blog comments"]);
    expect(sidebarAt(`${storeBase}/support/requests`, store.areas)).toEqual(["Requests"]);
    expect(sidebarAt(`${storeBase}/orders/x1`, store.areas)).toEqual(["Orders"]);
  });

  it("marks the platform's section on every page in one, and each sidebar page's own link; its tabs keep their mark on a deeper page", () => {
    const tabs = platformTabs();
    const areas = platformAreas();
    const none: string[] = [];
    for (const p of new Set(pagesOf("platform"))) if (tabsAt(`${PLATFORM_BASE}${p}`, tabs, areas).length === 0) none.push(p);
    // The AI manager is the platform's tool from every page, in no section, as a store's is Home's.
    expect(none.filter((p) => !p.startsWith("/assistant"))).toEqual([]);
    const wrong: string[] = [];
    for (const item of areas.flatMap((a) => a.groups.flatMap((g) => g.items))) {
      const got = sidebarAt(item.href, areas);
      if (got.join() !== item.label) wrong.push(`${item.href}: ${got.join()} (${item.label})`);
    }
    expect(wrong).toEqual([]);
    // Before D873 a section's tab lost its mark on a page below its own address (Plans on Limits, Support on its reports).
    expect(tabsAt(`${PLATFORM_BASE}/plans/limits`, tabs, areas)).toEqual(["Plans"]);
    expect(tabsAt(`${PLATFORM_BASE}/support/reports`, tabs, areas)).toEqual(["Support"]);
    expect(tabsAt(`${PLATFORM_BASE}/support/stores`, tabs, areas)).toEqual(["Support"]);
  });

  it("marks on every page of the admin map the tab its group names, at all three levels (D881)", () => {
    const frames: Record<AdminArea, { base: string; tabs: NavItem[]; areas: NavArea[] }> = {
      store: { base: storeBase, tabs: store.tabs, areas: store.areas },
      platform: { base: PLATFORM_BASE, tabs: platformTabs(), areas: platformAreas() },
      account: { base: OWNER_BASE, tabs: ownerTabs(who), areas: ownerAreas(who) },
    };
    const wrong: string[] = [];
    for (const page of ADMIN_PAGES) {
      const { base, tabs, areas } = frames[page.area];
      const got = tabsAt(`${base}${filled(page.path)}`, tabs, areas);
      if (got.join() !== page.group) wrong.push(`${page.area}:${page.id} ${page.path}: ${got.join() || "none"} (${page.group})`);
    }
    expect(wrong).toEqual([]);
  });

  it("marks one section of the owner's level: Work, Support and Books are not also Account's", () => {
    const tabs = ownerTabs(who);
    const areas = ownerAreas(who);
    expect(tabsAt(`${WORK_ROOT}/s/demo/clients`, tabs, areas)).toEqual(["Work"]);
    expect(tabsAt(`${OWNER_BASE}/account/support`, tabs, areas)).toEqual(["Support"]);
    expect(tabsAt(`${OWNER_BASE}/account/books`, tabs, areas)).toEqual(["Books"]);
    expect(tabsAt(`${OWNER_BASE}/account/appearance`, tabs, areas)).toEqual(["Account"]);
    expect(sidebarAt(`${OWNER_BASE}/account/appearance`, areas)).toEqual(["Appearance"]);
    expect(tabsAt(`${OWNER_BASE}/stores`, tabs, areas)).toEqual(["Stores"]);
    expect(tabsAt(OWNER_BASE, tabs, areas)).toEqual(["Home"]);
  });
});

describe("a count's spoken words (D873)", () => {
  it("reads a badge in the account's language, never in fixed English", () => {
    path.current = "/admin/p";
    const tabs: NavItem[] = [{ href: "/admin/p/requests", label: "Forespørsler", badge: 3 }];
    const provided = { lang: "nb", texts: { shell: SHELL_WORDS.nb } } as ComponentProps<typeof AdminTextProvider>;
    const nb = html(createElement(AdminTextProvider, provided, createElement(StoreTabs, { items: tabs, label: "Seksjoner" })));
    expect(nb).toContain('<span class="sr-only">3 venter</span>');
    expect(nb).not.toContain("waiting");
    for (const lang of ["en", "nb"] as const) expect(SHELL_WORDS[lang].frame.waiting).toContain("{count}");
  });
});
