/**
 * The working pages of a store's site that a page built in the page builder
 * can stand in for (D113): each has a component that draws it, and a page
 * chosen for its role (`src/lib/page-roles.ts`) holds that component. They
 * draw only on their own route, with what its address carries (the order in
 * the address, the link's secret): elsewhere they draw nothing, so a cart
 * component on the About page does no harm.
 */
export const STORE_PARTS = {
  cart: {
    name: "Cart",
    hint: "The shopper's cart: its lines, quantities, discount code and the checkout button.",
  },
  checkout: {
    name: "Checkout",
    hint: "The order summary and the payment form. Without an order to pay, shoppers are sent back to the cart.",
  },
  order: {
    name: "Order confirmation",
    hint: "What the shopper sees after paying: the order, its downloads, bookings and subscription. Its address carries the order.",
  },
  account: {
    name: "My account",
    hint: "The signed-in shopper's orders, subscriptions and details. Signed out, it is the sign-in form.",
  },
  sign_in: {
    name: "Sign-in",
    hint: "The form for signing in or creating an account, shown at My account to shoppers who are not signed in.",
  },
  wishlist: {
    name: "Wishlists",
    hint: "The shopper's wishlists, ready for the cart.",
  },
  subscription: {
    name: "Subscription",
    hint: "One subscription to pause, skip or cancel. Its address carries a link's secret, from emails and My account.",
  },
  deliveries: {
    name: "Weekly deliveries",
    hint: "The shopper's list for the store's weekly deliveries, when that is switched on.",
  },
  cookies: {
    name: "Cookies",
    hint: "What the site sets in the browser, and the shopper's choices.",
  },
} as const;

export type StorePart = keyof typeof STORE_PARTS;

export const STORE_PART_KEYS = Object.keys(STORE_PARTS) as StorePart[];

export const isStorePart = (value: unknown): value is StorePart => typeof value === "string" && Object.hasOwn(STORE_PARTS, value);

/** What an address carries into a store's page (D113): its query, as `searchParams` gives it. */
export type StoreQuery = Record<string, string | string[] | undefined>;

/**
 * The working route a page stands in for: which component may draw, and what
 * the address carries: an order's id, a subscription link's secret, the query.
 */
export type StoreRoute = {
  part: StorePart;
  /** The address's own part: the order in `/order/{id}`, the secret in `/subscription/{token}`. */
  param?: string;
  query?: Promise<StoreQuery>;
};
