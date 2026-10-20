/**
 * The payment providers a store's checkout can use (wave 4 unit E, D292, `docs/wave-4-payments.md` 7): Stripe, every store's default, and Mollie. Pure: the
 * ids, their names, and the one rule that decides what becomes of an order from a provider's answer about its payment, whichever provider gave it. Each
 * provider's server code (`src/server/payment-providers/`) only turns its own answer into a `PaymentAnswer`; `applyPaymentAnswer()` acts on `paymentFate()`.
 */

export const PAYMENT_PROVIDERS = ["stripe", "mollie"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export const isPaymentProvider = (value: unknown): value is PaymentProviderId => (PAYMENT_PROVIDERS as readonly unknown[]).includes(value);

/** The provider's name as staff read it. */
export const PROVIDER_NAMES: Record<PaymentProviderId, string> = { stripe: "Stripe", mollie: "Mollie" };

/**
 * Where a payment stands, in words every provider's answer comes to:
 * - `open`: the shopper has not finished; nothing to do.
 * - `paid`: the money is the store's.
 * - `unsettled`: the shopper finished but the money is not in yet: a card held to be captured later (D289) or a bank payment on its way (D291).
 * - `failed`: the payment was refused or failed after it was started.
 * - `expired`: the shopper never finished, and the payment can no longer be paid.
 */
export type PaymentState = "open" | "paid" | "unsettled" | "failed" | "expired";

export type ShopperAddress = { line1: string | null; line2: string | null; postalCode: string | null; city: string | null; country: string | null };

/** Who bought and where it goes, as the provider's payment page took them; only what the provider gave. */
export type ShopperDetails = {
  email: string | null;
  name: string | null;
  phone: string | null;
  billing: ShopperAddress | null;
  shipping: { name: string | null; address: ShopperAddress } | null;
};

/** A provider's answer about one payment: its provider and its reference (`payments.provider_reference`), where it stands, and who paid when it says. */
export type PaymentAnswer = {
  provider: PaymentProviderId;
  reference: string;
  state: PaymentState;
  /** Null when the shopper has not finished on the provider's page, or the provider gives no details. */
  shopper: ShopperDetails | null;
};

/** What a payment pays: the order itself, an order change's difference (D174), an exchange's (D239), or the balance of an order bought on payment terms (D293). */
export type PaymentPurpose = "order" | "edit" | "exchange" | "terms";

/**
 * What becomes of the order, decided from the answer alone:
 * - `settle_change`: an order change's or an exchange's difference, or the balance of an order on terms, is paid (`pay`) or ended (`failed`, `cancelled`); nothing else is touched.
 * - `unsettled`: hold the card or wait for the bank, as the provider can tell which.
 * - `paid`: complete the order.
 * - `ended`: the payment row ends (`failed` or `cancelled`) and the order is cancelled unless it is a weekly delivery or a staff-made order (`cancel`).
 * - `none`: nothing yet.
 */
export type PaymentFate =
  | { kind: "settle_change"; outcome: "pay" | "failed" | "cancelled" }
  | { kind: "unsettled" }
  | { kind: "paid" }
  | { kind: "ended"; status: "failed" | "cancelled"; cancel: boolean }
  | { kind: "none" };

export function paymentFate(state: PaymentState, purpose: PaymentPurpose, order: { delivery: boolean; draft: boolean }): PaymentFate {
  if (purpose !== "order") {
    if (state === "paid") return { kind: "settle_change", outcome: "pay" };
    if (state === "failed") return { kind: "settle_change", outcome: "failed" };
    if (state === "expired") return { kind: "settle_change", outcome: "cancelled" };
    return { kind: "none" };
  }
  if (state === "paid") return { kind: "paid" };
  // A weekly delivery paid by link (D102) waits for its money as it is: it is never held or put to wait for a bank here.
  if (state === "unsettled") return order.delivery ? { kind: "none" } : { kind: "unsettled" };
  if (state === "failed" || state === "expired") {
    // A weekly delivery stays when its link lapses (D102); a staff-made order lives until its draft expires (D173), and the pay link makes a new payment.
    return { kind: "ended", status: state === "failed" ? "failed" : "cancelled", cancel: !order.delivery && !order.draft };
  }
  return { kind: "none" };
}

/** A payment's amount as Mollie (and any provider that takes a decimal string) reads it: minor units to `"123.45"`, by code, for a currency of `decimals` places. */
export function decimalString(minor: number, decimals = 2): string {
  if (!Number.isSafeInteger(minor)) throw new Error("amount must be an integer of minor units");
  const sign = minor < 0 ? "-" : "";
  const digits = String(Math.abs(minor)).padStart(decimals + 1, "0");
  return decimals === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/** The reverse of `decimalString()`: a provider's decimal string to minor units, or null when it is not one. */
export function minorFromDecimal(value: string, decimals = 2): number | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = match[3] ?? "";
  if (fraction.length > decimals) return null;
  const minor = Number(match[2] + fraction.padEnd(decimals, "0"));
  if (!Number.isSafeInteger(minor)) return null;
  return match[1] ? -minor : minor;
}
