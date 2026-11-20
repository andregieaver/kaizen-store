import { storePartDrawer } from "@/components/store-part-frame";

import { WishlistSection } from "./wishlist-section";

/** What a page built for the wishlists draws of the shop (D113): only the wishlist's own section (bloat review step 2.9). */
export const wishlistParts = storePartDrawer(({ part, store, market, query }) => {
  switch (part) {
    case "wishlist":
      return <WishlistSection store={store} market={market} query={query} />;
    default:
      return null;
  }
});
