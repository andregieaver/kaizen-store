import { ArticleView } from "@/components/article-view";
import { ScopedCss } from "@/components/custom-css";
import { FontLinks } from "@/components/font-links";
import { PageArticle } from "@/components/page-article";
import { ProductLayoutView } from "@/components/product-parts";
import { StoreSiteFooter, StoreSiteHeader } from "@/components/site-parts";
import { siteFontFamilies } from "@/lib/fonts";
import { t } from "@/lib/i18n";
import type { PageContent, PageType } from "@/lib/page-content";
import { themeAttributes, themeCss } from "@/lib/theme";
import { getProduct, listProducts } from "@/server/catalog";
import { siteFontStyle } from "@/server/fonts";
import type { Store } from "@/server/stores";

/**
 * A page's content drawn as the store's site will draw it, inside the admin (D127): the store's own CSS and the
 * page's kept inside the box, and each kind of page as the site draws it (a product layout with one of the store's
 * products, a header or footer in the store's first country, an article under its heading, a page as its rows).
 * Shared by the draft preview and the template preview. With `themed` the store's theme and fonts are applied too,
 * as the builder's canvas does, for a page that has no admin around it.
 */
export function PageDrawing({
  store,
  type,
  id,
  content,
  publishedAt,
  asked,
  themed = false,
}: {
  store: Store;
  type: PageType;
  /** The page's id, or the template's: where a grid or form on it is placed. */
  id: string;
  content: PageContent;
  /** When an article was first published; null for a draft. */
  publishedAt: string | null;
  /** A product layout's preview (D79): `product`, the handle of the product it is shown with. */
  asked?: string | string[] | undefined;
  themed?: boolean;
}) {
  const market = store.markets[0];
  const place = { pageId: id, owner: store.id, market: market?.code };
  const drawing = (
    // Whatever it draws stays inside the preview, even `position: fixed`.
    <div data-site-css="" className="flex flex-col gap-6 [contain:paint]">
      <ScopedCss css={[store.customCss, content.css]} root="[data-site-css]" />
      {type === "product_layout" ? (
        <LayoutPreview store={store} layout={content} asked={asked} />
      ) : (type === "header" || type === "footer") && market ? (
        // As the store draws it (D80), in its first country, with its own logo, menus and details.
        <div className="overflow-hidden rounded-lg border border-border">
          {type === "header" ? (
            <StoreSiteHeader store={store} market={market} notice={null} layout={{ id, content }} />
          ) : (
            <StoreSiteFooter store={store} market={market} layout={{ id, content }} />
          )}
        </div>
      ) : type === "article" ? (
        // As the blog will show it (D57), in the store's main language.
        <ArticleView
          content={content}
          date={publishedAt}
          byline={content.author || store.name}
          lang={market?.lang ?? "en"}
          locale={market?.locale ?? "en-GB"}
          place={place}
          inAdmin
        />
      ) : (
        <PageArticle content={content} place={place} inAdmin />
      )}
    </div>
  );
  if (!themed) return drawing;
  // The site's fonts (D59) and the store's theme (D60), as the builder's canvas draws them.
  return (
    <div
      style={siteFontStyle(store.fonts)}
      className="min-w-0 bg-background text-foreground"
      {...themeAttributes(store.theme.settings)}
      data-theme-canvas=""
    >
      <FontLinks families={siteFontFamilies(store.fonts)} />
      <style>{themeCss(store.theme.settings, "[data-theme-canvas]")}</style>
      {drawing}
    </div>
  );
}

/**
 * A product layout's saved draft with one of the store's products (D79), in
 * its main market: the first product unless one is chosen.
 */
async function LayoutPreview({
  store,
  layout,
  asked,
}: {
  store: Store;
  layout: PageContent;
  asked: string | string[] | undefined;
}) {
  const market = store.markets[0];
  const products = market ? await listProducts(store.id, market) : [];
  const chosen = products.find((p) => p.handle === asked) ?? products[0];
  const product = chosen && market ? await getProduct(store.id, market, chosen.handle) : null;
  if (!market || !product)
    return <p className="text-sm text-muted">Add a product with a price to see the layout with it.</p>;
  return (
    <>
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 font-medium">
          Shown with
          <select
            name="product"
            defaultValue={product.handle}
            className="min-h-10 rounded-md border border-border bg-background px-3"
          >
            {products.map((p) => (
              <option key={p.handle} value={p.handle}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-10 rounded-md border border-border px-4 font-medium">
          Show
        </button>
      </form>
      <div className="rounded-lg border border-border py-8">
        <ProductLayoutView layout={layout} ctx={{ store, market, product, m: t(market.lang) }} inAdmin />
      </div>
    </>
  );
}
