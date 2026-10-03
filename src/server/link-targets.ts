import "server-only";

import { PLATFORM_ITEM_KINDS, STORE_KINDS, type KindOption, type Targets } from "@/components/admin/menu-links";
import { termTargets } from "@/lib/taxonomy";

import { listMenuProducts } from "./navigation";
import { listMenuPages } from "./pages";
import { listTerms } from "./taxonomy";

/**
 * What a custom grid item's link (D155) can point at, for the builder's picker: the menu editor's kinds and targets, by slug
 * (a store's pages, products, articles, categories and tags; Kaizen's pages, articles, categories and tags), so a link never
 * carries an id of another store. Read when the owner opens the picker, never while a page is shown.
 */
export type ItemLinkTargets = { kinds: KindOption[]; targets: Targets };

/** The links of a store (its id) or, with null, of Kaizen's own pages. */
export async function itemLinkTargets(owner: string | null, locale = "en-GB"): Promise<ItemLinkTargets> {
  if (owner === null) {
    const [pages, terms, articles, blogTerms] = await Promise.all([
      listMenuPages(null),
      listTerms({ storeId: null, contentType: "page" }),
      listMenuPages(null, "article"),
      listTerms({ storeId: null, contentType: "article" }),
    ]);
    return {
      kinds: PLATFORM_ITEM_KINDS,
      targets: {
        page: pages.map((p) => ({ value: p.slug, title: p.title, note: p.published ? undefined : "not published" })),
        ...termTargets(terms),
        article: articles.map((a) => ({ value: a.slug, title: a.title, note: a.published ? undefined : "not published" })),
        blogCategory: termTargets(blogTerms).category,
      },
    };
  }
  const [products, terms, pages, articles, blogTerms] = await Promise.all([
    listMenuProducts(owner, locale),
    listTerms({ storeId: owner, contentType: "product" }),
    listMenuPages(owner),
    listMenuPages(owner, "article"),
    listTerms({ storeId: owner, contentType: "article" }),
  ]);
  return {
    kinds: STORE_KINDS,
    targets: {
      page: pages.map((p) => ({ value: p.slug, title: p.title, note: p.published ? undefined : "not published" })),
      product: products.map((p) => ({ value: p.handle, title: p.title, note: p.status === "draft" ? "draft" : undefined })),
      ...termTargets(terms),
      article: articles.map((a) => ({ value: a.slug, title: a.title, note: a.published ? undefined : "not published" })),
      blogCategory: termTargets(blogTerms).category,
    },
  };
}
