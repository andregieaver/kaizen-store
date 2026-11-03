import { z } from "zod";

import { errorEnvelope, jsonSchemaOf, OPENAPI_DIALECT, parametersOf, pathParams } from "./openapi";

/**
 * The storefront API (wave 9 unit I, D362, `docs/wave-9-platform.md` section 3, I), the pure part: a storefront token's shape (public,
 * meant to sit in a site's own code, so it opens only what any visitor sees), the routes and how their requests are read. The answers are
 * the storefront's own reads (the WordPress plugin's, D169 and D170), so this API works out no price, stock or VAT of its own.
 */

export const STOREFRONT_TOKEN_PREFIX = "kfs_";
export const STOREFRONT_TOKENS_MAX = 10;
export const STOREFRONT_HEADER = "x-storefront-token";

export const looksLikeStorefrontToken = (value: string): boolean => /^kfs_[A-Za-z0-9_-]{32,48}$/.test(value);

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

// ---------------------------------------------------------------------------
// The answers (D438): the storefront's own reads, as `wordpress.ts`, `wordpress-shop.ts` and `api-carts.ts` build them
// ---------------------------------------------------------------------------

const id = z.guid();
const words = z.string();
/** A price written out as the store shows it (`wordpressPrice()`), with its amount for a site that formats it itself. */
export const sfPrice = z.object({
  text: words.describe("The price as the store shows it, such as \"kr 199,00\"."),
  vat_label: words.describe("Whether VAT is included, in the market's language."),
  from_label: words.nullable().describe("\"From\" when the variants differ in price and this is the lowest."),
  prior_label: words.nullable().describe("For a genuine reduction only: the words for the lowest price in the last 30 days."),
  prior_text: words.nullable(),
  unit_text: words.nullable().describe("The unit price, such as \"199,60 kr/kg\", when the product has a content to compare by."),
  amount_minor: z.int(),
  amount_decimal: z.string().describe("The amount as a decimal written as text, such as \"199.00\"."),
  currency: z.string(),
});
const sfMarket = z.object({ slug: z.string(), country: z.string(), name: z.string(), currency: z.string(), language: z.string() });
const sfLabels = z.record(z.string(), z.string()).describe("Words for a cart and a product page in the market's language; {n} stands for a number.");
const sfRule = z.object({ min: z.int(), max: z.int(), step: z.int(), text: z.string().nullable() }).describe("How many at a time: the least, the most and the step.");
const notCartable = z.enum(["booking", "subscription", "business_only", "service"]).nullable().describe("Why it cannot be put in a cart from another site, or null.");
const sfStore = z.object({ slug: z.string(), name: z.string() });

export const sfProductsAnswer = z.object({
  store: sfStore,
  market: sfMarket,
  open: z.boolean(),
  products: z.array(
    z.object({
      id,
      handle: z.string(),
      title: z.string(),
      excerpt: z.string(),
      url: z.string(),
      image: z.object({ url: z.string(), alt: z.string() }).nullable(),
      price: sfPrice,
      cart: z.object({ cartable: z.boolean(), reason: notCartable, variant_id: id.nullable(), variant_count: z.int(), sold_out: z.boolean() }),
    }),
  ),
  shop_url: z.string(),
  labels: sfLabels.optional(),
});

const sfImage = z.object({ url: z.string(), thumbnail: z.string(), alt: z.string() });
export const sfProductAnswer = z.object({
  store: sfStore,
  market: sfMarket,
  open: z.boolean(),
  product: z.object({
    id,
    handle: z.string(),
    title: z.string(),
    description: z.string(),
    seo_title: z.string(),
    seo_description: z.string(),
    url: z.string(),
    images: z.array(sfImage),
    options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
    variants: z.array(
      z.object({
        id,
        sku: z.string(),
        options: z.record(z.string(), z.string()),
        price: sfPrice,
        image: sfImage.nullable(),
        stock: z.object({ level: z.enum(["in_stock", "low", "out"]), max: z.int(), low: z.int().nullable() }),
        backorder_days: z.int().nullable(),
        quantity_rule: sfRule,
      }),
    ),
    cartable: z.boolean(),
    reason: notCartable,
  }),
  labels: sfLabels,
});

export const sfCategoriesAnswer = z.object({
  categories: z.array(z.object({ id, name: z.string(), depth: z.int() })),
  tags: z.array(z.object({ id, name: z.string() })),
});

export const sfQuoteAnswer = z.object({
  market: sfMarket,
  lines: z.array(
    z.object({
      variant_id: id,
      product_id: id,
      handle: z.string(),
      title: z.string(),
      options: z.record(z.string(), z.string()),
      image: z.object({ url: z.string(), alt: z.string() }).nullable(),
      url: z.string(),
      quantity: z.int(),
      status: z.enum(["ok", "insufficient", "quantity", "unavailable"]).describe("ok; insufficient (see available); quantity (the rule allows fitted); unavailable (left out of the subtotal)."),
      available: z.number(),
      fitted: z.int().describe("The quantity counted in the subtotal: the one asked, fitted to the rule and the stock."),
      quantity_rule: sfRule,
      backorder: z.object({ units: z.int(), days: z.int() }).nullable(),
      unit: sfPrice.nullable(),
      line_text: z.string().nullable(),
    }),
  ),
  subtotal_minor: z.int(),
  subtotal_text: z.string(),
  vat_label: z.string(),
  count: z.int(),
  labels: sfLabels,
});

export const sfKeptCartAnswer = sfQuoteAnswer.extend({ cart: z.string().describe("The cart's key (kfc_…): only you hold it. Keep it secret.") });
export const sfCheckoutAnswer = z.object({
  url: z.string().describe("The one-time address of the store's checkout, for fifteen minutes."),
  lines: z.array(z.object({ variant_id: id, quantity: z.int(), outcome: z.string() })),
});
export const sfCartCheckoutAnswer = z.object({ url: z.string().describe("The one-time address of the store's checkout, for fifteen minutes.") });

/**
 * The routes, for the settings page's list, the published contract (`/developers/storefront-api`) and the tests: each with what it is for
 * and what it answers, in plain words (D398), and its query, body and answer as zod with the refusals it can give (D438). A route file under
 * `src/app/api/storefront/v1/[store]` is an entry here (`api-routes.scan.test.ts`).
 */
export const STOREFRONT_ROUTES = [
  {
    method: "GET",
    path: "/products",
    what: "products",
    text: "Products as the token's market lists them: `category`, `tag`, `sort` and `limit` (at most 48).",
    query: productsQuery,
    response: sfProductsAnswer,
    status: 200,
    errors: { 400: ["invalid_request"], 404: ["not_found", "no_such_market"] },
  },
  {
    method: "GET",
    path: "/products/{handle}",
    what: "product",
    text: "One product's page: its variants with their prices, stock and quantity rules.",
    response: sfProductAnswer,
    status: 200,
    errors: { 404: ["not_found", "no_such_product"] },
  },
  { method: "GET", path: "/categories", what: "categories", text: "The store's product categories and tags.", response: sfCategoriesAnswer, status: 200, errors: { 404: ["not_found"] } },
  {
    method: "POST",
    path: "/cart",
    what: "cart",
    text: "What lines kept on your site cost now, without keeping a cart: `{ lines: [{ variantId, quantity }] }`.",
    body: cartBody,
    response: sfQuoteAnswer,
    status: 200,
    errors: { 400: ["invalid_cart"], 404: ["not_found", "no_such_market"] },
  },
  {
    method: "POST",
    path: "/checkout",
    what: "checkout",
    text: "Makes a cart of the lines given and answers the one-time address of the store's checkout.",
    body: cartBody,
    response: sfCheckoutAnswer,
    status: 200,
    errors: { 400: ["invalid_cart"], 404: ["not_found", "no_such_market"], 422: ["nothing_to_buy"] },
  },
  {
    method: "POST",
    path: "/carts",
    what: "carts",
    text: "Makes a cart the store keeps: `{ lines? }`. Answers its key (`cart`), which only you hold: keep it secret.",
    body: newCartBody,
    response: sfKeptCartAnswer,
    status: 201,
    errors: { 400: ["invalid_cart"], 404: ["not_found", "no_such_market"] },
  },
  {
    method: "GET",
    path: "/carts/{cart}",
    what: "cart_read",
    text: "What the cart holds and costs now: each line's price, `available`, `fitted` and status, and a subtotal.",
    response: sfKeptCartAnswer,
    status: 200,
    errors: { 404: ["not_found", "no_such_cart"] },
  },
  {
    method: "POST",
    path: "/carts/{cart}/lines",
    what: "cart_add",
    text: "Adds units of a variant: `{ variantId, quantity }`, put right by the variant's quantity rule and cut to what is available.",
    body: cartLineBody,
    response: sfKeptCartAnswer,
    status: 200,
    errors: { 400: ["invalid_line"], 404: ["not_found"], 422: ["unavailable", "quantity", "too_many_lines"] },
  },
  {
    method: "PATCH",
    path: "/carts/{cart}/lines/{variantId}",
    what: "cart_set",
    text: "Sets a line to exactly `{ quantity }`; 0 removes it. A quantity the rule does not allow is refused.",
    body: cartQuantityBody,
    response: sfKeptCartAnswer,
    status: 200,
    errors: { 400: ["invalid_line"], 404: ["not_found"], 422: ["unavailable", "quantity", "too_many_lines"] },
  },
  {
    method: "DELETE",
    path: "/carts/{cart}/lines/{variantId}",
    what: "cart_remove",
    text: "Removes a line.",
    response: sfKeptCartAnswer,
    status: 200,
    errors: { 400: ["invalid_line"], 404: ["not_found"], 422: ["unavailable", "quantity", "too_many_lines"] },
  },
  {
    method: "POST",
    path: "/carts/{cart}/checkout",
    what: "cart_checkout",
    text: "Hands the cart to the store's checkout: a one-time address for fifteen minutes. The key opens nothing after this.",
    response: sfCartCheckoutAnswer,
    status: 200,
    errors: { 404: ["not_found", "no_such_cart"], 422: ["nothing_to_buy"] },
  },
] as const;

export type StorefrontRoute = (typeof STOREFRONT_ROUTES)[number];

/** The refusals every route can give: no token of the store, the budget spent. A store not open answers 404 `not_found`. */
const COMMON_REFUSALS: Record<number, string[]> = { 401: ["unauthorized"], 429: ["rate_limited"] };
const REFUSAL_WORDS: Record<number, string> = {
  400: "The request could not be read: the error's `code` says which part.",
  401: "No storefront token of this store in `X-Storefront-Token`.",
  404: "No such store (or it is not open, sells nothing or is private), market, product or cart.",
  422: "Nothing changed: the error's `code` says why.",
  429: "Too many calls; `Retry-After` says when to try again.",
};

/** The calls a token may make a minute, and a store's tokens together (`BUDGETS.storefront`). */
export const STOREFRONT_RATE = { perToken: 1200, perStore: 6000 } as const;

/** A route's path in OpenAPI's words: `{store}` first, each `{name}` a path parameter. */
const openApiPath = (path: string) => `/{store}${path}`;

const PATH_WORDS: Record<string, string> = {
  store: "The store, by its slug.",
  handle: "The product's web address after /p/.",
  cart: "The cart's key (kfc_…).",
  variantId: "The variant's id.",
};

/**
 * The storefront API's contract as an OpenAPI 3.1 document (D398), served at `/api/storefront/v1/openapi.json` and made from
 * `STOREFRONT_ROUTES` alone, so the document and the routes cannot drift apart: each route's query, body and answer from its zod (D438).
 * English, as the API's own words are.
 */
export function storefrontOpenApi(server: string, contractVersion?: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of STOREFRONT_ROUTES) {
    const key = openApiPath(route.path);
    paths[key] ??= {
      parameters: pathParams(key).map((name) => ({ name, in: "path", required: true, description: PATH_WORDS[name] ?? name, schema: { type: "string" } })),
    };
    const refusals: Record<number, string[]> = { ...COMMON_REFUSALS };
    for (const [status, codes] of Object.entries(route.errors)) refusals[Number(status)] = [...(refusals[Number(status)] ?? []), ...codes];
    paths[key][route.method.toLowerCase()] = {
      operationId: route.what,
      summary: route.text,
      tags: [route.path.startsWith("/carts") || route.path === "/cart" || route.path === "/checkout" ? "Carts" : "Catalogue"],
      security: [{ storefrontToken: [] }],
      ...("query" in route && { parameters: parametersOf(route.query, "query") }),
      ...("body" in route && { requestBody: { required: true, content: { "application/json": { schema: jsonSchemaOf(route.body) } } } }),
      responses: {
        [String(route.status)]: {
          description: route.status === 201 ? "Made: the new cart, with its key in `cart`." : "The answer.",
          content: { "application/json": { schema: jsonSchemaOf(route.response) } },
        },
        ...Object.fromEntries(
          Object.entries(refusals).map(([status, codes]) => [
            status,
            {
              description: REFUSAL_WORDS[Number(status)],
              ...(status === "429" && { headers: { "Retry-After": { description: "Seconds to wait.", schema: { type: "integer" } } } }),
              content: { "application/json": { schema: errorEnvelope(codes, REFUSAL_WORDS[Number(status)]) } },
            },
          ]),
        ),
      },
    };
  }
  return {
    openapi: "3.1.0",
    jsonSchemaDialect: OPENAPI_DIALECT,
    info: {
      title: "Kaizena Flow storefront API",
      version: STOREFRONT_API_VERSION,
      description:
        "Read a store's catalogue as one of its markets shows it, keep a cart and hand it to the store's own checkout. A token is public by design and opens only what any visitor of its market sees; prices, stock and quantity rules are the storefront's own. Nothing is ordered or paid through this API.",
      ...(contractVersion && { "x-contract-version": contractVersion }),
    },
    servers: [{ url: server }],
    tags: [
      { name: "Catalogue", description: "Products, a product's page and the categories, as the token's market shows them." },
      { name: "Carts", description: "A cart's price now, a cart the store keeps, and the hand-over to the store's own checkout." },
    ],
    "x-rate-limit": { window: "minute", per_token: STOREFRONT_RATE.perToken, per_store: STOREFRONT_RATE.perStore },
    components: {
      securitySchemes: {
        storefrontToken: { type: "apiKey", in: "header", name: "X-Storefront-Token" },
      },
    },
    paths,
  };
}
