import { newPageContent, type ContentGridBlock, type PageContent, type PageRow } from "./page-content";
import { newBlock, newRow, type NewId } from "./page-rows";
import type { Messages } from "./i18n";
import { STORE_PART_KEYS, isStorePart, type ShopPart, type StorePart } from "./store-parts";

/**
 * Pages of a store that have a place of their own on its site (D112), built in
 * the page builder like its front page and All products page: one of the
 * store's published pages is chosen for each, and the site's standard page
 * shows until one is. The blog (`/blog`), the search page (`/search`) and the
 * page shown when an address is not found (a real 404); and (D113) the
 * store's working pages, each holding the component that draws it
 * (`STORE_PARTS`): cart, checkout, order confirmation, My account, sign-in,
 * wishlists, a subscription, weekly deliveries and cookies.
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
  { name: "Information", roles: ["cookies"] },
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
    name: "Weekly deliveries page",
    address: "/deliveries",
    standard: "The standard deliveries page",
    hint: "What shoppers see at their weekly deliveries (/deliveries), when you offer them: the standard page, or one of your published pages with the Weekly deliveries component.",
    slug: "deliveries-page",
  },
  cookies: {
    name: "Cookies page",
    address: "/cookies",
    standard: "The standard cookies page",
    hint: "What shoppers see at your cookies page (/cookies): the standard list of what the site sets, or one of your published pages with the Cookies component. Keep the component: the list must stay reachable.",
    slug: "cookie-policy",
  },
};



/**
 * A page to start a role's page from, written in the store's main language
 * and looking like the standard page it replaces: the owner then changes it
 * in the builder. `home` is where a button back to the store leads.
 */
export function starterPage(role: PageRole, m: Messages, id: NewId, home: string): PageContent {
  const heading = (text: string) => {
    const block = newBlock("heading", id);
    return block.type === "heading" ? { ...block, text, level: 1 as const } : block;
  };
  const row = (...blocks: ReturnType<typeof newBlock>[]): PageRow => {
    const r = newRow("1", id);
    r.columns[0].blocks.push(...blocks);
    return r;
  };
  const base = newPageContent();
  const page = (title: string, rows: PageRow[]): PageContent => ({ ...base, title, slug: ROLE_COPY[role].slug, rows });
  const part = (which: ShopPart) => newBlock("storePart", id, which);
  /** A row of columns, each holding these blocks. */
  const columns = (layout: "right-sidebar", ...columnBlocks: ReturnType<typeof newBlock>[][]): PageRow => {
    const r = newRow(layout, id);
    columnBlocks.forEach((blocks, i) => r.columns[i].blocks.push(...blocks));
    return r;
  };
  switch (role) {
    case "blog": {
      const grid = newBlock("contentGrid", id) as ContentGridBlock;
      return page(m.blog, [
        row(heading(m.blog)),
        row({ ...grid, source: { type: "articles" }, limit: 48, show: { ...grid.show, button: false }, emptyText: m.noArticles }),
      ]);
    }
    case "search":
      return page(m.search.title, [row(heading(m.search.title)), row(newBlock("search", id))]);
    case "not_found": {
      const box = newBlock("search", id);
      const button = newBlock("button", id);
      return page(m.notFound, [
        row(
          heading(m.notFound),
          box.type === "search" ? { ...box, results: false } : box,
          button.type === "button" ? { ...button, label: m.toHome, href: home } : button,
        ),
      ]);
    }
    // The working pages (D113): the component brings its own heading where the heading depends on the shopper's state.
    // The cart, checkout and order come in pieces (D117), laid out as the standard pages are.
    case "cart":
      return page(m.cart, [
        row(heading(m.cart)),
        columns("right-sidebar", [part("cart_lines")], [part("cart_summary"), part("cart_code"), part("cart_checkout")]),
      ]);
    case "checkout":
      return page(m.checkoutTitle, [
        row(heading(m.checkoutTitle)),
        columns(
          "right-sidebar",
          [part("checkout_payment"), part("checkout_back")],
          [part("checkout_items"), part("checkout_code"), part("checkout_totals")],
        ),
      ]);
    case "sign_in":
      return page(m.account.title, [row(heading(m.account.title)), row(part("sign_in"))]);
    case "order":
      return page(m.thanks, [
        row(part("order_status")),
        row(part("order_account"), part("order_bookings"), part("order_lines"), part("order_totals")),
        row(part("order_subscription"), part("order_downloads"), part("order_address"), part("order_continue")),
      ]);
    case "account":
      return page(m.account.title, [row(part("account"))]);
    case "wishlist":
      return page(m.wishlist.title, [row(part("wishlist"))]);
    case "subscription":
      return page(m.subscription, [row(part("subscription"))]);
    case "deliveries":
      return page(m.deliveries.title, [row(part("deliveries"))]);
    case "cookies":
      return page(m.cookies, [row(part("cookies"))]);
  }
}

/** The address of a page that is a role's, on a store's market address `base`. */
export const roleAddress = (role: PageRole, base: string) => (ROLE_COPY[role].address ? `${base}${ROLE_COPY[role].address}` : null);

