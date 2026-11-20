/**
 * The addresses a store's pages and the blog's articles cannot take, kept apart from the page model (`page-content.ts`, which
 * re-exports them) so that the visit endpoint can check a path without loading the block schemas (bloat review step 2.22).
 */

/**
 * Kept in step with the `pages_store_slug_not_reserved` check: a store's own
 * routes inside each of its markets (`/s/{store}/{market}/…`), D53. `blogs`
 * (the store's other blogs, D341) is refused here only, not by the check, so
 * a page a store already has at that address is not refused by the database.
 */
export const RESERVED_STORE_PAGE_SLUGS: readonly string[] = [
  "account",
  "blog",
  "blogs",
  "cart",
  "category",
  "checkout",
  "cookies",
  "deliveries",
  "download",
  "order",
  "p",
  "products",
  "request",
  "returns",
  "search",
  "subscription",
  "tag",
  "unsubscribe",
  "wishlist",
  "withdraw",
];

/**
 * Kept in step with the `pages_article_slug_not_reserved` check: the blog's
 * own routes under `/blog/` (D57), Kaizen's and every store's.
 */
export const RESERVED_ARTICLE_SLUGS: readonly string[] = ["category", "page", "tag"];
