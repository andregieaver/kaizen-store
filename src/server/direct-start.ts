import "server-only";

import { cartView } from "@/app/s/[store]/[market]/(shop)/cart/cart-view";
import { agreedAll, checkoutConsents } from "@/lib/checkout-consents";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";

import { readCartId } from "./cart";
import { startCheckout } from "./checkout";
import { getCustomer } from "./customers";
import { deliveryReady } from "./delivery-options";
import { cartSkips } from "./skip-cart";
import type { Store } from "./stores";

/**
 * Straight to payment, past the cart page (D915), after a product's page or a pricing table put something in the cart: the payment page's address,
 * or null to show the cart. Null when any product in the basket needs the cart (`cartSkips()`), and whenever the cart must ask something first, as
 * express checkout is held (D373): a problem on a line, payments off, Mollie's or no payment page at all (who it is for is asked on the cart), the
 * store's own questions, a company, the company's terms or purchase rules, signing in first, or a delivery that needs a postal code; and a basket
 * that costs nothing, whose cart asks who it is for. What the cart would ask a tick for (a subscription's renewals, a download's withdrawal) is
 * said beside the button (`checkoutConsents()`, the cart's own words), so pressing it is the agreement (the owner's choice, 27 November 2026):
 * `shown` is what the button said, and a basket asking anything it did not say (another renewal price, a download added earlier, a booked
 * service) is shown the cart. The payment page shows the store's terms as for any checkout. Loaded with import() by the actions that press it, so a
 * page that only draws the button loads none of the order writer.
 */
export async function startDirect(store: Store, market: Market, origin: string, shown: readonly string[]): Promise<string | null> {
  const cartShop = { storeId: store.id, market };
  const cartId = await readCartId(cartShop);
  if (!cartId || !(await cartSkips(store.id, cartId))) return null;
  const m = t(market.lang);
  const view = await cartView(store, market, m);
  if (view.empty) return null;
  const { summary } = view;
  if (summary.blocked || !summary.checkout.paymentsOn || summary.checkout.provider === "mollie") return null;
  if (summary.nothingDue || summary.giftCards.coverAll || summary.atVenueOnly) return null;
  if (view.mustSignInFirst || view.companyNeeded || view.onTerms || view.companyBuy || view.questions.fields.length > 0) return null;
  const asked = checkoutConsents(m, { digital: summary.digital, service: summary.serviceRequest, plan: summary.plan, renewal: summary.renewal }, view.money);
  if (!agreedAll(asked, shown)) return null;
  const customerId = (await getCustomer(store.id))?.id ?? null;
  if (!(await deliveryReady(cartShop, cartId, customerId)).ok) return null;
  const started = await startCheckout(
    { storeId: store.id, storeSlug: store.slug, market },
    cartId,
    origin,
    m.shipping,
    { digital: asked.digital !== undefined, subscription: asked.subscription !== undefined, service: asked.service !== undefined },
    { customerId },
  );
  return started.ok ? started.url : null;
}

/** The sentences a button said beside it (D915), as its form sends them (`agreed`): a few, each of a sentence's length. */
export function shownWith(formData: FormData): string[] {
  return formData
    .getAll("agreed")
    .filter((value): value is string => typeof value === "string" && value.length <= 600)
    .slice(0, 4);
}
