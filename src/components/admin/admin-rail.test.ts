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
const rail = () => renderToStaticMarkup(h(AdminRail, { items: tabs, home: { href: "/admin", label: "Kaizen: all your stores" }, label: "Main sections" }));

beforeEach(() => {
  path.current = "/admin/s/orders/123";
});

describe("the rail", () => {
  it("names every tile, marks the section being viewed, and is only for computers", () => {
    const out = rail();
    expect(out).toContain('aria-label="Orders" aria-current="page"');
    expect(out).toContain('aria-label="Home"');
    expect(out).not.toContain('aria-label="Home" aria-current');
    expect(out).toContain('aria-label="Kaizen: all your stores"');
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
});
