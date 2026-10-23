import { minorUnitDigits } from "./money";

/**
 * What a domain costs a store (D315 decision 3, `docs/domains.md` 4.3): the registrar's own price for that name, converted from its
 * currency at the ECB reference rate, plus Kaizena Flow's margin, rounded up, never below the floor a year. The rules per currency are data
 * (`commerce.domain_pricing`, set by platform admins); nothing here is a price. Pure and integer: the registrar's decimal is read as a
 * string into hundredths, the rates as decimal strings into millionths, and every step is BigInt, so the browser, the server and the tests
 * agree to the minor unit.
 */

export type DomainPricing = { currency: string; marginBps: number; minimumMinor: number; roundMinor: number };

/** ECB reference rates: units of a currency per 1 EUR, as decimal strings (`ecb_reference_rates`). EUR itself is 1. */
export type EurRates = Readonly<Record<string, string>>;

const SCALE = BigInt(1_000_000);

/** A decimal string (`"38.39"`, `"11.2"`) as an integer of `scale` digits after the point, or null for anything else. */
function decimal(value: string | number, digits: number): bigint | null {
  const text = typeof value === "number" ? value.toFixed(Math.max(digits, 6)) : value.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(digits, "0").slice(0, digits);
  // Anything beyond `digits` is rounded up, so a cost is never under-read.
  const rest = (m[2] ?? "").slice(digits);
  const up = /[1-9]/.test(rest) ? BigInt(1) : BigInt(0);
  return BigInt(m[1]) * BigInt(10) ** BigInt(digits) + BigInt(frac || "0") + up;
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - BigInt(1)) / b;

/**
 * The registrar's price (`cost` in `costCurrency`, for the whole term) in `pricing.currency`'s minor units at the ECB rates, without
 * margin, rounded up; null when a rate is missing.
 */
export function convertCost(cost: string | number, costCurrency: string, currency: string, rates: EurRates): bigint | null {
  const costMicros = decimal(cost, 6);
  if (costMicros === null) return null;
  const rateOf = (c: string) => (c === "EUR" ? SCALE : rates[c] ? decimal(rates[c], 6) : null);
  const from = rateOf(costCurrency);
  const to = rateOf(currency);
  if (!from || !to || from <= BigInt(0) || to <= BigInt(0)) return null;
  const digits = BigInt(minorUnitDigits(currency));
  // cost (micros of costCurrency) / from (per EUR) * to (per EUR) → micros of currency → minor units.
  const numerator = costMicros * to * BigInt(10) ** digits;
  const denominator = from * SCALE;
  return ceilDiv(numerator, denominator);
}

/**
 * Our price for a term of `years` whose registrar price is `cost`: converted, plus the margin, rounded up to `roundMinor`, at least
 * `minimumMinor` a year. Null when the currency cannot be priced (no rate).
 */
export function domainPrice(cost: string | number, costCurrency: string, years: number, pricing: DomainPricing, rates: EurRates): number | null {
  const base = convertCost(cost, costCurrency, pricing.currency, rates);
  if (base === null) return null;
  const withMargin = ceilDiv(base * BigInt(10_000 + pricing.marginBps), BigInt(10_000));
  const round = BigInt(Math.max(1, pricing.roundMinor));
  const rounded = ceilDiv(withMargin, round) * round;
  const floor = BigInt(pricing.minimumMinor) * BigInt(Math.max(1, years));
  const price = rounded > floor ? rounded : floor;
  return Number(price);
}

/** Which currency a store pays Kaizena Flow in, among those priced: its plan's, else its own country's, else the first priced (as themes, D286). */
export function billingCurrency(planCurrency: string | null, homeCurrency: string | null, priced: readonly string[]): string | null {
  for (const c of [planCurrency, homeCurrency]) if (c && priced.includes(c)) return c;
  return priced.includes("EUR") ? "EUR" : (priced[0] ?? null);
}
