import { storePartDrawer } from "@/components/store-part-frame";

import { SubscriptionSection } from "./subscription-section";

/** What a page built for a subscription draws of the shop (D113): only the subscription's own section (bloat review step 2.9). */
export const subscriptionParts = storePartDrawer(({ part, store, market, route }) => {
  switch (part) {
    case "subscription":
      return route.param ? <SubscriptionSection store={store} market={market} token={route.param} /> : null;
    default:
      return null;
  }
});
