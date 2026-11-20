import { storePartDrawer } from "@/components/store-part-frame";

import { CookiesSection } from "./cookies-section";

/** What a page built for the cookie list draws of the shop (D113): only the cookie list's own section (bloat review step 2.9). */
export const cookiesParts = storePartDrawer(({ part, store, market }) => {
  switch (part) {
    case "cookies":
      return <CookiesSection store={store} market={market} />;
    default:
      return null;
  }
});
