"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { COMPANY_NAME_MAX, organisationNumber } from "@/lib/b2b";
import { MAX_RANGE_LENGTH } from "@/lib/booking-ranges";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import type { CreditsState } from "@/lib/bonus-shopper";
import type { GiftFields, GiftProblem } from "@/lib/gift";
import { t } from "@/lib/i18n";
import { siteUrl } from "@/lib/site";
import { rememberAffiliate } from "@/server/affiliates";
import { changeLine, readCartId, setCartCompany, setCartGift, setCartVatNumber } from "@/server/cart";
import { viesClientKey } from "@/server/vat-checks";
import { getCustomer } from "@/server/customers";
import { setCartCode } from "@/server/discounts";
import { recordExperimentCart } from "@/server/experiments";
import { productOfVariant, recordRecommendedAdd } from "@/server/recommend-events";
import { attributionOf, parseAttribution } from "@/lib/recommendations";
import { startCheckout, type CheckoutConsent, type CheckoutProblem } from "@/server/checkout";
import { resolveSellingShop } from "@/server/shop";

import { applyCreditsForm } from "./bonus";

const lineInput = z
  .object({
    store: z.string(),
    market: z.string(),
    variantId: z.uuid(),
    /** Units; a stay's nights or a rental's days (D67), which may be more. */
    quantity: z.coerce.number().int().min(0).max(MAX_RANGE_LENGTH),
    sellingPlanId: z.uuid().nullable(),
    /** An appointment's time and who with (D65), or a stay's or rental's check-in and room or item (D67). */
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    resourceId: z.uuid().nullable(),
  })
  .refine((line) => line.startsAt !== null || line.quantity <= MAX_LINE_QUANTITY);

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
  const shop = await resolveSellingShop(parsed.data.store, parsed.data.market);
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
  // The referral code the page held (D131), else the consented cookie's, is kept with the cart; checked by the server.
  if (result.outcome !== "removed") {
    const cartId = await readCartId(input.shop);
    const ref = formData.get("ref");
    if (cartId) await rememberAffiliate(input.shop, cartId, typeof ref === "string" ? ref.slice(0, 32) : null);
    // An enrolled visitor's cart (D148): tied to them so the order that follows counts in the test they were shown.
    if (cartId) await recordExperimentCart(input.shop.storeId, cartId, "cart");
    // A product opened from a recommendation (D139) is remembered with the cart, so the order that follows counts towards it.
    const attribution = parseAttribution(formData.get("rec"));
    if (cartId && attribution) {
      const productId = await productOfVariant(input.shop.storeId, input.variantId);
      const credited = productId ? attributionOf(attribution, productId) : null;
      if (productId && credited) await recordRecommendedAdd(input.shop.storeId, cartId, productId, credited);
    }
  }
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

/**
 * `to`: where the order is paid, when it was placed. The browser goes there with a full page load, not a client navigation
 * (wave 1, 1e, `docs/pci.md`): a script the page added before (the consent manager's, the assistant's) must not still be in the
 * document where the shopper types a card.
 */
export type CheckoutState = { problem: CheckoutProblem | null; to?: string };

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
  const shop = await resolveSellingShop(storeSlug, marketSlug);
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
  if (result.ok) return { problem: null, to: result.url };
  refresh();
  return { problem: result.problem };
}

/**
 * What a shopper's EU VAT number came to (D157), for the cart to word in their language: `cleared` (taken off), `valid` (checked
 * valid: whether it takes the VAT off is `cartSummary()`'s, by the delivery country and the rest), `invalid`, `unavailable` (VIES
 * could not answer: VAT is charged and nothing is blocked), `not_eu`, `own_number`, or a problem with what was typed
 * (`empty`, `no_country`, `characters`, `shape`) or the cart (`no_cart`, `no_company`).
 */
export type VatNumberState = {
  outcome: "idle" | "cleared" | "valid" | "invalid" | "unavailable" | "not_eu" | "own_number" | "empty" | "no_country" | "characters" | "shape" | "no_cart" | "no_company" | "company" | "company_number";
};

/**
 * Checks the VAT number a business shopper typed for their cart and keeps it with the answer. The company typed beside it
 * (the cart holds its fields until checkout starts) is kept first, as `checkoutAction()` keeps it. Sets no cookie and uses no
 * storage: the number is on the cart row. Nothing is blocked: VIES being down only charges VAT.
 */
export async function vatNumberAction(
  storeSlug: string,
  marketSlug: string,
  typed: string,
  company?: { name: string; number: string } | null,
): Promise<VatNumberState> {
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop) return { outcome: "no_cart" };
  const cartShop = { storeId: shop.store.id, market: shop.market };
  let kept: { name: string; number: string } | null | undefined;
  if (company) {
    const name = company.name.trim().slice(0, COMPANY_NAME_MAX);
    const number = organisationNumber(shop.market.code, company.number.trim().slice(0, 40));
    if (!name) return { outcome: "company" };
    if (!number) return { outcome: "company_number" };
    kept = { name, number };
  }
  // The VIES limit knows the shopper by a keyed hash of their address for the day (kept in a counter, never the address).
  const result = await setCartVatNumber(cartShop, typed.slice(0, 40), kept, { clientKey: viesClientKey(shop.store.id, await headers()) });
  refresh();
  return { outcome: result.ok ? result.outcome : result.problem };
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
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  const code = String(form.get("code") ?? "").slice(0, 60);
  if (!shop || !code.trim()) return { tried: null };
  await setCartCode({ storeId: shop.store.id, market: shop.market }, code);
  refresh();
  return { tried: code };
}

/** Takes the discount code off the cart. */
export async function removeCodeAction(storeSlug: string, marketSlug: string): Promise<void> {
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop) return;
  await setCartCode({ storeId: shop.store.id, market: shop.market }, null);
  refresh();
}

/**
 * Uses bonus credits on the cart, or takes them off (D130): the amount typed, all that can be used, or none. The
 * cart page shows the new totals; the result is said next to the form.
 */
export async function setCartCreditsAction(
  storeSlug: string,
  marketSlug: string,
  _state: CreditsState,
  form: FormData,
): Promise<CreditsState> {
  const outcome = await applyCreditsForm(storeSlug, marketSlug, form);
  if (outcome.changed) refresh();
  return outcome.state;
}

export type GiftActionResult = { ok: true; gift: GiftFields } | { ok: false; problems: GiftProblem[] };

/** The longest text taken from the browser before it is cleaned: far over any limit, so a refusal is still a refusal, but a very large request is not read whole. */
const GIFT_INPUT_MAX = 2000;

/**
 * Keeps the buyer's gift on the cart (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1): ticked or not, with To, From and a message. The server cleans and checks them
 * (`setCartGift()`: a text over its limit is refused with how much is over, never cut; unticking clears the three; a store with gift messages off ignores it all) and
 * stores nothing in the browser. What the browser sends is never trusted to be a string.
 */
export async function setGiftAction(
  storeSlug: string,
  marketSlug: string,
  input: { isGift: boolean; to: string; from: string; message: string },
): Promise<GiftActionResult> {
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop || typeof input !== "object" || input === null) return { ok: false, problems: [] };
  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, GIFT_INPUT_MAX) : "");
  const result = await setCartGift(
    { storeId: shop.store.id, market: shop.market },
    { isGift: input.isGift === true, to: text(input.to), from: text(input.from), message: text(input.message) },
  );
  if (!result.ok) return { ok: false, problems: result.problem === "too_long" ? result.problems : [] };
  refresh();
  return { ok: true, gift: result.gift };
}
