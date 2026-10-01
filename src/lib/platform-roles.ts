import type { ContentGridBlock, PageContent, PageRow } from "./page-content";
import { newPageContent } from "./page-content";
import { newBlock, newRow, type NewId } from "./page-rows";
import { textToRichText } from "./simple-rich-text";

/**
 * Kaizen's own pages that have a place of their own on its site (D143), chosen as a store's front page and
 * special pages are (D54, D112): its front page (`/`), its blog (`/blog`) and the page shown for an address
 * that is not found. One of Kaizen's published pages is chosen for each, and the standard page shows until one is.
 * Kaizen has no cart, account or catalogue pages: those are stores'.
 */
export const PLATFORM_ROLES = ["front", "blog", "not_found"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const isPlatformRole = (value: unknown): value is PlatformRole => (PLATFORM_ROLES as readonly unknown[]).includes(value);

export const PLATFORM_ROLE_COPY: Record<
  PlatformRole,
  {
    /** What the admin calls it. */
    name: string;
    /** Where it shows; empty where it has no fixed address. */
    address: string;
    /** What visitors see until a page is chosen. */
    standard: string;
    hint: string;
    /** The address the page is made at when it starts from a new page. */
    slug: string;
  }
> = {
  front: {
    name: "Front page",
    address: "/",
    standard: "The standard front page",
    hint: "What visitors see first at Kaizen's address (/): the standard front page, or one of your published pages, such as one with the Plans component.",
    slug: "front-page",
  },
  blog: {
    name: "Blog page",
    address: "/blog",
    standard: "The standard list of articles",
    hint: "What visitors see at Kaizen's blog (/blog): the standard list of articles, or one of your published pages with a content grid of articles. Blog categories and tags keep the standard list.",
    slug: "blog-archive",
  },
  not_found: {
    name: "404 page",
    address: "",
    standard: "The standard message",
    hint: "What visitors see when an address on Kaizen's site does not exist: a short message, or one of your published pages. It is shown with a 404 status, so search engines know the address is gone.",
    slug: "page-not-found",
  },
};

/**
 * A page to start a role's page from, in English and looking like the standard page it replaces: the front page
 * has the standard one's words and buttons with the plans under them. The owner then changes it in the builder.
 */
export function platformStarterPage(role: PlatformRole, id: NewId): PageContent {
  const heading = (text: string, level: 1 | 2 = 1) => {
    const block = newBlock("heading", id);
    return block.type === "heading" ? { ...block, text, level } : block;
  };
  const button = (label: string, href: string, variant?: "outline") => {
    const block = newBlock("button", id);
    return block.type === "button" ? { ...block, label, href, ...(variant && { variant }) } : block;
  };
  const text = (words: string) => {
    const block = newBlock("richText", id);
    return block.type === "richText" ? { ...block, doc: textToRichText(words) } : block;
  };
  const row = (...blocks: ReturnType<typeof newBlock>[]): PageRow => {
    const r = newRow("1", id);
    r.columns[0].blocks.push(...blocks);
    return r;
  };
  const base = newPageContent();
  const page = (title: string, rows: PageRow[]): PageContent => ({ ...base, title, slug: PLATFORM_ROLE_COPY[role].slug, rows });
  switch (role) {
    case "front":
      return page("Kaizen", [
        row(
          heading("Kaizen"),
          text("Online stores for Norway and the EU: prices, VAT, product safety and consumer rules handled from the start, and pages that load in under half a second."),
          button("Start your store", "/sign-up"),
          button("Sign in", "/admin", "outline"),
        ),
        row(heading("Plans", 2), newBlock("plans", id)),
      ]);
    case "blog": {
      const grid = newBlock("contentGrid", id) as ContentGridBlock;
      return page("Blog", [
        row(heading("Blog")),
        row({ ...grid, source: { type: "articles" }, limit: 48, show: { ...grid.show, button: false }, emptyText: "No articles yet." }),
      ]);
    }
    case "not_found":
      return page("This page does not exist.", [row(heading("This page does not exist."), button("Kaizen's front page", "/"))]);
  }
}
