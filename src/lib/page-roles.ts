import { newPageContent, type ContentGridBlock, type PageContent, type PageRow } from "./page-content";
import { newBlock, newRow, type NewId } from "./page-rows";
import type { Messages } from "./i18n";
import { ROLE_COPY, type PageRole } from "./page-role-copy";
import type { ShopPart } from "./store-parts";

export { PAGE_ROLES, isPageRole, partOfRole, ROLE_GROUPS, ROLE_COPY, roleAddress, type PageRole } from "./page-role-copy";

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
        columns("right-sidebar", [part("cart_lines"), part("cart_gift")], [part("cart_summary"), part("cart_code"), part("cart_credits"), part("cart_checkout")]),
      ]);
    case "checkout":
      return page(m.checkoutTitle, [
        row(heading(m.checkoutTitle)),
        columns(
          "right-sidebar",
          [part("checkout_delivery"), part("checkout_terms"), part("checkout_payment"), part("checkout_back")],
          [part("checkout_items"), part("checkout_code"), part("checkout_credits"), part("checkout_totals")],
        ),
      ]);
    case "sign_in":
      return page(m.account.title, [row(heading(m.account.title)), row(part("sign_in"))]);
    case "order":
      return page(m.thanks, [
        row(part("order_status")),
        row(part("order_account"), part("order_bookings"), part("order_parcels"), part("order_lines"), part("order_totals"), part("order_documents")),
        row(part("order_subscription"), part("order_downloads"), part("order_address"), part("order_terms"), part("order_continue")),
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
    // The part draws the store's name, a line and the password field (D339).
    case "private":
      return page(m.privateStore.title, [row(part("private"))]);
    // The part draws the category's or tag's own name as the page's heading, as the standard page does.
    case "category":
      return page(m.catalogue.category, [row(part("category"))]);
    case "tag":
      return page(m.catalogue.tag, [row(part("tag"))]);
  }
}
