import type { Metadata } from "next";
import { Suspense } from "react";

import { MenuEditor, type MenuUse } from "@/components/admin/menu-editor";
import { STORE_KINDS } from "@/components/admin/menu-links";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { t } from "@/lib/i18n";
import type { PageType } from "@/lib/page-content";
import { termTargets } from "@/lib/taxonomy";
import { requirePermission } from "@/server/permissions";
import { listStoreMenus, menuUses } from "@/server/menus";
import { listMenuProducts } from "@/server/navigation";
import { uploadsEnabled } from "@/server/media";
import { listMenuPages } from "@/server/pages";
import { listTerms } from "@/server/taxonomy";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";

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
  const { store, account } = await requirePermission((await params).store, "website:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "website").menusPage;
  return (
    <AdminTextScope texts={adminTexts(lang, ["website"])}>
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={fillWords(w.description, { store: store.name })} />
      {/* The menu chosen in the address is read per request. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-card" />}>
        <Menus storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
    </AdminTextScope>
  );
}

async function Menus({ storeSlug, searchParams }: { storeSlug: string; searchParams: PageProps<"/admin/[store]/menus">["searchParams"] }) {
  const { store, account } = await requirePermission(storeSlug, "website:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "website").menusPage;
  const { menu: wanted } = await searchParams;
  const [menus, uses, products, terms, pages, articles, blogTerms] = await Promise.all([
    listStoreMenus(store.id),
    menuUses(store.id),
    listMenuProducts(store.id, store.localization.locales[0] ?? "en-GB"),
    listTerms({ storeId: store.id, contentType: "product" }),
    listMenuPages(store.id),
    listMenuPages(store.id, "article"),
    listTerms({ storeId: store.id, contentType: "article" }),
  ]);
  const chosen = wanted === "new" ? null : (menus.find((m) => m.id === wanted) ?? menus[0] ?? null);
  const base = `/admin/${store.slug}/menus`;

  const names = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "language" });
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
      label: place === "header" ? w.header : w.footer,
      href: `/admin/${store.slug}/settings/navigation`,
    })),
    ...(use?.pages ?? []).map((page) => ({
      label: `${w.pageTypes[page.type as PageType] ?? w.pageTypes.page}: ${page.title || w.untitled}`,
      href: `/admin/${store.slug}/${PAGE_TYPE_COPY[page.type as PageType]?.segment ?? "pages"}/${page.id}`,
    })),
  ];

  return (
    <MenuEditor
      key={chosen?.id ?? "new"}
      menus={menus.map(({ id, name }) => ({ id, name }))}
      menu={chosen ?? { id: null, name: menus.length === 0 ? w.mainMenu : "", items: [] }}
      uses={usedIn}
      basePath={base}
      languages={languages}
      kinds={STORE_KINDS.map((k) => ({ ...k, label: w.kinds[k.kind as keyof typeof w.kinds] ?? k.label }))}
      targets={{
        // A store's pages by address (D54); a page shows in the menu once it is published.
        page: pages.map((p) => ({ value: p.slug, title: p.title, note: p.published ? undefined : w.notPublished })),
        product: products.map((p) => ({ value: p.handle, title: p.title, note: p.status === "draft" ? w.draft : undefined })),
        ...termTargets(terms),
        // Articles by address and blog categories (D57).
        article: articles.map((a) => ({ value: a.slug, title: a.title, note: a.published ? undefined : w.notPublished })),
        blogCategory: termTargets(blogTerms).category,
      }}
      copy={{
        siteLinks: w.siteLinks,
        sections: w.sections,
        urlHint: w.urlHint,
        urlPlaceholder: w.urlPlaceholder,
      }}
      save={saveMenuAction.bind(null, store.slug)}
      upload={uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null}
      remove={deleteMenuAction.bind(null, store.slug)}
    />
  );
}
