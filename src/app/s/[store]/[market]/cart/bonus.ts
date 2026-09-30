import "server-only";

import type { CartBonus } from "@/lib/bonus";
import { creditsRequest, type CreditsState } from "@/lib/bonus-shopper";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { cartBonus, setCartCredits } from "@/server/bonus";
import { readCartId } from "@/server/cart";
import { getCustomer } from "@/server/customers";
import { resolveShop } from "@/server/shop";
import type { Store } from "@/server/stores";

/** The credits in this browser's cart (D130): what the cart and checkout pages show; null without a cart. */
export async function readCartBonus(
  store: Store,
  market: Market,
  knownCartId?: string | null,
): Promise<CartBonus | null> {
  const shop = { storeId: store.id, market };
  const cartId = knownCartId ?? (await readCartId(shop));
  if (!cartId) return null;
  const customer = await getCustomer(store.id);
  return cartBonus(shop, cartId, customer?.id ?? null);
}

/** What the credits form did: the words for the shopper, and whether the cart's credits changed. */
export type CreditsOutcome = {
  state: CreditsState;
  changed: boolean;
  shop: { store: Store; market: Market } | null;
  cartId: string | null;
};

/**
 * The credits form of the cart or checkout (D130), for a server action: who is asking (a signed-in customer with a
 * cart), what they asked for (checked against what can be used now), and the change made through
 * `setCartCredits()`, which checks everything again. The caller refreshes the page, or places the order again.
 */
export async function applyCreditsForm(storeSlug: string, marketSlug: string, form: FormData): Promise<CreditsOutcome> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return { state: { status: "idle", message: "" }, changed: false, shop: null, cartId: null };
  const { store, market } = shop;
  const m = t(market.lang).bonus;
  const money = (minor: number) => formatMoney(minor, market.currency, market.locale);
  const problem = (message: string): CreditsOutcome => ({
    state: { status: "problem", message },
    changed: false,
    shop,
    cartId: null,
  });

  const cartShop = { storeId: store.id, market };
  const cartId = await readCartId(cartShop);
  const customer = await getCustomer(store.id);
  if (!cartId) return problem(m.couldNotUse);
  if (!customer) return problem(m.signInNeeded);
  const before = await cartBonus(cartShop, cartId, customer.id);
  if (!before.enabled) return problem(m.couldNotUse);

  const asked = creditsRequest({
    intent: String(form.get("intent") ?? "apply"),
    use: form.get("use") === "on",
    amountText: String(form.get("amount") ?? "").slice(0, 24),
    maxUsableMinor: before.maxUsableMinor,
    currency: market.currency,
  });
  if (!asked.ok) return problem(asked.reason === "invalid" ? m.amountInvalid : m.nothingToUse);

  const result = await setCartCredits(cartShop, cartId, customer.id, asked.amountMinor);
  if (!result.ok) return problem(m.couldNotUse);
  const message = asked.clamped
    ? m.clamped(money(result.usingMinor))
    : result.usingMinor > 0
      ? m.using(money(result.usingMinor))
      : m.notUsing;
  return { state: { status: "done", message }, changed: result.usingMinor !== before.usingMinor, shop, cartId };
}
