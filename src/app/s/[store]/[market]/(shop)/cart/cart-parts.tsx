import { CartUpsell } from "@/components/cart-upsell";
import { CartSavedNote, FreeShippingNote } from "@/components/shop-notes";
import { storePartDrawer } from "@/components/store-part-frame";

import { CartCheckout, CartCode, CartContents, CartContinue, CartCredits, CartGift, CartLines, CartSummary } from "./cart-contents";

/** What a page built for the cart draws of the shop (D113, D117, D558, D559): only the cart's own sections (bloat review step 2.9). */
export const cartParts = storePartDrawer(({ part, store, market, m, holdsGift }) => {
  switch (part) {
    case "cart":
      return <CartContents store={store} market={market} m={m} />;
    case "cart_lines":
      return <CartLines store={store} market={market} m={m} />;
    case "cart_gift":
      return <CartGift store={store} market={market} m={m} />;
    case "cart_summary":
      return <CartSummary store={store} market={market} m={m} />;
    case "cart_code":
      return <CartCode store={store} market={market} m={m} />;
    case "cart_credits":
      return <CartCredits store={store} market={market} m={m} />;
    case "cart_checkout":
      return <CartCheckout store={store} market={market} m={m} drawGift={!holdsGift} />;
    case "cart_continue":
      return <CartContinue store={store} market={market} m={m} />;
    // What goes with the cart (D559): on the cart and checkout pages.
    case "cart_upsell":
      return <CartUpsell store={store} market={market} m={m} />;
    // The basket's notes (D558): on the cart, checkout, category and tag pages.
    case "free_shipping":
      return <FreeShippingNote store={store} market={market} m={m} />;
    case "you_saved":
      return <CartSavedNote store={store} market={market} m={m} />;
    default:
      return null;
  }
});
