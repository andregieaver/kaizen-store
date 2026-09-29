import { newPageContent, type ContentGridBlock, type PageContent, type PageRow } from "./page-content";
import { newBlock, newRow, type NewId } from "./page-rows";
import type { Messages } from "./i18n";

/**
 * Pages of a store that have a place of their own on its site (D112), built in
 * the page builder like its front page and All products page: one of the
 * store's published pages is chosen for each, and the site's standard page
 * shows until one is. The blog (`/blog`), the search page (`/search`) and the
 * page shown when an address is not found (a real 404).
 */
export const PAGE_ROLES = ["blog", "search", "not_found"] as const;
export type PageRole = (typeof PAGE_ROLES)[number];

export const isPageRole = (value: unknown): value is PageRole => (PAGE_ROLES as readonly unknown[]).includes(value);

export const ROLE_COPY: Record<
  PageRole,
  {
    /** What the admin calls it. */
    name: string;
    /** Where it shows, after the store's market address; empty for the 404 page. */
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
  }
}

/** The address of a page that is a role's, on a store's market address `base`. */
export const roleAddress = (role: PageRole, base: string) => (ROLE_COPY[role].address ? `${base}${ROLE_COPY[role].address}` : null);

