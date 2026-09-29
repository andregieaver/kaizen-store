import { minorUnitDigits } from "./money";

/**
 * Showing a store in more currencies than a country's own (D109). Prices,
 * shipping and every other amount stay in the country's own currency; a
 * shopper who chooses another sees them converted at the rates the store
 * set: units of the currency per 1 EUR (the euro reference rates the ECB
 * publishes), and a step the converted amount is rounded to. A rate of null
 * means no conversion into or out of the currency, so it is only shown by
 * countries that have it as their own.
 */

export type StoreCurrency = {
  currency: string;
  /** Units of the currency per 1 EUR; null when the store has not set one. */
  rate: number | null;
  /** Converted amounts are rounded to a multiple of this, in the currency's minor units. */
  roundTo: number;
};

/** The rate of the euro itself. */
export const EURO_RATE = 1;

/** The step converted amounts are rounded to unless the store chose: HUF is charged in whole forints. */
export function defaultRoundTo(currency: string): number {
  return currency === "HUF" ? 100 : 1;
}

/** The rounding steps a store can choose, as amounts in major units ("0.05" → 5 minor units of a 2-digit currency). */
export const ROUND_STEPS = [0, 0.05, 0.1, 0.5, 1, 5, 10] as const;

/** A step in major units, as minor units of the currency (at least 1). */
export function stepMinor(currency: string, major: number): number {
  return Math.max(1, Math.round(major * 10 ** minorUnitDigits(currency)));
}

/** Rates by currency; the euro is always 1. */
export type Rates = ReadonlyMap<string, StoreCurrency>;

export function toRates(list: readonly StoreCurrency[]): Rates {
  const map = new Map(list.map((c) => [c.currency, c]));
  if (!map.has("EUR")) map.set("EUR", { currency: "EUR", rate: EURO_RATE, roundTo: 1 });
  return map;
}

const rateOf = (rates: Rates, currency: string) => (currency === "EUR" ? EURO_RATE : (rates.get(currency)?.rate ?? null));

/** Whether an amount in one currency can be shown in another: the same one, or both have rates. */
export function canConvert(from: string, to: string, rates: Rates): boolean {
  if (from === to) return true;
  const a = rateOf(rates, from);
  const b = rateOf(rates, to);
  return a !== null && b !== null && a > 0 && b > 0;
}

/**
 * What turns an amount in one currency's minor units into another's: multiply
 * by `factor`, then round to a multiple of `step`. Null when they cannot be
 * converted. SQL that converts a column takes the same two numbers, so the
 * database and the code agree (`convertSql()`).
 */
export function conversionFactor(from: string, to: string, rates: Rates): { factor: number; step: number } | null {
  if (from === to) return { factor: 1, step: 1 };
  if (!canConvert(from, to, rates)) return null;
  const a = rateOf(rates, from)!;
  const b = rateOf(rates, to)!;
  return { factor: (b / a) * 10 ** (minorUnitDigits(to) - minorUnitDigits(from)), step: Math.max(1, rates.get(to)?.roundTo ?? 1) };
}

/**
 * An amount in minor units of one currency in another, at the store's rates,
 * rounded to the target's step; null when it cannot be converted. The same
 * currency comes back unchanged, whatever its step.
 */
export function convertMinor(amountMinor: number, from: string, to: string, rates: Rates): number | null {
  if (from === to) return amountMinor;
  const c = conversionFactor(from, to, rates);
  return c && Math.round((amountMinor * c.factor) / c.step) * c.step;
}

/** The conversion to use for one shopper's view: a function from a market's own currency to what is shown. */
export function converter(from: string, to: string, rates: Rates): (amountMinor: number) => number {
  if (from === to) return (amountMinor) => amountMinor;
  return (amountMinor) => {
    const converted = convertMinor(amountMinor, from, to, rates);
    if (converted === null) throw new RangeError(`No rate to show ${from} in ${to}`);
    return converted;
  };
}

/** A rate typed by an owner: a positive number, with a comma or a point. */
export function parseRate(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 && value < 1_000_000 ? Math.round(value * 1e8) / 1e8 : null;
}
