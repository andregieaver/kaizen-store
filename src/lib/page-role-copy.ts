import { STORE_PART_KEYS, isStorePart, type StorePart } from "./store-parts";


/**
 * Pages of a store that have a place of their own on its site (D112), built in
 * the page builder like its front page and All products page: one of the
 * store's published pages is chosen for each, and the site's standard page
 * shows until one is. The blog (`/blog`), the search page (`/search`) and the
 * page shown when an address is not found (a real 404); and (D113) the
 * store's working pages, each holding the component that draws it
 * (`STORE_PARTS`): cart, checkout, order confirmation, My account, sign-in,
 * wishlists, a subscription, subscription boxes and cookies.
 */
export const PAGE_ROLES = ["blog", "search", "not_found", ...STORE_PART_KEYS] as const;
export type PageRole = (typeof PAGE_ROLES)[number];

export const isPageRole = (value: unknown): value is PageRole => (PAGE_ROLES as readonly unknown[]).includes(value);

/** The working page a role draws with its component, if it is one of them. */
export const partOfRole = (role: PageRole): StorePart | null => (isStorePart(role) ? role : null);

/** How the admin groups the roles. */
export const ROLE_GROUPS: readonly { name: string; roles: readonly PageRole[] }[] = [
  { name: "Content pages", roles: ["blog", "search", "not_found"] },
  { name: "Shopping", roles: ["cart", "checkout", "order"] },
  { name: "Customer account", roles: ["account", "sign_in", "wishlist", "subscription", "deliveries"] },
  { name: "Catalogue", roles: ["category", "tag"] },
  { name: "Information", roles: ["cookies"] },
  { name: "Private mode", roles: ["private"] },
];

export const ROLE_COPY: Record<
  PageRole,
  {
    /** What the admin calls it. */
    name: string;
    /** Where it shows, after the store's market address; empty where it has no fixed address (the 404 page, an order, a subscription). */
    address: string;
    /** What shoppers see until a page is chosen. */
    standard: string;
    hint: string;
    /** The address the page is made at, if it takes its title's. */
    slug: string;
  }
> = {
  blog: {
    name: "Blog page",
    address: "/blog",
    standard: "The standard list of articles",
    hint: "What shoppers see at your blog (/blog): the standard list of articles, or one of your published pages with a content grid of articles. Blog categories and tags keep the standard list.",
    slug: "blog-archive",
  },
  search: {
    name: "Search page",
    address: "/search",
    standard: "The standard search page",
    hint: "What shoppers see when they search (/search): the standard page, or one of your published pages with a Search component, which draws the search box and its results.",
    slug: "search-page",
  },
  not_found: {
    name: "404 page",
    address: "",
    standard: "The standard message",
    hint: "What shoppers see when an address on your store does not exist: a short message, or one of your published pages. It is shown with a 404 status, so search engines know the address is gone. A Search component with only the box helps shoppers find what they wanted.",
    slug: "page-not-found",
  },
  cart: {
    name: "Cart page",
    address: "/cart",
    standard: "The standard cart",
    hint: "What shoppers see at the cart (/cart): the standard page, or one of your published pages with the Cart component, or with its pieces (items, summary, discount code, checkout button) laid out as you like. On phones the cart still slides out over the page.",
    slug: "cart-page",
  },
  checkout: {
    name: "Checkout page",
    address: "/checkout",
    standard: "The standard checkout",
    hint: "What shoppers see when they pay (/checkout): the standard page, or one of your published pages with the Checkout component, which holds the order summary and the payment form, or with its pieces laid out as you like. Keep the payment form: it is how the order gets paid.",
    slug: "checkout-page",
  },
  order: {
    name: "Order confirmation page",
    address: "",
    standard: "The standard confirmation",
    hint: "What shoppers see after paying, and when they open their order from an email: the standard page, or one of your published pages with the Order confirmation component, or with its pieces (thank you, items, totals, downloads, address …) laid out as you like. Its address carries the order, so the page itself has none.",
    slug: "order-confirmation",
  },
  account: {
    name: "My account page",
    address: "/account",
    standard: "The standard My account",
    hint: "What shoppers see at My account (/account): the standard page, or one of your published pages with the My account component. Signed out, the component is the sign-in form, unless you choose a sign-in page.",
    slug: "my-account",
  },
  sign_in: {
    name: "Sign-in page",
    address: "/account",
    standard: "The sign-in form on My account",
    hint: "What shoppers who are not signed in see at My account (/account): the sign-in form on the account page, or one of your published pages with the Sign-in component. Emailed sign-in links keep their own page.",
    slug: "sign-in-page",
  },
  wishlist: {
    name: "Wishlist page",
    address: "/wishlist",
    standard: "The standard wishlists",
    hint: "What shoppers see at their wishlists (/wishlist): the standard page, or one of your published pages with the Wishlists component.",
    slug: "wishlist-page",
  },
  subscription: {
    name: "Subscription page",
    address: "",
    standard: "The standard subscription page",
    hint: "What shoppers see when they open a subscription from an email or My account to pause, skip or cancel it: the standard page, or one of your published pages with the Subscription component. Its address carries a link's secret, so the page itself has none.",
    slug: "subscription-page",
  },
  deliveries: {
    name: "Subscription boxes page",
    address: "/deliveries",
    standard: "The standard subscription boxes page",
    hint: "What shoppers see at their subscription box (/deliveries), when you offer subscription boxes: the standard page, or one of your published pages with the Subscription boxes component.",
    slug: "deliveries-page",
  },
  category: {
    name: "Category pages",
    address: "/category/…",
    standard: "The standard category page",
    hint: "What shoppers see on every category page (/category/…): the standard page, or one of your published pages with the Category products component, which draws the category the shopper is in. Put a content grid that recommends products (or anything else) around it; a grid on this page recommends around the category.",
    slug: "category-page",
  },
  tag: {
    name: "Tag pages",
    address: "/tag/…",
    standard: "The standard tag page",
    hint: "What shoppers see on every tag page (/tag/…): the standard page, or one of your published pages with the Tag products component, which draws the tag the shopper is in. A content grid that recommends products on this page recommends around the tag.",
    slug: "tag-page",
  },
  private: {
    name: "Private mode page",
    address: "",
    standard: "The standard password page",
    hint: "What visitors see while your store is private (Settings, Private mode): the standard page with your store's name and the password field, or one of your published pages with the Password component. Keep the component: it is how visitors with the password get in.",
    slug: "private-page",
  },
  cookies: {
    name: "Cookies page",
    address: "/cookies",
    standard: "The standard cookies page",
    hint: "What shoppers see at your cookies page (/cookies): the standard list of what the site sets, or one of your published pages with the Cookies component. Keep the component: the list must stay reachable.",
    slug: "cookie-policy",
  },
};

/** The address of a page that is a role's, on a store's market address `base`. */
export const roleAddress = (role: PageRole, base: string) => (ROLE_COPY[role].address ? `${base}${ROLE_COPY[role].address}` : null);
