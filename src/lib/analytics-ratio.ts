/**
 * One ratio of the analytics (D152), a leaf: `analytics-core.ts` says numbers in the request's language, so it holds the analytics' words,
 * and a client part that only classifies a visit (`analytics-traffic.ts` through the campaign link builder) reads this instead (bloat review
 * step 2.26).
 */

/** `a / b`, or null when either is missing or `b` is zero: never 0 or Infinity for "unknown". */
export function safeRatio(a: number | null | undefined, b: number | null | undefined): number | null {
  if (typeof a !== "number" || !Number.isFinite(a) || typeof b !== "number" || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}
