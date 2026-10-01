/**
 * Judging recommendations (D140), the pure parts: the check against past orders (where in the engine's list a product a
 * shopper really bought would have come) and the comparison of the AI's ranking with the plain one on what shoppers did.
 */

/** The 1-based place of a product in a list, or null when it is not there. */
export function rankOf(list: readonly string[], target: string): number | null {
  const at = list.indexOf(target);
  return at < 0 ? null : at + 1;
}

/** Places a product had in the lists tried; the cutoffs a list is judged at. */
export const HIT_CUTOFFS = [1, 4, 12] as const;

export type RankSummary = {
  evaluated: number;
  /** The share (percent, one decimal) of replays whose product was within each cutoff; null with none evaluated. */
  hit: Record<number, number | null>;
  /** Mean reciprocal rank in percent: 100 would be first every time. */
  mrr: number | null;
};

export function summariseRanks(ranks: readonly (number | null)[]): RankSummary {
  const n = ranks.length;
  const share = (cutoff: number) => (n === 0 ? null : Math.round((ranks.filter((r) => r !== null && r <= cutoff).length / n) * 1000) / 10);
  return {
    evaluated: n,
    hit: Object.fromEntries(HIT_CUTOFFS.map((cutoff) => [cutoff, share(cutoff)])),
    mrr: n === 0 ? null : Math.round((ranks.reduce<number>((sum, r) => sum + (r === null ? 0 : 1 / r), 0) / n) * 1000) / 10,
  };
}

/** The standard normal distribution's cumulative probability (Abramowitz and Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export type Share = { success: number; n: number };

export type Comparison = {
  /** Each share in percent with one decimal; null without anyone. */
  a: number | null;
  b: number | null;
  /** a minus b, in percentage points. */
  diff: number | null;
  /** Two-sided p-value of the difference (a two-proportion z-test), null when it cannot be worked out. */
  p: number | null;
  verdict: "a_better" | "b_better" | "no_clear_difference" | "too_few";
};

/** Fewer visitors than this in either ranking and the comparison is not made. */
export const MIN_PER_ARM = 100;
/** The p-value under which a difference is called clear. */
export const CLEAR = 0.05;

/**
 * Whether two shares of visitors differ beyond chance: a two-proportion z-test on tabs (each tab one independent visitor),
 * called only with enough of them in both rankings. A clear difference is `a_better` or `b_better`; otherwise there is none yet.
 */
export function compareShares(a: Share, b: Share): Comparison {
  const rate = (s: Share) => (s.n > 0 ? s.success / s.n : null);
  const ra = rate(a);
  const rb = rate(b);
  const pct = (r: number | null) => (r === null ? null : Math.round(r * 1000) / 10);
  const base = { a: pct(ra), b: pct(rb), diff: ra === null || rb === null ? null : Math.round((ra - rb) * 1000) / 10 };
  if (ra === null || rb === null || a.n < MIN_PER_ARM || b.n < MIN_PER_ARM) return { ...base, p: null, verdict: "too_few" };
  const pooled = (a.success + b.success) / (a.n + b.n);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n));
  if (se === 0) return { ...base, p: null, verdict: "no_clear_difference" };
  const z = (ra - rb) / se;
  const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  const rounded = Math.round(p * 1000) / 1000;
  return { ...base, p: rounded, verdict: p < CLEAR ? (ra > rb ? "a_better" : "b_better") : "no_clear_difference" };
}

export type ArmShares = { visitors: number; clickers: number; adders: number };

/** The AI's ranking against the plain one, on the share of tabs that clicked a recommendation and that put one in the cart. */
export function compareArms(ai: ArmShares, plain: ArmShares): { clicked: Comparison; added: Comparison; words: string } {
  const clicked = compareShares({ success: ai.clickers, n: ai.visitors }, { success: plain.clickers, n: plain.visitors });
  const added = compareShares({ success: ai.adders, n: ai.visitors }, { success: plain.adders, n: plain.visitors });
  return { clicked, added, words: verdictWords(clicked, added) };
}

/** What the two comparisons add up to, in plain words, with what to do next. */
export function verdictWords(clicked: Comparison, added: Comparison): string {
  if (clicked.verdict === "too_few" || added.verdict === "too_few") {
    return `Too few visitors to say yet: wait for at least ${MIN_PER_ARM} in each ranking (the plain ranking's share is the smaller one, so raise it if this takes too long).`;
  }
  const side = (c: Comparison) => (c.verdict === "a_better" ? "ai" : c.verdict === "b_better" ? "plain" : "none");
  const [x, y] = [side(clicked), side(added)];
  if (x === "none" && y === "none") return "No clear difference between the AI's order and the plain one yet. Keep it running, or switch the AI off to save its tokens if it stays that way.";
  if (x === "plain" || y === "plain") return "The plain ranking is doing better than the AI's order on this measure: consider switching the AI off for recommendations.";
  return "The AI's order is doing clearly better than the plain ranking on this measure: keep it on.";
}
