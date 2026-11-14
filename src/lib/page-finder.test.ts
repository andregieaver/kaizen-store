import { describe, expect, it } from "vitest";

import { opensFinder } from "@/components/admin/page-finder";

import { FINDER_QUERY_MAX, finderResults } from "./page-finder";

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
