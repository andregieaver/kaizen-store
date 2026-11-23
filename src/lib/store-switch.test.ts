import { describe, expect, it } from "vitest";

import { keptPage } from "./kept-page";
import { canOpenPath, ROLE_TEMPLATES, type PermissionHolder } from "./permissions";
import { FEATURE_IDS } from "./store-features";
import { KEEP_PARAM, switchHref } from "./store-switch";

/**
 * Switching store keeps the page (code review FN12, D873): the switcher's link asks the other store's Home for the page after the store's
 * address, and that Home opens it there when the person can and it is no record, else itself.
 */
describe("the switcher's link to another store", () => {
  it("asks the other store's Home to keep the page you are on", () => {
    expect(switchHref("/admin/a/orders/drafts", "a", "b")).toBe(`/admin/b?${KEEP_PARAM}=%2Forders%2Fdrafts`);
    expect(switchHref("/admin/a/analytics/", "a", "b")).toBe("/admin/b?keep=%2Fanalytics");
  });

  it("leads to Home from Home, from the store you are in, from another level, and from an address that only starts the same way", () => {
    expect(switchHref("/admin/a", "a", "b")).toBe("/admin/b");
    expect(switchHref("/admin/a/orders", "a", "a")).toBe("/admin/a");
    expect(switchHref("/admin/platform/stores", undefined, "b")).toBe("/admin/b");
    expect(switchHref("/admin/ab/orders", "a", "b")).toBe("/admin/b");
    expect(switchHref(`/admin/a/${"x".repeat(300)}`, "a", "b")).toBe("/admin/b");
  });
});

describe("the page another store's Home keeps", () => {
  const all = { features: [...FEATURE_IDS], owner: true };

  it("keeps a page of the map with no record in it, at the map's own address", () => {
    expect(keptPage("b", "/orders/drafts", all)).toBe("/admin/b/orders/drafts");
    expect(keptPage("b", "/analytics", all)).toBe("/admin/b/analytics");
    expect(keptPage("b", "/settings/tax/", all)).toBe("/admin/b/settings/tax");
    expect(keptPage("b", "/orders?status=open", all)).toBe("/admin/b/orders");
  });

  it("opens Home for a record of the other store, Home's own pages, an address of no page, and anything that is no address", () => {
    expect(keptPage("b", "/orders/0b6a3c8e-9a52-4d6f-8a0c-1f2e3d4c5b6a", all)).toBeNull();
    expect(keptPage("b", "/products/0b6a3c8e-9a52-4d6f-8a0c-1f2e3d4c5b6a", all)).toBeNull();
    expect(keptPage("b", "/setup", all)).toBeNull();
    expect(keptPage("b", "/assistant", all)).toBeNull();
    expect(keptPage("b", "/no-such-page", all)).toBeNull();
    expect(keptPage("b", "//elsewhere.example/orders", all)).toBeNull();
    expect(keptPage("b", "https://elsewhere.example/orders", all)).toBeNull();
    expect(keptPage("b", ["/orders"], all)).toBeNull();
    expect(keptPage("b", "", all)).toBeNull();
  });

  it("opens Home where the store has the page off or the person's role does not open it there", () => {
    // A website (the online shop off) has no orders; Subscriptions need their feature.
    expect(keptPage("b", "/orders/drafts", { features: ["sales"] })).toBeNull();
    expect(keptPage("b", "/subscriptions", { features: ["shop"] })).toBeNull();
    // An owner's page (the store's tax) for someone who is not its owner.
    expect(keptPage("b", "/settings/tax", { ...all, owner: false })).toBeNull();
    // A read-only member opens the orders, not the team's page.
    const reader: PermissionHolder = { role: "admin", permissions: ROLE_TEMPLATES.read_only.permissions };
    const canOpen = (page: { area: string; path: string }) => page.area !== "store" || canOpenPath(reader, page.path);
    expect(keptPage("b", "/orders", { ...all, canOpen })).toBe("/admin/b/orders");
    expect(keptPage("b", "/staff", { ...all, canOpen })).toBeNull();
  });
});
