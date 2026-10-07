import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ScopedCss } from "@/components/custom-css";
import { FontLinks } from "@/components/font-links";
import { PageArticle } from "@/components/page-article";
import { ProductCard } from "@/components/product-card";
import { ProductLayoutView } from "@/components/product-parts";
import { StoreSiteFooter, StoreSiteHeader } from "@/components/site-parts";
import { StoreFooter, StoreHeader } from "@/components/store-layout";
import { layoutForStore, type DesignLayoutKind } from "@/lib/design-presets";
import { t } from "@/lib/i18n";
import { pageFonts } from "@/lib/page-content";
import { marketPath } from "@/lib/paths";
import { DEFAULT_PRODUCT_LAYOUT } from "@/lib/product-layout";
import { themeAttributes, themeCss } from "@/lib/theme";
import { getAccount } from "@/server/auth";
import { campaignNotices } from "@/server/campaign-notices";
import { getProduct, listProducts } from "@/server/catalog";
import { adminDesignPreview, publicDesignPreview } from "@/server/design-presets";
import { siteFontStyle } from "@/server/fonts";
import { listPublishedPages } from "@/server/pages";
import { getStore, type Store } from "@/server/stores";

export const metadata: Metadata = { title: "Design profile preview", robots: { index: false, follow: false } };

/**
 * A design profile shown before it is chosen (D176, `docs/design-profiles.md` section 5): a store template's front page and one of its
 * products (the Standard store's when no template is named), drawn with the profile's theme, header, footer, product layout and CSS in
 * place of the store's own, exactly as `applyDesignPreset()` would place them (`layoutForStore()`), without writing anything. Open to
 * anyone, since people at sign-up are not signed in: it shows only a published profile on a published store template (or the Standard
 * store), its reads are cached per profile and template, it sets no cookie and reads none, and its content is inert (nothing can be
 * clicked, focused or submitted). With `as=admin`, a signed-in platform admin also sees unpublished profiles and templates. `noindex`.
 */
export default function DesignPreviewPage({ params, searchParams }: PageProps<"/admin/account/design-profiles/[presetId]/preview">) {
  return (
    <Suspense fallback={null}>
      <DesignPreview params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function DesignPreview({ params, searchParams }: Pick<PageProps<"/admin/account/design-profiles/[presetId]/preview">, "params" | "searchParams">) {
  const { presetId } = await params;
  const query = await searchParams;
  const starterId = typeof query.starter === "string" && query.starter ? query.starter : null;
  let preview;
  if (query.as === "admin") {
    // Only here is the visitor read: a platform admin may look at what is not published yet.
    const account = await getAccount();
    if (!account?.platformAdmin) notFound();
    preview = await adminDesignPreview(presetId, starterId);
  } else {
    preview = await publicDesignPreview(presetId, starterId);
  }
  if (!preview) notFound();
  const base = await getStore(preview.storeSlug);
  const market = base?.markets[0];
  if (!base || !market) notFound();

  const { snapshot } = preview;
  // The store as it would look with the profile applied: its own name, logos, menus and products, the profile's look.
  const store: Store = {
    ...base,
    theme: { base: snapshot.theme.base, savedId: null, settings: snapshot.theme.settings },
    fonts: snapshot.theme.settings.fonts,
    customCss: snapshot.css,
  };
  const menus = { header: base.headerMenuId, footer: base.footerMenuId };
  const layout = (kind: DesignLayoutKind) => {
    const kept = snapshot[kind];
    return kept ? { id: `preview-${kind}`, content: layoutForStore(kept, menus, { title: preview.title, slug: "preview" }) } : null;
  };
  const header = layout("header");
  const footer = layout("footer");
  const productLayout = layout("productLayout")?.content ?? DEFAULT_PRODUCT_LAYOUT;
  const m = t(market.lang);
  const [pages, products, notices] = await Promise.all([
    base.frontPageId ? listPublishedPages(base.id) : Promise.resolve([]),
    listProducts(base.id, market),
    campaignNotices(base.id, market),
  ]);
  const front = pages.find((page) => page.id === base.frontPageId) ?? null;
  const product = products[0] ? await getProduct(base.id, market, products[0].handle) : null;
  // The profile's fonts Kaizen has, and the front page's own (installed when it was saved).
  const families = [...new Set([...preview.fonts, ...(front ? pageFonts(front.content) : [])])];
  const home = marketPath(store.slug, market.slug);

  return (
    <div className="flex min-h-screen flex-col">
      <p role="status" className="sticky top-0 z-50 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-foreground px-4 py-2 text-xs text-background">
        <span className="font-medium">Preview of the design profile {preview.title}: nothing is saved or changed</span>
        <span>On {preview.starterTitle ?? "the Standard store"}: its front page, then one of its products.</span>
      </p>
      {/* Nothing in the preview can be clicked, focused or submitted. */}
      <div
        inert
        lang={market.lang}
        style={siteFontStyle(store.fonts)}
        className="pointer-events-none min-w-0 flex-1 select-none bg-background text-foreground"
        {...themeAttributes(store.theme.settings)}
        data-theme-canvas=""
        data-design-preview=""
      >
        <FontLinks families={families} />
        <style>{themeCss(store.theme.settings, "[data-theme-canvas]")}</style>
        <div data-site-css="" className="flex min-h-full flex-col [contain:paint]">
          {/* The profile's CSS, kept inside the preview as the admin's previews keep a store's (D100). */}
          <ScopedCss css={[store.customCss, header?.content.css, footer?.content.css, productLayout.css]} root="[data-site-css]" />
          {header ? <StoreSiteHeader store={store} market={market} notice={null} layout={header} /> : <StoreHeader store={store} market={market} notice={null} />}
          <main className="flex flex-col">
            {front ? (
              <div className="store-page">
                <PageArticle content={front.content} place={{ pageId: front.id, owner: store.id, market: market.slug }} inAdmin />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-(--content-width) px-4 py-8">
                <h1 className="mb-6 text-3xl font-heading tracking-tight">{m.products}</h1>
                <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
                  {products.slice(0, 8).map((p) => (
                    <ProductCard key={p.handle} product={p} href={`${home}/p/${p.handle}`} market={market} m={m} store={store.slug} base={home} notices={notices} />
                  ))}
                </ul>
              </div>
            )}
            {product && (
              <section aria-label={product.title} className="mx-auto w-full max-w-(--content-width) border-t border-border px-4 py-8">
                <ProductLayoutView layout={productLayout} ctx={{ store, market, product, m, campaigns: notices }} inAdmin />
              </section>
            )}
          </main>
          {footer ? <StoreSiteFooter store={store} market={market} layout={footer} /> : <StoreFooter store={store} market={market} />}
        </div>
      </div>
    </div>
  );
}
