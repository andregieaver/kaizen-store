/**
 * The search test's (D77) and the recommendations test's (D140) own statistics as they were before they moved onto the engine
 * (D148, phase 7), kept word for word as the reference the engine's version is checked against: `experiment-parity.test.ts`
 * runs both on the same counts and they must agree. Only tests import this; nothing in the app does.
 */

export type LegacyRate = { hits: number; of: number };

const legacyRate = ({ hits, of }: LegacyRate): number => (of === 0 ? 0 : hits / of);

export function legacyErfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const value = poly * Math.exp(-z * z);
  return x >= 0 ? value : 2 - value;
}

export function legacyDifference(a: LegacyRate, b: LegacyRate): { diff: number; low: number; high: number } | null {
  if (a.of === 0 || b.of === 0) return null;
  const pa = legacyRate(a);
  const pb = legacyRate(b);
  const se = Math.sqrt((pa * (1 - pa)) / a.of + (pb * (1 - pb)) / b.of);
  const diff = pb - pa;
  return { diff, low: diff - 1.96 * se, high: diff + 1.96 * se };
}

export function legacySampleRatioP(countA: number, countB: number, shareA: number): number {
  const total = countA + countB;
  if (total === 0) return 1;
  const expectedA = total * shareA;
  const expectedB = total - expectedA;
  const chi = (countA - expectedA) ** 2 / expectedA + (countB - expectedB) ** 2 / expectedB;
  return legacyErfc(Math.sqrt(chi / 2));
}

export type LegacySearchVerdict = "few" | "better" | "worse" | "even" | "broken";

export function legacySearchVerdict(a: LegacyRate, b: LegacyRate, srmP: number, lowerIsBetter = false): LegacySearchVerdict {
  if (srmP < 0.001) return "broken";
  if (a.of < 200 || b.of < 200) return "few";
  const d = legacyDifference(a, b);
  if (!d) return "few";
  const [low, high] = lowerIsBetter ? [-d.high, -d.low] : [d.low, d.high];
  return low > 0 ? "better" : high < 0 ? "worse" : "even";
}

export function legacyNormalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export type LegacyShare = { success: number; n: number };
export type LegacyShareComparison = { a: number | null; b: number | null; diff: number | null; p: number | null; verdict: "a_better" | "b_better" | "no_clear_difference" | "too_few" };

export function legacyCompareShares(a: LegacyShare, b: LegacyShare): LegacyShareComparison {
  const rate = (s: LegacyShare) => (s.n > 0 ? s.success / s.n : null);
  const ra = rate(a);
  const rb = rate(b);
  const pct = (r: number | null) => (r === null ? null : Math.round(r * 1000) / 10);
  const base = { a: pct(ra), b: pct(rb), diff: ra === null || rb === null ? null : Math.round((ra - rb) * 1000) / 10 };
  if (ra === null || rb === null || a.n < 100 || b.n < 100) return { ...base, p: null, verdict: "too_few" };
  const pooled = (a.success + b.success) / (a.n + b.n);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n));
  if (se === 0) return { ...base, p: null, verdict: "no_clear_difference" };
  const z = (ra - rb) / se;
  const p = Math.min(1, 2 * (1 - legacyNormalCdf(Math.abs(z))));
  const rounded = Math.round(p * 1000) / 1000;
  return { ...base, p: rounded, verdict: p < 0.05 ? (ra > rb ? "a_better" : "b_better") : "no_clear_difference" };
}
