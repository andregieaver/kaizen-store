import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { HOME_PATHS, STORE_SECTIONS, sectionOf, sectionPaths, storeAreas, storeSections, storeTabs } from "./store-nav";

const ROOT = "src/app/admin/(gated)/[store]";
const ALL = { bookingsOn: true, deliveriesOn: true };
const NONE = { bookingsOn: false, deliveriesOn: false };
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
    const labels = (flags: typeof ALL) => storeSections(flags).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.label)));
    expect(labels(NONE)).not.toContain("Subscription boxes");
    expect(labels(NONE)).not.toContain("Calendar");
    expect(labels({ ...NONE, deliveriesOn: true })).toContain("Subscription boxes");
    expect(labels({ ...NONE, bookingsOn: true })).toContain("Calendar");
    expect(storeAreas("/admin/s", NONE)).toHaveLength(storeSections(NONE).length + 1);
  });

  it("puts returns with the orders and their rules with the selling settings (D153)", () => {
    const orders = STORE_SECTIONS.find((s) => s.key === "orders")!;
    expect(orders.groups[0].items.map((i) => i.label).slice(0, 2)).toEqual(["Orders", "Returns"]);
    const settings = STORE_SECTIONS.find((s) => s.key === "settings")!;
    const selling = settings.groups.find((g) => g.heading === "Selling")!;
    expect(selling.items.map((i) => i.path)).toContain("/settings/returns");
    // A return's own page is inside Orders, and the rules are Settings', not the Orders' address space.
    expect(sectionOf("/returns")?.key).toBe("orders");
    expect(sectionOf("/returns/abc")?.key).toBe("orders");
    expect(sectionOf("/settings/returns")?.key).toBe("settings");
    expect(storeAreas("/admin/s", ALL).find((a) => a.prefixes.includes("/admin/s/returns"))?.groups[0].items.map((i) => i.href)).toContain("/admin/s/returns");
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
