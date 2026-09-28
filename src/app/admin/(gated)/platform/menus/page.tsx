import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { MenuEditor, type MenuUse } from "@/components/admin/menu-editor";
import { PLATFORM_KINDS } from "@/components/admin/menu-links";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import type { PageType } from "@/lib/page-content";
import { termTargets } from "@/lib/taxonomy";
import { requirePlatformAdmin } from "@/server/auth";
import { listPlatformMenus, menuUses } from "@/server/menus";
import { listMenuPages } from "@/server/pages";
import { listTerms } from "@/server/taxonomy";

import { deletePlatformMenuAction, savePlatformMenuAction } from "./actions";

export const metadata: Metadata = { title: "Menus" };

/** Kaizen's own menus (D85), edited as a store's are. */
export default async function PlatformMenusPage({ searchParams }: PageProps<"/admin/platform/menus">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Menus</h1>
        <p className="max-w-2xl text-sm text-muted">
          Lists of links to use around Kaizen&apos;s site: in the standard header and footer (chosen under Header and
          footer), and with a Menu component in any page, header or footer. A link to a page shows once it is published,
          and follows it to a new address.
        </p>
      </div>
      {/* The menu chosen in the address is read per request. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-background" />}>
        <Menus searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Menus({ searchParams }: { searchParams: PageProps<"/admin/platform/menus">["searchParams"] }) {
  await requirePlatformAdmin();
  const { menu: wanted } = await searchParams;
  const [menus, uses, pages, terms, articles, blogTerms] = await Promise.all([
    listPlatformMenus(),
    menuUses(null),
    listMenuPages(null),
    listTerms({ storeId: null, contentType: "page" }),
    listMenuPages(null, "article"),
    listTerms({ storeId: null, contentType: "article" }),
  ]);
  const chosen = wanted === "new" ? null : (menus.find((m) => m.id === wanted) ?? menus[0] ?? null);
  const use = chosen ? uses.get(chosen.id) : undefined;
  const usedIn: MenuUse[] = [
    ...(use?.standard ?? []).map((place) => ({
      label: place === "header" ? "The standard header and the phone's menu" : "The standard footer",
      href: "/admin/platform/navigation",
    })),
    ...(use?.pages ?? []).map((page) => ({
      label: `${PAGE_TYPE_COPY[page.type as PageType]?.One ?? "Page"}: ${page.title || "Untitled"}`,
      href: `/admin/platform/${PAGE_TYPE_COPY[page.type as PageType]?.segment ?? "pages"}/${page.id}`,
    })),
  ];

  return (
    <MenuEditor
      key={chosen?.id ?? "new"}
      menus={menus.map(({ id, name }) => ({ id, name }))}
      menu={chosen ?? { id: null, name: menus.length === 0 ? "Main menu" : "", items: [] }}
      uses={usedIn}
      basePath="/admin/platform/menus"
      languages={[{ locale: "en", name: "English", defaults: { home: "Home", signUp: "Start your store", signIn: "Sign in", blog: "Blog" } }]}
      kinds={PLATFORM_KINDS}
      targets={{
        page: pages.map((page) => ({ value: page.id, title: page.title, note: page.published ? undefined : "draft" })),
        ...termTargets(terms),
        // Kaizen's articles by id and blog categories by address (D57).
        article: articles.map((a) => ({ value: a.id, title: a.title, note: a.published ? undefined : "draft" })),
        blogCategory: termTargets(blogTerms).category,
      }}
      copy={{
        siteLinks: "Kaizen links",
        sections: {
          page: "Pages",
          category: "Page categories",
          tag: "Page tags",
          article: "Blog articles",
          blogCategory: "Blog categories",
        },
        urlHint: "A full address opens that site; one starting with / is a page on Kaizen's site.",
        urlPlaceholder: "https://… or /sign-up",
      }}
      save={savePlatformMenuAction}
      remove={deletePlatformMenuAction}
    />
  );
}
