import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_PAGES, adminMapText, findPages, matchPath, pageHref, pagesFor, type AdminArea } from "./admin-map";
import { MODULES } from "./store-modules";

/** Every page.tsx under a folder, as the route after it (`/orders/[orderId]`). */
function routes(root: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) found.push(...routes(full, `${prefix}/${name}`));
    else if (name === "page.tsx") found.push(prefix);
  }
  return found;
}

const gated = path.join(process.cwd(), "src/app/admin/(gated)");

describe("the admin map (D103)", () => {
  it("lists every page of the store admin, the platform admin and the account pages", () => {
    const listed = (area: AdminArea) => new Set(ADMIN_PAGES.filter((p) => p.area === area).map((p) => p.path));
    const missing = [
      ...routes(path.join(gated, "[store]"))
        .filter((r) => !listed("store").has(r))
        .map((r) => `store ${r || "/"}`),
      ...routes(path.join(gated, "platform"))
        .filter((r) => !listed("platform").has(r))
        .map((r) => `platform ${r || "/"}`),
      ...["", "/stores", "/account", "/account/usage", "/account/billing", "/account/referrals"].filter((r) => !listed("account").has(r)).map((r) => `account ${r || "/"}`),
      // Duplicating a store (D129) lives under the owner's stores.
      ...routes(path.join(gated, "(owner)/stores"), "/stores")
        .filter((r) => !listed("account").has(r))
        .map((r) => `account ${r}`),
      // Work (D123) is the owner's: the combined pages and one store's own screens under it.
      ...routes(path.join(gated, "(owner)/account/work"), "/account/work")
        .filter((r) => !listed("account").has(r))
        .map((r) => `account ${r}`),
    ];
    expect(missing).toEqual([]);
    // And nothing listed that is not a page.
    const pages = new Set([...routes(path.join(gated, "[store]")).map((r) => `store:${r}`), ...routes(path.join(gated, "platform")).map((r) => `platform:${r}`)]);
    const stale = ADMIN_PAGES.filter((p) => p.area !== "account" && !pages.has(`${p.area}:${p.path}`)).map((p) => `${p.area}:${p.path}`);
    expect(stale).toEqual([]);
    const workPages = new Set(routes(path.join(gated, "(owner)/account/work"), "/account/work"));
    expect(ADMIN_PAGES.filter((p) => p.area === "account" && p.group === "Work" && !workPages.has(p.path)).map((p) => p.path)).toEqual([]);
    expect(new Set(ADMIN_PAGES.map((p) => `${p.area}:${p.id}`)).size).toBe(ADMIN_PAGES.length);
  });

  it("finds pages by what people call things", () => {
    expect(findPages("store", "where do I refund an order")[0]?.id).toBe("order");
    expect(findPages("store", "change the colours and fonts")[0]?.id).toBe("design");
    expect(findPages("store", "abandoned cart emails")[0]?.id).toBe("cart-reminders");
    expect(findPages("store", "upload pictures")[0]?.id).toBe("media");
    expect(findPages("platform", "approve sign-ups")[0]?.id).toBe("requests");
    // Pages behind a switch are only offered when it is on.
    expect(findPages("store", "subscription box").map((p) => p.id)).not.toContain("deliveries");
    expect(findPages("store", "subscription box", { deliveries: true })[0]?.id).toBe("deliveries");
  });

  it("knows where withdrawals and returns are worked, and their rules (D153)", () => {
    expect(findPages("store", "a customer withdrew from a purchase and wants a refund")[0]?.id).toBe("returns");
    expect(findPages("store", "who pays return shipping", { owner: true })[0]?.id).toBe("returns.settings");
    // The rules are the owner's.
    expect(findPages("store", "return window", {}).map((p) => p.id)).not.toContain("returns.settings");
    const order = ADMIN_PAGES.find((p) => p.area === "store" && p.id === "return")!;
    expect(pageHref(order, { returnId: "abc-123" }, "kaffe")).toBe("/admin/kaffe/returns/abc-123");
    expect(matchPath("/admin/kaffe/returns/abc-123")).toMatchObject({ page: { id: "return" }, params: { returnId: "abc-123" }, storeSlug: "kaffe" });
    expect(matchPath("/admin/kaffe/returns")?.page.id).toBe("returns");
    expect(matchPath("/admin/kaffe/settings/returns")?.page.id).toBe("returns.settings");
    expect(ADMIN_PAGES.find((p) => p.id === "returns")?.group).toBe("Orders");
    expect(ADMIN_PAGES.find((p) => p.id === "returns.settings")?.group).toBe("Settings");
  });

  it("builds addresses, and reads them back", () => {
    const order = ADMIN_PAGES.find((p) => p.area === "store" && p.id === "order")!;
    expect(pageHref(order, { orderId: "abc-123" }, "kaffe")).toBe("/admin/kaffe/orders/abc-123");
    expect(pageHref(order, {}, "kaffe")).toBeNull();
    expect(pageHref(order, { orderId: "../x" }, "kaffe")).toBeNull();
    expect(matchPath("/admin/kaffe/orders/abc-123?x=1")).toMatchObject({ page: { id: "order" }, params: { orderId: "abc-123" }, storeSlug: "kaffe" });
    expect(matchPath("/admin/kaffe/products/new")?.page.id).toBe("product.new");
    expect(matchPath("/admin/kaffe")?.page.id).toBe("overview");
    expect(matchPath("/admin/platform/stores/kaffe")?.page.id).toBe("store");
    expect(matchPath("/admin/account")?.page.id).toBe("account");
    expect(matchPath("/s/kaffe/no")).toBeNull();
  });

  it("gives the AI a short map of where things are", () => {
    const text = adminMapText("store", { owner: true });
    expect(text).toContain("Orders [orders]");
    expect(text).not.toContain("[order]");
    expect(text).not.toContain("Calendar [bookings]");
    expect(adminMapText("store", { owner: true, bookings: true })).toContain("Calendar [bookings]");
    expect(pagesFor("platform").some((p) => p.area === "store")).toBe(false);
  });

  it("has pages behind every module a store can switch on, offered only when it is on", () => {
    for (const name of MODULES) {
      const pages = ADMIN_PAGES.filter((p) => p.needs === name);
      expect(pages.length, `pages that need ${name}`).toBeGreaterThan(0);
      expect(pagesFor("store").filter((p) => p.needs === name)).toEqual([]);
      expect(pagesFor("store", { [name]: true })).toEqual(expect.arrayContaining(pages.filter((p) => p.area === "store")));
    }
    // Work (D122, D123): at the owner's level, the combined pages and one store's own screens.
    expect(matchPath("/admin/account/work")?.page.id).toBe("work");
    expect(matchPath("/admin/account/work/settings")?.page.id).toBe("work.settings");
    expect(matchPath("/admin/account/work/s/kaffe/settings")).toMatchObject({ page: { id: "work.store.settings" }, storeSlug: "kaffe" });
    expect(matchPath("/admin/account/work/s/kaffe/invoices/abc")).toMatchObject({ page: { id: "work.invoice" }, params: { invoiceId: "abc" }, storeSlug: "kaffe" });
    const store = ADMIN_PAGES.find((p) => p.id === "work.store.clients")!;
    expect(pageHref(store, {}, "kaffe")).toBe("/admin/account/work/s/kaffe/clients");
    expect(pageHref(store, { store: "acme" })).toBe("/admin/account/work/s/acme/clients");
    expect(findPages("store", "log my hours with a timer").map((p) => p.id)).not.toContain("work.time");
    expect(findPages("store", "log my hours with a timer", { work: true })[0]?.id).toBe("work.time");
    expect(findPages("store", "invoice number prefix", { work: true })[0]?.id).toBe("work.store.settings");
    expect(findPages("store", "which invoices are overdue", { work: true })[0]?.id).toBe("work.invoices");
    // Where Work is switched on is always offered, or nobody could find the switch.
    expect(findPages("store", "switch on work").map((p) => p.id)).toContain("work.settings");
    expect(adminMapText("store", { owner: true })).not.toContain("[work.invoices]");
    expect(adminMapText("store", { owner: true, work: true })).toContain("Work invoices [work.invoices]");
  });
});
