import { CartSavedNote, FreeShippingNote } from "@/components/shop-notes";
import { storePartDrawer } from "@/components/store-part-frame";

import { TermListing } from "./term-listing";

/** What a page built for category or tag pages draws of the shop (D140, D558): the term's listing and the basket's notes (bloat review step 2.9). */
export const termParts = storePartDrawer(({ part, store, market, route, query, m }) => {
  switch (part) {
    // A category's or tag's own listing (D140); the address carries the term's slug.
    case "category":
    case "tag":
      return route.param ? <TermListing store={store} market={market} kind={part} slug={route.param} query={query} /> : null;
    // The basket's notes (D558): on the cart, checkout, category and tag pages.
    case "free_shipping":
      return <FreeShippingNote store={store} market={market} m={m} />;
    case "you_saved":
      return <CartSavedNote store={store} market={market} m={m} />;
    default:
      return null;
  }
});
