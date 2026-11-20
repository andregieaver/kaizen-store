import { CartUpsell } from "@/components/cart-upsell";
import { CartSavedNote, FreeShippingNote } from "@/components/shop-notes";
import { storePartDrawer } from "@/components/store-part-frame";

import {
  Checkout,
  CheckoutBack,
  CheckoutCode,
  CheckoutCredits,
  CheckoutDelivery,
  CheckoutItems,
  CheckoutPayment,
  CheckoutTerms,
  CheckoutTotals,
} from "./checkout-section";

/** What a page built for the checkout draws of the shop (D113, D117, D558, D559): only the checkout's own sections (bloat review step 2.9). */
export const checkoutParts = storePartDrawer(({ part, store, market, m, holdsTerms }) => {
  switch (part) {
    case "checkout":
      return <Checkout store={store} market={market} drawTerms={!holdsTerms} />;
    case "checkout_items":
      return <CheckoutItems store={store} market={market} />;
    case "checkout_code":
      return <CheckoutCode store={store} market={market} />;
    case "checkout_credits":
      return <CheckoutCredits store={store} market={market} />;
    case "checkout_delivery":
      return <CheckoutDelivery store={store} market={market} />;
    case "checkout_totals":
      return <CheckoutTotals store={store} market={market} />;
    case "checkout_terms":
      return <CheckoutTerms store={store} market={market} />;
    case "checkout_payment":
      return <CheckoutPayment store={store} market={market} drawTerms={!holdsTerms} />;
    case "checkout_back":
      return <CheckoutBack store={store} market={market} />;
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
