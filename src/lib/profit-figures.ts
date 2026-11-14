/**
 * Profit figures the challenge is judged on (`docs/100-day-challenge.md` 3.3), worked out in code. Pure.
 */

/**
 * Profit per krone of marketing: contribution profit before marketing ÷ marketing spend (the challenge's second ratio). Null without spend or
 * without a contribution profit to measure.
 */
export function marketingReturn(contributionMinor: number | null, marketingMinor: number): number | null {
  if (contributionMinor === null || !Number.isFinite(marketingMinor) || marketingMinor <= 0) return null;
  return (contributionMinor + marketingMinor) / marketingMinor;
}
