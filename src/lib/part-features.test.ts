import { describe, expect, it } from "vitest";

import { allPartFeatureTags, partDrawsWhenOff, partFeature, partFeatureOn } from "./part-features";
import { SHOP_PART_KEYS, shopPartFeature } from "./store-parts";
import { isFeatureId, type FeatureRequirement } from "./store-features";

const ids = (tag: FeatureRequirement): readonly string[] => (typeof tag === "string" ? [tag] : tag);

describe("parts of pages that stand behind a store feature (D178)", () => {
  it("names only real features in every tag", () => {
    const tags = [...allPartFeatureTags(), ...SHOP_PART_KEYS.map(shopPartFeature).filter((tag): tag is FeatureRequirement => tag !== undefined)];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(ids(tag).length).toBeGreaterThan(0);
      for (const id of ids(tag)) expect(isFeatureId(id), id).toBe(true);
    }
  });

  it("tags the bonus credits, the business switch and the business-only notice", () => {
    expect(partFeature({ type: "storePart", part: "cart_credits" })).toBe("bonus");
    expect(partFeature({ type: "storePart", part: "checkout_credits" })).toBe("bonus");
    expect(partFeature({ type: "site", part: "buyerSwitch" })).toBe("business");
    expect(partFeature({ type: "product", part: "notice" })).toBe("business");
    expect(partFeature({ type: "storePart", part: "cookies" })).toBeUndefined();
    expect(partFeature({ type: "richText" })).toBeUndefined();
  });

  it("draws a tagged part only while its feature is on, and every part where the features are unknown", () => {
    const credits = { type: "storePart", part: "cart_credits" };
    expect(partFeatureOn(credits, ["shop"])).toBe(false);
    expect(partFeatureOn(credits, ["shop", "bonus"])).toBe(true);
    // Kept on but asleep: the shop is off.
    expect(partFeatureOn(credits, ["bonus"])).toBe(false);
    expect(partFeatureOn(credits, null)).toBe(true);
    expect(partFeatureOn({ type: "site", part: "logo" }, [])).toBe(true);
  });

  it("tags the Selling group's parts, and keeps a subscription's page drawn for its links (step 3)", () => {
    expect(partFeature({ type: "storePart", part: "subscription" })).toBe("subscriptions");
    expect(partFeature({ type: "storePart", part: "deliveries" })).toBe("boxes");
    expect(partFeature({ type: "product", part: "host" })).toBe("bookings");
    // History of an order stays: its subscription and bookings are shown whatever is switched on now (only the shop's own switch tags them).
    expect(partFeature({ type: "storePart", part: "order_subscription" })).toBe("shop");
    expect(partFeature({ type: "storePart", part: "order_bookings" })).toBe("shop");
    expect(partDrawsWhenOff({ type: "storePart", part: "order_bookings" })).toBe(true);
    expect(partFeatureOn({ type: "storePart", part: "subscription" }, ["shop"])).toBe(false);
    expect(partDrawsWhenOff({ type: "storePart", part: "subscription" })).toBe(true);
    expect(partDrawsWhenOff({ type: "storePart", part: "deliveries" })).toBe(false);
    expect(partDrawsWhenOff({ type: "product", part: "host" })).toBe(false);
  });

  it("tags the online shop's own parts, and keeps what was bought drawn for its links (step 5)", () => {
    const website: string[] = [];
    // The cart, checkout and their pieces, wishlists, category and tag listings draw nothing in a website and leave the palette.
    for (const part of ["cart", "checkout", "wishlist", "category", "tag", "cart_lines", "cart_summary", "checkout_payment", "checkout_terms"]) {
      expect(partFeature({ type: "storePart", part }), part).toBe("shop");
      expect(partFeatureOn({ type: "storePart", part }, website), part).toBe(false);
      expect(partDrawsWhenOff({ type: "storePart", part }), part).toBe(false);
    }
    // An order's page and its pieces, My account and its sign-in serve what a shopper already bought: out of the palette, still drawn.
    for (const part of ["order", "order_lines", "order_documents", "account", "sign_in"]) {
      expect(partFeatureOn({ type: "storePart", part }, website), part).toBe(false);
      expect(partDrawsWhenOff({ type: "storePart", part }), part).toBe(true);
    }
    // The header's and footer's search, account, wishlist and cart; the cookies and withdrawal links are not the shop's tag (the withdrawal
    // link follows after-sale, `sitePartShows()`).
    for (const part of ["search", "account", "wishlist", "cart"]) expect(partFeature({ type: "site", part }), part).toBe("shop");
    for (const part of ["logo", "cookies", "withdrawal", "business", "markets"]) expect(partFeature({ type: "site", part }), part).toBeUndefined();
    // A grid of products and the search component; a grid of pages, articles or the owner's own items stays.
    expect(partFeature({ type: "contentGrid", source: { type: "products" } })).toBe("shop");
    for (const type of ["pages", "articles", "custom"]) expect(partFeature({ type: "contentGrid", source: { type } }), type).toBeUndefined();
    expect(partFeature({ type: "search" })).toBe("shop");
    expect(partFeatureOn({ type: "search" }, ["shop"])).toBe(true);
  });
});
