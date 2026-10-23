import { isEuMemberCountry, normaliseVatNumber } from "./vat-number";

/**
 * Buying a domain without a store (D317, `docs/domains-standalone.md` 6, 7 and 10): who may buy and what VAT the invoice carries, the
 * consent a consumer gives before registration starts, names a person looks at first, and how many domains a new account may buy. Pure:
 * the checkout, the server and the tests share it.
 *
 * Kaizena Flow is a Norwegian seller. Decision 1: consumers in Norway (25 % MVA) and businesses anywhere (Norwegian MVA in Norway, reverse
 * charge with a checked VAT number in the EU, outside the scope of Norwegian VAT elsewhere). Consumers outside Norway can't buy until the
 * company has registered for the EU's non-Union OSS scheme (S2), so they are refused with that reason, never charged the wrong VAT.
 */

export type BuyerKind = "consumer" | "business";
export type VatKind = "mva" | "reverse_charge" | "outside_scope";

/** Norwegian MVA on what Kaizena Flow sells (merverdiavgiftsloven § 5-1), in percent. */
export const NORWEGIAN_MVA_PERCENT = 25;

export type VatChoice =
  | { ok: true; vatKind: VatKind; vatNumber: string | null; ratePercent: number }
  | { ok: false; problem: "consumer_country" | "vat_number_needed" | "vat_number_shape" | "vat_number_country" };

/** The VAT a domain invoice to this buyer carries, or why they can't buy yet. */
export function vatFor(buyer: { kind: BuyerKind; country: string; vatNumber?: string | null }): VatChoice {
  const country = buyer.country.trim().toUpperCase();
  if (country === "NO") return { ok: true, vatKind: "mva", vatNumber: null, ratePercent: NORWEGIAN_MVA_PERCENT };
  if (buyer.kind === "consumer") return { ok: false, problem: "consumer_country" };
  if (!isEuMemberCountry(country)) return { ok: true, vatKind: "outside_scope", vatNumber: null, ratePercent: 0 };
  if (!buyer.vatNumber?.trim()) return { ok: false, problem: "vat_number_needed" };
  const number = normaliseVatNumber(country, buyer.vatNumber);
  if (!number.ok) return { ok: false, problem: "vat_number_shape" };
  if (number.country !== country) return { ok: false, problem: "vat_number_country" };
  return { ok: true, vatKind: "reverse_charge", vatNumber: number.number, ratePercent: 0 };
}

/** The price a buyer sees: VAT added where the invoice adds it, rounded half up to the minor unit. Integer arithmetic. */
export const withVat = (minor: number, ratePercent: number): number => minor + Math.floor((minor * ratePercent + 50) / 100);

export const VAT_PROBLEM_TEXT: Record<Extract<VatChoice, { ok: false }>["problem"], string> = {
  consumer_country: "Kaizena Flow sells domains to private people in Norway only for now. A business anywhere can buy with its VAT number.",
  vat_number_needed: "Give the business's VAT number: the invoice is then without VAT (reverse charge).",
  vat_number_shape: "That doesn't look like a VAT number for that country.",
  vat_number_country: "The VAT number is for another country than the address.",
};

/** The currency a buyer without a store pays in, by their country, among the currencies domains are priced in. */
export function currencyForCountry(country: string, priced: readonly string[]): string | null {
  const own: Record<string, string> = { NO: "NOK", SE: "SEK", DK: "DKK" };
  const wanted = own[country.trim().toUpperCase()] ?? "EUR";
  return priced.includes(wanted) ? wanted : priced.includes("EUR") ? "EUR" : null;
}

/**
 * A consumer's express consent that registration starts now and the right of withdrawal is lost once it is complete (Directive
 * 2011/83/EU art. 16 (a); angrerettloven § 22 bokstav a). Shown beside the tick box, kept on the purchase, and repeated in the email.
 * The words need a lawyer's review (S3) before consumers buy.
 */
export const CONSENT_TEXT = {
  en: "I ask Kaizena Flow to register the domain as soon as it is paid, and I understand that I lose my right to withdraw once the registration is complete.",
  nb: "Jeg ber Kaizena Flow registrere domenet så snart det er betalt, og jeg forstår at jeg mister angreretten når registreringen er fullført.",
} as const;

/**
 * Words that phishing favours, and well-known names: a domain holding one waits for a platform admin's yes before the registrar is asked
 * (D317 10). Matched as whole parts of the name split by dots, dashes and digits, so `pay-later.com` waits and `display.com` does not. A list
 * kept as data and changed by a person; never a model's guess.
 */
export const REVIEW_WORDS: readonly string[] = [
  "login",
  "signin",
  "logon",
  "secure",
  "security",
  "verify",
  "verification",
  "account",
  "accounts",
  "wallet",
  "bank",
  "banking",
  "invoice",
  "refund",
  "support",
  "helpdesk",
  "password",
  "update",
  "recovery",
  "unlock",
  "paypal",
  "vipps",
  "bankid",
  "apple",
  "icloud",
  "google",
  "gmail",
  "microsoft",
  "outlook",
  "office365",
  "amazon",
  "netflix",
  "facebook",
  "instagram",
  "whatsapp",
  "posten",
  "postnord",
  "bring",
  "dhl",
  "fedex",
  "ups",
  "skatteetaten",
  "nav",
  "altinn",
  "dnb",
  "nordea",
  "klarna",
  "stripe",
  "coinbase",
  "binance",
  "kaizena",
  "kaizenaflow",
  "vercel",
];

/** Whether a name waits for a person's yes, and which word made it. */
export function nameNeedsReview(domain: string): string | null {
  const label = domain.toLowerCase().split(".").slice(0, -1).join(".");
  const parts = label.split(/[.\-0-9]+/).filter(Boolean);
  const joined = label.replace(/[.\-0-9]/g, "");
  for (const word of REVIEW_WORDS) {
    if (parts.includes(word)) return word;
    // A known brand hidden in a longer word (`paypalhelp`), for names of six letters or more only, so short words don't catch everything.
    if (word.length >= 6 && joined.includes(word)) return word;
  }
  return null;
}

/** A new account (its first 30 days) may hold at most three domains bought here, until a renewal is paid or it has a store. */
export const NEW_ACCOUNT_DAYS = 30;
export const NEW_ACCOUNT_DOMAINS = 3;

/** Whether one more purchase is allowed for an account without a store. */
export function newAccountRoom(facts: { createdAt: Date; bought: number; renewedOrStore: boolean }, now: Date): boolean {
  if (facts.renewedOrStore) return true;
  const young = now.getTime() - facts.createdAt.getTime() < NEW_ACCOUNT_DAYS * 86_400_000;
  return !young || facts.bought < NEW_ACCOUNT_DOMAINS;
}
