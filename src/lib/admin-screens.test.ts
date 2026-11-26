import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { adminScreenKey, isMeasuredScreen, MEASURED, NEVER_MEASURED } from "./admin-screens";

const { storeSections: MEASURED_STORE_SECTIONS, subscreens: MEASURED_SUBSCREENS, accountScreens: MEASURED_ACCOUNT_SCREENS } = MEASURED;

const ROOT = join(process.cwd(), "src/app/admin/(gated)");
const dirs = (dir: string) => readdirSync(join(ROOT, dir)).filter((name) => statSync(join(ROOT, dir, name)).isDirectory());

describe("the admin's screens as owners' own heatmaps and recordings name them (D895 phase 3b)", () => {
  it("names a screen by its shape, never by a store, an id or a slug", () => {
    expect(adminScreenKey("/admin")).toBe("a");
    expect(adminScreenKey("/admin/stores")).toBe("a/stores");
    expect(adminScreenKey("/admin/account")).toBe("a/account");
    expect(adminScreenKey("/admin/account/billing")).toBe("a/billing");
    expect(adminScreenKey("/admin/my-shop")).toBe("s");
    expect(adminScreenKey("/admin/my-shop/products")).toBe("s/products");
    expect(adminScreenKey("/admin/my-shop/products/new")).toBe("s/products/new");
    expect(adminScreenKey("/admin/my-shop/products/3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c")).toBe("s/products/detail");
    expect(adminScreenKey("/admin/my-shop/pages/about-us/edit")).toBe("s/pages/detail");
    expect(adminScreenKey("/admin/my-shop/settings/payments?tab=x")).toBe("s/settings/payments");
    for (const path of ["/admin/my-shop/products/new", "/admin/my-shop/pages/about-us"]) expect(adminScreenKey(path)).not.toContain("my-shop");
  });

  it("never measures shoppers' data, conversations, documents, the recordings player or the platform's own screens", () => {
    for (const path of [
      "/admin/shop/orders",
      "/admin/shop/orders/123",
      "/admin/shop/customers/abc",
      "/admin/shop/support",
      "/admin/shop/chat",
      "/admin/shop/assistant",
      "/admin/shop/campaigns/x",
      "/admin/shop/invoices",
      "/admin/shop/analytics/recordings",
      "/admin/shop/analytics/recordings/abc",
      "/admin/shop/analytics/customers",
      "/admin/shop/settings/private",
      "/admin/shop/settings/payments/extra",
      "/admin/shop/somewhere-new",
      "/admin/account/support",
      "/admin/account/kaizen-support",
      "/admin/account/domains/example.com",
      "/admin/platform",
      "/admin/platform/incidents",
      "/admin/legal/admin-use",
      "/admin/hosting/x",
      "/shop",
    ])
      expect(adminScreenKey(path), path).toBeNull();
  });

  it("accepts on the server exactly the keys the browser can make", () => {
    for (const key of ["a", "a/stores", "a/account", "a/billing", "s", "s/products", "s/products/new", "s/products/detail", "s/settings/tax"]) expect(isMeasuredScreen(key), key).toBe(true);
    for (const key of ["s/orders", "s/orders/detail", "s/settings/detail", "s/analytics/recordings", "a/support", "a/billing/x", "s/x", "/s/products", "s/products/MY-SHOP", "", "p"])
      expect(isMeasuredScreen(key), key).toBe(false);
  });

  it("lists only screens that exist, and keeps the never-measured ones off the list", () => {
    const sections = dirs("[store]");
    for (const section of MEASURED_STORE_SECTIONS) {
      expect(sections, section).toContain(section);
      for (const sub of MEASURED_SUBSCREENS[section]) expect(existsSync(join(ROOT, "[store]", section, sub)), `${section}/${sub}`).toBe(true);
    }
    const account = dirs("(owner)/account");
    for (const screen of MEASURED_ACCOUNT_SCREENS.filter(Boolean)) expect(account, screen).toContain(screen);
    for (const never of NEVER_MEASURED) {
      const [section, sub] = never.split("/");
      if (section === "account") expect(MEASURED_ACCOUNT_SCREENS).not.toContain(sub);
      else if (sub) expect(MEASURED_SUBSCREENS[section] ?? []).not.toContain(sub);
      else expect(MEASURED_STORE_SECTIONS).not.toContain(section);
    }
  });

  it("names every settings and analytics screen that is measured, so a new one stays quiet until it is decided", () => {
    for (const section of ["settings", "analytics"]) {
      const real = dirs(`[store]/${section}`).filter((d) => !d.startsWith("["));
      const listed = new Set(MEASURED_SUBSCREENS[section]);
      const decided = real.filter((d) => listed.has(d) || (NEVER_MEASURED as readonly string[]).includes(`${section}/${d}`) || d === "private");
      expect(decided.length, section).toBeGreaterThan(0);
      for (const sub of listed) expect(real, `${section}/${sub}`).toContain(sub);
    }
  });
});
