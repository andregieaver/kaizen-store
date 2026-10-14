"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";

import type { CreditsState } from "@/lib/bonus-shopper";
import { withDeliveryWords, type ShownDeliveryOptions } from "@/lib/delivery-words";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { readCartId } from "@/server/cart";
import { captureCheckout, setCheckoutOptOut } from "@/server/cart-reminders";
import { getOpenCheckout, startCheckout } from "@/server/checkout";
import { getCustomer } from "@/server/customers";
import { deliveryView } from "@/server/delivery-choice";
import { db } from "@/db/client";
import { chooseDelivery, deliveryReady, marketShipping, quoteDelivery, setDeliveryPostalCode } from "@/server/delivery-options";
import { checkCodeForOrder, setCartCode } from "@/server/discounts";
import { resolveSellingShop } from "@/server/shop";

import { applyCreditsForm } from "../cart/bonus";

const email = z.email().max(254);

/** This browser's checkout: the store, its market, the cart and the order waiting for payment. */
async function openCheckout(storeSlug: string, marketSlug: string) {
  const shop = await resolveSellingShop(storeSlug, marketSlug);
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
  const shop = await resolveSellingShop(storeSlug, marketSlug);
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

/**
 * Bonus credits used or taken off at checkout (D130). The credits are checked and set on the cart as in the cart
 * page; when they changed, the order is placed again at the new price, with the consent to downloads the shopper
 * already gave, as a discount code does (`checkoutCodeAction`). An order that starts a subscription is placed again
 * only once the shopper agrees to its renewal price, so there the page only shows that the order changed.
 */
export async function checkoutCreditsAction(
  storeSlug: string,
  marketSlug: string,
  _state: CreditsState,
  form: FormData,
): Promise<CreditsState> {
  const outcome = await applyCreditsForm(storeSlug, marketSlug, form);
  if (!outcome.changed || !outcome.shop || !outcome.cartId) return outcome.state;
  const { shop, cartId } = outcome;
  const open = await getOpenCheckout(shop.store.id, cartId);
  if (!open || open.subscription) {
    refresh();
    return outcome.state;
  }

  const header = (await headers()).get("origin");
  const result = await startCheckout(
    { storeId: shop.store.id, storeSlug: shop.store.slug, market: shop.market },
    cartId,
    header ? new URL(header).origin : siteUrl(),
    t(shop.market.lang).shipping,
    { digital: open.digital, subscription: false },
    { customerId: (await getCustomer(shop.store.id))?.id ?? null },
  );
  // On a problem (stock ran out meanwhile, ...) the cart says what.
  redirect(result.ok ? result.url : marketPath(shop.store.slug, shop.market.slug, "/cart"));
}

/** What the delivery choice shows after a look-up: the options, or why there are none (a key of `m.deliveryChoice.problems`). */
export type DeliveryLookup = { options: ShownDeliveryOptions | null; problem: string | null };

/** Places the order again from the cart (after a change of delivery), with the consent to downloads already given, and sends the shopper to it. */
async function placeAgain(found: NonNullable<Awaited<ReturnType<typeof openCheckout>>>, digital: boolean): Promise<never> {
  const { shop, cartId } = found;
  const header = (await headers()).get("origin");
  const result = await startCheckout(
    { storeId: shop.store.id, storeSlug: shop.store.slug, market: shop.market },
    cartId,
    header ? new URL(header).origin : siteUrl(),
    t(shop.market.lang).shipping,
    { digital, subscription: false },
    { customerId: (await getCustomer(shop.store.id))?.id ?? null },
  );
  // On a problem (stock ran out meanwhile, ...) the cart says what.
  redirect(result.ok ? result.url : marketPath(shop.store.slug, shop.market.slug, "/cart"));
}

/** The options as the page draws them, with a pickup place's sentences in the page's language. */
async function shownOptions(found: NonNullable<Awaited<ReturnType<typeof openCheckout>>>): Promise<ShownDeliveryOptions | null> {
  const { shop, cartId } = found;
  const m = t(shop.market.lang);
  const options = await deliveryView({ storeId: shop.store.id, market: shop.market }, cartId, m.shipping);
  return options ? withDeliveryWords(options, m, { locale: shop.market.locale, timeZone: shop.store.timeZone }) : null;
}

/**
 * The shopper gave a postal code at checkout (D135, D237 2.4): it is kept with the cart (`setDeliveryPostalCode()`, so the store's zones and local areas price
 * the basket for it), and the store's carriers, when it has any on in the country, are asked for their services, kept with the cart too. When the code
 * changes what the order is charged (another zone, a local area no longer covering it), the order is placed again at once; otherwise nothing about the
 * order changes until an option is chosen. A carrier that does not answer leaves the store's own options, and the shopper is told so.
 */
export async function lookUpDeliveryAction(storeSlug: string, marketSlug: string, postalCode: string): Promise<DeliveryLookup> {
  const found = await openCheckout(storeSlug, marketSlug);
  if (!found) return { options: null, problem: "gone" };
  const { shop, cartId } = found;
  const cartShop = { storeId: shop.store.id, market: shop.market };
  const typed = postalCode.slice(0, 20);
  const kept = await setDeliveryPostalCode(cartShop, cartId, typed);
  if (!kept.ok) return { options: await shownOptions(found), problem: kept.problem };
  const carriers = (await marketShipping(db(), shop.store.id, shop.market)).carriers;
  const quoted = carriers ? await quoteDelivery(cartShop, cartId, typed) : ({ ok: true } as const);
  const open = await getOpenCheckout(shop.store.id, cartId);
  // The order was placed for another postal code: placed again for this one, so what is paid is what the page now shows.
  if (open && open.changed && !open.subscription) await placeAgain(found, open.digital);
  return { options: await shownOptions(found), problem: quoted.ok ? null : quoted.problem };
}

/**
 * The shopper chose how the order is delivered (D135, D237): one of the store's methods, a pickup place, its local delivery (with a note for the driver),
 * a carrier's service (with its pickup point), or the flat rate. The order is placed again at that price, with the consent to downloads already given, as
 * a discount code does.
 */
export async function chooseDeliveryAction(
  storeSlug: string,
  marketSlug: string,
  _state: { problem: string | null },
  form: FormData,
): Promise<{ problem: string | null }> {
  const found = await openCheckout(storeSlug, marketSlug);
  if (!found) {
    refresh();
    return { problem: null };
  }
  const { shop, cartId } = found;
  const open = await getOpenCheckout(shop.store.id, cartId);
  if (!open || open.subscription) {
    refresh();
    return { problem: null };
  }
  const pickup = String(form.get("pickup") ?? "").slice(0, 80);
  const option = String(form.get("option") ?? "").slice(0, 80);
  const note = form.get("note");
  const chosen = await chooseDelivery({ storeId: shop.store.id, market: shop.market }, cartId, option, pickup || undefined, {
    note: typeof note === "string" ? note : undefined,
  });
  if (!chosen.ok) return { problem: chosen.problem };
  return placeAgain(found, open.digital);
}

/** Why the pay press may not go ahead yet (a key of `ReadyProblem`), and, when the delivery changed, where the order placed again waits. */
export type DeliveryReadyAnswer = { ok: true } | { ok: false; problem: "postal_code" | "changed" | "no_shipping"; next?: string };

/**
 * Asked by the pay press before Stripe's `confirm` (D237 2.4 point 4, 2.7): refused while the delivery price waits for a postal code, when nothing
 * delivers the basket, or once when the chosen delivery no longer prices it. Then the order is placed again at the delivery it now gets, and `next` is its
 * checkout, which the shopper opens to see the new price: nothing is paid at the old one. An order with nothing to choose is always ready.
 */
export async function deliveryReadyAction(storeSlug: string, marketSlug: string): Promise<DeliveryReadyAnswer> {
  const found = await openCheckout(storeSlug, marketSlug);
  if (!found) return { ok: true };
  const { shop, cartId } = found;
  const ready = await deliveryReady({ storeId: shop.store.id, market: shop.market }, cartId);
  if (ready.ok) return { ok: true };
  if (ready.problem !== "changed") return { ok: false, problem: ready.problem };
  const open = await getOpenCheckout(shop.store.id, cartId);
  const header = (await headers()).get("origin");
  const result = await startCheckout(
    { storeId: shop.store.id, storeSlug: shop.store.slug, market: shop.market },
    cartId,
    header ? new URL(header).origin : siteUrl(),
    t(shop.market.lang).shipping,
    { digital: open?.digital ?? false, subscription: false },
    { customerId: (await getCustomer(shop.store.id))?.id ?? null },
  );
  return { ok: false, problem: "changed", next: result.ok ? result.url : marketPath(shop.store.slug, shop.market.slug, "/cart") };
}
