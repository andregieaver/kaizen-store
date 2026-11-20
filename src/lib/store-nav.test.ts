import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ROLE_TEMPLATES, canOpenPath, permissionOfPath, type PermissionHolder } from "./permissions";
import { AFTER_SALE_ADMIN_PATHS, FEATURE_IDS, isAfterSaleAdminPath, requirementMet, type FeatureRequirement } from "./store-features";
import { NAV_ICON_NAMES } from "@/components/admin/nav-icons";

import { ACCOUNT_ITEMS } from "./owner-nav";
import { PLAN_ITEMS, SETTINGS_ITEMS, SUPPORT_ITEMS, WEBSITE_ITEMS } from "./platform-nav";
import { HOME_PATHS, STORE_SECTIONS, advancedIn, sectionOf, sectionPaths, storeAreas, storeNav, storeSections, storeTabs } from "./store-nav";

const ROOT = "src/app/admin/(gated)/[store]";
const ALL = { features: [...FEATURE_IDS] };
const NONE = { features: ["shop"] };
/** Folders that are not a section's page: the layout's own, and routes with no page of their own. */
const SKIPPED = new Set(["setup", "assistant"]);

const items = STORE_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items));

/** The addresses inside a section's tab: its sidebar's `prefixes`, found by the key the tab names (bloat review step 2.28). */
const insideTab = (base: string, flags: Parameters<typeof storeTabs>[1], label: string): string[] => {
  const tab = storeTabs(base, flags).find((t) => t.label === label)!;
  expect(tab.also, `${label} names its section instead of its addresses`).toBeUndefined();
  return storeAreas(base, flags).find((a) => a.section === tab.section)!.prefixes;
};

describe("the store admin's sections (D147)", () => {
  it("lists each page once, in one sidebar", () => {
    const paths = items.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("links only pages the admin map knows, and gives the map the section as its group", () => {
    const known = new Map(ADMIN_PAGES.filter((p) => p.area === "store").map((p) => [p.path, p]));
    for (const section of STORE_SECTIONS) {
      for (const path of sectionPaths(section)) {
        expect(known.has(path), path).toBe(true);
        expect(known.get(path)!.group, path).toBe(section.label);
      }
    }
    // Every page of the map, with its own parameters, is inside a section or is Home's.
    for (const page of known.values()) {
      const home = page.path === "" || HOME_PATHS.some((p) => page.path === p || page.path.startsWith(`${p}/`));
      expect(Boolean(sectionOf(page.path)) || home, page.path).toBe(true);
      expect(page.group, page.path).toBe(sectionOf(page.path)?.label ?? "Home");
    }
  });

  it("puts every store page folder in a section, or in Home", () => {
    const dirs = readdirSync(ROOT).filter((name) => statSync(join(ROOT, name)).isDirectory());
    for (const dir of dirs) {
      if (SKIPPED.has(dir)) continue;
      // `settings` has no page of its own folder but the hub; each of its folders is a page of a section.
      if (dir === "settings") {
        for (const sub of readdirSync(join(ROOT, dir)).filter((name) => statSync(join(ROOT, dir, name)).isDirectory())) {
          expect(sectionOf(`/settings/${sub}`), `settings/${sub}`).toBeDefined();
          expect(items.some((i) => i.path === `/settings/${sub}`), `settings/${sub} is in a sidebar`).toBe(true);
        }
        continue;
      }
      expect(sectionOf(`/${dir}`), dir).toBeDefined();
    }
  });

  it("gives a page of cards a sidebar that leads to the same pages, and marks only itself on its tab", () => {
    const tabs = storeTabs("/admin/s", ALL);
    expect(tabs.map((t) => t.label)).toEqual(["Home", "Orders", "Products", "Customers", "Marketing", "Analytics", "Website", "Bookings", "Support", "Settings"]);
    expect(tabs[0]).toMatchObject({ href: "/admin/s", exact: true, icon: "home" });
    const settings = tabs.find((t) => t.label === "Settings")!;
    expect(settings).toMatchObject({ href: "/admin/s/settings", exact: true, section: "settings" });
    // The Design page is in Settings' address space, but the Website's: its tab is not marked as Settings'.
    expect(insideTab("/admin/s", ALL, "Settings")).not.toContain("/admin/s/settings/design");
    // Nor its own address: below it would take every settings page, Design included.
    expect(insideTab("/admin/s", ALL, "Settings")).not.toContain("/admin/s/settings");
    expect(insideTab("/admin/s", ALL, "Website")).toContain("/admin/s/settings/design");
    const areas = storeAreas("/admin/s", ALL);
    const settingsArea = areas.find((a) => a.exact?.includes("/admin/s/settings"))!;
    expect(settingsArea.groups.map((g) => g.heading)).toEqual(["Store", "Selling", "Site", "Tools", "Account"]);
    expect(settingsArea.prefixes).not.toContain("/admin/s/settings/design");
  });

  it("offers bookings and subscription boxes only to stores that have them on", () => {
    const off = storeTabs("/admin/s", NONE).map((t) => t.label);
    expect(off).not.toContain("Bookings");
    const labels = (flags: { features: string[] }) => storeSections(flags).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.label)));
    expect(labels(NONE)).not.toContain("Subscription boxes");
    expect(labels(NONE)).not.toContain("Calendar");
    expect(labels({ features: ["shop", "boxes"] })).toContain("Subscription boxes");
    expect(labels({ features: ["shop", "appointments"] })).toEqual(expect.arrayContaining(["Calendar", "Staff and hours"]));
    expect(labels({ features: ["shop", "appointments"] })).not.toContain("Rooms and items");
    expect(labels({ features: ["shop", "bookings"] })).toEqual(expect.arrayContaining(["Calendar", "Rooms and items", "Stays and rentals", "Hosts"]));
    expect(labels({ features: ["shop", "bookings"] })).not.toContain("Staff and hours");
    expect(storeAreas("/admin/s", NONE)).toHaveLength(storeSections(NONE).length + 1);
  });

  it("hides what stands behind a feature that is off, its own switch kept while the shop is off (D178)", () => {
    const labels = (features: string[]) => storeSections({ features }).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.path)));
    const gated = ["/subscriptions", "/analytics/subscriptions", "/bonus", "/affiliates", "/companies", "/deliveries", "/hosts", "/bookings"];
    for (const path of gated) expect(labels(["shop"]), path).not.toContain(path);
    for (const path of gated) expect(labels([...FEATURE_IDS]), path).toContain(path);
    // Kept on, but the shop is off: hidden; the referral program needs the bonus program as well.
    expect(labels(FEATURE_IDS.filter((id) => id !== "shop"))).not.toContain("/bonus");
    expect(labels(["shop", "referrals"])).not.toContain("/affiliates");
    expect(labels(["shop", "bonus", "referrals"])).toContain("/affiliates");
    // The sections themselves stay whole for the permissions and the admin map.
    expect(sectionOf("/bonus")?.key).toBe("marketing");
    expect(STORE_SECTIONS.find((s) => s.key === "bookings")).toBeDefined();
  });

  it("leaves the online shop's sections and pages out of a website, and opens a section on what is left (D178 step 5)", () => {
    const website = { features: [] as string[] };
    const tabs = storeTabs("/admin/s", website);
    // Products has only Custom fields left, a page its tab does not stand for, so it is not in the menu (the round 4 fix).
    expect(tabs.map((t) => t.label)).toEqual(["Home", "Customers", "Marketing", "Analytics", "Website", "Support", "Settings"]);
    // Orders is not in the menu (reached from Home while an order can still be withdrawn from or returned).
    expect(tabs.map((t) => t.href)).not.toContain("/admin/s/orders");
    // A section whose main page is hidden opens on the first page it has left.
    const href = (label: string) => tabs.find((t) => t.label === label)!.href;
    expect(href("Customers")).toBe("/admin/s/privacy");
    // Since Marketing is in groups (code review step 0.11), Email comes before the site's own tools: a website opens it on Broadcasts.
    expect(href("Marketing")).toBe("/admin/s/marketing");
    expect(href("Analytics")).toBe("/admin/s/analytics/traffic");
    expect(storeTabs("/admin/s", NONE).find((t) => t.label === "Products")!.href).toBe("/admin/s/products");
    const paths = storeSections(website).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.path)));
    for (const path of ["/products", "/inventory", "/product-layouts", "/customers", "/customer-groups", "/wishlists", "/campaigns", "/discounts", "/recommendations", "/cart-reminders", "/analytics", "/analytics/finance", "/analytics/tax", "/settings/payments", "/settings/shipping", "/settings/orders", "/settings/returns", "/settings/tax", "/settings/invoices", "/search"]) {
      expect(paths, path).not.toContain(path);
    }
    for (const path of ["/privacy", "/experiments", "/analytics/traffic", "/analytics/settings", "/pages", "/settings/legal", "/settings/features", "/integrations", "/chat"]) {
      expect(paths, path).toContain(path);
    }
    // The pages of what was sold that stay reachable are the shop's in the map and the menu, and are pages the map knows.
    const known = new Map(ADMIN_PAGES.filter((p) => p.area === "store").map((p) => [p.path, p]));
    for (const path of AFTER_SALE_ADMIN_PATHS) {
      expect(known.get(path)?.feature, path).toBe("shop");
      expect(isAfterSaleAdminPath(path)).toBe(true);
    }
    expect(isAfterSaleAdminPath("/orders/drafts")).toBe(false);
  });

  it("tags each page behind a feature as the admin map does", () => {
    const key = (f: FeatureRequirement | undefined) => (f === undefined ? "" : typeof f === "string" ? f : [...f].sort().join("|"));
    const pages = new Map(ADMIN_PAGES.filter((p) => p.area === "store").map((p) => [p.path, p]));
    for (const section of STORE_SECTIONS) {
      for (const item of section.groups.flatMap((g) => g.items)) {
        const page = pages.get(item.path)!;
        expect(key(page.feature), item.path).toBe(key(item.feature ?? section.feature));
      }
    }
  });

  it("tags each page of a paid extension as the admin map does (D748 E3)", () => {
    const pages = new Map(ADMIN_PAGES.filter((p) => p.area === "store").map((p) => [p.path, p]));
    for (const section of STORE_SECTIONS) {
      for (const item of section.groups.flatMap((g) => g.items)) {
        expect(pages.get(item.path)?.extension, item.path).toBe(item.extension ?? section.extension);
      }
    }
  });

  it("leaves out the pages of an extension the account does not have, and keeps them while it has every one (D748 E3)", () => {
    const launched = { platform: false, launchedAt: "2026-01-01T00:00:00Z", included: ["ab_testing"], rows: [] };
    const paths = (facts: unknown) =>
      storeSections({ features: ["shop", "sales"], extensionFacts: facts }).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.path)));
    const all = paths(null);
    expect(all).toEqual(expect.arrayContaining(["/deals", "/broadcasts", "/experiments", "/support", "/settings/books"]));
    const some = paths(launched);
    expect(some).toContain("/experiments");
    expect(some).not.toEqual(expect.arrayContaining(["/deals"]));
    for (const gone of ["/deals", "/leads", "/broadcasts", "/automations", "/segments", "/support", "/support/widgets", "/settings/books"]) expect(some, gone).not.toContain(gone);
    // The chat assistant is the shop's own, not the support desk's.
    expect(some).toContain("/chat");
  });

  it("puts returns with the orders and their rules with the selling settings (D153)", () => {
    const orders = STORE_SECTIONS.find((s) => s.key === "orders")!;
    expect(orders.groups[0].items.map((i) => i.label).slice(0, 3)).toEqual(["Orders", "Draft orders", "Returns"]);
    const settings = STORE_SECTIONS.find((s) => s.key === "settings")!;
    const selling = settings.groups.find((g) => g.heading === "Selling")!;
    expect(selling.items.map((i) => i.path)).toContain("/settings/returns");
    // A return's own page is inside Orders, and the rules are Settings', not the Orders' address space.
    expect(sectionOf("/returns")?.key).toBe("orders");
    expect(sectionOf("/returns/abc")?.key).toBe("orders");
    expect(sectionOf("/settings/returns")?.key).toBe("settings");
    expect(storeAreas("/admin/s", ALL).find((a) => a.prefixes.includes("/admin/s/returns"))?.groups[0].items.map((i) => i.href)).toContain("/admin/s/returns");
  });

  it("puts draft orders beside the orders and their settings with the selling settings (wave 3, D173)", () => {
    const orders = STORE_SECTIONS.find((s) => s.key === "orders")!;
    expect(orders.groups[0].items.map((i) => i.path).slice(0, 2)).toEqual(["/orders", "/orders/drafts"]);
    const selling = STORE_SECTIONS.find((s) => s.key === "settings")!.groups.find((g) => g.heading === "Selling")!;
    expect(selling.items.map((i) => i.path)).toContain("/settings/orders");
    expect(sectionOf("/orders/drafts")?.key).toBe("orders");
    expect(sectionOf("/orders/drafts/abc")?.key).toBe("orders");
    expect(sectionOf("/orders/packing-slips")?.key).toBe("orders");
    // The settings page is the Settings', not the Orders' address space.
    expect(sectionOf("/settings/orders")?.key).toBe("settings");
  });

  it("puts the leads inbox beside Deals under Customers, behind Deals' feature, at an address of its own (ecosystem plan E2.8, D713)", () => {
    const customers = STORE_SECTIONS.find((s) => s.key === "customers")!;
    const paths = customers.groups.flatMap((g) => g.items.map((i) => i.path));
    expect(paths.indexOf("/leads")).toBe(paths.indexOf("/deals") + 1);
    expect(customers.groups.flatMap((g) => g.items).find((i) => i.path === "/leads")).toMatchObject({ feature: "sales", icon: "user-plus", basic: true });
    expect(sectionOf("/leads")?.key).toBe("customers");
    expect(permissionOfPath("/leads")).toBe("customers:read");
    // Marked as the page being viewed by its own address: a query string on Deals' address never was.
    const sidebar = storeAreas("/admin/s", { features: ["shop", "sales"] }).find((a) => a.prefixes.includes("/admin/s/leads"))!;
    expect(sidebar.groups.flatMap((g) => g.items).find((i) => i.label === "Leads")).toMatchObject({ href: "/admin/s/leads", icon: "user-plus" });
    expect(insideTab("/admin/s", { features: ["shop", "sales"] }, "Customers")).toContain("/admin/s/leads");
    // Without Deals there are no leads to follow up.
    expect(storeSections({ features: ["shop"] }).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.path)))).not.toContain("/leads");
  });

  it("has one Discounts page, whose Automatic tab the old Campaigns address and its offers' pages are inside (ecosystem plan E3.7, D718)", () => {
    const marketing = STORE_SECTIONS.find((s) => s.key === "marketing")!;
    const discounts = marketing.groups.flatMap((g) => g.items).filter((i) => i.path === "/discounts" || i.path === "/campaigns");
    expect(discounts).toEqual([expect.objectContaining({ path: "/discounts", label: "Discounts", basic: true, also: ["/campaigns"] })]);
    for (const path of ["/campaigns", "/campaigns/new", "/campaigns/abc", "/discounts/abc"]) expect(sectionOf(path)?.key, path).toBe("marketing");
    expect(permissionOfPath("/campaigns/abc")).toBe("marketing:read");
    // The sidebar marks Discounts on an offer's page, and Marketing's tab is marked there too.
    const sidebar = storeAreas("/admin/s", ALL).find((a) => a.prefixes.includes("/admin/s/campaigns"))!;
    expect(sidebar.groups.flatMap((g) => g.items).find((i) => i.label === "Discounts")).toMatchObject({ href: "/admin/s/discounts", also: ["/admin/s/campaigns"] });
    expect(insideTab("/admin/s", ALL, "Marketing")).toEqual(expect.arrayContaining(["/admin/s/discounts", "/admin/s/campaigns"]));
  });

  it("finds a page's section by the longest address it is inside", () => {
    expect(sectionOf("/orders/abc/packing-slip")?.key).toBe("orders");
    expect(sectionOf("/settings/design")?.key).toBe("website");
    expect(sectionOf("/settings/company/places/new")?.key).toBe("settings");
    expect(sectionOf("/settings")?.key).toBe("settings");
    expect(sectionOf("/setup/payments")).toBeUndefined();
    expect(sectionOf("/ordersx")).toBeUndefined();
  });
});

describe("what a member's navigation offers (wave 1, 1f)", () => {
  const owner: PermissionHolder = { role: "owner" };
  const admin: PermissionHolder = { role: "admin" };
  const role = (key: keyof typeof ROLE_TEMPLATES): PermissionHolder => ({ role: "admin", permissions: ROLE_TEMPLATES[key].permissions });
  const paths = (holder: PermissionHolder) => storeSections(ALL, (path) => canOpenPath(holder, path)).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.path)));
  const everything = storeSections(ALL).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.path)));

  it("offers the owner every page, as without a filter", () => {
    expect(paths(owner)).toEqual(everything);
  });

  it("offers a default admin everything but the owner's pages: the team, the plan, legal pages, accessibility and the like", () => {
    const hidden = everything.filter((p) => !paths(admin).includes(p));
    expect(hidden).toEqual(expect.arrayContaining(["/billing", "/staff", "/settings/legal", "/settings/accessibility", "/settings/payments", "/settings/returns"]));
    // Features (D178) is read by every member who may read the settings; only owners switch.
    expect(paths(admin)).toContain("/settings/features");
    // The activity log is every member's.
    expect(paths(admin)).toContain("/activity");
    expect(hidden).not.toContain("/orders");
  });

  it("offers a role only the areas it holds, and the activity log to every role", () => {
    expect(paths(role("orders"))).toEqual(expect.arrayContaining(["/orders", "/returns", "/customers", "/products", "/activity"]));
    expect(paths(role("orders"))).not.toContain("/discounts");
    expect(paths(role("orders"))).not.toContain("/settings/shipping");
    expect(paths(role("marketing"))).toContain("/discounts");
    expect(paths(role("marketing"))).not.toContain("/orders/");
    for (const key of Object.keys(ROLE_TEMPLATES) as (keyof typeof ROLE_TEMPLATES)[]) expect(paths(role(key)), key).toContain("/activity");
  });

  it("drops a section with nothing a member can open, from the tabs and the sidebars alike", () => {
    const content = role("content");
    const sections = storeSections(ALL, (path) => canOpenPath(content, path)).map((s) => s.key);
    expect(sections).toContain("website");
    expect(sections).not.toContain("orders");
    expect(sections).not.toContain("analytics");
    const open = (path: string) => canOpenPath(content, path);
    expect(storeTabs("/admin/s", ALL, open).map((t) => t.label)).not.toContain("Orders");
    expect(storeAreas("/admin/s", ALL, open)).toHaveLength(storeSections(ALL, open).length + 1);
  });

  it("offers a read-only member every area to look at, and no owner page", () => {
    const readOnly = paths(role("read_only"));
    expect(readOnly).toEqual(expect.arrayContaining(["/orders", "/products", "/analytics", "/pages", "/settings/shipping", "/activity"]));
    expect(readOnly).not.toContain("/staff");
    expect(readOnly).not.toContain("/billing");
    expect(readOnly).not.toContain("/settings/legal");
  });

  it("lists the new pages: legal pages and accessibility in the settings, the activity log with the team", () => {
    const settings = STORE_SECTIONS.find((s) => s.key === "settings")!;
    expect(settings.groups.find((g) => g.heading === "Selling")!.items.map((i) => i.path)).toContain("/settings/legal");
    expect(settings.groups.find((g) => g.heading === "Site")!.items.map((i) => i.path)).toContain("/settings/accessibility");
    expect(settings.groups.find((g) => g.heading === "Account")!.items.map((i) => i.path)).toEqual(["/billing", "/staff", "/activity"]);
  });
});

describe("the pages' icons and the Basic view (D454)", () => {
  it("gives every page of every level an icon the admin draws", () => {
    const names = new Set<string>(NAV_ICON_NAMES);
    for (const section of STORE_SECTIONS) expect(names.has(section.icon), section.key).toBe(true);
    for (const page of [...items, ...ACCOUNT_ITEMS, ...WEBSITE_ITEMS, ...PLAN_ITEMS, ...SUPPORT_ITEMS, ...SETTINGS_ITEMS]) expect(names.has(page.icon), page.path).toBe(true);
  });

  it("keeps Basic to each section's everyday pages: some in every section, and fewer than half in all", () => {
    let basic = 0;
    for (const section of STORE_SECTIONS) {
      const shown = section.groups.flatMap((g) => g.items).filter((i) => !advancedIn(section, i));
      expect(shown.length, section.key).toBeGreaterThan(0);
      expect(shown.length, section.key).toBeLessThanOrEqual(12);
      basic += shown.length;
    }
    expect(basic).toBeLessThan(items.length / 2);
    const settings = STORE_SECTIONS.find((s) => s.key === "settings")!;
    expect(settings.groups.flatMap((g) => g.items).filter((i) => i.basic).map((i) => i.label)).toEqual([
      "Company",
      "Domains",
      "Countries",
      "Features",
      "Payments",
      "Shipping",
      // One home for what runs by itself (ecosystem plan E3.3, D718).
      "Automatic",
      "Legal pages",
      "Tax",
      "Header and footer",
      "Billing",
      "Team",
    ]);
  });

  it("never leaves out of Basic the page a section's tab leads to, whatever the store has on", () => {
    for (const flags of [ALL, NONE, { features: [] }]) {
      const areas = storeAreas("/admin/s", flags);
      for (const section of storeSections(flags).filter((s) => !s.hub)) {
        const links = areas.flatMap((a) => a.groups.flatMap((g) => g.items));
        const start = links.find((l) => l.href === `/admin/s${section.start}`);
        expect(start, `${section.key} ${flags.features.join(",")}`).toBeDefined();
        expect(start!.advanced, section.key).toBeUndefined();
      }
    }
  });

  it("marks in the sidebar the links Basic leaves out, each with its icon", () => {
    const settings = storeAreas("/admin/s", ALL).find((a) => a.exact?.includes("/admin/s/settings"))!;
    const links = settings.groups.flatMap((g) => g.items);
    expect(links.find((l) => l.label === "Payments")).toMatchObject({ icon: "credit-card" });
    expect(links.find((l) => l.label === "Payments")!.advanced).toBeUndefined();
    expect(links.find((l) => l.label === "Checkout rules")).toMatchObject({ icon: "list-filter", advanced: true });
    for (const link of links) expect(link.icon, link.label).toBeDefined();
  });
});

describe("Kaizena Flow's own store (D466)", () => {
  const paths = (flags: { features: string[]; house?: boolean }) => storeSections(flags).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.path)));

  it("offers every page a website has but the plan and closing, which only a customer's store has", () => {
    const house = paths({ features: ["languages", "sales"], house: true });
    const website = paths({ features: ["languages", "sales"] });
    expect(website.filter((p) => !house.includes(p))).toEqual(["/settings/close", "/billing"]);
    expect(house).toEqual(expect.arrayContaining(["/customers", "/subscribers", "/broadcasts", "/segments", "/deals", "/privacy", "/redirects", "/staging", "/staff"]));
  });
});

describe("the menu's cost (bloat review step 0.17)", () => {
  it("asks once per menu item", () => {
    const asked: string[] = [];
    storeNav("/admin/x", ALL, (path) => {
      asked.push(path);
      return true;
    });
    const expected = STORE_SECTIONS.filter((s) => requirementMet(ALL, s.feature))
      .flatMap((s) => s.groups.flatMap((g) => g.items))
      .filter((i) => requirementMet(ALL, i.feature)).length;
    // 110 asks on 12 November 2026, 220 before.
    expect(asked.length).toBe(expected);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it("the memoised lookup is fast", () => {
    const canOpen = (path: string) => permissionOfPath(path, "read") !== "owner";
    storeNav("/admin/x", ALL, canOpen);
    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i += 1) storeNav("/admin/x", ALL, canOpen);
    // Under 2 ms a build measured locally on 14 November 2026; 125 ms before this step. 20 ms is a margin for a loaded CI runner.
    expect((performance.now() - start) / runs).toBeLessThan(20);
  });

  // The menu of a store with everything on, as JSON, at the base `/admin/s` (docs/rules/budgets.md): 14,757 characters on 19 November 2026,
  // 17,307 before each section's tab stopped repeating its sidebar's addresses (bloat review step 2.28, whose brief gave 14,000 for the menu
  // of 12 November, six pages smaller). Lowered, never raised: a new page adds about 120.
  const MENU_CHARS = 15_000;

  it("sends each address once as a prefix: the menu of a store with everything on stays under its figure (bloat review step 2.28)", () => {
    const base = "/admin/s";
    const tabs = storeTabs(base, ALL);
    const areas = storeAreas(base, ALL);
    const json = JSON.stringify({ tabs, areas });
    expect(json.length).toBeLessThan(MENU_CHARS);
    // Home keeps its own addresses; every section's tab names its sidebar instead, and each sidebar has the key.
    expect(tabs[0]).toMatchObject({ label: "Home", also: HOME_PATHS.map((p) => `${base}${p}`) });
    expect(tabs[0].section).toBeUndefined();
    for (const tab of tabs.slice(1)) {
      expect(tab.also, tab.label).toBeUndefined();
      expect(areas.filter((a) => a.section === tab.section), tab.label).toHaveLength(1);
    }
    expect(areas[0].section).toBe("home");
    // Besides the tabs' own links (a section's tab leads to its main page, also a link in its sidebar), each address is sent at most twice:
    // once as an item's href, once as a prefix.
    const lists = JSON.stringify({ tabs: tabs.map(({ href, ...rest }) => (void href, rest)), areas });
    const addresses = new Set([...json.matchAll(/"(\/admin\/s(?:\/[^"]*)?)"/g)].map((m) => m[1]));
    for (const address of addresses) {
      const times = lists.split(`"${address}"`).length - 1;
      expect(times, address).toBeLessThanOrEqual(2);
    }
  });

  it("storeNav equals the two it replaces, for every role", () => {
    const holders: PermissionHolder[] = [
      { role: "owner" },
      { role: "admin" },
      ...(Object.keys(ROLE_TEMPLATES) as (keyof typeof ROLE_TEMPLATES)[]).map((key): PermissionHolder => ({ role: "admin", permissions: ROLE_TEMPLATES[key].permissions })),
    ];
    const counts = { support: 3 };
    for (const holder of holders) {
      const canOpen = (path: string) => canOpenPath(holder, path);
      const nav = storeNav("/admin/s", ALL, canOpen, counts);
      expect(nav.tabs).toEqual(storeTabs("/admin/s", ALL, canOpen, counts));
      expect(nav.areas).toEqual(storeAreas("/admin/s", ALL, canOpen));
    }
  });

  it("the memo keeps read and write apart", () => {
    for (const page of ADMIN_PAGES.filter((p) => p.area === "store")) {
      const read = permissionOfPath(page.path, "read");
      const write = permissionOfPath(page.path, "write");
      if (read?.endsWith(":read")) expect(write, page.path).toBe(read.replace(/:read$/, ":write"));
      else expect(write, page.path).toBe(read);
    }
  });
});

describe("a standalone account's workspace (D748 E7)", () => {
  const owner: PermissionHolder = { role: "owner" };
  const workspace = (facts: unknown) => ({ features: ["sales"], workspace: true, extensionFacts: facts });
  const sections = (facts: unknown) => storeSections(workspace(facts), (path) => canOpenPath(owner, path, true));
  const paths = (facts: unknown) => sections(facts).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.path)));

  it("offers only its extensions' pages, the people, a few settings and the team: no shop, website, bookings or A/B tests", () => {
    const all = paths(null);
    expect(all).toEqual(expect.arrayContaining(["/deals", "/leads", "/customers", "/broadcasts", "/flows", "/subscribers", "/support", "/chat", "/settings/books", "/analytics/sales"]));
    expect(all).toEqual(expect.arrayContaining(["/settings/company", "/staff", "/activity", "/settings/workflows", "/integrations", "/settings/api", "/settings/ai"]));
    for (const gone of ["/orders", "/products", "/discounts", "/pages", "/media", "/forms", "/experiments", "/bookings", "/settings/payments", "/settings/domains", "/settings/features", "/billing", "/analytics/traffic", "/text-messages"]) {
      expect(all, gone).not.toContain(gone);
    }
    expect(sections(null).map((s) => s.key)).toEqual(["customers", "marketing", "analytics", "support", "settings"]);
  });

  it("follows what the account has: the support desk alone is its inbox, the people and the settings", () => {
    const desk = { platform: false, launchedAt: "2026-01-01T00:00:00Z", included: ["support_desk"], rows: [] };
    const some = paths(desk);
    expect(some).toEqual(expect.arrayContaining(["/support", "/chat", "/customers"]));
    for (const gone of ["/deals", "/broadcasts", "/subscribers", "/segments", "/settings/books", "/analytics/sales"]) expect(some, gone).not.toContain(gone);
    expect(sections(desk).map((s) => s.key)).toEqual(["customers", "support", "settings"]);
  });

  it("opens none of the areas it does not serve, nor the setup wizard, whatever the role holds", () => {
    for (const path of ["/orders", "/products", "/pages", "/bookings", "/setup", "/setup/details"]) expect(canOpenPath(owner, path, true), path).toBe(false);
    for (const path of ["/support", "/deals", "/broadcasts", "/settings/company", "/staff", "/assistant"]) expect(canOpenPath(owner, path, true), path).toBe(true);
    expect(canOpenPath(owner, "/orders")).toBe(true);
  });
});
