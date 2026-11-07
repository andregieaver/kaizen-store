import type { PlansBlock } from "@/lib/page-content";
import { plansIn } from "@/lib/plan-words";
import type { GridPlace } from "@/server/content-grid";
import { sitePlaceLang } from "@/server/place-lang";
import { getPublicPlans } from "@/server/public-plans";

import { PlansView } from "./plans-view";

/**
 * Kaizen's plans on one of its pages (D142): the active plans and their features, read where the page is shown
 * (cached, refreshed when the platform changes a plan), in the page's language (D312: its words, and the plans' own
 * lines and features where they are written in it, `plansIn()`). Draws nothing when no plan has a price.
 */
export async function PlansSection({ block, place }: { block: PlansBlock; place: GridPlace }) {
  // Kaizena Flow's own page's language, or its own store's market's (D484).
  const lang = await sitePlaceLang(place);
  return <PlansView block={block} data={plansIn(await getPublicPlans(), lang)} lang={lang} />;
}
