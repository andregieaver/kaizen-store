import type { Metadata } from "next";
import { Suspense } from "react";

import { MenuEditor, type MenuUse } from "@/components/admin/menu-editor";
import { STORE_KINDS } from "@/components/admin/menu-links";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { t } from "@/lib/i18n";
import type { PageType } from "@/lib/page-content";
import { termTargets } from "@/lib/taxonomy";
import { requireMember } from "@/server/auth";
import { listStoreMenus, menuUses } from "@/server/menus";
import { listMenuProducts } from "@/server/navigation";
import { uploadsEnabled } from "@/server/media";
import { listMenuPages } from "@/server/pages";
import { listTerms } from "@/server/taxonomy";

import { uploadImageAction } from "../products/actions";
import { deleteMenuAction, saveMenuAction } from "./actions";

export const metadata: Metadata = { title: "Menus" };

/**
 * The store's menus (D85), edited one at a time as in WordPress: `?menu=`
 * chooses one (`new` for a new one; the first one without). Menus show
 * wherever they are chosen: the standard header and footer, and menu
 * components in pages, headers and footers.
 */
export default async function MenusPage({ params, searchParams }: PageProps<"/admin/[store]/menus">) {
  const { store } = await requireMember((await params).store);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Menus</h1>
        <p className="max-w-2xl text-sm text-muted">
          Lists of links to use around {store.name}: in the standard header and footer (chosen under Header and footer),
          and with a Menu component in any page, header or footer. A link to a page, article, category or tag shows once
          it is published, and follows it to a new address.
        </p>
      </div>
      {/* The menu chosen in the address is read per request. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-background" />}>
        <Menus storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Menus({ storeSlug, searchParams }: { storeSlug: string; searchParams: PageProps<"/admin/[store]/menus">["searchParams"] }) {
  const { store } = await requireMember(storeSlug);
  const { menu: wanted } = await searchParams;
  const home = store.markets[0];
  const [menus, uses, products, terms, pages, articles, blogTerms] = await Promise.all([
    listStoreMenus(store.id),
    menuUses(store.id),
    listMenuProducts(store.id, home?.locale ?? "nb-NO"),
    listTerms({ storeId: store.id, contentType: "product" }),
    listMenuPages(store.id),
    listMenuPages(store.id, "article"),
    listTerms({ storeId: store.id, contentType: "article" }),
  ]);
  const chosen = wanted === "new" ? null : (menus.find((m) => m.id === wanted) ?? menus[0] ?? null);
  const base = `/admin/${store.slug}/menus`;

  const names = new Intl.DisplayNames(["en"], { type: "language" });
  const languages = [...new Map(store.markets.map((m) => [m.locale, m])).values()].map((market) => {
    const m = t(market.lang);
    return {
      locale: market.locale,
      name: names.of(market.locale) ?? market.locale,
      defaults: {
        home: store.frontPageId ? m.home : m.allProducts,
        products: m.allProducts,
        account: m.account.title,
        cart: m.cart,
        blog: m.blog,
      },
    };
  });

  const use = chosen ? uses.get(chosen.id) : undefined;
  const usedIn: MenuUse[] = [
    ...(use?.standard ?? []).map((place) => ({
      label: place === "header" ? "The standard header and the phone's menu" : "The standard footer",
      href: `/admin/${store.slug}/settings/navigation`,
    })),
    ...(use?.pages ?? []).map((page) => ({
      label: `${PAGE_TYPE_COPY[page.type as PageType]?.One ?? "Page"}: ${page.title || "Untitled"}`,
      href: `/admin/${store.slug}/${PAGE_TYPE_COPY[page.type as PageType]?.segment ?? "pages"}/${page.id}`,
    })),
  ];

  return (
    <MenuEditor
      key={chosen?.id ?? "new"}
      menus={menus.map(({ id, name }) => ({ id, name }))}
      menu={chosen ?? { id: null, name: menus.length === 0 ? "Main menu" : "", items: [] }}
      uses={usedIn}
      basePath={base}
      languages={languages}
      kinds={STORE_KINDS}
      targets={{
        // A store's pages by address (D54); a page shows in the menu once it is published.
        page: pages.map((p) => ({ value: p.slug, title: p.title, note: p.published ? undefined : "not published" })),
        product: products.map((p) => ({ value: p.handle, title: p.title, note: p.status === "draft" ? "draft" : undefined })),
        ...termTargets(terms),
        // Articles by address and blog categories (D57).
        article: articles.map((a) => ({ value: a.slug, title: a.title, note: a.published ? undefined : "not published" })),
        blogCategory: termTargets(blogTerms).category,
      }}
      copy={{
        siteLinks: "Store links",
        sections: {
          page: "Pages",
          product: "Products",
          category: "Product categories",
          tag: "Product tags",
          article: "Blog articles",
          blogCategory: "Blog categories",
        },
        urlHint: "A full address opens that site; one starting with / is a page in your store.",
        urlPlaceholder: "https://… or /p/product-name",
      }}
      save={saveMenuAction.bind(null, store.slug)}
      upload={uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null}
      remove={deleteMenuAction.bind(null, store.slug)}
    />
  );
}
