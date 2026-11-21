import type { Market } from "@/lib/markets";
import type { PageContent } from "@/lib/page-content";
import { headerOverlays } from "@/lib/site-layout";
import type { GridPlace } from "@/server/content-grid";
import { bindForPlace } from "@/server/field-binding";
import { headerLayoutById, siteLayoutFor, type SiteLayout } from "@/server/site-layouts";
import type { Store } from "@/server/stores";

import { CustomCss } from "./custom-css";
import { PageArticle, pageRoomClass, type StorePartDrawer } from "./page-article";
import { HeaderOverlayMark, PageHeaderMark } from "./store-chrome";

/**
 * A store's page (D54) inside the storefront's `<main>`, which keeps to the
 * content's width with room around it: the marker class lets `<main>` drop
 * both for pages, so rows can span the whole window and keep to the width
 * themselves (`PageArticle`). A page the store's header lies over (D80)
 * says so for the stylesheet. A page with a header of its own (`PageContent.header`: the special pages' *Header*) draws it above
 * itself, and the site's header gives way to it (`PageHeaderMark`); `shop` is the store and market it is drawn for, where one can be.
 */
export async function StorePageArticle({
  content: page,
  place,
  front = false,
  editable = false,
  storePart,
  shop,
}: {
  content: PageContent;
  /** The store and market the page is drawn in, for a header of its own; without them the site's header shows. */
  shop?: { store: Store; market: Market };
  place: GridPlace;
  front?: boolean;
  /** On a working page, what draws its shop components (`RolePage`, `StorePartDrawer`). */
  storePart?: StorePartDrawer;
  /** Signed-in staff may change its headings' and texts' words where they stand (D192): `PageArticle`'s. */
  editable?: boolean;
}) {
  // Blocks bound to the page's custom fields (D118) show their values; a page with none is left as it is and stays prerendered.
  const content = await bindForPlace(page, place);
  const [site, chosen] = await Promise.all([
    place.owner ? siteLayoutFor(place.owner, "header") : null,
    shop && page.header ? headerLayoutById(shop.store.id, page.header) : null,
  ]);
  // The site's own header chosen as the page's is simply the site's.
  const own = shop && chosen && chosen.id !== site?.id ? chosen : null;
  const header = own ?? site;
  const over = headerOverlays(header?.content.overlay, { front, categories: content.categories, tags: content.tags, rows: content.rows });
  return (
    <>
      {own && shop && <OwnHeader shop={shop} layout={own} />}
      <div className={`store-page ${pageRoomClass(content, "pt-8", "pb-8")}`} data-header-overlay={over ? "" : undefined}>
        {over && <HeaderOverlayMark />}
        <PageArticle content={content} place={place} editable={editable} storePart={storePart} />
      </div>
    </>
  );
}

/**
 * A page's own header in place of the site's: its CSS, the mark that hides the site's header, and the header as the site draws one. Its
 * modules are loaded only for a page that has one, so a page without stays as light as before.
 */
async function OwnHeader({ shop, layout }: { shop: { store: Store; market: Market }; layout: SiteLayout }) {
  const [{ StoreSiteHeader }, { storeNotice }, { featureOn, showsWithdrawalLink }, { afterSaleOpenCached }] = await Promise.all([
    import("./site-parts"),
    import("./store-layout"),
    import("@/lib/store-features"),
    import("@/server/after-sale"),
  ]);
  const { store, market } = shop;
  const withdrawal = showsWithdrawalLink(store, featureOn(store, "shop") || (await afterSaleOpenCached(store.id)));
  return (
    <>
      <PageHeaderMark />
      <CustomCss css={layout.content.css} name={`header-${layout.id}`} />
      <StoreSiteHeader store={store} market={market} notice={storeNotice(store, market)} layout={layout} withdrawal={withdrawal} pageOwn />
    </>
  );
}
