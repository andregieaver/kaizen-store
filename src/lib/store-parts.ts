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

/**
 * The pieces of the cart, checkout and order pages (D117): the same working
 * pages, taken apart so an owner can lay them out in the page builder as
 * they like, the way a product's page is (D79). Each belongs to one working
 * page (`route`) and draws only there, with what its address carries; the
 * whole page (`STORE_PARTS`) is still there for a page that wants it all as
 * it always was. Each piece is bare: no frame, so the block's own frame and
 * spacing settings decide how it looks; the whole page frames them itself.
 * A piece with nothing to show (a cart with no lines has no summary) draws
 * nothing.
 */
export const STORE_PIECES = {
  cart_lines: {
    route: "cart",
    name: "Cart items",
    hint: "The lines in the cart with their pictures, quantities, remove buttons and free gifts. An empty cart says so here, with a link back to the store.",
  },
  cart_summary: {
    route: "cart",
    name: "Cart summary",
    hint: "Subtotal, shipping, discounts, VAT and the total, with what a subscription or an appointment adds.",
  },
  cart_code: {
    route: "cart",
    name: "Discount code",
    hint: "The field for a discount code in the cart.",
  },
  cart_credits: {
    route: "cart",
    name: "Bonus credits",
    hint: "Where a signed-in shopper uses their bonus credits, or sees what the order earns; a guest is invited to sign in. Nothing in a store without a bonus program.",
  },
  cart_checkout: {
    route: "cart",
    name: "Checkout button",
    hint: "The button that starts the checkout, with the fields and agreements the cart needs first (a company, contact details, digital goods, a subscription).",
  },
  cart_continue: {
    route: "cart",
    name: "Continue shopping",
    hint: "A link back to the store's front page.",
  },
  checkout_items: {
    route: "checkout",
    name: "Checkout items",
    hint: "The order's lines, as the shopper is about to pay for them.",
  },
  checkout_code: {
    route: "checkout",
    name: "Checkout discount code",
    hint: "The field for a discount code at the checkout.",
  },
  checkout_credits: {
    route: "checkout",
    name: "Checkout bonus credits",
    hint: "Where a signed-in shopper uses their bonus credits at the checkout, or sees what the order earns. Nothing in a store without a bonus program.",
  },
  checkout_totals: {
    route: "checkout",
    name: "Checkout totals",
    hint: "Subtotal, shipping, discounts, VAT and the total, with the company and a subscription's terms.",
  },
  checkout_payment: {
    route: "checkout",
    name: "Payment form",
    hint: "Contact, delivery and payment, and the button to pay. Keep it: it is how the order gets paid.",
  },
  checkout_back: {
    route: "checkout",
    name: "Back to cart",
    hint: "A link back to the cart.",
  },
  order_status: {
    route: "order",
    name: "Thank you",
    hint: "The thank-you heading (or that the order was cancelled), the order number and that the payment is being confirmed. Keep it: it also refreshes the page while the payment is confirmed.",
  },
  order_account: {
    route: "order",
    name: "Account created",
    hint: "What became of the account asked for at checkout: created, with a button to it, or already known, with a way to sign in. Nothing when none was asked for.",
  },
  order_bookings: {
    route: "order",
    name: "Bookings",
    hint: "The order's appointments, stays and rentals, to change or cancel while that is allowed.",
  },
  order_lines: {
    route: "order",
    name: "Order items",
    hint: "The lines the shopper bought.",
  },
  order_totals: {
    route: "order",
    name: "Order totals",
    hint: "Shipping, discounts, the total and its VAT, and the company it was bought for.",
  },
  order_subscription: {
    route: "order",
    name: "Subscription",
    hint: "The subscription the order started, with a link to manage it. Nothing for an order without one.",
  },
  order_downloads: {
    route: "order",
    name: "Downloads",
    hint: "The files bought, to download once the order is paid. Nothing for an order without files.",
  },
  order_address: {
    route: "order",
    name: "Delivery address",
    hint: "Where the order is delivered. Nothing for an order that is not shipped.",
  },
  order_continue: {
    route: "order",
    name: "Continue shopping",
    hint: "A link back to the store's front page.",
  },
} as const satisfies Record<string, { route: StorePart; name: string; hint: string }>;

export type StorePiece = keyof typeof STORE_PIECES;

export const STORE_PIECE_KEYS = Object.keys(STORE_PIECES) as StorePiece[];

export const isStorePiece = (value: unknown): value is StorePiece => typeof value === "string" && Object.hasOwn(STORE_PIECES, value);

/** What a shop component can be: a working page as a whole, or one piece of the cart, checkout or order page. */
export type ShopPart = StorePart | StorePiece;

export const SHOP_PART_KEYS: ShopPart[] = [...STORE_PART_KEYS, ...STORE_PIECE_KEYS];

export const isShopPart = (value: unknown): value is ShopPart => isStorePart(value) || isStorePiece(value);

/** The working page a component draws on: its own for a whole page, the page it is a piece of otherwise. */
export const routeOfPart = (part: ShopPart): StorePart => (isStorePiece(part) ? STORE_PIECES[part].route : part);

/** What the admin calls a component, and what it says it does. */
export const shopPartCopy = (part: ShopPart): { name: string; hint: string } => (isStorePiece(part) ? STORE_PIECES[part] : STORE_PARTS[part]);

/** The pieces of a working page, in the order the standard page draws them. */
export const piecesOf = (route: StorePart): StorePiece[] => STORE_PIECE_KEYS.filter((piece) => STORE_PIECES[piece].route === route);

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

/** The working pages that come in pieces, as the builder groups them. */
export const PIECE_GROUPS: readonly { route: StorePart; name: string; hint: string }[] = [
  { route: "cart", name: "Cart pieces", hint: "The cart page taken apart. They draw on the page chosen for the cart." },
  { route: "checkout", name: "Checkout pieces", hint: "The checkout page taken apart. They draw on the page chosen for the checkout." },
  { route: "order", name: "Order pieces", hint: "The thank-you page taken apart. They draw on the page chosen for the order confirmation." },
];
