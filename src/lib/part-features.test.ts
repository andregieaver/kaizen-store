import { describe, expect, it } from "vitest";

import { allPartFeatureTags, partFeature, partFeatureOn } from "./part-features";
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
    expect(partFeature({ type: "storePart", part: "cart_lines" })).toBeUndefined();
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
});
