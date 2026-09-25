"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";

import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { readCartId } from "@/server/cart";
import { captureCheckout, setCheckoutOptOut } from "@/server/cart-reminders";
import { getOpenCheckout, startCheckout } from "@/server/checkout";
import { getCustomer } from "@/server/customers";
import { checkCodeForOrder, setCartCode } from "@/server/discounts";
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

/** Why the code typed did not apply, and the code, to show it again. */
export type CheckoutCodeState = { problem: string | null; tried: string };

/**
 * A discount code typed at checkout, or the code taken off (D38). A code is
 * checked against the order first and, if it does not apply, the shopper is
 * told why and the checkout stays as it was. When it does, it goes on the
 * cart and the order is placed again at the new price, with the consent to
 * downloads the shopper already gave. An order that starts a subscription
 * is placed again only once the shopper agrees to its new renewal price.
 */
export async function checkoutCodeAction(
  storeSlug: string,
  marketSlug: string,
  _state: CheckoutCodeState,
  form: FormData,
): Promise<CheckoutCodeState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return { problem: null, tried: "" };
  const m = t(shop.market.lang);
  const cartShop = { storeId: shop.store.id, market: shop.market };
  const cartId = await readCartId(cartShop);
  const open = cartId ? await getOpenCheckout(shop.store.id, cartId) : null;
  if (!cartId || !open) {
    refresh();
    return { problem: null, tried: "" };
  }

  const removing = form.get("intent") === "remove";
  const text = String(form.get("code") ?? "").slice(0, 60);
  if (!removing) {
    if (!text.trim()) return { problem: null, tried: "" };
    const check = await checkCodeForOrder(cartShop, open.orderId, text);
    if (!check.ok) {
      return {
        problem:
          check.problem === "minimum" && check.minimumMinor
            ? `${m.minimumFor} ${formatMoney(check.minimumMinor, shop.market.currency, shop.market.locale)}.`
            : m.codeProblems[check.problem],
        tried: text,
      };
    }
  }
  await setCartCode(cartShop, removing ? null : text);
  if (open.subscription) {
    refresh();
    return { problem: null, tried: "" };
  }

  const header = (await headers()).get("origin");
  const result = await startCheckout(
    { storeId: shop.store.id, storeSlug: shop.store.slug, market: shop.market },
    cartId,
    header ? new URL(header).origin : siteUrl(),
    m.shipping,
    { digital: open.digital, subscription: false },
    { customerId: (await getCustomer(shop.store.id))?.id ?? null },
  );
  // On a problem (stock ran out meanwhile, ...) the cart says what.
  redirect(result.ok ? result.url : marketPath(shop.store.slug, shop.market.slug, "/cart"));
}
