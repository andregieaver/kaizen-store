import { Suspense } from "react";

import { BuyerQuestion } from "@/components/buyer";
import { SiteConsent } from "@/components/consent/site-consent";
import { StoreAffiliate } from "@/components/store-affiliate";
import { StoreChat } from "@/components/site-chat";
import { liveCustomCode } from "@/lib/custom-code";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import type { Store } from "@/server/stores";

/**
 * What the store's pages carry that other sites' code can come in through (wave 1, 1e, `docs/wave-1-trust.md` 2.5, `docs/pci.md`): the
 * store's AI assistant, a friend's referral capture, the business popup, and the consent banner with the tracking tools and the owner's
 * own code it loads. The market layout draws them inside `OffPayRoutes`, which draws nothing on the cart, checkout and order, where a
 * shopper types a card; this file is the only place that imports them, and a test (`pay-routes.graph.test.ts`) holds that.
 */
export function MarketExtras({ store, market }: { store: Store; market: Market }) {
  const m = t(market.lang);
  return (
    <>
      {store.businessPopup && <BuyerQuestion storeId={store.id} labels={m.buyer} />}
      {/* The store's AI assistant (D81), while it is on. */}
      <Suspense fallback={null}>
        <StoreChat store={store} market={market} />
      </Suspense>
      {/* A friend's referral link (D131): read in the browser, kept in memory and, once allowed, in a cookie. */}
      <Suspense fallback={null}>
        <StoreAffiliate store={store} base={marketPath(store.slug, market.slug)} />
      </Suspense>
      {/* Asks about the store's optional tools and code, if it has any, in the market's language (D58, D61). */}
      <Suspense fallback={null}>
        <SiteConsent
          storeId={store.id}
          tracking={store.tracking}
          code={liveCustomCode(store.customCode)}
          lang={market.lang}
          locale={market.locale}
          cookiePage={marketPath(store.slug, market.slug, "/cookies")}
        />
      </Suspense>
    </>
  );
}
