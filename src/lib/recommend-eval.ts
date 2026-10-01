import { normalCdf } from "./experiment-results";
import { callRates, UNITS } from "./experiment-units";

/**
 * Judging recommendations (D140), the pure parts: the check against past orders (where in the engine's list a product a
 * shopper really bought would have come) and the comparison of the AI's ranking with the plain one on what shoppers did.
 * The comparison is counted by the engine's arithmetic (D148, phase 7); the unit stays the tab.
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

/** The standard normal distribution's cumulative probability: the engine's (D148, phase 7), not a curve of its own. */
export { normalCdf };

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

/** Fewer tabs than this in either ranking and the comparison is not made. */
export const MIN_PER_ARM = UNITS.tab.floor;

/**
 * Whether two shares of visitors differ beyond chance: the engine's two-proportion rule on tabs (each tab one independent visitor,
 * `callRates()` with the pooled rule), called only with enough of them in both rankings. The plain ranking is the control and the
 * AI's the treatment; a clear difference is `a_better` (the AI) or `b_better` (the plain one); otherwise there is none yet.
 */
export function compareShares(a: Share, b: Share): Comparison {
  const rate = (s: Share) => (s.n > 0 ? s.success / s.n : null);
  const ra = rate(a);
  const rb = rate(b);
  const pct = (r: number | null) => (r === null ? null : Math.round(r * 1000) / 10);
  const base = { a: pct(ra), b: pct(rb), diff: ra === null || rb === null ? null : Math.round((ra - rb) * 1000) / 10 };
  const called = callRates({ hits: b.success, of: b.n }, { hits: a.success, of: a.n }, { rule: "pooled", floor: MIN_PER_ARM });
  if (called.call === "few") return { ...base, p: null, verdict: "too_few" };
  const p = called.p === null ? null : Math.round(called.p * 1000) / 1000;
  return { ...base, p, verdict: called.call === "better" ? "a_better" : called.call === "worse" ? "b_better" : "no_clear_difference" };
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
