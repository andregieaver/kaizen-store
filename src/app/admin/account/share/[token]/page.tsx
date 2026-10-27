import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageDrawing } from "@/app/admin/(gated)/[store]/pages/drawing";
import { InstallPreviewView } from "@/components/admin/install-preview-view";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { pageInput } from "@/lib/page-content";
import { getPageForEdit } from "@/server/pages";
import { previewLinkOf } from "@/server/preview-links";
import { getStore } from "@/server/stores";
import { installPreview } from "@/server/theme-preview";

// Never in a search engine, and the token in the address never leaves in a Referer when a link on the page is followed.
export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * What a preview link opens (wave 7 unit F, D340, `docs/wave-7-storefront.md` F): one page's or article's **draft**, read per request, or a
 * store's pages in one installed theme, for anyone who has the link and without signing in, until it runs out or is revoked. It is not
 * behind a sign-in, as the person it was shared with has none: the token in the address opens this one draft or theme and nothing else
 * (`previewLinkOf()`, the token's hash looked up). Nothing here reads the published page or its cached copy, sets a cookie, tracks or chats;
 * a wrong, expired or revoked token, or a store that is not open, finds nothing, and says no more.
 */
export default function SharedPreviewPage({ params, searchParams }: PageProps<"/admin/account/share/[token]">) {
  // It reads the address and the database: shown as they arrive, never prerendered.
  return (
    <Suspense fallback={null}>
      <Shared params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Shared({ params, searchParams }: Pick<PageProps<"/admin/account/share/[token]">, "params" | "searchParams">) {
  const { token } = await params;
  const link = await previewLinkOf(token);
  if (!link) notFound();
  const store = await getStore(link.storeSlug);
  if (!store || store.id !== link.storeId) notFound();
  // The words around it are in the store's own language where the admin has it, else English.
  const lang = adminLangOf(store.localization.locales[0]);
  const w = adminText(lang, "schedules").preview;
  const until = fillWords(w.until, {
    when: new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "long", timeStyle: "short", timeZone: store.timeZone }).format(new Date(link.expiresAt)),
  });

  if (link.kind === "theme") {
    const preview = await installPreview(store.id, link.installId);
    if (!preview || !store.markets[0]) notFound();
    const query = await searchParams;
    const d = adminText(lang, "design").preview;
    return (
      <div data-shared-preview="theme">
        <InstallPreviewView
          base={store}
          preview={preview}
          pageId={typeof query.page === "string" ? query.page : null}
          wantsProduct={query.product === "1"}
          here={`/admin/account/share/${token}`}
          words={{ pagesLabel: w.pagesLabel, aProduct: w.aProduct, noProduct: d.noProduct, noPage: d.noPage }}
          banner={() => (
            <>
              <span className="font-medium">{fillWords(w.bannerTheme, { store: store.name, theme: preview.install.title })}</span>
              <span>{until}</span>
            </>
          )}
        />
      </div>
    );
  }

  const page = await getPageForEdit(store.id, link.pageId, link.type);
  const content = page ? pageInput.safeParse(page.draft) : null;
  if (!page || !content?.success) notFound();
  return (
    <div data-shared-preview="page" className="min-h-screen">
      <p role="status" className="sticky top-0 z-50 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-foreground px-4 py-2 text-xs text-background">
        <span className="font-medium">{fillWords(w.banner, { store: store.name })}</span>
        <span>{until}</span>
      </p>
      <PageDrawing themed store={store} type={link.type} id={page.id} content={content.data} publishedAt={null} />
    </div>
  );
}
