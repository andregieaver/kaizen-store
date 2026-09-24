"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { t } from "@/lib/i18n";
import { siteUrl } from "@/lib/site";
import { changeLine, readCartId } from "@/server/cart";
import { getCustomer } from "@/server/customers";
import { setCartCode } from "@/server/discounts";
import { startCheckout, type CheckoutConsent, type CheckoutProblem } from "@/server/checkout";
import { resolveShop } from "@/server/shop";

const lineInput = z.object({
  store: z.string(),
  market: z.string(),
  variantId: z.uuid(),
  quantity: z.coerce.number().int().min(0).max(MAX_LINE_QUANTITY),
  sellingPlanId: z.uuid().nullable(),
});

export type AddToCartState = {
  outcome: "idle" | "added" | "capped" | "unavailable" | "plan_conflict" | "error";
  quantity: number;
};

async function parse(formData: FormData) {
  const parsed = lineInput.safeParse({
    store: formData.get("store"),
    market: formData.get("market"),
    variantId: formData.get("variantId"),
    quantity: formData.get("quantity") ?? 1,
    sellingPlanId: formData.get("sellingPlanId") || null,
  });
  if (!parsed.success) return null;
  const shop = await resolveShop(parsed.data.store, parsed.data.market);
  return shop
    ? {
        shop: { storeId: shop.store.id, market: shop.market },
        variantId: parsed.data.variantId,
        quantity: parsed.data.quantity,
        sellingPlanId: parsed.data.sellingPlanId,
      }
    : null;
}

/** Adds one or more units from a product page. */
export async function addToCart(
  _previous: AddToCartState,
  formData: FormData,
): Promise<AddToCartState> {
  const input = await parse(formData);
  if (!input || input.quantity < 1) return { outcome: "error", quantity: 0 };
  const result = await changeLine(input.shop, input.variantId, input.quantity, "add", input.sellingPlanId);
  refresh();
  return result.outcome === "removed"
    ? { outcome: "error", quantity: 0 }
    : { outcome: result.outcome, quantity: result.quantity };
}

/** Sets a cart line's quantity; 0 removes the line. */
export async function updateCartLine(formData: FormData): Promise<void> {
  const input = await parse(formData);
  if (!input) return;
  await changeLine(input.shop, input.variantId, input.quantity, "set", input.sellingPlanId);
  refresh();
}

export type CheckoutState = { problem: CheckoutProblem | null };

/**
 * Places the order and sends the shopper to payment. On a problem (stock ran
 * out, payments not set up, ...) the cart page says what. `consent` holds
 * the shopper's ticks for downloads (D24) and a subscription (D25).
 */
export async function checkoutAction(
  storeSlug: string,
  marketSlug: string,
  consent: CheckoutConsent = {},
): Promise<CheckoutState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return { problem: "empty" };
  const cartShop = { storeId: shop.store.id, market: shop.market };
  const cartId = await readCartId(cartShop);
  if (!cartId) return { problem: "empty" };

  const header = (await headers()).get("origin");
  const origin = header ? new URL(header).origin : siteUrl();
  const result = await startCheckout(
    { storeId: shop.store.id, storeSlug: shop.store.slug, market: shop.market },
    cartId,
    origin,
    t(shop.market.lang).shipping,
    { digital: consent.digital === true, subscription: consent.subscription === true },
    // A signed-in customer's order is theirs from the start, and codes for one use each know them (D31).
    { customerId: (await getCustomer(shop.store.id))?.id ?? null },
  );
  if (result.ok) redirect(result.url);
  refresh();
  return { problem: result.problem };
}

export type CodeState = { tried: string | null };

/**
 * Puts a discount code on the cart (D31). Whether it applies is shown by
 * the cart page, which checks it against the basket every time, as checkout
 * will.
 */
export async function applyCodeAction(
  storeSlug: string,
  marketSlug: string,
  _state: CodeState,
  form: FormData,
): Promise<CodeState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  const code = String(form.get("code") ?? "").slice(0, 60);
  if (!shop || !code.trim()) return { tried: null };
  await setCartCode({ storeId: shop.store.id, market: shop.market }, code);
  refresh();
  return { tried: code };
}

/** Takes the discount code off the cart. */
export async function removeCodeAction(storeSlug: string, marketSlug: string): Promise<void> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return;
  await setCartCode({ storeId: shop.store.id, market: shop.market }, null);
  refresh();
}
