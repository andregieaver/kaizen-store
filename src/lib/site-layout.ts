import {
  blockShowsUnbound,
  newPageContent,
  sitePartsFor,
  type PageBlock,
  type PageColumn,
  type PageContent,
  type PageRow,
  type PageType,
  type HeaderOverlay,
  type MenuBlock,
  type SiteBlock,
  type SitePart,
} from "./page-content";
import { SIZES } from "./breakpoints";
import { flowRows } from "./page-modal";
import { SIDE_BY_SIDE_GAP, hiddenAt } from "./responsive";

/**
 * Headers and footers (D80): a site's top and bottom built in the page
 * builder, with site components (`SiteBlock`) where its logo, tools and
 * details go, and menu components (`MenuBlock`, D85) for its menus. Until one is chosen a site shows its standard header and
 * footer; a new one starts from these, which look much the same.
 */

const part = (id: string, name: SitePart, extra: Partial<SiteBlock> = {}): SiteBlock => ({ id, type: "site", part: name, ...extra });
/** A menu component (D85) showing `menuId`, if the site has one to show. */
const menu = (id: string, menuId: string | null, extra: Partial<MenuBlock> = {}): MenuBlock => ({
  id,
  type: "menu",
  ...(menuId && { menuId }),
  ...extra,
});
const sides = (vertical: number, horizontal: number) => ({ top: vertical, right: horizontal, bottom: vertical, left: horizontal });

/** The menus a site's standard header and footer show (D85), which a new header or footer starts with. */
export type StandardMenus = { header: string | null; footer: string | null };

/** Left out on phones, where the phone's menu has it (D179: hidden at Small). */
const PHONES_HIDDEN = { visibility: { hideAt: ["sm" as const] } };

/** A header: the logo (after the phone's menu button), the menu, then the site's tools, on one line on phones too. */
export function defaultHeader(storeId: string | null, menus: StandardMenus = { header: null, footer: null }): PageContent {
  const tools: SiteBlock[] =
    storeId === null
      ? [part("header-account", "account"), part("header-sign-up", "signUp", PHONES_HIDDEN)]
      : [
          part("header-markets", "markets", PHONES_HIDDEN),
          part("header-search", "search"),
          part("header-account", "account", PHONES_HIDDEN),
          part("header-wishlist", "wishlist"),
          part("header-cart", "cart"),
        ];
  const row: PageRow = {
    id: "header-row",
    type: "row",
    layout: "fit-sides",
    // On one line at every size (D80), closer together on phones (D179).
    stack: false,
    at: { sm: { gap: SIDE_BY_SIDE_GAP } },
    align: "middle",
    style: { padding: sides(10, 16) },
    columns: [
      { id: "header-brand", inline: true, blocks: [part("header-menu-button", "menuButton"), part("header-logo", "logo")] },
      { id: "header-nav", blocks: [menu("header-menu", menus.header, PHONES_HIDDEN)] },
      { id: "header-tools", inline: true, justify: "end", blocks: tools },
    ],
  };
  return { ...newPageContent(), title: "Header", slug: "header", rows: [row] };
}

/** A footer: who runs the site, the cookies link and (a store's) the withdrawal link, the footer menu, and a store's countries. */
export function defaultFooter(storeId: string | null, menus: StandardMenus = { header: null, footer: null }): PageContent {
  const columns: PageColumn[] = [
    {
      id: "footer-about",
      blocks: [
        part("footer-logo", "logo"),
        part("footer-business", "business"),
        part("footer-cookies", "cookies"),
        // The withdrawal function is always reachable (EU Directive 2023/2673, D153): a store's footer holds its link.
        ...(storeId !== null ? [part("footer-withdrawal", "withdrawal")] : []),
      ],
    },
    { id: "footer-menu", blocks: [menu("footer-links", menus.footer, { direction: "column" })] },
  ];
  if (storeId !== null) {
    columns.push({ id: "footer-markets", blocks: [part("footer-countries", "markets", { display: "list", direction: "column" })] });
  }
  const row: PageRow = {
    id: "footer-row",
    type: "row",
    layout: storeId === null ? "2" : "3",
    style: { padding: sides(40, 16) },
    columns,
  };
  return { ...newPageContent(), title: "Footer", slug: "footer", rows: [row] };
}

/** Whether a block is a part of a site's header or footer, which only headers and footers hold. */
export const isSiteBlock = (block: PageBlock): block is SiteBlock => block.type === "site";

/** The site components a page holds; a page that is not a header or footer must hold none. */
export const siteBlocks = (content: Pick<PageContent, "rows">): SiteBlock[] =>
  content.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks.filter(isSiteBlock)));

/**
 * What a footer must show on every page (who runs the site, by e-commerce law; the cookie choices, D58; and in a store the
 * link to the withdrawal function, which the law asks to be always accessible, D153).
 */
export const FOOTER_REQUIRED: readonly SitePart[] = ["business", "cookies"];
export const footerRequired = (storeId: string | null): readonly SitePart[] => (storeId === null ? FOOTER_REQUIRED : [...FOOTER_REQUIRED, "withdrawal"]);

/**
 * Whether a footer's withdrawal link is there for everyone: a component of the part, in a row of the page's flow (a modal's
 * is not on the page), not hidden on phones. A footer without it gets the standard link under it (`StoreWithdrawalLink`), so
 * the function is reachable in every footer layout, including ones saved before it existed.
 */
export const footerHasWithdrawal = (content: Pick<PageContent, "rows">): boolean =>
  siteBlocks({ rows: flowRows(content.rows) }).some((block) => block.part === "withdrawal" && SIZES.every((size) => !hiddenAt(block, size)));

/**
 * Why a page of a type cannot be saved with its site components (D80), or
 * null: they belong only in headers and footers, only the owner's own parts
 * (a store's cart, Kaizen's sign-up button), and a footer shows who runs the
 * site and links to the cookies page. Headers and footers have no
 * categories or tags.
 */
export function siteLayoutProblem(storeId: string | null, type: PageType, content: PageContent): string | null {
  const parts = siteBlocks(content);
  if (content.overlay && type !== "header") return "Only a header lies over the page.";
  if (content.overlay?.where === "terms" && content.overlay.categories.length === 0 && content.overlay.tags.length === 0) {
    return "Choose the page categories or tags whose pages the header lies over.";
  }
  if (type !== "header" && type !== "footer") {
    return parts.length > 0 ? "Site components belong in headers and footers." : null;
  }
  if (content.categories.length > 0 || content.tags.length > 0) return `A ${type} has no categories or tags.`;
  const offered = sitePartsFor(storeId);
  const foreign = parts.find((block) => !offered.includes(block.part));
  if (foreign) return storeId === null ? "Kaizen's site has no cart, wishlist, search, countries or buyer switch." : "A store's site has no Start your store button.";
  if (type === "footer") {
    const missing = footerRequired(storeId).filter((name) => !parts.some((block) => block.part === name));
    if (missing.length > 0) {
      return storeId === null
        ? "A footer shows the business details and the cookies link, as the law asks. Add the missing components."
        : "A footer shows the business details, the cookies link and the withdrawal link, as the law asks. Add the missing components.";
    }
    if (storeId !== null && !footerHasWithdrawal(content)) return "The withdrawal link must be in the footer itself and shown on phones too, as the law asks.";
  }
  return null;
}

/** What a page shows the header about itself (D80): whether it is the front page, its categories and tags, and how it starts. */
export type OverlayPage = { front: boolean; categories: string[]; tags: string[]; rows: PageRow[] };

/**
 * Whether the header lies over this page (D80): the header asks for it
 * here, and the page's first row has a background of its own to run up
 * behind it (else the header would cover the page's first words).
 */
export function headerOverlays(overlay: HeaderOverlay | undefined, page: OverlayPage): boolean {
  if (!overlay) return false;
  // The first row the page shows (as `rowShows` finds it on the site).
  // A modal (D121) is not in the page's flow: it is never the row the header lies over.
  const first = page.rows.find((row) => !row.modal && (Boolean(row.background) || row.columns.some((c) => c.background || c.blocks.some(blockShowsUnbound))));
  if (!first?.background) return false;
  if (overlay.where === "everywhere") return true;
  if (overlay.where === "front") return page.front;
  return overlay.categories.some((id) => page.categories.includes(id)) || overlay.tags.some((id) => page.tags.includes(id));
}
