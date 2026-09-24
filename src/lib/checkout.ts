/**
 * Money rules for checkout, kept pure so they can be tested and shared.
 * Prices are VAT-inclusive; the VAT is the part of the price that is tax.
 */

/** The VAT contained in a VAT-inclusive amount, rounded to the minor unit. */
export function vatIncluded(amountMinor: number, rate: number): number {
  if (rate <= 0) return 0;
  return Math.round((amountMinor * rate) / (1 + rate));
}

export type ShippingRate = { amountMinor: number; freeOverMinor: number | null };

/** What shipping costs for a basket of this value. */
export function shippingCost(subtotalMinor: number, rate: ShippingRate): number {
  return rate.freeOverMinor !== null && subtotalMinor >= rate.freeOverMinor ? 0 : rate.amountMinor;
}

/** Languages Stripe Checkout can show; others get Stripe's automatic choice. */
const STRIPE_LOCALES = new Set([
  "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it", "lt", "lv",
  "mt", "nb", "nl", "pl", "pt", "ro", "sk", "sl", "sv",
]);

export function stripeLocale(lang: string): string {
  return STRIPE_LOCALES.has(lang) ? lang : "auto";
}

/** How long stock is held while the shopper pays (Stripe's minimum session life). */
export const CHECKOUT_MINUTES = 30;

/**
 * The withdrawal exclusion an order line records (D24): a download,
 * delivered at once with the shopper's consent, is digital content; a
 * shipped item never is.
 */
export function lineWithdrawal(delivery: "physical" | "digital", productExclusion: string): string {
  if (delivery === "digital") return "digital_content";
  return productExclusion === "digital_content" ? "none" : productExclusion;
}
