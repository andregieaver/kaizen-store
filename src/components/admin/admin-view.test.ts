import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current, useRouter: () => ({ push() {}, refresh() {} }) }));

import type { AdminView } from "@/lib/admin-view";
import { ownerAreas } from "@/lib/owner-nav";
import { platformAreas } from "@/lib/platform-nav";

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

describe("the platform's and the owner's sidebars in each view (D884)", () => {
  const settings = platformAreas().find((a) => a.section === "settings")!.groups;
  const account = ownerAreas({ owner: true, work: true }).find((a) => a.groups.length > 0)!.groups;

  it("shows the platform's Settings in six groups, its everyday pages in Basic and how many more Advanced has", () => {
    path.current = "/admin/platform/team";
    const basic = inView("basic", h(StoreSidebar, { groups: settings, label: "More" }));
    for (const heading of ["Site", "Money and tax", "AI", "Apps and connections", "Privacy and law", "Running the platform"]) expect(basic).toContain(`uppercase">${heading}</h2>`);
    expect(basic).toContain("VAT rates");
    expect(basic).not.toContain("Duty rates");
    expect(basic).toContain("17 more in Advanced view");
    const advanced = inView("advanced", h(StoreSidebar, { groups: settings, label: "More" }));
    expect(advanced).toContain("Duty rates");
    expect(advanced).not.toContain("more in Advanced view");
  });

  it("keeps an advanced page of the platform in its sidebar while it is viewed", () => {
    path.current = "/admin/platform/duty-rates";
    const basic = inView("basic", h(StoreSidebar, { groups: settings, label: "More" }));
    expect(basic).toMatch(/aria-current="page"[^>]*>.*Duty rates/);
    expect(basic).toContain("16 more in Advanced view");
  });

  it("shows the owner's Account in its groups, its everyday pages in Basic", () => {
    path.current = "/admin/account";
    const basic = inView("basic", h(StoreSidebar, { groups: account, label: "More" }));
    expect(basic).toContain(`uppercase">Personal</h2>`);
    expect(basic).toContain("Billing");
    expect(basic).not.toContain("Appearance");
    expect(basic).not.toContain(`uppercase">Apps and themes</h2>`);
    expect(basic).toContain("10 more in Advanced view");
  });
});

describe("the switch and the note", () => {
  it("names both views and marks the one in force", () => {
    const out = inView("basic", h(AdminViewToggle));
    expect(out).toContain('role="group" aria-label="How much the admin shows"');
    expect(out).toMatch(/aria-pressed="true"[^>]*>.*Basic<\/button>/);
    expect(out).toMatch(/aria-pressed="false"[^>]*>.*Advanced<\/button>/);
    expect(out.match(/<svg/g)).toHaveLength(2);
  });

  it("keeps its names for screen readers where it is compact, and says what each view shows", () => {
    const out = inView("advanced", h(AdminViewToggle, { compact: true }));
    expect(out).toContain('class="sr-only xl:not-sr-only">Advanced</span>');
    expect(out).toMatch(/aria-pressed="false" title="Basic view: the pages you use every day"/);
    expect(out).toMatch(/aria-pressed="true" title="Advanced view: every page and setting"/);
  });

  it("is not drawn outside a level's provider, and the note only in Basic", () => {
    expect(inView(null, h(AdminViewToggle))).toBe("<div></div>");
    expect(inView("advanced", h(BasicViewHint, { card: true }))).toBe("");
    expect(inView("basic", h(BasicViewHint, { card: true }))).toContain("You are in Basic view");
  });
});
