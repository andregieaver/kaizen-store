import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ScopedCss } from "@/components/custom-css";
import { FontLinks } from "@/components/font-links";
import { PageArticle } from "@/components/page-article";
import { ProductLayoutView } from "@/components/product-parts";
import { StoreSiteFooter, StoreSiteHeader } from "@/components/site-parts";
import { StoreFooter, StoreHeader } from "@/components/store-layout";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { t } from "@/lib/i18n";
import { pageFonts, type PageContent } from "@/lib/page-content";
import { DEFAULT_PRODUCT_LAYOUT } from "@/lib/product-layout";
import { themeLayersOf } from "@/lib/section-styles";
import { themeAttributes, themeCss } from "@/lib/theme";
import { themeFontFamilies } from "@/lib/theme-elements";
import { campaignNotices } from "@/server/campaign-notices";
import { getProduct, listProducts } from "@/server/catalog";
import { siteFontStyle } from "@/server/fonts";
import { requirePermission } from "@/server/permissions";
import type { Store } from "@/server/stores";
import { installPreview, previewPageContent } from "@/server/theme-preview";

export const metadata: Metadata = { title: "Theme preview", robots: { index: false, follow: false } };

/**
 * An installed theme on the store's own pages (D244, `docs/theme-phase-2.md` step 3): one of its published pages or articles, or one of its
 * products, drawn with the theme's settings, section styles, header, footer, product page and CSS in place of the live ones, without writing
 * anything. Served here in the admin rather than on the storefront: it is read per request for the signed-in person (`website:read`), is
 * `noindex`, sets no cookie, and its content is inert, so no visitor and no cached page of the site ever sees it. The pages to look at are
 * links above it (`?page=` an id, `?product=1`).
 */
export default async function ThemePreviewPage({ params, searchParams }: PageProps<"/admin/[store]/settings/design/themes/[install]/preview">) {
  const { store: slug, install: installId } = await params;
  const query = await searchParams;
  const { store: base, account } = await requirePermission(slug, "website:read");
  const { common: c, preview: w } = adminText(adminLangOf(account.adminLocale), "design");
  const preview = await installPreview(base.id, installId);
  const market = base.markets[0];
  if (!preview || !market) notFound();

  // The store as it would look with this theme live: its own name, logos, menus, pages and products; the theme's look.
  const store: Store = { ...base, theme: preview.theme, fonts: preview.theme.settings.fonts, customCss: preview.css };
  const m = t(market.lang);
  const wantsProduct = query.product === "1";
  const pageId = typeof query.page === "string" ? query.page : null;
  const chosen = preview.pages.find((page) => page.id === pageId) ?? preview.pages.find((page) => page.id === base.frontPageId) ?? preview.pages[0] ?? null;
  const [content, product, notices] = await Promise.all([
    !wantsProduct && chosen ? previewPageContent(base.id, chosen.id) : Promise.resolve(null as PageContent | null),
    wantsProduct ? listProducts(base.id, market).then((list) => (list[0] ? getProduct(base.id, market, list[0].handle) : null)) : Promise.resolve(null),
    campaignNotices(base.id, market),
  ]);
  const productLayout = preview.productLayout?.content ?? DEFAULT_PRODUCT_LAYOUT;
  const families = [
    ...new Set([
      ...themeFontFamilies(preview.theme.settings),
      ...[preview.header?.content, preview.footer?.content, content, wantsProduct ? productLayout : null].flatMap((c) => (c ? pageFonts(c) : [])),
    ]),
  ];
  const here = `/admin/${base.slug}/settings/design/themes/${preview.install.id}/preview`;
  const shown = wantsProduct ? w.aProductShown : chosen ? fillWords(c.quote, { title: chosen.title }) : w.noPageShown;

  return (
    <div className="flex min-h-screen flex-col">
      <div role="status" className="sticky top-0 z-50 flex flex-col gap-1.5 bg-foreground px-4 py-2 text-xs text-background">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-medium">
            {fillWords(w.banner, { name: preview.install.title, live: preview.install.live ? w.yourLive : "", shown })}
          </span>
          <Link href={`/admin/${base.slug}/settings/design${preview.install.live ? "" : `/themes/${preview.install.id}`}`} className="underline">
            {w.back}
          </Link>
        </p>
        <nav aria-label={w.pagesLabel} className="flex flex-wrap gap-x-3 gap-y-1">
          {preview.pages.slice(0, 30).map((page) => (
            <Link key={page.id} href={`${here}?page=${page.id}`} aria-current={!wantsProduct && chosen?.id === page.id ? "page" : undefined} className="underline aria-[current=page]:no-underline aria-[current=page]:font-medium">
              {page.title}
            </Link>
          ))}
          <Link href={`${here}?product=1`} aria-current={wantsProduct ? "page" : undefined} className="underline aria-[current=page]:no-underline aria-[current=page]:font-medium">
            {w.aProduct}
          </Link>
        </nav>
      </div>
      {/* Nothing in the preview can be clicked, focused or submitted. */}
      <div
        inert
        lang={market.lang}
        style={siteFontStyle(store.fonts)}
        className="pointer-events-none min-w-0 flex-1 select-none bg-background text-foreground"
        {...themeAttributes(store.theme.settings)}
        data-theme-canvas=""
        data-theme-preview=""
      >
        <FontLinks families={families} />
        <style>{themeCss(store.theme.settings, "[data-theme-canvas]")}</style>
        <div data-site-css="" className="flex min-h-full flex-col [contain:paint]">
          {/* The theme's CSS, kept inside the preview as the admin's previews keep a store's (D100). */}
          <ScopedCss css={[store.customCss, preview.header?.content.css, preview.footer?.content.css, wantsProduct ? productLayout.css : content?.css]} root="[data-site-css]" />
          {preview.header ? <StoreSiteHeader store={store} market={market} notice={null} layout={preview.header} /> : <StoreHeader store={store} market={market} notice={null} />}
          <main className="flex flex-col">
            {wantsProduct ? (
              product ? (
                <div className="mx-auto w-full max-w-(--content-width) px-4 py-8">
                  <ProductLayoutView layout={productLayout} ctx={{ store, market, product, m, campaigns: notices }} inAdmin />
                </div>
              ) : (
                <p className="mx-auto w-full max-w-(--content-width) px-4 py-8">{w.noProduct}</p>
              )
            ) : content && chosen ? (
              <div className="store-page">
                <PageArticle content={content} place={{ pageId: chosen.id, owner: store.id, market: market.slug, theme: themeLayersOf(store.theme.settings) }} inAdmin />
              </div>
            ) : (
              <p className="mx-auto w-full max-w-(--content-width) px-4 py-8">{w.noPage}</p>
            )}
          </main>
          {preview.footer ? <StoreSiteFooter store={store} market={market} layout={preview.footer} /> : <StoreFooter store={store} market={market} />}
        </div>
      </div>
    </div>
  );
}
