import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ArticleView } from "@/components/article-view";
import { ScopedCss } from "@/components/custom-css";
import { FontLinks } from "@/components/font-links";
import { PageArticle } from "@/components/page-article";
import { PlatformFooter, PlatformHeader } from "@/components/platform-layout";
import { KaizenSiteFooter, KaizenSiteHeader } from "@/components/site-parts";
import { pageFonts } from "@/lib/page-content";
import { themeLayersOf } from "@/lib/section-styles";
import { themeAttributes, themeCss } from "@/lib/theme";
import { themeFontFamilies } from "@/lib/theme-elements";
import { requirePlatformAdmin } from "@/server/auth";
import { siteFontStyle } from "@/server/fonts";
import { getPlatformChrome } from "@/server/platform-navigation";
import { getPlatformPageRoles } from "@/server/platform-roles";
import { platformInstallPreview, platformPreviewPage } from "@/server/platform-theme-preview";

export const metadata: Metadata = { title: "Theme preview", robots: { index: false, follow: false } };

/**
 * One of Kaizena Flow's installed themes on its own pages (D252, `docs/theme-phase-4.md` step 2), as a store's preview is (D244): one of its
 * published pages or articles drawn with the theme's settings, section styles, fonts, header, footer and CSS in place of the live ones,
 * without writing anything. Platform admins only, read per request, `noindex`, inert; no visitor and no cached page sees it. The pages to look
 * at are links above it (`?page=` an id).
 */
export default async function PlatformThemePreviewPage({ params, searchParams }: PageProps<"/admin/platform/themes/[install]/preview">) {
  await connection();
  await requirePlatformAdmin();
  const { install: installId } = await params;
  const query = await searchParams;
  const [preview, base, roles] = await Promise.all([platformInstallPreview(installId), getPlatformChrome(), getPlatformPageRoles()]);
  if (!preview) notFound();
  const frontPageId = roles.find(([role]) => role === "front")?.[1] ?? null;

  // Kaizena Flow's site as it would look with this theme live: its own logos, menus and pages; the theme's look.
  const chrome = { ...base, theme: preview.theme, fonts: preview.theme.settings.fonts, customCss: preview.css };
  const theme = themeLayersOf(preview.theme.settings);
  const pageId = typeof query.page === "string" ? query.page : null;
  const chosen = preview.pages.find((page) => page.id === pageId) ?? preview.pages.find((page) => page.id === frontPageId) ?? preview.pages[0] ?? null;
  const shown = chosen ? await platformPreviewPage(chosen.id) : null;
  const families = [
    ...new Set([...themeFontFamilies(preview.theme.settings), ...[preview.header?.content, preview.footer?.content, shown?.content].flatMap((c) => (c ? pageFonts(c) : []))]),
  ];
  const here = `/admin/platform/themes/${preview.install.id}/preview`;
  const place = chosen ? { pageId: chosen.id, owner: null, theme } : null;

  return (
    <div className="flex min-h-screen flex-col">
      <div role="status" className="sticky top-0 z-50 flex flex-col gap-1.5 bg-foreground px-4 py-2 text-xs text-background">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-medium">
            Preview of “{preview.install.title}”{preview.install.live ? ", the live theme," : ""} on {chosen ? `“${chosen.title}”` : "no page"}: nothing is saved, and visitors do
            not see it
          </span>
          <Link href={preview.install.live ? "/admin/platform/themes" : `/admin/platform/themes/${preview.install.id}`} className="underline">
            Back to the theme
          </Link>
        </p>
        <nav aria-label="Pages to preview" className="flex flex-wrap gap-x-3 gap-y-1">
          {preview.pages.slice(0, 30).map((page) => (
            <Link key={page.id} href={`${here}?page=${page.id}`} aria-current={chosen?.id === page.id ? "page" : undefined} className="underline aria-[current=page]:no-underline aria-[current=page]:font-medium">
              {page.title}
            </Link>
          ))}
        </nav>
      </div>
      {/* Nothing in the preview can be clicked, focused or submitted. */}
      <div
        inert
        lang="en"
        style={siteFontStyle(chrome.fonts)}
        className="pointer-events-none min-w-0 flex-1 select-none bg-background text-foreground"
        {...themeAttributes(chrome.theme.settings)}
        data-theme-canvas=""
        data-theme-preview=""
      >
        <FontLinks families={families} />
        <style>{themeCss(chrome.theme.settings, "[data-theme-canvas]")}</style>
        <div data-site-css="" className="flex min-h-full flex-col [contain:paint]">
          {/* The theme's CSS, kept inside the preview as the admin's previews keep a site's (D100). */}
          <ScopedCss css={[chrome.customCss, preview.header?.content.css, preview.footer?.content.css, shown?.content.css]} root="[data-site-css]" />
          {preview.header ? <KaizenSiteHeader chrome={chrome} layout={preview.header} theme={theme} /> : <PlatformHeader chrome={chrome} />}
          <main className="flex flex-col">
            {shown && place ? (
              shown.type === "article" ? (
                <ArticleView content={shown.content} date={shown.publishedAt} byline="Kaizena Flow" lang="en" locale="en-GB" place={place} inAdmin />
              ) : (
                <PageArticle content={shown.content} place={place} inAdmin />
              )
            ) : (
              <p className="mx-auto w-full max-w-(--content-width) px-4 py-8">Kaizena Flow has no published page to show yet.</p>
            )}
          </main>
          {preview.footer ? <KaizenSiteFooter chrome={chrome} layout={preview.footer} theme={theme} /> : <PlatformFooter chrome={chrome} />}
        </div>
      </div>
    </div>
  );
}
