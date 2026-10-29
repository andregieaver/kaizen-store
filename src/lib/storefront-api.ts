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

/**
 * The routes, for the settings page's list, the published contract (`/developers/storefront-api`) and the tests: each with what it is for
 * and what it answers, in plain words (D398).
 */
export const STOREFRONT_ROUTES = [
  { method: "GET", path: "/products", what: "products", text: "Products as the token's market lists them: `category`, `tag`, `sort` and `limit` (at most 48)." },
  { method: "GET", path: "/products/{handle}", what: "product", text: "One product's page: its variants with their prices, stock and quantity rules." },
  { method: "GET", path: "/categories", what: "categories", text: "The store's product categories and tags." },
  { method: "POST", path: "/cart", what: "cart", text: "What lines kept on your site cost now, without keeping a cart: `{ lines: [{ variantId, quantity }] }`." },
  { method: "POST", path: "/checkout", what: "checkout", text: "Makes a cart of the lines given and answers the one-time address of the store's checkout." },
  { method: "POST", path: "/carts", what: "carts", text: "Makes a cart the store keeps: `{ lines? }`. Answers its key (`cart`), which only you hold: keep it secret." },
  { method: "GET", path: "/carts/{cart}", what: "cart_read", text: "What the cart holds and costs now: each line's price, `available`, `fitted` and status, and a subtotal." },
  { method: "POST", path: "/carts/{cart}/lines", what: "cart_add", text: "Adds units of a variant: `{ variantId, quantity }`, put right by the variant's quantity rule and cut to what is available." },
  { method: "PATCH", path: "/carts/{cart}/lines/{variantId}", what: "cart_set", text: "Sets a line to exactly `{ quantity }`; 0 removes it. A quantity the rule does not allow is refused." },
  { method: "DELETE", path: "/carts/{cart}/lines/{variantId}", what: "cart_remove", text: "Removes a line." },
  { method: "POST", path: "/carts/{cart}/checkout", what: "cart_checkout", text: "Hands the cart to the store's checkout: a one-time address for fifteen minutes. The key opens nothing after this." },
] as const;

/** A kept cart's key (D398): a secret the token holder keeps; the store keeps only its hash. */
export const API_CART_PREFIX = "kfc_";
export const API_CART_LINES_MAX = 50;
export const looksLikeApiCartKey = (value: string): boolean => /^kfc_[A-Za-z0-9_-]{40,48}$/.test(value);

/** The version of the contract (`/developers/storefront-api`); a change that breaks a caller raises it. */
export const STOREFRONT_API_VERSION = "v1";

/** A line added to a kept cart, and a line's quantity set. */
export const cartLineBody = z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(999) });
export const cartQuantityBody = z.object({ quantity: z.number().int().min(0).max(999) });
/** A new kept cart: its first lines, if any. */
export const newCartBody = z.object({
  lines: z
    .array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(999) }))
    .max(50)
    .default([]),
});

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

/** A route's path in OpenAPI's words: `{store}` first, each `{name}` a path parameter. */
const openApiPath = (path: string) => `/{store}${path}`;
const paramsOf = (path: string) => [...`/{store}${path}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/**
 * The storefront API's contract as an OpenAPI 3.1 document (D398), served at `/api/storefront/v1/openapi.json` and made from
 * `STOREFRONT_ROUTES` alone, so the document and the routes cannot drift apart. English, as the API's own words are.
 */
export function storefrontOpenApi(server: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of STOREFRONT_ROUTES) {
    const key = openApiPath(route.path);
    paths[key] ??= {
      parameters: paramsOf(route.path).map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
    };
    paths[key][route.method.toLowerCase()] = {
      operationId: route.what,
      summary: route.text,
      security: [{ storefrontToken: [] }],
      responses: {
        "200": { description: "The answer, as JSON." },
        ...(route.method === "POST" && route.what === "carts" ? { "201": { description: "The new cart, with its key in `cart`." } } : {}),
        "400": { description: "The request could not be read: `{ error: { code, message } }`." },
        "401": { description: "No storefront token of this store in `X-Storefront-Token`." },
        "404": { description: "No such store, market, product or cart." },
        "422": { description: "Nothing changed: the error's `code` says why." },
        "429": { description: "Too many calls; `Retry-After` says when to try again." },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Kaizena Flow storefront API",
      version: STOREFRONT_API_VERSION,
      description:
        "Read a store's catalogue as one of its markets shows it, keep a cart and hand it to the store's own checkout. A token is public by design and opens only what any visitor of its market sees; prices, stock and quantity rules are the storefront's own. Nothing is ordered or paid through this API.",
    },
    servers: [{ url: server }],
    components: { securitySchemes: { storefrontToken: { type: "apiKey", in: "header", name: "X-Storefront-Token" } } },
    paths,
  };
}
