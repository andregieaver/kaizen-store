import type { Metadata } from "next";

import { NavigationEditor } from "@/components/admin/navigation-editor";
import { t } from "@/lib/i18n";
import { marketPath, storeHref } from "@/lib/paths";
import { requireMember } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { termTargets } from "@/lib/taxonomy";
import { listMenuProducts } from "@/server/navigation";
import { listMenuPages } from "@/server/pages";
import { listTerms } from "@/server/taxonomy";

import { uploadImageAction } from "../../products/actions";
import { saveNavigationAction } from "./actions";

export const metadata: Metadata = { title: "Header and footer" };

/** The storefront's logo and menus (D30). */
export default async function NavigationPage({ params }: PageProps<"/admin/[store]/settings/navigation">) {
  const { store } = await requireMember((await params).store);
  const home = store.markets[0];
  const [products, terms, pages, articles, blogTerms] = await Promise.all([
    listMenuProducts(store.id, home?.locale ?? "nb-NO"),
    listTerms({ storeId: store.id, contentType: "product" }),
    listMenuPages(store.id),
    listMenuPages(store.id, "article"),
    listTerms({ storeId: store.id, contentType: "article" }),
  ]);
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  const languages = [...new Map(store.markets.map((m) => [m.locale, m])).values()].map((market) => {
    const m = t(market.lang);
    return {
      locale: market.locale,
      name: names.of(market.locale) ?? market.locale,
      defaults: { home: store.frontPageId ? m.home : m.allProducts, account: m.account.title, cart: m.cart, blog: m.blog },
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Header and footer</h1>
        <p className="text-sm text-muted">
          Your logo and the links shoppers use to find their way around {store.name}, in each of your languages.
        </p>
      </div>
      <NavigationEditor
        initial={store.navigation}
        languages={languages}
        targets={{
          // A store's pages by address (D54); a page shows in the menu once it is published.
          page: pages.map((p) => ({ value: p.slug, title: p.title, note: p.published ? undefined : "not published" })),
          product: products.map((p) => ({
            value: p.handle,
            title: p.title,
            note: p.status === "draft" ? "draft" : undefined,
          })),
          ...termTargets(terms),
          // Articles by address and blog categories (D57).
          article: articles.map((a) => ({ value: a.slug, title: a.title, note: a.published ? undefined : "not published" })),
          blogCategory: termTargets(blogTerms).category,
        }}
        upload={uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null}
        save={saveNavigationAction.bind(null, store.slug)}
        previewHref={home ? storeHref(store.slug, marketPath(store.slug, home.slug)) : "/"}
      />
    </div>
  );
}
