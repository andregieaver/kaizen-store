import { fillWords } from "./admin-fill";
import { minorUnitDigits } from "./money";

/**
 * Premium themes (D286, `docs/theme-prices.md`): a theme is free, or has a price per currency that a store pays Kaizena Flow once, without
 * VAT, to use it. Nothing is paid to try one or add it to a store's theme library; a store pays when the theme goes live on it and the store
 * is open (a theme chosen before the store opens is paid when it opens). Once paid, the store keeps it, with every preset and update. What a
 * store pays is decided by the database (`commerce.theme_price_for()`, the plan's currency, else the store's own country's) and recorded
 * there when the theme goes live (`commerce.theme_installs_charge()`); this module only words it and checks what was agreed. No server code:
 * the browser and the theme store's pages read it too.
 */

export type ThemePrice = { currency: string; amountMinor: number };

/** The most a theme may cost, in minor units, as the database holds it (`theme_prices_amount`). */
export const THEME_PRICE_MAX_MINOR = 100_000_000;

/** A theme with no price is free. */
export const isPremium = (prices: readonly ThemePrice[]): boolean => prices.length > 0;

/** Prices in the order the platform lists its plan currencies (its own country's first), any other after, by code. */
export function orderPrices(prices: readonly ThemePrice[], currencies: readonly string[] = []): ThemePrice[] {
  const rank = (currency: string) => {
    const at = currencies.indexOf(currency);
    return at === -1 ? currencies.length : at;
  };
  return [...prices].sort((a, b) => rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency));
}

/** One price as people read it, without decimals when it is whole: "NOK 3,490", "€299.50"; in Norwegian `locale` "3 490 kr". */
export function priceText(price: ThemePrice, locale = "en"): string {
  const digits = minorUnitDigits(price.currency);
  const whole = price.amountMinor % 10 ** digits === 0;
  return new Intl.NumberFormat(locale, { style: "currency", currency: price.currency, minimumFractionDigits: whole ? 0 : digits, maximumFractionDigits: digits }).format(
    price.amountMinor / 10 ** digits,
  );
}

/** A theme card's price: "Free", or its first price (the platform's own currency first). */
export const cardPrice = (prices: readonly ThemePrice[] | undefined): string => (prices && prices.length > 0 ? priceText(prices[0]) : "Free");

/** What a theme's page says of its price: free, or what a store pays and when. */
export function priceLine(prices: readonly ThemePrice[] | undefined): string {
  return prices && prices.length > 0
    ? `${pricesText(prices)}, excl. VAT, once per store. Free to try: you pay when your store goes live with it.`
    : "Free";
}

/** Every price of a theme, e.g. "NOK 3,490.00 · SEK 3,490.00 · EUR 299.00"; "Free" for none. */
export function pricesText(prices: readonly ThemePrice[], currencies: readonly string[] = [], locale = "en"): string {
  return isPremium(prices) ? orderPrices(prices, currencies).map((price) => priceText(price, locale)).join(" · ") : "Free";
}

/**
 * The price a person agreed to, as the form sends it and the database checks it (`kaizen.theme_charge`): `{currency}:{amount}`. Making a
 * premium theme live on an open store carries it, so nobody pays a price they were not shown.
 */
export const chargeToken = (price: ThemePrice): string => `${price.currency}:${price.amountMinor}`;

export function readChargeToken(value: unknown): ThemePrice | null {
  const match = typeof value === "string" ? /^([A-Z]{3}):([1-9][0-9]{0,8})$/.exec(value) : null;
  if (!match) return null;
  const amountMinor = Number(match[2]);
  return amountMinor <= THEME_PRICE_MAX_MINOR ? { currency: match[1], amountMinor } : null;
}

/**
 * What making a theme live would cost a store now: nothing (`free`), nothing more (`owned`: the store paid for it, was given it, or owes it
 * already), or its price, paid when the store opens (`at_opening`) or charged at once (`now`, the store is open).
 */
export type ThemeCharge =
  | { kind: "free" }
  | { kind: "owned"; status: OwnedStatus }
  | { kind: "at_opening"; price: ThemePrice }
  | { kind: "now"; price: ThemePrice };

export type OwnedStatus = "owed" | "due" | "invoiced" | "paid" | "granted";

/** The words `chargeLine()` and `chargeButton()` write, in English unless an admin catalogue's `design.charge` is given (D312 A7). */
export const CHARGE_WORDS = {
  owed: "Paid when your store opens.",
  granted: "Included for your store.",
  owned: "Your store has this theme.",
  atOpening: "{price} excl. VAT, once. Nothing to pay now: it is charged when your store opens, if the theme is live then.",
  now: "{price} excl. VAT, once, charged now to your Kaizena Flow billing: by card if your plan is paid by card, otherwise invoiced, due in 14 days.",
  pay: "Pay {price} and use it",
};

export type ChargeWords = { [K in keyof typeof CHARGE_WORDS]: string };

const withPrice = (template: string, price: ThemePrice, locale: string) => fillWords(template, { price: priceText(price, locale) });

/** The words beside a premium theme's button, saying what pressing it costs. Empty for a free theme. */
export function chargeLine(charge: ThemeCharge, w: ChargeWords = CHARGE_WORDS, locale = "en"): string {
  switch (charge.kind) {
    case "free":
      return "";
    case "owned":
      return charge.status === "owed" ? w.owed : charge.status === "granted" ? w.granted : w.owned;
    case "at_opening":
      return withPrice(w.atOpening, charge.price, locale);
    case "now":
      return withPrice(w.now, charge.price, locale);
  }
}

/** The main button's words for making a theme live, e.g. "Pay NOK 3,490.00 and use it" when it is charged at once. */
export function chargeButton(charge: ThemeCharge, plain: string, w: ChargeWords = CHARGE_WORDS, locale = "en"): string {
  return charge.kind === "now" ? withPrice(w.pay, charge.price, locale) : plain;
}

/** A purchase as the store's Billing page and the platform's theme page list it. */
export type ThemePurchaseStatus = OwnedStatus | "cancelled" | "void";

export const PURCHASE_STATUS_WORDS: Record<ThemePurchaseStatus, { words: string; signal: "positive" | "warning" | "neutral" | "danger" }> = {
  owed: { words: "Paid when the store opens", signal: "neutral" },
  due: { words: "Being invoiced", signal: "warning" },
  invoiced: { words: "Invoiced", signal: "warning" },
  paid: { words: "Paid", signal: "positive" },
  granted: { words: "Included", signal: "positive" },
  cancelled: { words: "Not charged", signal: "neutral" },
  void: { words: "Invoice voided", signal: "danger" },
};

/** When a try to invoice a purchase failed: the next try waits longer each time, at most a day. */
export function nextTryDelayMs(tries: number): number {
  return Math.min(24 * 60, 5 * 2 ** Math.max(0, tries - 1)) * 60_000;
}
