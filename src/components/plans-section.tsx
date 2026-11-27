import type { PlansBlock } from "@/lib/page-content";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { plansIn } from "@/lib/plan-words";
import type { GridPlace } from "@/server/content-grid";
import { storeSlugOf } from "@/server/menus";
import { placeLang, sitePlaceLang } from "@/server/place-lang";
import { getPublicPlans } from "@/server/public-plans";
import { marketIn } from "@/server/shop";
import { getOpenStore } from "@/server/stores";

import { PlansView } from "./plans-view";

/**
 * The Plans component where a page is shown. On a store's page (D912) the store's own plans: its plan products offered in the shopper's
 * market, priced in it, each card's button putting the plan in the cart (`getStorePlans()`, cached with the catalogue). On Kaizena Flow's own
 * pages, and on its own store while that serves Kaizena Flow's site (D484), Kaizena Flow's plans (D142): the active plans and their features
 * (cached, refreshed when the platform changes a plan), in the page's language (D312: its words, and the plans' own lines and features where
 * they are written in it, `plansIn()`). Draws nothing when no plan has a price.
 */
export async function PlansSection({ block, place }: { block: PlansBlock; place: GridPlace }) {
  if (place.owner) {
    const slug = await storeSlugOf(place.owner);
    const store = slug ? await getOpenStore(slug) : null;
    if (store && !store.house) {
      const market = marketIn(store, place.market);
      if (!market) return null;
      // Loaded where a store's plans are drawn only: every other page with a grid keeps out the cart and its action.
      const [{ getStorePlans }, { storePlansData, planAgreements }, { choosePlanAction }] = await Promise.all([
        import("@/server/store-plans"),
        import("@/lib/store-plans"),
        import("@/app/s/[store]/[market]/(shop)/cart/plan-action"),
      ]);
      const { plans, withVat } = await getStorePlans(store.id, market);
      // What a plan's button agrees to, where a plan skips the cart (D915): its words loaded only then.
      const agreed = plans.some((plan) => plan.skipsCart)
        ? planAgreements(plans, t(market.lang), (minor) => formatMoney(minor, market.currency, market.locale, market.priceStyle), (await import("@/lib/direct-buy-words")).directBuyWords(market.lang).lead)
        : undefined;
      return (
        <PlansView
          block={{ ...block, currency: undefined }}
          data={storePlansData(plans)}
          lang={await placeLang(place)}
          sale={{ action: choosePlanAction, store: store.slug, market: market.slug, plans, withVat, agreed }}
        />
      );
    }
  }
  // Kaizena Flow's own page's language, or its own store's market's (D484).
  const lang = await sitePlaceLang(place);
  return <PlansView block={block} data={plansIn(await getPublicPlans(), lang)} lang={lang} />;
}
