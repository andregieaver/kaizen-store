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

/** A header: the logo (after the phone's menu button), the menu, then the site's tools, on one line on phones too. */
export function defaultHeader(storeId: string | null, menus: StandardMenus = { header: null, footer: null }): PageContent {
  const tools: SiteBlock[] =
    storeId === null
      ? [part("header-account", "account"), part("header-sign-up", "signUp", { hideOnPhones: true })]
      : [
          part("header-markets", "markets", { hideOnPhones: true }),
          part("header-search", "search"),
          part("header-account", "account", { hideOnPhones: true }),
          part("header-wishlist", "wishlist"),
          part("header-cart", "cart"),
        ];
  const row: PageRow = {
    id: "header-row",
    type: "row",
    layout: "fit-sides",
    sideBySide: true,
    align: "middle",
    style: { padding: sides(10, 16) },
    columns: [
      { id: "header-brand", inline: true, blocks: [part("header-menu-button", "menuButton"), part("header-logo", "logo")] },
      { id: "header-nav", blocks: [menu("header-menu", menus.header, { hideOnPhones: true })] },
      { id: "header-tools", inline: true, justify: "end", blocks: tools },
    ],
  };
  return { ...newPageContent(), title: "Header", slug: "header", rows: [row] };
}

/** A footer: who runs the site and the cookies link, the footer menu, and a store's countries. */
export function defaultFooter(storeId: string | null, menus: StandardMenus = { header: null, footer: null }): PageContent {
  const columns: PageColumn[] = [
    {
      id: "footer-about",
      blocks: [part("footer-logo", "logo"), part("footer-business", "business"), part("footer-cookies", "cookies")],
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

/** What a footer must show on every page (who runs the site, by e-commerce law; the cookie choices, D58). */
export const FOOTER_REQUIRED: readonly SitePart[] = ["business", "cookies"];

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
    const missing = FOOTER_REQUIRED.filter((name) => !parts.some((block) => block.part === name));
    if (missing.length > 0) return "A footer shows the business details and the cookies link, as the law asks. Add the missing components.";
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
  const first = page.rows.find((row) => Boolean(row.background) || row.columns.some((c) => c.background || c.blocks.some(blockShowsUnbound)));
  if (!first?.background) return false;
  if (overlay.where === "everywhere") return true;
  if (overlay.where === "front") return page.front;
  return overlay.categories.some((id) => page.categories.includes(id)) || overlay.tags.some((id) => page.tags.includes(id));
}
