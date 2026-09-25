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
};
