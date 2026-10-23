import type { Metadata } from "next";
import { PLATFORM_LANG_FACTS, PLATFORM_LANGS, pageLocaleOf } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { connection } from "next/server";
import { Suspense } from "react";

import { MenuEditor, type MenuUse } from "@/components/admin/menu-editor";
import { PLATFORM_KINDS } from "@/components/admin/menu-links";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import type { PageType } from "@/lib/page-content";
import { termTargets } from "@/lib/taxonomy";
import { requirePlatformAdmin } from "@/server/auth";
import { listPlatformMenus, menuUses } from "@/server/menus";
import { uploadsEnabled } from "@/server/media";
import { listMenuPages } from "@/server/pages";
import { listTerms } from "@/server/taxonomy";
import { PageHeader } from "@/components/admin/ui";

import { uploadPlatformImageAction } from "../actions";
import { deletePlatformMenuAction, savePlatformMenuAction } from "./actions";
import { platformSiteWords } from "@/server/platform-site-words";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Menus" };

/** Kaizen's own menus (D85), edited as a store's are. */
export default async function PlatformMenusPage({ searchParams }: PageProps<"/admin/platform/menus">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const { w } = await platformSiteWords();
  return (
    <>
      <PageHeader
        title={w.misc.menus.title}
        description={w.misc.menus.description}
      />
      {/* The menu chosen in the address is read per request. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-card" />}>
        <Menus searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Menus({ searchParams }: { searchParams: PageProps<"/admin/platform/menus">["searchParams"] }) {
  const { lang, w: site } = await platformSiteWords();
  const w = adminText(lang, "website").menusPage;
  const m = site.misc.menus;
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
      label: place === "header" ? w.header : w.footer,
      href: "/admin/platform/navigation",
    })),
    ...(use?.pages ?? []).map((page) => ({
      label: `${w.pageTypes[page.type as PageType] ?? w.pageTypes.page}: ${page.title || w.untitled}`,
      href: `/admin/platform/${PAGE_TYPE_COPY[page.type as PageType]?.segment ?? "pages"}/${page.id}`,
    })),
  ];

  return (
    <MenuEditor
      key={chosen?.id ?? "new"}
      menus={menus.map(({ id, name }) => ({ id, name }))}
      menu={chosen ?? { id: null, name: menus.length === 0 ? w.mainMenu : "", items: [] }}
      uses={usedIn}
      basePath="/admin/platform/menus"
      // English, then the site's other languages (D312 P4): a link's words in each, its built-in names the site's own.
      languages={PLATFORM_LANGS.map((lang) => ({ locale: pageLocaleOf(lang) ?? "en", name: PLATFORM_LANG_FACTS[lang].english, defaults: platformText(lang).nav }))}
      kinds={PLATFORM_KINDS.map((k) => ({ ...k, label: m.kinds[k.kind as keyof typeof m.kinds] ?? k.label }))}
      targets={{
        page: pages.map((page) => ({ value: page.id, title: page.title, note: page.published ? undefined : m.draft })),
        ...termTargets(terms),
        // Kaizen's articles by id and blog categories by address (D57).
        article: articles.map((a) => ({ value: a.id, title: a.title, note: a.published ? undefined : m.draft })),
        blogCategory: termTargets(blogTerms).category,
      }}
      copy={{ siteLinks: m.siteLinks, sections: m.sections, urlHint: m.urlHint, urlPlaceholder: m.urlPlaceholder }}
      save={savePlatformMenuAction}
      upload={uploadsEnabled() ? uploadPlatformImageAction : null}
      remove={deletePlatformMenuAction}
    />
  );
}
