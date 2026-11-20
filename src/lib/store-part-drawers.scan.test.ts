import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SHOP_PART_KEYS, STORE_PART_KEYS, drawsOn, type StorePart } from "./store-parts";

/**
 * Each working route draws its shop components through a parts module of its own on one frame (`storePartDrawer()`,
 * `src/components/store-part-frame.tsx`, bloat review step 2.9), so a listing no longer carries the cart's, checkout's and account's
 * forms. The frame imports no section and `RolePage` no parts module; each working page hands its own to every `RolePage` it draws.
 * These tests fail when a part has no case in the parts module of a route it draws on, or a page is left without its parts.
 */
const SRC = join(process.cwd(), "src");
const SHOP = "app/s/[store]/[market]/(shop)";
const PRIVATE = "app/s/[store]/private/[market]";
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

/** The parts module of each working route; typed by `StorePart`, so a new working page without one fails the type check too. */
const PARTS_FILES: Record<StorePart, string> = {
  cart: `${SHOP}/cart/cart-parts.tsx`,
  checkout: `${SHOP}/checkout/checkout-parts.tsx`,
  order: `${SHOP}/order/[orderId]/order-parts.tsx`,
  account: `${SHOP}/account/account-parts.tsx`,
  sign_in: `${SHOP}/account/account-parts.tsx`,
  wishlist: `${SHOP}/wishlist/wishlist-parts.tsx`,
  subscription: `${SHOP}/subscription/[token]/subscription-parts.tsx`,
  deliveries: `${SHOP}/deliveries/deliveries-parts.tsx`,
  cookies: `${SHOP}/cookies/cookies-parts.tsx`,
  private: `${PRIVATE}/private-parts.tsx`,
  category: `${SHOP}/term-parts.tsx`,
  tag: `${SHOP}/term-parts.tsx`,
};

/** Each page that draws a working route, with the parts module's export it hands `RolePage`. */
const PAGES: Record<string, string> = {
  [`${SHOP}/cart/page.tsx`]: "cartParts",
  [`${SHOP}/checkout/page.tsx`]: "checkoutParts",
  [`${SHOP}/order/[orderId]/page.tsx`]: "orderParts",
  [`${SHOP}/account/page.tsx`]: "accountParts",
  [`${SHOP}/wishlist/page.tsx`]: "wishlistParts",
  [`${SHOP}/subscription/[token]/page.tsx`]: "subscriptionParts",
  [`${SHOP}/deliveries/page.tsx`]: "deliveriesParts",
  [`${SHOP}/cookies/page.tsx`]: "cookiesParts",
  [`${PRIVATE}/page.tsx`]: "privateParts",
  [`${SHOP}/term-listing.tsx`]: "termParts",
};

const importsOf = (text: string) => [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s+[^;]*?\s+from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]);

describe("each working route's parts module", () => {
  it("is named for every working route", () => {
    expect(STORE_PART_KEYS.filter((route) => !Object.hasOwn(PARTS_FILES, route))).toEqual([]);
  });

  it("has a case for every shop part that draws on its route", () => {
    const missing: string[] = [];
    for (const part of SHOP_PART_KEYS)
      for (const route of STORE_PART_KEYS) {
        if (!drawsOn(part, route)) continue;
        if (!read(PARTS_FILES[route]).includes(`case "${part}":`)) missing.push(`${part} on ${route} (${PARTS_FILES[route]})`);
      }
    expect(missing).toEqual([]);
  });

  it("the frame imports no section", () => {
    const sections = importsOf(read("components/store-part-frame.tsx")).filter(
      (path) => path.includes("/app/s/") || /(-section|cart-contents|cart-upsell|shop-notes)$/.test(path),
    );
    expect(sections).toEqual([]);
  });

  it("RolePage imports no section and no parts module", () => {
    const partsModules = new Set(Object.values(PARTS_FILES).map((file) => file.split("/").pop()!.replace(/\.tsx$/, "")));
    const imports = importsOf(read("components/role-page.tsx"));
    // The old switch of every route's sections ended in `-section` too.
    expect(imports.filter((path) => /-section$/.test(path) || partsModules.has(path.split("/").pop()!) || path.includes("/app/s/"))).toEqual([]);
  });

  it("every working page hands RolePage its parts", () => {
    for (const [page, name] of Object.entries(PAGES)) {
      const text = read(page);
      const pages = text.match(/<RolePage\b/g)?.length ?? 0;
      expect(pages, page).toBeGreaterThanOrEqual(1);
      expect(text.split(`storePart={${name}}`).length - 1, page).toBe(pages);
    }
    expect(read(`${SHOP}/search/page.tsx`)).not.toContain("storePart=");
  });
});
