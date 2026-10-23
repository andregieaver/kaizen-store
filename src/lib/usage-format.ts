/**
 * Usage and limits written for people (D314): bytes in GB (binary, as limits are typed), counts with separators, AI in US dollars as
 * its prices are. Pure. A file's own size stays `formatBytes()`'s; this is for amounts measured against a limit.
 */

import { capacityEn, type CapacityMessages } from "./admin-messages/capacity.en";
import { fillWords } from "./admin-fill";
import { GIB, LIMITS, type LimitKey, limitUnit } from "./limits";
import { USAGE_METRICS, type UsageMetric } from "./usage-metrics";

/** An amount in a metric's unit. */
export function formatUsage(metric: UsageMetric, value: number, locale = "en-GB"): string {
  const unit = USAGE_METRICS[metric].unit;
  if (unit === "bytes") {
    if (value >= GIB / 10) return `${(value / GIB).toLocaleString(locale, { maximumFractionDigits: 1 })} GB`;
    return `${Math.max(0, Math.round(value / 1024 / 1024)).toLocaleString(locale)} MB`;
  }
  if (unit === "micros") return `$${(value / 1_000_000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return Math.round(value).toLocaleString(locale);
}

/** A limit's value written in its unit; `stores_owned` has no metric and is a count. */
export function formatLimit(key: LimitKey, value: number, locale = "en-GB"): string {
  const metric = LIMITS[key].metric;
  if (metric) return formatUsage(metric, value, locale);
  return limitUnit(key) === "count" ? Math.round(value).toLocaleString(locale) : String(value);
}

/** The sentence that refuses an action at a hard limit, in the admin's words (English unless given). */
export function limitRefusal(key: LimitKey, limit: number, words: CapacityMessages = capacityEn, locale = "en-GB"): string {
  return fillWords(words.refusals[key] || capacityEn.refusals[key], { limit: formatLimit(key, limit, locale) });
}
