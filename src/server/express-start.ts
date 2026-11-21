import "server-only";

import { expressFits, type ExpressProblem } from "@/lib/express-checkout";
import type { Market } from "@/lib/markets";

import { getCart } from "./cart";
import { getOpenCheckout, startCheckout, type CheckoutProblem } from "./checkout";
import { getCustomer } from "./customers";
import { deliveryReady } from "./delivery-options";
import { platformPublishableKey } from "./stripe";
import type { Store } from "./stores";

/**
 * The express area's press (wave 10 unit J, D373), apart from the facts that draw the area (`src/server/express-checkout.ts`), so a page
 * that draws the area never loads the order writer: only `expressCheckoutAction()` loads this file, with import() (bloat review step 2.47).
 */

/** What pressing the area gives the browser: Stripe's keys for the session, or why not. */
export type ExpressStart =
  | { ok: true; publishableKey: string; stripeAccount: string; clientSecret: string; orderId: string; sessionId: string; lines: number }
  | { ok: false; problem: CheckoutProblem | ExpressProblem };

/**
 * The press: the basket checked for what an express payment can pay (`expressFits()`), its delivery settled without a postal code the wallet
 * would only give later (`deliveryReady()`; the checkout page asks one), then the order placed and the session opened by `startCheckout()`,
 * exactly as the cart's button does, and the open checkout read back for its client secret. Only the cart's own browser gets here (the
 * cart is the caller's cookie), as on the checkout page.
 */
export async function startExpress(
  shop: { store: Store; market: Market },
  cartId: string,
  origin: string,
  shippingLabel: string,
): Promise<ExpressStart> {
  const { store, market } = shop;
  const cartShop = { storeId: store.id, market };
  const customerId = (await getCustomer(store.id))?.id ?? null;
  const cart = await getCart(cartShop, { customerId });
  if (!expressFits(cart.lines)) return { ok: false, problem: cart.lines.length === 0 ? "empty" : "not_here" };
  const ready = await deliveryReady(cartShop, cartId, customerId);
  if (!ready.ok) return { ok: false, problem: "delivery" };
  const started = await startCheckout({ storeId: store.id, storeSlug: store.slug, market }, cartId, origin, shippingLabel, {}, { customerId });
  if (!started.ok) return { ok: false, problem: started.problem };
  const open = await getOpenCheckout(store.id, cartId);
  const publishableKey = open ? platformPublishableKey(open.mode) : null;
  // Kaizena Flow's own checkout page is off (Stripe's hosted page): `expressOn()` offered nothing, so this is a change made meanwhile.
  if (!open || !publishableKey || open.expired) return { ok: false, problem: "payment_error" };
  return {
    ok: true,
    publishableKey,
    stripeAccount: open.accountId,
    clientSecret: open.clientSecret,
    orderId: open.orderId,
    sessionId: open.sessionId,
    lines: cart.lines.length,
  };
}
