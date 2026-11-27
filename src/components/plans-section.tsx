import type { PlansBlock } from "@/lib/page-content";
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
 * they are written in it, `plansIn()`). Draws nothing when no plan has a price. A store's table may show one product category's plans (D914).
 */
export async function PlansSection({ block, place }: { block: PlansBlock; place: GridPlace }) {
  if (place.owner) {
    const slug = await storeSlugOf(place.owner);
    const store = slug ? await getOpenStore(slug) : null;
    if (store && !store.house) {
      const market = marketIn(store, place.market);
      if (!market) return null;
      // Loaded where a store's plans are drawn only: every other page with a grid keeps out the cart and its action.
      const [{ getStorePlans }, { storePlansData, plansOfCategory }, { choosePlanAction }] = await Promise.all([
        import("@/server/store-plans"),
        import("@/lib/store-plans"),
        import("@/app/s/[store]/[market]/(shop)/cart/plan-action"),
      ]);
      // A pricing table of one product category shows the plans in it or under it (D914); every plan when it names none.
      const all = await getStorePlans(store.id, market);
      const plans = plansOfCategory(all.plans, block.categoryId);
      const withVat = all.withVat;
      return (
        <PlansView
          block={{ ...block, currency: undefined }}
          data={storePlansData(plans)}
          lang={await placeLang(place)}
          sale={{ action: choosePlanAction, store: store.slug, market: market.slug, plans, withVat }}
        />
      );
    }
  }
  // Kaizena Flow's own page's language, or its own store's market's (D484).
  const lang = await sitePlaceLang(place);
  return <PlansView block={block} data={plansIn(await getPublicPlans(), lang)} lang={lang} />;
}
