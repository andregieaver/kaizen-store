import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArticleView } from "@/components/article-view";
import { ScopedCss } from "@/components/custom-css";
import { FontLinks } from "@/components/font-links";
import { PageArticle } from "@/components/page-article";
import { KaizenSiteFooter, KaizenSiteHeader } from "@/components/site-parts";
import { siteFontFamilies } from "@/lib/fonts";
import { newPageContent } from "@/lib/page-content";
import { LAYOUT_TYPE_LABELS } from "@/lib/page-layout";
import { KIND_LABELS } from "@/lib/templates";
import { themeAttributes, themeCss } from "@/lib/theme";
import { requirePlatformAdmin } from "@/server/auth";
import { siteFontStyle } from "@/server/fonts";
import { getPlatformChrome } from "@/server/platform-navigation";
import { previewKaizenTemplate } from "@/server/templates";

export const metadata: Metadata = { title: "Template preview", robots: { index: false, follow: false } };

/**
 * One of Kaizen's own templates shown in Kaizen's own builder before it is used (D236): drawn as Kaizen's pages are
 * (its theme, fonts and CSS, D235), view-only and inert, as a store's template preview is (D127). Platform admins only.
 */
export default async function KaizenTemplatePreviewPage({
  params,
}: PageProps<"/admin/account/templates/kaizen/[templateId]/preview">) {
  const { templateId } = await params;
  await requirePlatformAdmin();
  const result = await previewKaizenTemplate(templateId);
  if (!result.ok) notFound();
  const { preview } = result;
  const chrome = await getPlatformChrome();
  const what =
    preview.kind === "page" && preview.pageType
      ? `${KIND_LABELS.page.one} for ${LAYOUT_TYPE_LABELS[preview.pageType].many}`
      : KIND_LABELS[preview.kind].one;
  const content = { ...newPageContent(), title: preview.name, rows: preview.rows, css: preview.css };
  const place = { pageId: preview.id, owner: null };
  const type = preview.pageType ?? "page";
  return (
    <div className="flex min-h-screen flex-col">
      <p
        role="status"
        className="sticky top-0 z-50 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-foreground px-4 py-2 text-xs text-background"
      >
        <span className="font-medium">Preview — nothing is saved or copied</span>
        <span>
          {preview.name} · {what} · by {preview.publisher}
        </span>
      </p>
      {/* Nothing in the template can be clicked, focused or submitted. */}
      <div inert className="pointer-events-none min-w-0 flex-1 select-none">
        <div
          style={siteFontStyle(chrome.fonts)}
          className="min-w-0 bg-background text-foreground"
          {...themeAttributes(chrome.theme.settings)}
          data-theme-canvas=""
        >
          <FontLinks families={siteFontFamilies(chrome.fonts)} />
          <style>{themeCss(chrome.theme.settings, "[data-theme-canvas]")}</style>
          <div data-site-css="" className="flex flex-col gap-6 [contain:paint]">
            <ScopedCss css={[chrome.customCss, content.css]} root="[data-site-css]" />
            {type === "header" ? (
              <KaizenSiteHeader chrome={chrome} layout={{ id: preview.id, content }} />
            ) : type === "footer" ? (
              <KaizenSiteFooter chrome={chrome} layout={{ id: preview.id, content }} />
            ) : type === "article" ? (
              <ArticleView content={content} date={null} byline="Kaizen" lang="en" locale="en-GB" place={place} inAdmin />
            ) : (
              <PageArticle content={content} place={place} inAdmin />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
