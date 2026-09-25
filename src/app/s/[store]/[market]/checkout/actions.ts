"use server";

import { z } from "zod";

import { readCartId } from "@/server/cart";
import { captureCheckout, setCheckoutOptOut } from "@/server/cart-reminders";
import { getOpenCheckout } from "@/server/checkout";
import { getCustomer } from "@/server/customers";
import { resolveShop } from "@/server/shop";

const email = z.email().max(254);

/** This browser's checkout: the store, its market, the cart and the order waiting for payment. */
async function openCheckout(storeSlug: string, marketSlug: string) {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  const cartId = await readCartId({ storeId: shop.store.id, market: shop.market });
  const open = cartId ? await getOpenCheckout(shop.store.id, cartId) : null;
  return cartId && open ? { shop, cartId, orderId: open.orderId } : null;
}

/**
 * The shopper finished typing their email at checkout (D33): kept with
 * the cart for the store's reminders, unless they are signed in or chose
 * no reminders.
 */
export async function captureCheckoutEmailAction(storeSlug: string, marketSlug: string, typed: string): Promise<void> {
  const address = email.safeParse(typed.trim());
  if (!address.success) return;
  const found = await openCheckout(storeSlug, marketSlug);
  if (!found || (await getCustomer(found.shop.store.id))) return;
  await captureCheckout(found.shop.store.id, found.shop.market, found.cartId, found.orderId, address.data);
}

/** The link under the email field: no reminders about this cart, or reminders after all. */
export async function checkoutRemindersAction(
  storeSlug: string,
  marketSlug: string,
  optOut: boolean,
  typed: string | null,
): Promise<{ optedOut: boolean }> {
  const found = await openCheckout(storeSlug, marketSlug);
  if (!found) return { optedOut: optOut };
  const address = typed ? email.safeParse(typed.trim()) : null;
  await setCheckoutOptOut(found.shop.store.id, found.shop.market, found.cartId, optOut, address?.success ? address.data : null);
  // On second thought: the email typed is kept after all.
  if (!optOut && address?.success) {
    await captureCheckout(found.shop.store.id, found.shop.market, found.cartId, found.orderId, address.data);
  }
  return { optedOut: optOut };
}
