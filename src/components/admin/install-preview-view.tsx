import Link from "next/link";
import type { ReactNode } from "react";

import { ScopedCss } from "@/components/custom-css";
import { FontLinks } from "@/components/font-links";
import { PageArticle } from "@/components/page-article";
import { ProductLayoutView } from "@/components/product-parts";
import { StoreSiteFooter, StoreSiteHeader } from "@/components/site-parts";
import { StoreFooter, StoreHeader } from "@/components/store-layout";
import { t } from "@/lib/i18n";
import { pageFonts, type PageContent } from "@/lib/page-content";
import { DEFAULT_PRODUCT_LAYOUT } from "@/lib/product-layout";
import { themeLayersOf } from "@/lib/section-styles";
import { themeAttributes, themeCss } from "@/lib/theme";
import { themeFontFamilies } from "@/lib/theme-elements";
import { campaignNotices } from "@/server/campaign-notices";
import { getProduct, listProducts } from "@/server/catalog";
import { siteFontStyle } from "@/server/fonts";
import type { Store } from "@/server/stores";
import { previewPageContent, type InstallPreview } from "@/server/theme-preview";

/**
 * An installed theme on the store's own pages (D244), drawn for the signed-in preview and for a preview link (D340) alike: one of the
 * store's published pages or articles, or one of its products, with the theme's settings, section styles, header, footer, product page and
 * CSS in place of the live ones, without writing anything. Its content is inert. The pages to look at are links in the bar above it, to
 * `here` with `?page=` an id or `?product=1`.
 */
export async function InstallPreviewView({
  base,
  preview,
  pageId,
  wantsProduct,
  here,
  banner,
  words,
}: {
  base: Store;
  preview: InstallPreview;
  pageId: string | null;
  wantsProduct: boolean;
  /** Where the bar's links go: the preview's own address. */
  here: string;
  /** The bar's first line: what this is, and a way back where there is one. */
  banner: (shown: { page: { id: string; title: string } | null; product: boolean }) => ReactNode;
  words: { pagesLabel: string; aProduct: string; noProduct: string; noPage: string };
}) {
  const market = base.markets[0];
  if (!market) return null;
  // The store as it would look with this theme live: its own name, logos, menus, pages and products; the theme's look.
  const store: Store = { ...base, theme: preview.theme, fonts: preview.theme.settings.fonts, customCss: preview.css };
  const m = t(market.lang);
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

  return (
    <div className="flex min-h-screen flex-col">
      <div role="status" className="sticky top-0 z-50 flex flex-col gap-1.5 bg-foreground px-4 py-2 text-xs text-background">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">{banner({ page: wantsProduct || !chosen ? null : { id: chosen.id, title: chosen.title }, product: wantsProduct })}</p>
        <nav aria-label={words.pagesLabel} className="flex flex-wrap gap-x-3 gap-y-1">
          {preview.pages.slice(0, 30).map((page) => (
            <Link key={page.id} href={`${here}?page=${page.id}`} aria-current={!wantsProduct && chosen?.id === page.id ? "page" : undefined} className="underline aria-[current=page]:no-underline aria-[current=page]:font-medium">
              {page.title}
            </Link>
          ))}
          <Link href={`${here}?product=1`} aria-current={wantsProduct ? "page" : undefined} className="underline aria-[current=page]:no-underline aria-[current=page]:font-medium">
            {words.aProduct}
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
                <p className="mx-auto w-full max-w-(--content-width) px-4 py-8">{words.noProduct}</p>
              )
            ) : content && chosen ? (
              <div className="store-page">
                <PageArticle content={content} place={{ pageId: chosen.id, owner: store.id, market: market.slug, theme: themeLayersOf(store.theme.settings) }} inAdmin />
              </div>
            ) : (
              <p className="mx-auto w-full max-w-(--content-width) px-4 py-8">{words.noPage}</p>
            )}
          </main>
          {preview.footer ? <StoreSiteFooter store={store} market={market} layout={preview.footer} /> : <StoreFooter store={store} market={market} />}
        </div>
      </div>
    </div>
  );
}
