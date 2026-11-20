import { storePartDrawer } from "@/components/store-part-frame";

import { DeliveriesSection } from "./deliveries-section";

/** What a page built for the subscription boxes draws of the shop (D113): only the deliveries' own section (bloat review step 2.9). */
export const deliveriesParts = storePartDrawer(({ part, store, market, query }) => {
  switch (part) {
    case "deliveries":
      return <DeliveriesSection store={store} market={market} query={query} />;
    default:
      return null;
  }
});
