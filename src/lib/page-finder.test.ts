import { describe, expect, it } from "vitest";

import { opensFinder } from "@/components/admin/page-finder";

import { ownerOpens } from "./owner-nav";
import { FINDER_QUERY_MAX, finderAnswer, finderOptions, finderResults } from "./page-finder";

const shop = { features: ["shop" as const] };
const key = (over: Partial<Parameters<typeof opensFinder>[0]>) => ({ key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe("the page finder", () => {
  it("finds a store's pages by what people call them, as links into that store", () => {
    const items = finderResults("store", "shipping", { storeSlug: "shop", flags: shop });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.href.startsWith("/admin/shop"))).toBe(true);
    expect(items.some((item) => item.href === "/admin/shop/settings/shipping")).toBe(true);
  });

  it("leaves out a feature's pages while the feature is off", () => {
    expect(finderResults("store", "shipping", { storeSlug: "shop" }).some((item) => item.href === "/admin/shop/settings/shipping")).toBe(false);
  });

  it("offers only pages without params, so every result opens as it is", () => {
    const items = finderResults("store", "order", { storeSlug: "shop", flags: shop, limit: 20 });
    expect(items.every((item) => !item.href.includes("["))).toBe(true);
  });

  it("finds Advanced pages too: Basic hides links, never pages", () => {
    expect(finderResults("store", "redirects", { storeSlug: "shop" }).some((item) => item.href === "/admin/shop/redirects")).toBe(true);
  });

  it("names pages in Norwegian for a Norwegian admin", () => {
    const items = finderResults("store", "frakt", { storeSlug: "shop", lang: "nb", flags: shop });
    expect(items.length).toBeGreaterThan(0);
  });

  it("offers nothing for nothing, and cuts a long question rather than refusing it", () => {
    expect(finderResults("store", "  ", { storeSlug: "shop" })).toEqual([]);
    expect(() => finderResults("platform", "x".repeat(FINDER_QUERY_MAX * 10))).not.toThrow();
  });

  it("finds the platform's own pages", () => {
    expect(finderResults("platform", "plans").every((item) => item.href.startsWith("/admin"))).toBe(true);
  });

  it("opens on ⌘K or Ctrl+K anywhere, and on / outside a field", () => {
    expect(opensFinder(key({ metaKey: true }), true)).toBe(true);
    expect(opensFinder(key({ ctrlKey: true }), false)).toBe(true);
    expect(opensFinder(key({ key: "/" }), false)).toBe(true);
    expect(opensFinder(key({ key: "/" }), true)).toBe(false);
    expect(opensFinder(key({ metaKey: true, shiftKey: true }), false)).toBe(false);
    expect(opensFinder(key({ key: "j", metaKey: true }), false)).toBe(false);
  });
});

describe("the page finder at the owner's level, and its answer (ecosystem plan E2.2, D713)", () => {
  const owner = { owner: true, work: true, canOpen: (page: { path: string }) => ownerOpens({ owner: true, work: true }, page.path) };
  const staff = { owner: false, work: false, canOpen: (page: { path: string }) => ownerOpens({ owner: false, work: false }, page.path) };

  it("finds the level's own pages, never a store's", () => {
    const items = finderResults("account", "billing", { flags: owner });
    expect(items.some((item) => item.href === "/admin/account/billing")).toBe(true);
    expect(finderResults("account", "orders", { flags: owner, limit: 20 }).every((item) => /^\/admin(\/stores|\/account|$)/.test(item.href))).toBe(true);
  });

  it("offers staff only what their tabs show: no billing, no control center, no Work", () => {
    expect(finderResults("account", "billing", { flags: staff }).some((item) => item.href === "/admin/account/billing")).toBe(false);
    expect(finderResults("account", "control center", { flags: staff }).some((item) => item.href === "/admin")).toBe(false);
    expect(finderResults("account", "invoices hours time", { flags: staff, limit: 20 }).some((item) => item.href.startsWith("/admin/account/work"))).toBe(false);
    expect(finderResults("account", "appearance", { flags: staff }).some((item) => item.href === "/admin/account/appearance")).toBe(true);
  });

  it("puts the pages first and leaves out empty groups; the options run in the order they are drawn", () => {
    const page = { title: "Orders", group: "Main", what: "", href: "/admin/s/orders" };
    const order = { title: "#1001", group: "", what: "", href: "/admin/s/orders/o1" };
    const answer = finderAnswer([page], [{ kind: "order", items: [order] }, { kind: "deal", items: [] }]);
    expect(answer.map((group) => group.kind)).toEqual(["pages", "order"]);
    expect(finderOptions(answer)).toEqual([page, order]);
    expect(finderAnswer([], [{ kind: "order", items: [order] }]).map((group) => group.kind)).toEqual(["order"]);
    expect(finderAnswer([])).toEqual([]);
  });
});
