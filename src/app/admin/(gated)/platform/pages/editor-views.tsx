import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { PageEditor } from "@/components/admin/page-editor";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { ArticleView } from "@/components/article-view";
import { PageArticle } from "@/components/page-article";
import { ScopedCss } from "@/components/custom-css";
import { KaizenSiteFooter, KaizenSiteHeader } from "@/components/site-parts";
import { LAYOUT_TYPES, termContentOf, type PageType } from "@/lib/page-content";
import { PLATFORM_ROLE_COPY } from "@/lib/platform-roles";
import { requirePlatformAdmin } from "@/server/auth";
import { getPageForEdit } from "@/server/pages";
import { getPlatformChrome } from "@/server/platform-navigation";
import { themeStoreRoleOf } from "@/server/platform-roles";
import { themeStoreCards, themeStorePage } from "@/server/theme-store";
import { THEME_STORE_PARTS, themePartsWith } from "@/lib/theme-store-parts";
import { THEME_STORE_PAGES, themeStorePageHref } from "@/lib/theme-admin-paths";
import { listSavedParts } from "@/server/saved-parts";
import { bothTerms, listTerms } from "@/server/taxonomy";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { adminTexts } from "@/lib/admin-text";
import { PLATFORM_SITE_AREAS, platformSiteWords } from "@/server/platform-site-words";

import { deleteThemeStorePageAction } from "./actions";
import { platformPageContext } from "./context";

import { typeWords } from "./type-words";

/**
 * Kaizena Flow's page editor and preview (D42, D57), apart from its lists (`views.tsx`): a list's route loads every client component
 * its modules import, drawn or not, so the builder's scripts load only where the builder is (PSI PERF-01).
 */

type Query = Promise<Record<string, string | string[] | undefined>>;

type Params = Promise<{ pageId: string }>;

/** A new page, article, header or footer in the editor. */
export async function NewPageView({ type }: { type: PageType }) {
  await connection();
  const admin = await requirePlatformAdmin();
  const [saved, terms, context] = await Promise.all([
    listSavedParts(null),
    listTerms({ storeId: null, contentType: termContentOf(type) }),
    platformPageContext(type, admin.name ?? ""),
  ]);
  const gridTerms = await bothTerms(null);
  const { lang, w } = await platformSiteWords();
  return (
    <AdminTextScope texts={adminTexts(lang, PLATFORM_SITE_AREAS)}>
      {/* Only for screen readers: the title is in the editor, and the list is in the menu. */}
      <h1 className="sr-only">{typeWords(w, type).new}</h1>
      <PageEditor page={null} savedParts={saved} terms={terms} gridTerms={gridTerms} context={context} />
    </AdminTextScope>
  );
}

const load = async (type: PageType, params: Params) => {
  const { pageId } = await params;
  return z.uuid().safeParse(pageId).success ? getPageForEdit(null, pageId, type) : null;
};

/**
 * The page a page of Kaizen's is edited at: the theme store's own pages (D285) under Themes, every other page under Pages. Null when it is
 * this one; the other address when the page belongs there.
 */
async function editedElsewhere(type: PageType, pageId: string, themeStore: boolean): Promise<string | null> {
  if (type !== "page") return null;
  const role = await themeStoreRoleOf(pageId);
  if (themeStore && !role) return `/admin/platform/pages/${pageId}`;
  if (!themeStore && role) return themeStorePageHref(pageId);
  return null;
}

/** Where a theme store page's View and preview go: the list, or the first theme's page for a theme's page (D285). */
async function themeStoreView(role: "themes" | "theme") {
  if (role === "themes") return { slug: null, view: "/themes" };
  const first = (await themeStoreCards())[0]?.slug ?? null;
  return { slug: first, view: first ? `/themes/${first}` : null };
}

/** One of Kaizen's pages or articles in the editor, opened from its list or from the site; `themeStore`: one of the theme store's own (D285). */
export async function EditPageView({ type, params, searchParams, themeStore = false }: { type: PageType; params: Params; searchParams: Query; themeStore?: boolean }) {
  await connection();
  const admin = await requirePlatformAdmin();
  const [page, { saved: justSaved }, saved, terms, base, gridTerms] = await Promise.all([
    load(type, params),
    searchParams,
    listSavedParts(null),
    listTerms({ storeId: null, contentType: termContentOf(type) }),
    platformPageContext(type, admin.name ?? ""),
    bothTerms(null),
  ]);
  if (!page) notFound();
  const elsewhere = await editedElsewhere(type, page.id, themeStore);
  if (elsewhere) redirect(elsewhere);
  const role = themeStore ? await themeStoreRoleOf(page.id) : null;
  const context = role
    ? {
        ...base,
        adminBase: THEME_STORE_PAGES,
        // A theme's page holds the theme's parts; the list may be on either (and on any of Kaizena Flow's pages).
        themeStore: { parts: role === "theme" ? [...THEME_STORE_PARTS] : (["list"] as const).slice() },
        place: { view: (await themeStoreView(role)).view, address: PLATFORM_ROLE_COPY[role].address },
        actions: { ...base.actions, remove: deleteThemeStorePageAction },
      }
    : base;
  const address = role ? PLATFORM_ROLE_COPY[role].address : `${context.siteBase}/${page.slug}`;
  const { lang, w } = await platformSiteWords();
  return (
    <AdminTextScope texts={adminTexts(lang, PLATFORM_SITE_AREAS)}>
      <h1 className="sr-only">{fillWords(w.tables.editTitle, { title: page.draft.title || `${w.tables.untitled} ${w.tables.pageTypes[type].one}` })}</h1>
      <PageEditor
        key={page.id}
        page={page}
        notice={
          justSaved === "draft"
            ? w.pages.draftSaved
            : justSaved === "published"
              ? LAYOUT_TYPES.includes(type)
                ? w.pages.published
                : fillWords(w.pages.publishedAt, { address })
              : null
        }
        savedParts={saved}
        terms={terms}
        gridTerms={gridTerms}
        context={context}
      />
    </AdminTextScope>
  );
}

/** The last saved draft, as the site will show it once published (D42); a theme's page (D285) with the first theme, or `?theme=`'s. */
export async function PreviewPageView({ type, params, searchParams, themeStore = false }: { type: PageType; params: Params; searchParams?: Query; themeStore?: boolean }) {
  await connection();
  await requirePlatformAdmin();
  const page = await load(type, params);
  if (!page) notFound();
  const elsewhere = await editedElsewhere(type, page.id, themeStore);
  if (elsewhere) redirect(`${elsewhere}/preview`);
  const role = themeStore ? await themeStoreRoleOf(page.id) : null;
  const asked = role === "theme" ? (await searchParams)?.theme : undefined;
  const themeSlug = role === "theme" ? (typeof asked === "string" && asked ? asked : (await themeStoreView("theme")).slug) : null;
  const shownTheme = themeSlug ? await themeStorePage(themeSlug) : null;
  const back = role ? themeStorePageHref(page.id) : `/admin/platform/${PAGE_TYPE_COPY[type].segment}/${page.id}`;
  const { w } = await platformSiteWords();
  return (
    <>
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand px-4 py-3 text-sm text-brand-ink">
        <span>
          {w.pages.previewDraft}{" "}
          {page.state === "draft" ? typeWords(w, type).notOnSite : page.state === "changed" ? w.pages.stillPublished : w.pages.thisIsShown}
        </span>
        <Link href={back} className="font-medium underline">
          {w.pages.back}
        </Link>
      </p>
      {/* Kaizen's own CSS and the page's (D100), kept inside the preview. */}
      <div className="py-6 [contain:paint]" data-site-css="">
        <ScopedCss css={[(await getPlatformChrome()).customCss, page.draft.css]} root="[data-site-css]" />
        {type === "header" || type === "footer" ? (
          // As Kaizen's pages draw it (D80), with its logo, menus and details.
          <div className="overflow-hidden rounded-panel border border-line">
            {type === "header" ? (
              <KaizenSiteHeader chrome={await getPlatformChrome()} layout={{ id: page.id, content: page.draft }} />
            ) : (
              <KaizenSiteFooter chrome={await getPlatformChrome()} layout={{ id: page.id, content: page.draft }} />
            )}
          </div>
        ) : type === "article" ? (
          // As the blog will show it (D57); the date is the day it is first published.
          <ArticleView
            content={page.draft}
            date={page.publishedAt}
            byline={page.draft.author || "Kaizena Flow"}
            lang="en"
            locale="en-GB"
            place={{ pageId: page.id, owner: null }}
            inAdmin
          />
        ) : (
          <PageArticle content={page.draft} place={{ pageId: page.id, owner: null, ...(shownTheme && { themeSlug: shownTheme.slug, themeParts: themePartsWith(shownTheme) }) }} inAdmin />
        )}
      </div>
    </>
  );
}
