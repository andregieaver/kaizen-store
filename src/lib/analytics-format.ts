// The decimal figures the analytics views write besides analytics-core.ts's percentages and counts (D152, docs/analytics.md: every
// figure is written once, by the same functions). They are built on `formatNumber()`/`roundedText()` there, so they follow its one
// convention: a decimal point and thousands apart by a no-break space, never the store's market. Only an amount of money
// (`formatMoney`) follows the market's locale.

import { formatNumber, NO_FIGURE, roundedText, withMinus } from "./analytics-core";
import { formatMoney } from "./money";

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** A figure with a fixed number of decimals: 1.44 → "1.4"; the dash when it cannot be known. */
export function formatDecimal(n: number | null | undefined, digits = 1): string {
  return formatNumber(n, digits);
}

/** A figure with up to `digits` decimals and none that are zero: 0.4285714 → "0.43", 2 → "2". */
export function formatUpTo(n: number | null | undefined, digits = 2): string {
  if (!finite(n)) return NO_FIGURE;
  const rounded = Number(roundedText(n, digits));
  return formatNumber(rounded, String(rounded).split(".")[1]?.length ?? 0);
}

/** A return on spend, or any multiple, as "3.2×"; the dash when it cannot be known. */
export function formatTimes(ratio: number | null | undefined): string {
  return finite(ratio) ? `${formatNumber(ratio, 1)}×` : NO_FIGURE;
}

/**
 * An amount of money in the market's locale with the proper minus (U+2212) for a negative one, whichever sign the locale's own
 * `Intl` writes: the one way the analytics write an amount. Whole minor units only, as `formatMoney()`.
 */
export function formatAmount(amountMinor: number, currency: string, locale: string): string {
  return withMinus(formatMoney(amountMinor, currency, locale));
}
