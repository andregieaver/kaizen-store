import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ROLE_TEMPLATES, canOpenPath, type PermissionHolder } from "./permissions";
import { AFTER_SALE_ADMIN_PATHS, FEATURE_IDS, isAfterSaleAdminPath, type FeatureRequirement } from "./store-features";
import { HOME_PATHS, STORE_SECTIONS, sectionOf, sectionPaths, storeAreas, storeSections, storeTabs } from "./store-nav";

const ROOT = "src/app/admin/(gated)/[store]";
const ALL = { features: [...FEATURE_IDS] };
const NONE = { features: ["shop"] };
/** Folders that are not a section's page: the layout's own, and routes with no page of their own. */
const SKIPPED = new Set(["setup", "assistant"]);

const items = STORE_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items));

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
    expect(tabs.map((t) => t.label)).toEqual(["Home", "Orders", "Products", "Customers", "Marketing", "Analytics", "Website", "Bookings", "Settings"]);
    expect(tabs[0]).toMatchObject({ href: "/admin/s", exact: true, icon: "home" });
    const settings = tabs.find((t) => t.label === "Settings")!;
    expect(settings).toMatchObject({ href: "/admin/s/settings", exact: true });
    // The Design page is in Settings' address space, but the Website's: its tab is not marked as Settings'.
    expect(settings.also).not.toContain("/admin/s/settings/design");
    // Nor its own address: below it would take every settings page, Design included.
    expect(settings.also).not.toContain("/admin/s/settings");
    expect(tabs.find((t) => t.label === "Website")!.also).toContain("/admin/s/settings/design");
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
    expect(tabs.map((t) => t.label)).toEqual(["Home", "Products", "Customers", "Marketing", "Analytics", "Website", "Settings"]);
    // Orders is not in the menu (reached from Home while an order can still be withdrawn from or returned).
    expect(tabs.map((t) => t.href)).not.toContain("/admin/s/orders");
    // A section whose main page is hidden opens on the first page it has left.
    const href = (label: string) => tabs.find((t) => t.label === label)!.href;
    expect(href("Products")).toBe("/admin/s/fields");
    expect(href("Customers")).toBe("/admin/s/privacy");
    expect(href("Marketing")).toBe("/admin/s/experiments");
    expect(href("Analytics")).toBe("/admin/s/analytics/traffic");
    expect(storeTabs("/admin/s", NONE).find((t) => t.label === "Products")!.href).toBe("/admin/s/products");
    const paths = storeSections(website).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.path)));
    for (const path of ["/products", "/inventory", "/product-layouts", "/customers", "/customer-groups", "/wishlists", "/campaigns", "/discounts", "/recommendations", "/cart-reminders", "/analytics", "/analytics/finance", "/analytics/tax", "/settings/payments", "/settings/shipping", "/settings/orders", "/settings/returns", "/settings/tax", "/settings/invoices", "/search"]) {
      expect(paths, path).not.toContain(path);
    }
    for (const path of ["/fields", "/privacy", "/experiments", "/analytics/traffic", "/analytics/settings", "/pages", "/settings/legal", "/settings/features", "/integrations", "/chat"]) {
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
    expect(paths(role("orders"))).not.toContain("/campaigns");
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
