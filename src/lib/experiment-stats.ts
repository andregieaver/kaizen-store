/**
 * The primitives the engine's statistics stand on (D77, D148): a rate, the complementary error function and the share of
 * units each arm needs before a difference is read at all. The comparison of two rates, the split check and the rule for
 * calling a difference are the engine's (`experiment-results.ts`, `experiment-units.ts`), used by the search test and the
 * recommendations test as by page tests; the decision rule is fixed there before any result is in.
 */

/** Searches (or visitors) each arm needs before a difference is read at all. */
export const MIN_PER_ARM = 200;

export type Rate = { hits: number; of: number };

export const rate = ({ hits, of }: Rate): number => (of === 0 ? 0 : hits / of);

/** The complementary error function (Abramowitz and Stegun 7.1.26, error below 1.5e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const value = poly * Math.exp(-z * z);
  return x >= 0 ? value : 2 - value;
}

/** Whether the arm is to get keyword search only, from a number in [0, 1). */
export const keywordArm = (draw: number, keywordShare: number): boolean => draw < keywordShare;
