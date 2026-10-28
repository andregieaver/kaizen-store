import { z } from "zod";

/**
 * The storefront API (wave 9 unit I, D362, `docs/wave-9-platform.md` section 3, I), the pure part: a storefront token's shape (public,
 * meant to sit in a site's own code, so it opens only what any visitor sees), the routes and how their requests are read. The answers are
 * the storefront's own reads (the WordPress plugin's, D169 and D170), so this API works out no price, stock or VAT of its own.
 */

export const STOREFRONT_TOKEN_PREFIX = "kfs_";
export const STOREFRONT_TOKENS_MAX = 10;
export const STOREFRONT_HEADER = "x-storefront-token";

export const looksLikeStorefrontToken = (value: string): boolean => /^kfs_[A-Za-z0-9_-]{32,48}$/.test(value);

/** The routes, for the settings page's list and the tests. */
export const STOREFRONT_ROUTES = [
  { method: "GET", path: "/products", what: "products" },
  { method: "GET", path: "/products/{handle}", what: "product" },
  { method: "GET", path: "/categories", what: "categories" },
  { method: "POST", path: "/cart", what: "cart" },
  { method: "POST", path: "/checkout", what: "checkout" },
] as const;

/** Products listed: from the whole catalogue, a category or a tag, sorted, at most 48 a call. */
export const productsQuery = z.object({
  category: z.string().uuid().optional(),
  tag: z.string().uuid().optional(),
  sort: z.enum(["newest", "oldest", "title", "priceLow", "priceHigh"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});
export type ProductsQuery = z.infer<typeof productsQuery>;

/** A cart as the site keeps it: variants and quantities, at most 50 lines. */
export const cartBody = z.object({
  lines: z
    .array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(999) }))
    .min(1)
    .max(50),
});
export type CartBody = z.infer<typeof cartBody>;

export const isHandle = (value: string): boolean => /^[a-z0-9][a-z0-9-]{0,199}$/.test(value);
