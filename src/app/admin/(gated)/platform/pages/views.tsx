import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { PageEditor } from "@/components/admin/page-editor";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { PagePlaceForm } from "@/components/admin/page-place-form";
import { PagesTable } from "@/components/admin/pages-table";
import { TermsManager } from "@/components/admin/terms";
import { ArticleView } from "@/components/article-view";
import { SiteLayoutChoice, SiteLayoutsTable } from "@/components/admin/site-layouts";
import { PageArticle } from "@/components/page-article";
import { ScopedCss } from "@/components/custom-css";
import { KaizenSiteFooter, KaizenSiteHeader } from "@/components/site-parts";
import { LAYOUT_TYPES, termContentOf, type PageType } from "@/lib/page-content";
import { isThemeStoreRole, PLATFORM_ROLE_COPY, SPECIAL_ROLES, type PlatformRole } from "@/lib/platform-roles";
import { requirePlatformAdmin } from "@/server/auth";
import { getPageForEdit, listPages } from "@/server/pages";
import { getPlatformChrome } from "@/server/platform-navigation";
import { getPlatformPageRoles, themeStoreRoleOf } from "@/server/platform-roles";
import { themeStoreCards, themeStorePage } from "@/server/theme-store";
import { THEME_STORE_PARTS, themePartsWith } from "@/lib/theme-store-parts";
import { THEME_STORE_PAGES, themeStorePageHref } from "@/lib/theme-admin-paths";
import { listSavedParts } from "@/server/saved-parts";
import { siteLayoutChoice } from "@/server/site-layouts";
import { bothTerms, listTerms } from "@/server/taxonomy";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { PlatformLegalCard } from "@/components/admin/platform-legal-card";
import { adminLangOf } from "@/lib/admin-lang";
import { platformLegalOverview } from "@/server/platform-legal";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import type { PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";
import { adminTexts } from "@/lib/admin-text";
import { PLATFORM_SITE_AREAS, platformSiteWords } from "@/server/platform-site-words";

import {
  choosePlatformSiteLayoutAction,
  createPageTermAction,
  createPlatformRolePageAction,
  deleteThemeStorePageAction,
  setPlatformPageRoleAction,
  deletePageTermAction,
  updatePageTermAction,
} from "./actions";
import { platformPageContext } from "./context";
import { duplicatePageAction } from "./duplicate-action";
import { writeLegalPagesAction } from "./legal-action";

/**
 * Kaizen's pages (D42) and blog articles (D57): the same list, editor,
 * preview and categories, at `/admin/platform/pages` and `/articles`.
 */

type Query = Promise<Record<string, string | string[] | undefined>>;

type Params = Promise<{ pageId: string }>;

type TypeWords = PlatformSiteMessages["pages"]["types"]["page"];

/** A type's words in the admin's language; Kaizena Flow has pages, articles, headers and footers (stores' product layouts and test versions are not its). */
function typeWords(w: PlatformSiteMessages, type: PageType): TypeWords {
  const types: Partial<Record<PageType, TypeWords>> = w.pages.types;
  return types[type] ?? w.pages.types.page;
}

export async function PagesListView({ type, searchParams }: { type: PageType; searchParams: Query }) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const admin = await requirePlatformAdmin();
  const { lang, w } = await platformSiteWords();
  const tw = typeWords(w, type);
  const copy = PAGE_TYPE_COPY[type];
  const base = `/admin/platform/${copy.segment}`;
  const [all, query, roles, legal] = await Promise.all([
    listPages(null, type),
    searchParams,
    type === "page" ? getPlatformPageRoles() : [],
    type === "page" ? platformLegalOverview() : null,
  ]);
  // The theme store's own pages (D285) are edited from Themes, so they are not mixed with these.
  const themeStorePages = new Set(roles.flatMap(([role, id]) => (isThemeStoreRole(role) ? [id] : [])));
  const pages = all.filter((p) => !themeStorePages.has(p.id));
  // Pages that have a place of their own (D143) are not offered for another.
  const placedIds = new Set(roles.map(([, id]) => id));
  const roleOf = Object.fromEntries(roles.map(([role, id]) => [role, id]));
  const offered = (role: PlatformRole) => pages.filter((p) => (!placedIds.has(p.id) || p.id === roleOf[role]) && (p.state !== "draft" || p.id === roleOf[role]));
  return (
    <AdminTextScope texts={adminTexts(lang, ["website", "platformSite"])}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title={<>{tw.list}</>} description={<>{tw.intro}</>} />
        <div className="flex flex-wrap gap-3">
          {!LAYOUT_TYPES.includes(type) && (
            <Link href={`${base}/categories`} className="flex min-h-11 items-center rounded-pill border border-edge px-5 font-medium">
              {w.pages.categories}
            </Link>
          )}
          {type === "page" && (
            <Link href={`${base}/ai`} className="flex min-h-11 items-center rounded-pill border border-edge px-5 font-medium">
              {w.pages.createAi}
            </Link>
          )}
          <Link href={`${base}/new`} className="flex min-h-11 items-center rounded-pill bg-brand px-5 font-medium text-brand-ink">
            {tw.new}
          </Link>
        </div>
      </div>

      {query.deleted && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {tw.deleted}
        </p>
      )}

      {pages.length === 0 ? (
        <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>
          {tw.none}
        </p>
      ) : type === "header" || type === "footer" ? (
        <SiteLayoutsTable layouts={pages} adminBase={base} current={(await siteLayoutChoice(null))[type]} />
      ) : (
        <PagesTable
          pages={pages}
          adminBase={base}
          siteBase={copy.sitePrefix}
          placed={Object.fromEntries(roles.map(([role, id]) => [id, { name: w.tables.roles[role].name, address: PLATFORM_ROLE_COPY[role].address }]))}
          duplicate={duplicatePageAction.bind(null, type)}
        />
      )}
      {legal && <PlatformLegalCard lang={adminLangOf(admin.adminLocale)} overview={legal} write={writeLegalPagesAction} />}
      {type === "page" && (
        <section className="flex flex-col gap-4" aria-labelledby="special-pages">
          <div className="flex flex-col gap-1">
            <h2 id="special-pages" className="text-title text-ink">
              {w.pages.special}
            </h2>
            <p className="max-w-2xl text-sm text-muted">{w.pages.specialNote}</p>
          </div>
          {SPECIAL_ROLES.map((role) => (
            <PagePlaceForm
              key={role}
              name={w.tables.roles[role].name}
              hint={w.tables.roles[role].hint}
              standard={w.tables.roles[role].standard}
              current={roleOf[role] ?? null}
              pages={offered(role)}
              choose={setPlatformPageRoleAction.bind(null, role) as never}
              start={createPlatformRolePageAction.bind(null, role) as never}
            />
          ))}
        </section>
      )}
      {(type === "header" || type === "footer") && (
        <SiteLayoutChoice
          type={type}
          layouts={pages}
          current={(await siteLayoutChoice(null))[type]}
          siteName={w.pages.siteName}
          action={choosePlatformSiteLayoutAction.bind(null, type)}
        />
      )}
    </AdminTextScope>
  );
}

export async function PageTermsView({ type }: { type: PageType }) {
  await connection();
  await requirePlatformAdmin();
  const { lang, w } = await platformSiteWords();
  const tw = typeWords(w, type);
  const copy = PAGE_TYPE_COPY[type];
  const terms = await listTerms({ storeId: null, contentType: termContentOf(type) });
  return (
    <AdminTextScope texts={adminTexts(lang, ["products", "platformSite"])}>
      <div className="flex flex-col gap-1">
        <Link href={`/admin/platform/${copy.segment}`} className="w-fit text-sm underline">
          {tw.list}
        </Link>
        <PageHeader title={w.pages.categories} description={tw.terms} />
        </div>
      <TermsManager
        initial={terms}
        usedBy={copy.many}
        actions={{
          create: createPageTermAction.bind(null, type),
          update: updatePageTermAction.bind(null, type),
          remove: deletePageTermAction.bind(null, type),
        }}
      />
    </AdminTextScope>
  );
}

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
