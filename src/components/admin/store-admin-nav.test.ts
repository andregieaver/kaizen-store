import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

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

  it("shows the count beside a tab", () => {
    expect(render()).toContain("3 waiting");
  });
});
