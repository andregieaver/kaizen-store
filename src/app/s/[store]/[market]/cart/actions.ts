"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { COMPANY_NAME_MAX, organisationNumber } from "@/lib/b2b";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { t } from "@/lib/i18n";
import { siteUrl } from "@/lib/site";
import { changeLine, readCartId, setCartCompany } from "@/server/cart";
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
  /** An appointment's time and who with (D65). */
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  resourceId: z.uuid().nullable(),
});

export type AddToCartState = {
  outcome: "idle" | "added" | "capped" | "unavailable" | "plan_conflict" | "slot_taken" | "error";
  quantity: number;
};

async function parse(formData: FormData) {
  const parsed = lineInput.safeParse({
    store: formData.get("store"),
    market: formData.get("market"),
    variantId: formData.get("variantId"),
    quantity: formData.get("quantity") ?? 1,
    sellingPlanId: formData.get("sellingPlanId") || null,
    startsAt: formData.get("startsAt") || null,
    resourceId: formData.get("resourceId") || null,
  });
  if (!parsed.success) return null;
  const shop = await resolveShop(parsed.data.store, parsed.data.market);
  return shop
    ? {
        shop: { storeId: shop.store.id, market: shop.market },
        variantId: parsed.data.variantId,
        quantity: parsed.data.quantity,
        sellingPlanId: parsed.data.sellingPlanId,
        booking: parsed.data.startsAt
          ? { startsAt: new Date(parsed.data.startsAt).toISOString(), resourceId: parsed.data.resourceId }
          : null,
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
  const result = await changeLine(
    input.shop,
    input.variantId,
    input.quantity,
    "add",
    input.sellingPlanId,
    undefined,
    input.booking,
  );
  refresh();
  return result.outcome === "removed"
    ? { outcome: "error", quantity: 0 }
    : { outcome: result.outcome, quantity: result.quantity };
}

/** Sets a cart line's quantity; 0 removes the line. */
export async function updateCartLine(formData: FormData): Promise<void> {
  const input = await parse(formData);
  if (!input) return;
  await changeLine(input.shop, input.variantId, input.quantity, "set", input.sellingPlanId, undefined, input.booking);
  refresh();
}

export type CheckoutState = { problem: CheckoutProblem | null };

const contactInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(200).pipe(z.email()),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^\+?[0-9 ()-]{5,}$/),
});

/**
 * Places the order and sends the shopper to payment. On a problem (stock ran
 * out, payments not set up, ...) the cart page says what. `consent` holds
 * the shopper's ticks for downloads (D24) and a subscription (D25).
 */
export async function checkoutAction(
  storeSlug: string,
  marketSlug: string,
  consent: CheckoutConsent = {},
  /** The company typed on the cart page (B2B), null for a private shopper, left out to keep the cart's. */
  company?: { name: string; number: string } | null,
  /** Who books, when nothing is paid online (D66). */
  contact: { name: string; email: string; phone: string } | null = null,
): Promise<CheckoutState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return { problem: "empty" };
  const cartShop = { storeId: shop.store.id, market: shop.market };
  const cartId = await readCartId(cartShop);
  if (!cartId) return { problem: "empty" };
  if (company !== undefined) {
    const name = company?.name.trim().slice(0, COMPANY_NAME_MAX) ?? "";
    const typed = company?.number.trim().slice(0, 40) ?? "";
    if (!name && !typed) {
      await setCartCompany(cartShop, null);
    } else {
      if (!name || !typed) return { problem: "company" };
      const number = organisationNumber(shop.market.code, typed);
      if (!number) return { problem: "company_number" };
      await setCartCompany(cartShop, { name, number });
    }
  }

  const who = contact ? contactInput.safeParse(contact) : null;
  if (who && !who.success) return { problem: "contact" };

  const header = (await headers()).get("origin");
  const origin = header ? new URL(header).origin : siteUrl();
  const result = await startCheckout(
    { storeId: shop.store.id, storeSlug: shop.store.slug, market: shop.market },
    cartId,
    origin,
    t(shop.market.lang).shipping,
    { digital: consent.digital === true, subscription: consent.subscription === true },
    // A signed-in customer's order is theirs from the start, and codes for one use each know them (D31).
    { customerId: (await getCustomer(shop.store.id))?.id ?? null, contact: who?.success ? who.data : null },
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
