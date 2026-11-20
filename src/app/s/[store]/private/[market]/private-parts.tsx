import { storePartDrawer } from "@/components/store-part-frame";

import { PrivateSection } from "./private-section";

/** What a private store's landing page draws of the shop (D113): only the password's own section (bloat review step 2.9). */
export const privateParts = storePartDrawer(({ part, store, market, query }) => {
  switch (part) {
    // A private store's password (D339): only on its landing page.
    case "private":
      return <PrivateSection store={store} market={market} query={query} />;
    default:
      return null;
  }
});
