import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { PageEditor } from "@/components/admin/page-editor";
import { DualPageEditor, type DualDoc } from "@/components/admin/dual-page-editor";
import { parseDualLayout, templateAsPage, type DualKind, type DualLayout, type DualWith } from "@/lib/dual-page";
import { adminText } from "@/lib/admin-text";
import type { AdminLang } from "@/lib/admin-lang";
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
import type { EditablePage } from "@/server/pages";
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

/** The kinds of Kaizena Flow's own documents a dual page can hold (D412): no product layouts (a store's) or entry pages (made from their type). */
const PLATFORM_DUAL = ["page", "article", "header", "footer"] as const satisfies readonly DualKind[];

/**
 * What a dual page on Kaizena Flow's own site shows (D412, D424), as the address asks (`?with=`, `?first=`, `?swap=`), with its second
 * document loaded: null where the address asks for no second half, "refused" where it names nothing that can be opened here.
 */
async function platformDual(
  first: { kind: DualKind; id: string | null },
  query: Record<string, string | string[] | undefined> | undefined,
  lang: AdminLang,
  author: string,
): Promise<{ layout: DualLayout; right: DualDoc | null } | "refused" | null> {
  if (query?.with === undefined) return null;
  const layout = parseDualLayout(first, { with: query.with, first: query.first, swap: query.swap });
  if (!layout) return "refused";
  if (typeof layout.second !== "object") return { layout, right: null };
  const right = await platformSecondDoc(layout.second, lang, author);
  return right === "refused" ? "refused" : { layout, right };
}

/** The second document of a dual page (D412) on Kaizena Flow's own site; "refused" where it cannot be opened here (a theme store page is edited under Themes). */
async function platformSecondDoc(doc: DualWith, lang: AdminLang, author: string): Promise<DualDoc | "refused"> {
  // A saved template of Kaizena Flow's (D412 step 5), edited as the kind of page it is for.
  if (doc.kind === "template") {
    const savedParts = await listSavedParts(null);
    const part = savedParts.find((p) => p.id === doc.id);
    if (!part) return "refused";
    const { shape, page } = templateAsPage(part);
    if (!(PLATFORM_DUAL as readonly string[]).includes(shape)) return "refused";
    const [terms, gridTerms, context] = await Promise.all([listTerms({ storeId: null, contentType: termContentOf(shape) }), bothTerms(null), platformPageContext(shape, author)]);
    return {
      doc: { kind: "template", id: part.id },
      kindName: adminText(lang, "builder").dual.kinds.template,
      props: { page, template: part, savedParts, terms, gridTerms, context: { ...context, languages: context.languages.slice(0, 1), schedule: null, share: null } },
    };
  }
  if (!(PLATFORM_DUAL as readonly string[]).includes(doc.kind)) return "refused";
  let page: EditablePage | null = null;
  if (doc.id !== null) {
    page = await getPageForEdit(null, doc.id, doc.kind);
    if (!page || (await editedElsewhere(doc.kind, page.id, false))) return "refused";
  }
  const [savedParts, terms, gridTerms, context] = await Promise.all([
    listSavedParts(null),
    listTerms({ storeId: null, contentType: termContentOf(doc.kind) }),
    bothTerms(null),
    platformPageContext(doc.kind, author),
  ]);
  return { doc, kindName: adminText(lang, "builder").dual.kinds[doc.kind], props: { page, savedParts, terms, gridTerms, context } };
}

/** A new page, article, header or footer in the editor; with `?with=`, beside a second document (D412). */
export async function NewPageView({ type, searchParams }: { type: PageType; searchParams?: Query }) {
  await connection();
  const admin = await requirePlatformAdmin();
  const [saved, terms, context, query] = await Promise.all([
    listSavedParts(null),
    listTerms({ storeId: null, contentType: termContentOf(type) }),
    platformPageContext(type, admin.name ?? ""),
    searchParams,
  ]);
  const gridTerms = await bothTerms(null);
  const { lang, w } = await platformSiteWords();
  const dual = context.dualPages ? await platformDual({ kind: type as DualKind, id: null }, query, lang, admin.name ?? "") : null;
  const props = { page: null, savedParts: saved, terms, gridTerms, context };
  const bw = adminText(lang, "builder");
  return (
    <AdminTextScope texts={adminTexts(lang, PLATFORM_SITE_AREAS)}>
      {/* Only for screen readers: the title is in the editor, and the list is in the menu. */}
      <h1 className="sr-only">{typeWords(w, type).new}</h1>
      {dual && dual !== "refused" && context.dualPages ? (
        <DualPageEditor
          left={{ doc: { kind: type as DualKind, id: null }, kindName: bw.dual.kinds[type as DualKind], props }}
          right={dual.right}
          layout={dual.layout}
          root={context.dualPages.root}
          pick={{ ...context.dualPages, templates: saved }}
          site={{ css: context.siteCss, name: bw.editor.kaizenSite, save: context.actions.saveSiteCss, versions: context.actions.cssVersions }}
        />
      ) : (
        <PageEditor {...props} notice={dual === "refused" ? bw.dual.notOpened : null} />
      )}
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
  const [page, query, saved, terms, base, gridTerms] = await Promise.all([
    load(type, params),
    searchParams,
    listSavedParts(null),
    listTerms({ storeId: null, contentType: termContentOf(type) }),
    platformPageContext(type, admin.name ?? ""),
    bothTerms(null),
  ]);
  if (!page) notFound();
  const justSaved = query.saved;
  const elsewhere = await editedElsewhere(type, page.id, themeStore);
  if (elsewhere) redirect(elsewhere);
  const role = themeStore ? await themeStoreRoleOf(page.id) : null;
  const context = role
    ? {
        ...base,
        adminBase: THEME_STORE_PAGES,
        dualPages: null,
        // A theme's page holds the theme's parts; the list may be on either (and on any of Kaizena Flow's pages).
        themeStore: { parts: role === "theme" ? [...THEME_STORE_PARTS] : (["list"] as const).slice() },
        place: { view: (await themeStoreView(role)).view, address: PLATFORM_ROLE_COPY[role].address },
        actions: { ...base.actions, remove: deleteThemeStorePageAction },
      }
    : base;
  const address = role ? PLATFORM_ROLE_COPY[role].address : `${context.siteBase}/${page.slug}`;
  const { lang, w } = await platformSiteWords();
  const notice =
    justSaved === "draft"
      ? w.pages.draftSaved
      : justSaved === "published"
        ? LAYOUT_TYPES.includes(type)
          ? w.pages.published
          : fillWords(w.pages.publishedAt, { address })
        : null;
  // A second document beside this one (D412); a theme store page (D285) has its own place and stays alone.
  const dual = role || !context.dualPages ? null : await platformDual({ kind: type as DualKind, id: page.id }, query, lang, admin.name ?? "");
  const bw = adminText(lang, "builder");
  if (dual && dual !== "refused" && context.dualPages) {
    return (
      <AdminTextScope texts={adminTexts(lang, PLATFORM_SITE_AREAS)}>
        <h1 className="sr-only">{fillWords(w.tables.editTitle, { title: page.draft.title || `${w.tables.untitled} ${w.tables.pageTypes[type].one}` })}</h1>
        <DualPageEditor
          left={{ doc: { kind: type as DualKind, id: page.id }, kindName: bw.dual.kinds[type as DualKind], props: { page, notice, savedParts: saved, terms, gridTerms, context } }}
          right={dual.right}
          layout={dual.layout}
          root={context.dualPages.root}
          pick={{ ...context.dualPages, templates: saved }}
          site={{ css: context.siteCss, name: bw.editor.kaizenSite, save: context.actions.saveSiteCss, versions: context.actions.cssVersions }}
        />
      </AdminTextScope>
    );
  }
  return (
    <AdminTextScope texts={adminTexts(lang, PLATFORM_SITE_AREAS)}>
      <h1 className="sr-only">{fillWords(w.tables.editTitle, { title: page.draft.title || `${w.tables.untitled} ${w.tables.pageTypes[type].one}` })}</h1>
      <PageEditor
        key={page.id}
        page={page}
        notice={dual === "refused" ? bw.dual.notOpened : notice}
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
