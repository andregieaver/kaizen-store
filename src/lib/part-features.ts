/**
 * Parts of pages that stand behind a store feature (D178, `docs/store-features.md`): a shop component of the cart or checkout (bonus
 * credits), a header's or footer's part (the business or private switch), a product layout's part (the business-only notice). The tags
 * live with each kind's list (`STORE_PARTS`/`STORE_PIECES` in `src/lib/store-parts.ts`, `SITE_PART_FEATURES` and
 * `PRODUCT_PART_FEATURES` in `src/lib/page-content.ts`); this module reads them for any block. While the feature is off the site draws
 * nothing for the part (`StorePartSection`, `sitePartShows()`, `productPartShows()`), the builder's palette leaves it out, and a page that
 * already holds it shows "Switched off – not shown" on the canvas. A later step tags its own parts the same way.
 */
import { PRODUCT_PART_FEATURES, SITE_PART_FEATURES, type ProductPart, type SitePart } from "./page-content";
import { requirementMet, type FeatureRequirement, type FeatureSource } from "./store-features";
import { shopPartAfterSale, shopPartFeature, type ShopPart } from "./store-parts";

/** A block as far as its part goes: a shop component, a site part or a product part (anything else stands behind no feature). */
type PartBlock = { type: string; part?: unknown };

/** The feature (or features, any of which will do) a block stands behind, or undefined. */
export function partFeature(block: PartBlock): FeatureRequirement | undefined {
  switch (block.type) {
    case "storePart":
      return shopPartFeature(block.part as ShopPart);
    case "site":
      return SITE_PART_FEATURES[block.part as SitePart];
    case "product":
      return PRODUCT_PART_FEATURES[block.part as ProductPart];
    default:
      return undefined;
  }
}

/** Whether a block's feature is on in a store (always, for a block that stands behind none, or where the features are unknown: Kaizen's pages). */
export function partFeatureOn(block: PartBlock, features: FeatureSource | null | undefined): boolean {
  if (!features) return true;
  return requirementMet(features, partFeature(block));
}

/**
 * Whether the site still draws a block while its feature is off (D178): a shop component that serves shoppers' links to what they already
 * have (`afterSale`, a subscription's page). The palette leaves it out all the same.
 */
export function partDrawsWhenOff(block: PartBlock): boolean {
  return block.type === "storePart" && shopPartAfterSale(block.part as ShopPart);
}

/** Every feature tag of every part, for the test that holds them to real feature ids. */
export function allPartFeatureTags(): FeatureRequirement[] {
  return [...Object.values(SITE_PART_FEATURES), ...Object.values(PRODUCT_PART_FEATURES)].filter((tag): tag is FeatureRequirement => tag !== undefined);
}
