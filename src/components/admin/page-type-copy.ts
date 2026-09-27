import type { PageType } from "@/lib/page-content";

/**
 * How the admin speaks of pages and articles (D57): the same editor and
 * lists, with their own words and addresses.
 */
export const PAGE_TYPE_COPY: Record<
  PageType,
  { list: string; one: string; One: string; many: string; segment: string; sitePrefix: string }
> = {
  page: { list: "Pages", one: "page", One: "Page", many: "pages", segment: "pages", sitePrefix: "" },
  article: { list: "Blog", one: "article", One: "Article", many: "articles", segment: "articles", sitePrefix: "/blog" },
  // A store's product layouts (D79): not at an address of their own, but where products are.
  product_layout: { list: "Product layouts", one: "layout", One: "Layout", many: "layouts", segment: "product-layouts", sitePrefix: "/p" },
  // The site's own header and footer (D80): on every page, at no address of their own.
  header: { list: "Headers", one: "header", One: "Header", many: "headers", segment: "headers", sitePrefix: "" },
  footer: { list: "Footers", one: "footer", One: "Footer", many: "footers", segment: "footers", sitePrefix: "" },
};
