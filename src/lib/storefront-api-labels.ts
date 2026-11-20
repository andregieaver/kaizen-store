/**
 * What each storefront API route is for and what it answers, in plain words (D398), by its `what` (bloat review step 2.50): beside
 * `storefront-api.ts`, whose routes take their text from here, so the admin's `screens` catalogue reads the same words without the routes' zod.
 * Imports nothing.
 */
export const STOREFRONT_ROUTE_TEXT = {
  products: "Products as the token's market lists them: `category`, `tag`, `sort` and `limit` (at most 48).",
  product: "One product's page: its variants with their prices, stock and quantity rules.",
  cart: "What lines kept on your site cost now, without keeping a cart: `{ lines: [{ variantId, quantity }] }`.",
  checkout: "Makes a cart of the lines given and answers the one-time address of the store's checkout.",
  carts: "Makes a cart the store keeps: `{ lines? }`. Answers its key (`cart`), which only you hold: keep it secret.",
  cart_read: "What the cart holds and costs now: each line's price, `available`, `fitted` and status, and a subtotal.",
  cart_add: "Adds units of a variant: `{ variantId, quantity }`, put right by the variant's quantity rule and cut to what is available.",
  cart_set: "Sets a line to exactly `{ quantity }`; 0 removes it. A quantity the rule does not allow is refused.",
  cart_remove: "Removes a line.",
  cart_checkout: "Hands the cart to the store's checkout: a one-time address for fifteen minutes. The key opens nothing after this.",
} as const;
