/**
 * The search test's arithmetic (Phase 2, S5, D77): the difference between
 * two rates with its 95 % interval, and the sample-ratio check. Pure, so it
 * is tested alone; the decision rule is fixed here before any result is in.
 */

/** Searches each arm needs before a difference is read at all. */
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

/**
 * B's rate minus A's, with a 95 % interval (normal approximation). The
 * interval is null while either arm has no searches.
 */
export function difference(a: Rate, b: Rate): { diff: number; low: number; high: number } | null {
  if (a.of === 0 || b.of === 0) return null;
  const pa = rate(a);
  const pb = rate(b);
  const se = Math.sqrt((pa * (1 - pa)) / a.of + (pb * (1 - pb)) / b.of);
  const diff = pb - pa;
  return { diff, low: diff - 1.96 * se, high: diff + 1.96 * se };
}

/**
 * The sample-ratio-mismatch check: how likely the split seen is, if
 * searches really went to arm A with `shareA`. Below 0.001 the assignment
 * or the logging is broken, and the results are not to be trusted.
 */
export function sampleRatioP(countA: number, countB: number, shareA: number): number {
  const total = countA + countB;
  if (total === 0) return 1;
  const expectedA = total * shareA;
  const expectedB = total - expectedA;
  const chi = (countA - expectedA) ** 2 / expectedA + (countB - expectedB) ** 2 / expectedB;
  // A chi-square with one degree of freedom: P(X > chi) = erfc(sqrt(chi / 2)).
  return erfc(Math.sqrt(chi / 2));
}

export type Verdict = "few" | "better" | "worse" | "even" | "broken";

/**
 * Whether hybrid (B) is better than keyword (A) on a rate where more is
 * better; `lowerIsBetter` for rates such as searches finding nothing.
 */
export function verdict(a: Rate, b: Rate, srmP: number, lowerIsBetter = false): Verdict {
  if (srmP < 0.001) return "broken";
  if (a.of < MIN_PER_ARM || b.of < MIN_PER_ARM) return "few";
  const d = difference(a, b);
  if (!d) return "few";
  const [low, high] = lowerIsBetter ? [-d.high, -d.low] : [d.low, d.high];
  return low > 0 ? "better" : high < 0 ? "worse" : "even";
}

/** Whether the arm is to get keyword search only, from a number in [0, 1). */
export const keywordArm = (draw: number, keywordShare: number): boolean => draw < keywordShare;
