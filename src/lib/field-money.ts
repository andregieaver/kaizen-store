import { convertMinor, type Rates } from "./currency";
import { mainCurrency, type Market } from "./markets";
import { formatMoney, isCurrency, minorUnitDigits } from "./money";

/**
 * Money in custom fields (D120): an amount for information, not a price
 * ("Shipping from", "Deposit", "Warranty cost"). It is kept as integer minor
 * units with an ISO 4217 code, the same in every language, in a currency the
 * store offers; shoppers see it in the market's currency at the store's rates
 * (or in its own currency when no rate is known), and never with a VAT label:
 * it is shown as entered and is not what anyone pays. Pure and shared with the
 * browser; `src/lib/custom-fields.ts` uses it to check and word a value.
 */

/** An amount of money: whole minor units of a currency. */
export type FieldMoney = { amountMinor: number; currency: string };

/** The most a money field may hold, in minor units: 1 000 000 000.00, far more than any currency needs, small enough to convert without losing units. */
export const MAX_MONEY_MINOR = 100_000_000_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether a value is money as it is kept. */
export const isMoney = (v: unknown): v is FieldMoney =>
  isRecord(v) && typeof v.amountMinor === "number" && typeof v.currency === "string";

/** A money value as the major amount it stands for (12.5 for 1250 EUR), or null for a currency this code does not know. */
export function majorOf(value: FieldMoney): number | null {
  return isCurrency(value.currency) && Number.isFinite(value.amountMinor)
    ? value.amountMinor / 10 ** minorUnitDigits(value.currency)
    : null;
}

/** Minor units of a currency for an amount in major units (12.5 EUR → 1250). */
export const minorOf = (major: number, currency: string): number => Math.round(major * 10 ** minorUnitDigits(currency));

/**
 * The minor units a person typed: "12", "12.5", "12,50", with the currency's
 * own number of decimals at most. Null when the text is not an amount of that
 * currency (letters, a minus sign, too many decimals, too large); no floating
 * point is involved, so 0.07 is 7 and 1234567.89 is exactly that.
 */
export function parseAmount(text: string, currency: string): number | null {
  if (!isCurrency(currency)) return null;
  const digits = minorUnitDigits(currency);
  const match = /^(\d{1,12})(?:[.,](\d*))?$/.exec(text.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > digits) return null;
  const minor = Number(match[1] + fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(minor) && minor <= MAX_MONEY_MINOR ? minor : null;
}

/** Minor units as the text a form shows for editing: "12.50", with the currency's decimals and a point. */
export function amountText(amountMinor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const sign = amountMinor < 0 ? "-" : "";
  const whole = String(Math.abs(amountMinor)).padStart(digits + 1, "0");
  return digits === 0 ? `${sign}${whole}` : `${sign}${whole.slice(0, -digits)}.${whole.slice(-digits)}`;
}

/**
 * What a shopper reads: the amount in `to.currency` at the store's rates,
 * formatted in their language; in its own currency when there is no
 * `to`, no rate for the pair, or the currency is one this code cannot format.
 * Empty for something that is not money, so nothing wrong is ever drawn.
 */
export function shownMoney(value: unknown, locale: string, to?: { currency: string; rates: Rates }): string {
  if (
    !isMoney(value) ||
    !Number.isSafeInteger(value.amountMinor) ||
    value.amountMinor < 0 ||
    !isCurrency(value.currency)
  )
    return "";
  if (to && to.currency !== value.currency && isCurrency(to.currency)) {
    const converted = convertMinor(value.amountMinor, value.currency, to.currency, to.rates);
    if (converted !== null && Number.isSafeInteger(converted)) return formatMoney(converted, to.currency, locale);
  }
  return formatMoney(value.amountMinor, value.currency, locale);
}

/** The currencies a store offers for money fields: its main one first, then the others it can show (`store.localization`), only those money knows. */
export function moneyCurrencies(store: {
  markets: readonly Pick<Market, "nativeCurrency">[];
  localization: { currencies: readonly { currency: string }[] };
}): string[] {
  const all = [mainCurrency(store), ...store.localization.currencies.map((c) => c.currency)];
  return [...new Set(all)].filter(isCurrency);
}
