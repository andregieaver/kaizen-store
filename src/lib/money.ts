/**
 * Money is stored as an integer count of minor units (cents, öre, fillér)
 * alongside an ISO 4217 currency code. These helpers convert for display only;
 * arithmetic stays in integers.
 */

/**
 * ISO 4217 minor-unit digits for the currencies of our markets (EU and Norway) and those stores may offer besides. This is the
 * storage unit, matching Stripe's amounts. It deliberately does not come from
 * Intl: display data shows HUF with no decimals, but HUF amounts are still
 * counted in hundredths.
 */
const MINOR_UNIT_DIGITS: Record<string, number> = {
  EUR: 2,
  SEK: 2,
  DKK: 2,
  NOK: 2,
  PLN: 2,
  CZK: 2,
  HUF: 2,
  RON: 2,
  // Offered to shoppers next to a market's own currency (D109).
  CHF: 2,
  GBP: 2,
  USD: 2,
};

/** Number of decimal places in a currency's minor unit, e.g. 2 for EUR. */
export function minorUnitDigits(currency: string): number {
  const digits = MINOR_UNIT_DIGITS[currency];
  if (digits === undefined) {
    throw new RangeError(`Unsupported currency: ${currency}`);
  }
  return digits;
}

/**
 * Decimals shown where they differ from the stored ones: whole forints, though HUF is counted in hundredths. Fixed here because the
 * runtime's own data changed (ICU 77, as in Node 22.22, shows HUF with two decimals where older ICU showed none), and a price must look
 * the same on every server (PSI CODE-03).
 */
const DISPLAY_DIGITS: Record<string, number> = { HUF: 0 };

/**
 * Prices with or without decimals (D429): `always` writes every amount with its currency's decimals (499,00 kr), `hide_whole` leaves them off
 * a whole amount (499 kr) and keeps them on any other (499,50 kr). It never rounds, so what is shown is what is charged. A store's choice,
 * which a market may change (`stores.price_decimals`, `markets.price_decimals`); shoppers' pages and emails follow it, legal documents
 * (invoices, credit notes, UBL, tax reports) and the admin never do.
 */
export type PriceDecimals = "always" | "hide_whole";

export const PRICE_DECIMALS: readonly PriceDecimals[] = ["always", "hide_whole"];

export const isPriceDecimals = (value: unknown): value is PriceDecimals => value === "always" || value === "hide_whole";

/** How an amount is written beyond its currency and locale (D429): absent, or `decimals` absent, is `always`. A market's `priceStyle` is one. */
export type MoneyStyle = { decimals?: PriceDecimals } | null | undefined;

/**
 * Formats an amount in minor units for a locale, e.g. 1999 EUR → "19,99 €".
 * HUF shows whole forints (`DISPLAY_DIGITS`); every other currency its own decimals, but none on a whole amount where `style` hides them
 * (D429: 49900 NOK → "499 kr", 49950 NOK → "499,50 kr").
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale: string,
  style?: MoneyStyle,
): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(
      `Amount must be a whole number of minor units: ${amountMinor}`,
    );
  }
  // A whole amount loses only zeros, so nothing is rounded.
  const shown = DISPLAY_DIGITS[currency] ?? (style?.decimals === "hide_whole" && amountMinor % 10 ** minorUnitDigits(currency) === 0 ? 0 : undefined);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    ...(shown === undefined ? {} : { minimumFractionDigits: shown, maximumFractionDigits: shown }),
  }).format(amountMinor / 10 ** minorUnitDigits(currency));
}

/** The currencies a store can offer (D109). */
export const OFFERABLE_CURRENCIES: readonly string[] = Object.keys(MINOR_UNIT_DIGITS);

export function isCurrency(value: string): boolean {
  return value in MINOR_UNIT_DIGITS;
}
