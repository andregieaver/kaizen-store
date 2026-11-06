/**
 * Usage and limits written for people (D314): bytes in GB (binary, as limits are typed), counts with separators, AI in euros (D481),
 * or in the currency a page or a store shows its prices in. Pure. A file's own size stays `formatBytes()`'s; this is for amounts
 * measured against a limit.
 */

import { capacityEn, type CapacityMessages } from "./admin-messages/capacity.en";
import { fillWords } from "./admin-fill";
import { GIB, LIMITS, type LimitKey, limitUnit } from "./limits";
import { formatMoney, minorUnitDigits, type PriceDecimals } from "./money";
import { USAGE_METRICS, type UsageMetric } from "./usage-metrics";

/**
 * The currency AI money is written in (D481): euros, as it is measured and as plans' limits are typed, or another currency at its ECB
 * rate (units of it per euro), as the platform converts domain prices. `decimals` as a market's price style (D429).
 */
export type AiMoney = { currency: string; perEuro: number; decimals?: PriceDecimals };

export const EURO_MONEY: AiMoney = { currency: "EUR", perEuro: 1 };

/**
 * Millionths of a euro as minor units of the money's currency. Euros are to the cent; a converted amount is an estimate, so a limit's
 * (`whole`) is rounded down to a whole unit of the currency, never promising more than the plan gives, and usage to its minor unit.
 */
export function aiMinor(micros: number, money: AiMoney = EURO_MONEY, whole = false): number {
  const digits = minorUnitDigits(money.currency);
  if (money.currency === "EUR") return Math.round((micros / 1_000_000) * 10 ** digits);
  const major = (micros / 1_000_000) * money.perEuro;
  return whole ? Math.floor(major) * 10 ** digits : Math.round(major * 10 ** digits);
}

/** An amount in a metric's unit; AI money in `money` (euros unless given). */
export function formatUsage(metric: UsageMetric, value: number, locale = "en-GB", money: AiMoney = EURO_MONEY): string {
  const unit = USAGE_METRICS[metric].unit;
  if (unit === "bytes") {
    if (value >= GIB / 10) return `${(value / GIB).toLocaleString(locale, { maximumFractionDigits: 1 })} GB`;
    return `${Math.max(0, Math.round(value / 1024 / 1024)).toLocaleString(locale)} MB`;
  }
  if (unit === "micros") return formatMoney(aiMinor(value, money), money.currency, locale, { decimals: money.decimals });
  return Math.round(value).toLocaleString(locale);
}

/** A limit's value written in its unit; `stores_owned` has no metric and is a count. An AI limit in another currency is whole units. */
export function formatLimit(key: LimitKey, value: number, locale = "en-GB", money: AiMoney = EURO_MONEY): string {
  if (limitUnit(key) === "money") return formatMoney(aiMinor(value, money, true), money.currency, locale, { decimals: money.decimals });
  const metric = LIMITS[key].metric;
  if (metric) return formatUsage(metric, value, locale, money);
  return limitUnit(key) === "count" ? Math.round(value).toLocaleString(locale) : String(value);
}

/** The sentence that refuses an action at a hard limit, in the admin's words (English unless given). */
export function limitRefusal(key: LimitKey, limit: number, words: CapacityMessages = capacityEn, locale = "en-GB"): string {
  return fillWords(words.refusals[key] || capacityEn.refusals[key], { limit: formatLimit(key, limit, locale) });
}
