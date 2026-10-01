import "server-only";

import type { DeliveryOptions } from "@/lib/delivery-options";
import type { Market } from "@/lib/markets";

import { getCart } from "./cart";
import { cartSummary } from "./cart-summary";
import { deliveryChoiceOn, deliveryOptionsFor } from "./delivery-options";

/**
 * What the checkout's delivery choice shows (D135): the market's flat rate and the carrier's services asked for so far,
 * each priced for this basket as the cart page prices shipping (`cartSummary()`). Null when there is nothing to choose:
 * nothing to ship, a subscription (which pays the flat rate on each delivery), or no carrier's services on in this country.
 */
export async function deliveryView(
  shop: { storeId: string; market: Market },
  cartId: string,
  flatLabel: string,
): Promise<DeliveryOptions | null> {
  if (!(await deliveryChoiceOn(shop.storeId, shop.market.code))) return null;
  const summary = await cartSummary(shop, await getCart(shop), { cartId });
  if (!summary.ships || summary.plan) return null;
  return deliveryOptionsFor(shop, cartId, { label: flatLabel, rate: summary.checkout.shipping }, summary.shippingAt);
}
