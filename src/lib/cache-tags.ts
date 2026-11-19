/**
 * Cache tag names, and nothing else: no import, ever (bloat review step 2.20). A reader or a writer that needs only a tag imports it from
 * here, so it does not load the feature module the tag was born in; those modules re-export their tags from here for their importers.
 * `termsTag` stays in src/server/taxonomy.ts (it takes a type of that file); `redirectsTag` and `contentTag` live in their own src/lib files.
 */

/** Revalidate after a store opens, closes or changes its search settings. */
export const STORES_TAG = "stores";

/** Revalidate after changing a store's name, status, markets or payment switch. */
export const storeTag = (slug: string) => `store:${slug}`;

/**
 * Cache tags. Revalidate a store's catalogue tag after any product or price
 * change in it; `catalog` covers every store.
 */
export const CATALOG_TAG = "catalog";
export const catalogTag = (storeId: string) => `catalog:${storeId}`;

/** Revalidate after one of Kaizen's pages is published, unpublished or deleted. */
export const PAGES_TAG = "platform-pages";
/** The same for an owner: Kaizen's, or a store's. */
export const pagesTag = (owner: string | null) => (owner === null ? PAGES_TAG : `pages:${owner}`);

/** The tag of every cached read of whether Kaizena Flow's site is served from its store (D484): the switch refreshes it. */
export const SITE_STORE_TAG = "site-from-store";

/** Revalidate after a site's scan finishes or its notes change (kept here so `site-cookies.ts`, which re-exports it, and this file share it). */
export const cookiesTag = (storeId: string | null) => `cookies:${storeId ?? "kaizen"}`;

/** Revalidate when a store's program is switched on or off, or its settings change. */
export const affiliateTag = (storeId: string) => `affiliate:${storeId}`;

export const afterSaleTag = (storeId: string) => `after-sale:${storeId}`;

export const fieldsTag = (storeId: string) => `fields:${storeId}`;

/** The cache tag of what owners, the sign-up form and the preview are offered: every change to a profile's details, order or publishing updates it. */
export const DESIGNS_TAG = "design-presets";

/** The cache tag of what owners and the sign-up page are offered: every change to a template's details, order or publishing updates it. */
export const STARTERS_TAG = "store-starters";

export const chatTag = (storeId: string | null) => (storeId ? `chat:${storeId}` : "chat:kaizen");

export const recommendTag = (storeId: string) => `recommend:${storeId}`;

/** Refreshed when a test starts, stops or changes: the pages that show a test's marker are drawn again. */
/**
 * The cache tag of a store's tests. Every storefront read of running tests also asks `commerce.extension_on(store, 'ab_testing')` (D748): while
 * the account does not have A/B testing, visitors see the original; `refreshExtensionFacts()` refreshes this tag with the store's.
 */
export const experimentsTag = (storeId: string) => `experiments:${storeId}`;

export const campaignsTag = (storeId: string) => `campaigns:${storeId}`;

export const textStylesTag = (owner: string | null) => `text-styles:${owner ?? "kaizen"}`;

/** Revalidate after Kaizen's logo, menus or business details change. */
export const PLATFORM_NAVIGATION_TAG = "platform-navigation";
