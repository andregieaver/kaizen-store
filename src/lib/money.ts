/**
 * Money is stored as an integer count of minor units (cents, öre, fillér)
 * alongside an ISO 4217 currency code. These helpers convert for display only;
 * arithmetic stays in integers.
 */

/**
 * ISO 4217 minor-unit digits for the currencies of EU markets. This is the
 * storage unit, matching Stripe's amounts. It deliberately does not come from
 * Intl: display data shows HUF with no decimals, but HUF amounts are still
 * counted in hundredths.
 */
const MINOR_UNIT_DIGITS: Record<string, number> = {
  EUR: 2,
  SEK: 2,
  DKK: 2,
  PLN: 2,
  CZK: 2,
  HUF: 2,
  RON: 2,
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
 * Formats an amount in minor units for a locale, e.g. 1999 EUR → "19,99 €".
 * Decimals follow local convention, so HUF shows whole forints.
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale: string,
): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(
      `Amount must be a whole number of minor units: ${amountMinor}`,
    );
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    amountMinor / 10 ** minorUnitDigits(currency),
  );
}
