"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { db } from "@/db/client";
import { COMPANY_NAME_MAX, organisationNumber } from "@/lib/b2b";
import { MAX_RANGE_LENGTH } from "@/lib/booking-ranges";
import { MAX_ORDER_QUANTITY } from "@/lib/cart";
import type { CreditsState } from "@/lib/bonus-shopper";
import { cleanAnswers } from "@/lib/checkout-rules";
import type { GiftFields, GiftProblem } from "@/lib/gift";
import { cleanGiftCardRecipient, type GiftCardProblem } from "@/lib/gift-card-line";
import { todayIn } from "@/lib/analytics-period";
import { t } from "@/lib/i18n";
import { siteUrl } from "@/lib/site";
import { stripeLocale } from "@/lib/checkout";
import { expressProblemText } from "@/lib/checkout-labels";
import type { ExpressProblem } from "@/lib/express-checkout";
import { marketPath } from "@/lib/paths";
import { rememberAffiliate } from "@/server/affiliates";
import { changeLine, readCartId, setCartCompany, setCartGift, setCartVatNumber } from "@/server/cart";
import { viesClientKey } from "@/server/vat-checks";
import { getCustomer } from "@/server/customers";
import { addCartCode, removeCartCode } from "@/server/discounts";
import { addCartGiftCard, removeCartGiftCard, type AddGiftCardOutcome } from "@/server/gift-card-cart";
import { recordExperimentCart } from "@/server/experiments";
import { productOfVariant, recordRecommendedAdd } from "@/server/recommend-events";
import { attributionOf } from "@/lib/recommendations";
import { parseAttribution } from "@/lib/recommendations-schema";
import { listCheckoutFields, setCartAnswers } from "@/server/checkout-rules";
import { recordTermsForOrder } from "@/server/checkout-terms";
import { startCheckout, type CheckoutConsent, type CheckoutProblem } from "@/server/checkout";
import { resolveSellingShop } from "@/server/shop";
import { expressOn, startExpress } from "@/server/express-checkout";
import { setCartCompanyPurchase } from "@/server/company-locations";

import { applyCreditsForm } from "./bonus";

const lineInput = z
  .object({
    store: z.string(),
    market: z.string(),
    variantId: z.uuid(),
    /** Units; a stay's nights or a rental's days (D67), which may be more. */
    quantity: z.coerce.number().int().min(0).max(Math.max(MAX_RANGE_LENGTH, MAX_ORDER_QUANTITY)),
    sellingPlanId: z.uuid().nullable(),
    /** An appointment's time and who with (D65), or a stay's or rental's check-in and room or item (D67). */
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    resourceId: z.uuid().nullable(),
    /** A gift card's line as the cart's forms name it (D300): the key of who its cards are for; null for the buyer's own. */
    giftCardKey: z.string().max(2000).nullable(),
  })
  .refine((line) => line.startsAt !== null || line.quantity <= MAX_ORDER_QUANTITY);

export type AddToCartState = {
  outcome: "idle" | "added" | "capped" | "unavailable" | "plan_conflict" | "slot_taken" | "error" | "gift_card";
  quantity: number;
  /** What was wrong with *Send it to someone* (D300), field by field; the card was not added. */
  giftCardProblems?: GiftCardProblem[];
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
    giftCardKey: formData.get("giftCardKey") || null,
  });
  if (!parsed.success) return null;
  const shop = await resolveSellingShop(parsed.data.store, parsed.data.market);
  return shop
    ? {
        shop: { storeId: shop.store.id, market: shop.market },
        timeZone: shop.store.timeZone,
        giftCardKey: parsed.data.giftCardKey,
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
  // A gift card sent to someone (D300): who, cleaned as the order will keep it; refused whole, never cut.
  const card = cleanGiftCardRecipient(
    {
      send: formData.get("giftCardSend") === "on",
      to: formData.get("giftCardTo"),
      toName: formData.get("giftCardToName"),
      from: formData.get("giftCardFrom"),
      message: formData.get("giftCardMessage"),
      sendOn: formData.get("giftCardSendOn"),
    },
    todayIn(new Date(), input.timeZone),
  );
  if (!card.ok) return { outcome: "gift_card", quantity: 0, giftCardProblems: card.problems };
  const result = await changeLine(
    input.shop,
    input.variantId,
    input.quantity,
    "add",
    input.sellingPlanId,
    undefined,
    input.booking,
    card.recipient ? { recipient: card.recipient } : null,
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
  // Adding follows the variant's rule (D323) and is never refused by it; only setting a line can be.
  return result.outcome === "removed" || result.outcome === "quantity"
    ? { outcome: "error", quantity: 0 }
    : { outcome: result.outcome, quantity: result.quantity };
}

/** Sets a cart line's quantity; 0 removes the line. */
export async function updateCartLine(formData: FormData): Promise<void> {
  const input = await parse(formData);
  if (!input) return;
  await changeLine(input.shop, input.variantId, input.quantity, "set", input.sellingPlanId, undefined, input.booking, input.giftCardKey ? { key: input.giftCardKey } : null);
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
  /** Who pays and where the goods go, as typed, when the store's checkout is Mollie's (D292); checked by `startCheckout()`. */
  payer: Partial<Record<"name" | "email" | "phone" | "line1" | "line2" | "postalCode" | "city", string>> | null = null,
  /** Bought on the company's payment terms (D293), with whether the store's terms of sale were ticked (in `checkbox` mode). */
  onTerms: { termsTicked: boolean } | null = null,
  /** Gift cards pay it all (D300 F3): no payment page follows, so the store's terms of sale are accepted here, as on terms. */
  paidByCards: { termsTicked: boolean } | null = null,
  /** The answers to the store's checkout fields (D357), by field; checked here and again when the order is placed. */
  answers: Record<string, string | boolean> | null = null,
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

  // The store's questions (D357): kept on the cart as answered, so placing the order again (a code, a delivery) keeps them.
  const fields = await listCheckoutFields(db(), shop.store.id, { onlyOn: true });
  if (fields.length > 0) {
    const asked = cleanAnswers(fields, answers);
    await setCartAnswers(shop.store.id, cartId, asked.answers);
    if (asked.missing.length > 0) return { problem: "checkout_fields" };
  }

  const who = contact ? contactInput.safeParse(contact) : null;
  if (who && !who.success) return { problem: "contact" };

  // The store's terms of sale (D158) are accepted here when no payment page follows: in `checkbox` mode, only ticked.
  const accepted = onTerms ?? paidByCards;
  if (accepted && shop.store.termsAtCheckout === "checkbox" && !accepted.termsTicked) return { problem: "consent" };

  const header = (await headers()).get("origin");
  const origin = header ? new URL(header).origin : siteUrl();
  const result = await startCheckout(
    { storeId: shop.store.id, storeSlug: shop.store.slug, market: shop.market },
    cartId,
    origin,
    t(shop.market.lang).shipping,
    { digital: consent.digital === true, subscription: consent.subscription === true },
    // A signed-in customer's order is theirs from the start, and codes for one use each know them (D31).
    {
      customerId: (await getCustomer(shop.store.id))?.id ?? null,
      contact: who?.success ? who.data : null,
      payer,
      onTerms: onTerms !== null,
      ...(accepted && { recordTerms: (orderId: string) => recordTermsForOrder(shop.store, shop.market, orderId) }),
    },
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

export type CodeState = { tried: string | null; full?: boolean };

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
  // Added beside the codes already there (D299 E2); the cart page says which apply and why the others do not.
  const saved = await addCartCode({ storeId: shop.store.id, market: shop.market }, code);
  refresh();
  return { tried: code, full: saved === "full" };
}

/** What the gift card field shows after a code was typed: why it was not added, in the shopper's words; nothing when it was. */
export type GiftCardFormState = { problem: string | null };

/** The words for a code that was not added (D300 F3): never whether the card exists. */
function giftCardProblemText(lang: string, outcome: AddGiftCardOutcome): string | null {
  if (outcome.ok) return null;
  const words = t(lang).giftCardPay.problems;
  return outcome.problem === "currency" ? words.currency(outcome.currency) : words[outcome.problem];
}

/**
 * Puts a gift card on the cart by its code (D300 F3): found by its hash, counted against the cart's and the client's tries. What it pays is
 * shown by the cart, which works it out against the basket every time, as checkout will. The code itself is never kept.
 */
export async function applyGiftCardAction(storeSlug: string, marketSlug: string, _state: GiftCardFormState, form: FormData): Promise<GiftCardFormState> {
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  const code = String(form.get("giftCard") ?? "").slice(0, 40);
  if (!shop || !code.trim()) return { problem: null };
  const outcome = await addCartGiftCard({ storeId: shop.store.id, market: shop.market }, code, { clientKey: viesClientKey(shop.store.id, await headers()) });
  refresh();
  return { problem: giftCardProblemText(shop.market.lang, outcome) };
}

/** Takes a gift card off the cart, by its id (`remove`; the cart never holds a code). */
export async function removeGiftCardAction(storeSlug: string, marketSlug: string, form: FormData): Promise<void> {
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop) return;
  await removeCartGiftCard({ storeId: shop.store.id, market: shop.market }, String(form.get("remove") ?? ""));
  refresh();
}

/**
 * Keeps a company member's location and PO number on the cart (D321 C.2). `placeOrder()` checks both again, so a refusal here (a location not theirs, a PO
 * number too long) only leaves the cart as it was; the checkout then says what is missing.
 */
export async function companyPurchaseAction(storeSlug: string, marketSlug: string, form: FormData): Promise<void> {
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop) return;
  const cartShop = { storeId: shop.store.id, market: shop.market };
  const cartId = await readCartId(cartShop);
  if (!cartId) return;
  const location = String(form.get("location") ?? "");
  await setCartCompanyPurchase(cartShop, cartId, (await getCustomer(shop.store.id))?.id ?? null, {
    locationId: z.uuid().safeParse(location).success ? location : null,
    poNumber: String(form.get("po") ?? "").slice(0, 200),
  });
  refresh();
}

/** Takes one discount code off the cart. */
export async function removeCodeAction(storeSlug: string, marketSlug: string, code: string): Promise<void> {
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop) return;
  await removeCartCode({ storeId: shop.store.id, market: shop.market }, String(code).slice(0, 60));
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

/**
 * What pressing the express area gives the browser (wave 10 unit J, D373): Stripe's keys for the order's Checkout Session, or the reason in
 * the shopper's words with the cart's address (the checkout there asks what an express payment cannot).
 */
export type ExpressState =
  | { ok: true; publishableKey: string; stripeAccount: string; clientSecret: string; locale: string; orderHref: string; lines: number }
  | { ok: false; message: string; cartHref: string };

/**
 * The express area's press, on a product page (`add`: the chosen variant, put in the cart first exactly as Add to cart does) or in the cart:
 * the order placed and its session opened by `startExpress()` through `startCheckout()`. The keys go only to the cart's own browser (its
 * cookie), as the checkout page's do.
 */
export async function expressCheckoutAction(
  storeSlug: string,
  marketSlug: string,
  add: { variantId: string; quantity: number } | null,
): Promise<ExpressState> {
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  const m = t(shop?.market.lang ?? "en");
  const cartHref = shop ? marketPath(shop.store.slug, shop.market.slug, "/cart") : "/";
  if (!shop) return { ok: false, message: m.problemEmpty, cartHref };
  const problem = (key: CheckoutProblem | ExpressProblem) => ({ ok: false as const, message: expressProblemText(m, key, shop.market.lang), cartHref });
  if (!(await expressOn(shop.store, shop.market))) return problem("not_here");
  if (add) {
    const form = new FormData();
    form.set("store", shop.store.slug);
    form.set("market", shop.market.slug);
    form.set("variantId", add.variantId);
    form.set("quantity", String(Math.max(1, Math.min(MAX_ORDER_QUANTITY, Math.trunc(add.quantity) || 1))));
    const added = await addToCart({ outcome: "idle", quantity: 0 }, form);
    if (added.outcome !== "added" && added.outcome !== "capped") return problem("add");
  }
  const cartId = await readCartId({ storeId: shop.store.id, market: shop.market });
  if (!cartId) return problem("empty");
  const header = (await headers()).get("origin");
  const started = await startExpress(shop, cartId, header ? new URL(header).origin : siteUrl(), m.shipping);
  if (!started.ok) {
    refresh();
    return problem(started.problem);
  }
  return {
    ok: true,
    publishableKey: started.publishableKey,
    stripeAccount: started.stripeAccount,
    clientSecret: started.clientSecret,
    locale: stripeLocale(shop.market.lang),
    orderHref: marketPath(shop.store.slug, shop.market.slug, `/order/${started.orderId}?session_id=${encodeURIComponent(started.sessionId)}`),
    lines: started.lines,
  };
}
