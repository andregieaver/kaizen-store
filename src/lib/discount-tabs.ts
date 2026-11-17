/**
 * The store's Discounts page and its two tabs (ecosystem plan E3.7, D718; code review step 2.4): Codes, the codes shoppers type at
 * checkout (the old Coupons page, at its old address `/discounts`), and Automatic, the offers without a code (the old Campaigns page;
 * `/campaigns` leads here). Codes comes first, so every old address shows what it showed before. Pure.
 */

export const DISCOUNT_TABS = ["codes", "automatic"] as const;
export type DiscountTab = (typeof DISCOUNT_TABS)[number];

/** The tab an address asks for (`?tab=`): Automatic only when named, else Codes. */
export function discountTab(asked: unknown): DiscountTab {
  return asked === "automatic" ? "automatic" : "codes";
}

/** A tab's address in a store: Codes is the page's own address, Automatic adds `?tab=automatic`. */
export function discountTabHref(storeSlug: string, tab: DiscountTab): string {
  return `/admin/${storeSlug}/discounts${tab === "automatic" ? "?tab=automatic" : ""}`;
}
