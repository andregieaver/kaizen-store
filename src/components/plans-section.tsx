import type { PlansBlock } from "@/lib/page-content";
import { getPublicPlans } from "@/server/public-plans";

import { PlansView } from "./plans-view";

/**
 * Kaizen's plans on one of its pages (D142): the active plans and their features, read where the page is shown
 * (cached, refreshed when the platform changes a plan). Draws nothing when no plan has a price.
 */
export async function PlansSection({ block }: { block: PlansBlock }) {
  // Kaizen's own pages are in English (`placeLang`).
  return <PlansView block={block} data={await getPublicPlans()} lang="en" />;
}
