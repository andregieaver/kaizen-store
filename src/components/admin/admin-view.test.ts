import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current, useRouter: () => ({ push() {}, refresh() {} }) }));

import type { AdminView } from "@/lib/admin-view";

import { AdminViewProvider, AdminViewToggle, BasicViewHint } from "./admin-view";
import { HubCards } from "./section-hub-cards";
import { StoreSidebar, type NavGroup } from "./store-admin-nav";

/** Basic and Advanced (D454): what the sidebar, the pages of cards and the switch draw in each view. */

const groups: NavGroup[] = [
  {
    heading: "Selling",
    items: [
      { href: "/admin/s/settings/payments", label: "Payments", icon: "credit-card" },
      { href: "/admin/s/settings/checkout", label: "Checkout rules", icon: "list-filter", advanced: true },
      { href: "/admin/s/settings/customs", label: "Duties and import VAT", icon: "container", advanced: true },
    ],
  },
  { heading: "Tools", items: [{ href: "/admin/s/settings/api", label: "Apps and API", icon: "braces", advanced: true }] },
];

const save = async () => {};
const inView = (view: AdminView | null, child: ReactNode) => renderToStaticMarkup(view ? h(AdminViewProvider, { saved: view, save, children: child }) : h("div", null, child));
const sidebar = (view: AdminView | null) => inView(view, h(StoreSidebar, { groups, label: "More" }));

beforeEach(() => {
  path.current = "/admin/s/settings/payments";
});

describe("the sidebar in each view", () => {
  it("leaves the advanced pages out of Basic, with the groups left empty, and says how many more Advanced has", () => {
    const out = sidebar("basic");
    expect(out).toContain("Payments");
    expect(out).not.toContain("Checkout rules");
    expect(out).not.toContain(">Tools<");
    expect(out).toContain("3 more in Advanced view");
    expect(out).toContain("Can&#x27;t find what you&#x27;re looking for? Switch to Advanced view");
    expect(out).toContain(">Switch to Advanced</button>");
  });

  it("keeps the page being viewed in Basic, even an advanced one", () => {
    path.current = "/admin/s/settings/checkout";
    const out = sidebar("basic");
    expect(out).toContain('aria-current="page"');
    expect(out).toContain("Checkout rules");
    expect(out).toContain("2 more in Advanced view");
  });

  it("shows every page in Advanced, and outside a store's admin, with nothing said about views", () => {
    for (const out of [sidebar("advanced"), sidebar(null)]) {
      expect(out).toContain("Checkout rules");
      expect(out).toContain("Apps and API");
      expect(out).not.toContain("Advanced view");
    }
  });

  it("leaves the note to the cards on a page of cards, where the sidebar lists the same pages", () => {
    const out = inView("basic", h(StoreSidebar, { groups, label: "More", hint: false }));
    expect(out).not.toContain("Checkout rules");
    expect(out).not.toContain("more in Advanced view");
  });

  it("draws each page's icon beside its name", () => {
    expect(sidebar("advanced").match(/<svg/g)).toHaveLength(4);
  });
});

describe("the pages of cards in each view", () => {
  const lists = groups.map((g) => ({ heading: g.heading, items: g.items.map((i) => ({ href: i.href, label: i.label, description: `About ${i.label}`, icon: i.icon, advanced: i.advanced })) }));

  it("leaves the advanced cards out of Basic, with a note and the switch at the foot", () => {
    const out = inView("basic", h(HubCards, { lists }));
    expect(out).toContain("About Payments");
    expect(out).not.toContain("About Checkout rules");
    expect(out).not.toContain(">Tools<");
    expect(out).toContain("3 more in Advanced view");
  });

  it("shows every card in Advanced", () => {
    const out = inView("advanced", h(HubCards, { lists }));
    expect(out).toContain("About Apps and API");
    expect(out).not.toContain("more in Advanced view");
  });
});

describe("the switch and the note", () => {
  it("names both views and marks the one in force", () => {
    const out = inView("basic", h(AdminViewToggle));
    expect(out).toContain('role="group" aria-label="How much the admin shows"');
    expect(out).toMatch(/aria-pressed="true" title="Basic view: the pages you use every day"/);
    expect(out).toMatch(/aria-pressed="false" title="Advanced view: every page and setting"/);
  });

  it("keeps its names for screen readers where it is compact", () => {
    expect(inView("advanced", h(AdminViewToggle, { compact: true }))).toContain('class="sr-only xl:not-sr-only">Advanced</span>');
  });

  it("is not drawn outside a store's admin, and the note only in Basic", () => {
    expect(inView(null, h(AdminViewToggle))).toBe("<div></div>");
    expect(inView("advanced", h(BasicViewHint, { card: true }))).toBe("");
    expect(inView("basic", h(BasicViewHint, { card: true }))).toContain("You are in Basic view");
  });
});
