import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { ArticleView } from "@/components/article-view";
import { PageArticle } from "@/components/page-article";
import { ScopedCss } from "@/components/custom-css";
import { KaizenSiteFooter, KaizenSiteHeader } from "@/components/site-parts";
import type { PageType } from "@/lib/page-content";
import { requirePlatformReader } from "@/server/auth";
import { getPlatformChrome } from "@/server/platform-navigation";
import { themeStoreRoleOf } from "@/server/platform-roles";
import { themeStorePage } from "@/server/theme-store";
import { themePartsWith } from "@/lib/theme-store-parts";
import { themeStorePageHref } from "@/lib/theme-admin-paths";
import { platformSiteWords } from "@/server/platform-site-words";

import { load, editedElsewhere, themeStoreView, type Params } from "./page-load";
import { typeWords } from "./type-words";

/** Kaizena Flow's page preview (D42, D57), apart from its editors (`editor-views.tsx`): a route loads every client component its modules import (bloat review step 0.10). */

type Query = Promise<Record<string, string | string[] | undefined>>;

/** The last saved draft, as the site will show it once published (D42); a theme's page (D285) with the first theme, or `?theme=`'s. */
export async function PreviewPageView({ type, params, searchParams, themeStore = false }: { type: PageType; params: Params; searchParams?: Query; themeStore?: boolean }) {
  await connection();
  await requirePlatformReader();
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
