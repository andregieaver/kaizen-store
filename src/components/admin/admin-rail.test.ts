import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current, useRouter: () => ({ push() {}, refresh() {} }) }));

import { AdminFrame } from "./admin-frame";
import { AdminRail } from "./admin-rail";
import type { NavArea, NavItem } from "./store-admin-nav";

/** The rail layout (docs/admin-style.md 5.3, 6.3): the sections as named icon tiles, drawn once, Settings at the foot. */

const tabs: NavItem[] = [
  { href: "/admin/s", label: "Home", icon: "home", exact: true },
  { href: "/admin/s/orders", label: "Orders", icon: "package" },
  { href: "/admin/s/support", label: "Support", icon: "chat", badge: 3 },
  { href: "/admin/s/settings", label: "Settings", icon: "cog", exact: true, also: ["/admin/s/settings/tax"], foot: true },
];
const areas: NavArea[] = [{ prefixes: ["/admin/s/settings/tax"], exact: ["/admin/s/settings"], groups: [{ heading: "Money", items: [{ href: "/admin/s/settings/tax", label: "Tax" }] }] }];
const rail = () => renderToStaticMarkup(h(AdminRail, { items: tabs, home: { href: "/admin", label: "Kaizena Flow: all your stores" }, label: "Main sections" }));

beforeEach(() => {
  path.current = "/admin/s/orders/123";
});

describe("the rail", () => {
  it("names every tile, marks the section being viewed, and is only for computers", () => {
    const out = rail();
    expect(out).toContain('aria-label="Orders" aria-current="page"');
    expect(out).toContain('aria-label="Home"');
    expect(out).not.toContain('aria-label="Home" aria-current');
    expect(out).toContain('aria-label="Kaizena Flow: all your stores"');
    expect(out).toMatch(/data-admin-rail="true" class="[^"]*hidden[^"]*md:flex/);
  });

  it("says what waits on a tile in its name, and puts Settings at the foot", () => {
    const out = rail();
    expect(out).toContain('aria-label="Support, 3 waiting"');
    const lists = out.split("<ul");
    expect(lists).toHaveLength(3);
    expect(lists[2]).toContain("Settings");
    expect(lists[1]).not.toContain("Settings");
  });

  it("marks Settings on a page inside it", () => {
    path.current = "/admin/s/settings/tax";
    expect(rail()).toContain('aria-label="Settings" aria-current="page"');
  });

  it("has a button at its foot that shows the sections' names beside their icons, and none where it is narrowed for a tool (D262)", () => {
    const out = rail();
    expect(out).toContain('aria-label="Show the sections&#x27; names"');
    // Each name is there for the wider rail, hidden until the browser's choice on <html> shows it.
    expect(out).toMatch(/<span aria-hidden="true" class="hidden [^"]*\[\[data-rail=names\]_&amp;\]:inline">Orders<\/span>/);
    const narrow = renderToStaticMarkup(h(AdminRail, { items: tabs, home: { href: "/admin", label: "Home" }, label: "Main sections", collapseOn: "^/admin/s/orders" }));
    expect(narrow).not.toContain("names");
  });

  it("is set on <html> before the page is drawn, from the browser's choice, and kept by the button", async () => {
    const { RAIL_NAMES_KEY, railNamesScript, setRailNames } = await import("@/lib/admin-rail");
    const attributes = new Map<string, string>();
    const stored = new Map<string, string>();
    const root = { setAttribute: (k: string, v: string) => attributes.set(k, v), removeAttribute: (k: string) => attributes.delete(k), getAttribute: (k: string) => attributes.get(k) ?? null };
    const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v), removeItem: (k: string) => stored.delete(k) };
    new Function("document", "localStorage", railNamesScript())({ documentElement: root }, storage);
    expect(attributes.has("data-rail")).toBe(false);
    stored.set(RAIL_NAMES_KEY, "names");
    new Function("document", "localStorage", railNamesScript())({ documentElement: root }, storage);
    expect(attributes.get("data-rail")).toBe("names");
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { dispatchEvent: () => true });
    setRailNames(false);
    expect(attributes.has("data-rail")).toBe(false);
    expect(stored.has(RAIL_NAMES_KEY)).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("the frame in each layout", () => {
  const frame = (layout: "rail" | "classic") =>
    renderToStaticMarkup(
      h(AdminFrame, { layout, switcher: "Store", account: "Me", tabs, groups: [], areas, wide: true, tabsLabel: "Main sections", menuTitle: "Store", children: h("p", null, "Page") }),
    );

  it("draws the sections in the rail and not again as tabs", () => {
    path.current = "/admin/s/settings/tax";
    const out = frame("rail");
    expect(out).toContain('data-admin-layout="rail"');
    expect(out).toContain("data-admin-rail");
    expect(out.match(/aria-label="Main sections"/g)).toHaveLength(1);
    // The section's own pages stay beside it.
    expect(out).toContain(">Tax<");
    expect(out).toContain("Page");
  });

  it("keeps the classic layout as it was: tabs, no rail", () => {
    const out = frame("classic");
    expect(out).not.toContain("data-admin-rail");
    expect(out.match(/aria-label="Main sections"/g)).toHaveLength(1);
  });

  it("draws a tool in the workspace layout: a narrowed rail, the whole width, the inbox's section pages in the top bar", () => {
    const supportAreas: NavArea[] = [
      { prefixes: ["/admin/s/support"], groups: [{ heading: "Support", items: [{ href: "/admin/s/support", label: "Inbox", exact: true }, { href: "/admin/s/support/reports", label: "Reports" }] }] },
      ...areas,
    ];
    const workspace = () =>
      renderToStaticMarkup(
        h(AdminFrame, {
          layout: "rail",
          switcher: "Store",
          account: "Me",
          tabs,
          groups: [],
          areas: supportAreas,
          tabsLabel: "Main sections",
          menuTitle: "Store",
          fullWidth: "^/admin/[^/]+/media$",
          workspaceLinks: "^/admin/[^/]+/support$",
          children: h("p", null, "Tool"),
        }),
      );
    path.current = "/admin/s/support";
    const inbox = workspace();
    expect(inbox).toContain('data-admin-layout="workspace"');
    expect(inbox).toContain("data-collapsed");
    expect(inbox).toContain("w-16");
    expect(inbox).toContain('aria-label="This section"');
    expect(inbox).toContain(">Reports<");
    // Its pages are in the top bar, not in a sidebar beside it.
    expect(inbox).not.toContain("<aside");
    path.current = "/admin/s/media";
    const media = workspace();
    expect(media).toContain("data-collapsed");
    expect(media).not.toContain('aria-label="This section"');
    // The inbox's other pages keep the full rail and their sidebar.
    path.current = "/admin/s/support/reports";
    const reports = workspace();
    expect(reports).not.toContain("data-collapsed");
    expect(reports).toContain("<aside");
  });

  it("draws the setup wizard in the focus layout: a way back and what is being done, no rail, sidebar, menu or actions", () => {
    const focused = () =>
      renderToStaticMarkup(
        h(AdminFrame, {
          layout: "rail",
          switcher: "Store switcher",
          actions: "AI manager",
          account: "Me",
          tabs,
          groups: [],
          areas,
          tabsLabel: "Main sections",
          menuTitle: "Store",
          focus: { pattern: "^/admin/[^/]+/setup(/|$)", back: { href: "/admin/s", label: "Leave setup" }, title: "Setting up Kaffe" },
          children: h("p", null, "Step"),
        }),
      );
    path.current = "/admin/s/setup/details";
    const out = focused();
    expect(out).toContain('data-admin-layout="focus"');
    expect(out).toContain("max-w-[760px]");
    expect(out).not.toContain("data-admin-rail");
    expect(out).not.toContain("Main sections");
    expect(out).not.toContain("data-open-menu");
    expect(out).not.toContain("Store switcher");
    expect(out).not.toContain("AI manager");
    expect(out).toContain('href="/admin/s"');
    expect(out).toContain("Leave setup");
    expect(out).toContain("Setting up Kaffe");
    expect(out).toContain("Me");
    expect(out).toContain("Step");
    // Any other page of the store keeps the rail.
    path.current = "/admin/s/orders";
    const normal = focused();
    expect(normal).toContain("data-admin-rail");
    expect(normal).toContain("Store switcher");
    expect(normal).not.toContain("Leave setup");
  });
});
