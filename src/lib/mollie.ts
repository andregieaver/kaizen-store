/**
 * Mollie as a payment provider (wave 4 unit E2, D292, `docs/wave-4-payments.md` 7): the pure parts. Mollie's addresses and scopes, its payment and refund
 * states in Kaizena Flow's words, amounts as Mollie reads them, Kaizena Flow's fee within what a payment can carry, which methods a checkout offers, and
 * the shopper's details asked before Mollie's hosted page (which asks for none). No network and no database here: `src/server/mollie.ts` calls Mollie.
 */

import { minorUnitDigits } from "./money";
import { decimalString, minorFromDecimal, type PaymentAnswer, type PaymentState } from "./payment-providers";

export const MOLLIE_API = "https://api.mollie.com/v2";
export const MOLLIE_TOKENS = "https://api.mollie.com/oauth2/tokens";
export const MOLLIE_REVOKE = "https://api.mollie.com/oauth2/tokens";
export const MOLLIE_AUTHORIZE = "https://my.mollie.com/oauth2/authorize";
export const MOLLIE_DASHBOARD = "https://my.mollie.com/dashboard";

/** What Kaizena Flow asks a store's Mollie account for (D292): payments, refunds and what they need; never more. */
export const MOLLIE_SCOPES = [
  "payments.read",
  "payments.write",
  "refunds.read",
  "refunds.write",
  "profiles.read",
  "profiles.write",
  "settlements.read",
  "balances.read",
  "organizations.read",
  "onboarding.read",
] as const;

/** Where Mollie sends the owner back after approving Kaizena Flow, and the cookie that remembers who started (path-scoped to the callback). */
export const MOLLIE_CALLBACK = "/api/integrations/mollie/callback";
export const MOLLIE_COOKIE = "kaizen_mollie_connect";
export const MOLLIE_COOKIE_PATH = "/api/integrations/mollie";

/** The address an owner is sent to, to approve Kaizena Flow's Mollie app. */
export function mollieAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    scope: MOLLIE_SCOPES.join(" "),
    response_type: "code",
    approval_prompt: "auto",
  });
  return `${MOLLIE_AUTHORIZE}?${params}`;
}

/** Ids as Mollie makes them: only these are ever sent back to Mollie in a path. */
export const MOLLIE_IDS = {
  payment: /^tr_[A-Za-z0-9]{4,64}$/,
  refund: /^re_[A-Za-z0-9]{4,64}$/,
  chargeback: /^chb_[A-Za-z0-9]{4,64}$/,
  profile: /^pfl_[A-Za-z0-9]{4,64}$/,
  organization: /^org_[A-Za-z0-9]{1,64}$/,
} as const;

/** The payment id a webhook names (its only content: `id=tr_…`), or null when the body is not one. */
export function webhookPaymentId(body: string): string | null {
  const id = new URLSearchParams(body).get("id")?.trim() ?? "";
  return MOLLIE_IDS.payment.test(id) ? id : null;
}

/** A Mollie amount: a currency and a decimal string. */
export type MollieAmount = { currency: string; value: string };

/** Minor units as Mollie reads them, in the currency's own decimals, by code. */
export function mollieAmount(minor: number, currency: string): MollieAmount {
  const code = currency.trim().toUpperCase();
  return { currency: code, value: decimalString(minor, minorUnitDigits(code)) };
}

/** A Mollie amount back to minor units, or null when it is not one (or not in the currency expected). */
export function minorOfAmount(amount: MollieAmount | null | undefined, currency?: string): number | null {
  if (!amount || typeof amount.value !== "string" || typeof amount.currency !== "string") return null;
  const code = amount.currency.toUpperCase();
  if (currency && code !== currency.trim().toUpperCase()) return null;
  return minorFromDecimal(amount.value, minorUnitDigits(code));
}

/** A Mollie payment, as far as Kaizena Flow reads it. */
export type MolliePayment = {
  id: string;
  status: string;
  amount: MollieAmount;
  amountRefunded?: MollieAmount | null;
  amountChargedBack?: MollieAmount | null;
  method?: string | null;
  isCancelable?: boolean;
  metadata?: unknown;
  profileId?: string;
  mode?: "live" | "test";
  createdAt?: string;
  paidAt?: string | null;
  _links?: { checkout?: { href: string } | null };
};

/** Where a Mollie payment stands, in the words every provider's answer comes to (`PaymentState`). */
export function mollieState(status: string): PaymentState {
  switch (status) {
    case "paid":
      return "paid";
    // A pay-later method's authorisation (not offered in this unit): the money is not in, and only Mollie's next answer settles it.
    case "authorized":
      return "unsettled";
    case "failed":
      return "failed";
    // The shopper cancelled on Mollie's page, or never finished: it can no longer be paid.
    case "canceled":
    case "expired":
      return "expired";
    // `open` (not finished) and `pending` (being processed): wait.
    default:
      return "open";
  }
}

/** A Mollie payment as a provider's answer. Mollie's hosted page asks for no address: who paid was asked by Kaizena Flow before and is on the order already. */
export function mollieAnswer(payment: Pick<MolliePayment, "id" | "status">): PaymentAnswer {
  return { provider: "mollie", reference: payment.id, state: mollieState(payment.status), shopper: null };
}

/** A Mollie refund's status in the database's three: `refunded` is done, `failed` and `canceled` failed, anything else is on its way. */
export function mollieRefundStatus(status: string | null | undefined): "pending" | "succeeded" | "failed" {
  if (status === "refunded") return "succeeded";
  if (status === "failed" || status === "canceled") return "failed";
  return "pending";
}

/**
 * The most of a payment Kaizena Flow's fee may take on Mollie, as a share: Mollie names no figure, only that its own fees must fit in what is left
 * (a 0.99 fee cannot be charged on a 1.00 payment), so Kaizena Flow keeps at least half for the store and Mollie's fees. Higher fees wait for a partner
 * agreement (bucket B).
 */
export const MOLLIE_FEE_SHARE_MAX = 0.5;

/** Kaizena Flow's fee on a Mollie payment: its sale fee, capped (and said so) at `MOLLIE_FEE_SHARE_MAX` of the amount; null when there is none. */
export function mollieFee(amountMinor: number, saleFeeMinor: number | null): { feeMinor: number; capped: boolean } | null {
  if (saleFeeMinor === null || saleFeeMinor <= 0 || amountMinor <= 0) return null;
  const ceiling = Math.floor(amountMinor * MOLLIE_FEE_SHARE_MAX);
  if (ceiling <= 0) return null;
  return saleFeeMinor > ceiling ? { feeMinor: ceiling, capped: true } : { feeMinor: saleFeeMinor, capped: false };
}

/**
 * Methods Mollie offers that a checkout of this unit leaves out: pay-later methods need order lines and a capture Kaizena Flow does not send Mollie yet,
 * a bank transfer takes longer than an order's stock is held, and direct debit is for repeat payments.
 */
export const MOLLIE_LEFT_OUT = new Set(["klarna", "klarnapaylater", "klarnapaynow", "klarnasliceit", "billie", "in3", "riverty", "alma", "voucher", "banktransfer", "directdebit"]);

/** The owner's switches per country (D291) are kept by Stripe's names; these are Mollie's names for the same methods. */
export const MOLLIE_METHOD_OF: Record<string, string> = {
  card: "creditcard",
  klarna: "klarna",
  ideal: "ideal",
  bancontact: "bancontact",
  eps: "eps",
  p24: "przelewy24",
  blik: "blik",
  mobilepay: "mobilepay",
};

/**
 * The methods a Mollie checkout lists: what Mollie has active for the store's profile and this amount, less what this unit leaves out and what the owner
 * switched off for the order's country (cards are never switched off). Null: send no list, so Mollie shows what it has (when it could not be asked).
 */
export function checkoutMethods(active: readonly string[] | null, switchedOff: readonly string[]): string[] | null {
  if (active === null) return null;
  const off = new Set(switchedOff.filter((type) => type !== "card").map((type) => MOLLIE_METHOD_OF[type]).filter(Boolean));
  return active.filter((id) => !MOLLIE_LEFT_OUT.has(id) && !off.has(id));
}

const MOLLIE_LOCALES = new Set([
  "en_US", "en_GB", "nl_NL", "nl_BE", "de_DE", "de_AT", "de_CH", "fr_FR", "fr_BE", "es_ES", "ca_ES", "pt_PT", "it_IT", "nb_NO", "sv_SE", "fi_FI", "da_DK",
  "is_IS", "hu_HU", "pl_PL", "lv_LV", "lt_LT",
]);
const LANGUAGE_LOCALE: Record<string, string> = {
  en: "en_US", nl: "nl_NL", de: "de_DE", fr: "fr_FR", es: "es_ES", ca: "ca_ES", pt: "pt_PT", it: "it_IT", nb: "nb_NO", no: "nb_NO", nn: "nb_NO", sv: "sv_SE",
  fi: "fi_FI", da: "da_DK", is: "is_IS", hu: "hu_HU", pl: "pl_PL", lv: "lv_LV", lt: "lt_LT",
};

/** Mollie's locale for the shopper's: the language and country as Mollie has them, else the language's, else English. */
export function mollieLocale(locale: string): string {
  const [lang = "", region = ""] = locale.replace("_", "-").split("-");
  const exact = `${lang.toLowerCase()}_${region.toUpperCase()}`;
  if (MOLLIE_LOCALES.has(exact)) return exact;
  return LANGUAGE_LOCALE[lang.toLowerCase()] ?? "en_US";
}

/** What Mollie's hosted page does not ask and Kaizena Flow asks first: who pays, and where the goods go. */
export type PayerDetails = {
  name: string;
  email: string;
  phone: string;
  address: { line1: string; line2: string; postalCode: string; city: string } | null;
};

export type PayerProblem = "name" | "email" | "phone" | "address";

/** What the payer form needs for an order: the address when goods are sent to the shopper, a phone number when the store's own driver brings them. */
export type PayerNeeds = { address: boolean; phone: boolean };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()-]{5,40}$/;

/** The payer's details cleaned, or the first field that is not right. No zod: the cart is a pay route (D158). */
export function cleanPayer(input: Partial<Record<"name" | "email" | "phone" | "line1" | "line2" | "postalCode" | "city", unknown>>, needs: PayerNeeds): { ok: true; payer: PayerDetails } | { ok: false; problem: PayerProblem } {
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");
  const name = text(input.name, 120);
  const email = text(input.email, 200);
  const phone = text(input.phone, 40);
  if (!name) return { ok: false, problem: "name" };
  if (!EMAIL.test(email)) return { ok: false, problem: "email" };
  if ((needs.phone || phone) && !PHONE.test(phone)) return { ok: false, problem: "phone" };
  let address: PayerDetails["address"] = null;
  if (needs.address) {
    const line1 = text(input.line1, 200);
    const postalCode = text(input.postalCode, 20);
    const city = text(input.city, 100);
    if (!line1 || !postalCode || !city) return { ok: false, problem: "address" };
    address = { line1, line2: text(input.line2, 200), postalCode, city };
  }
  return { ok: true, payer: { name, email, phone, address } };
}
