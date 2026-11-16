import type { ExperimentsMessages } from "./admin-messages/experiments.en";
import { estimateRuntime, type RuntimeEstimate } from "./experiment-results";
import { MIN_DAYS, type Goal } from "./experiments";

/**
 * How long a test would take at the store's own traffic (D148 phase 13, D658, `docs/ab-testing-usability.md` step 2): the facts are counted
 * by the server (`experimentTraffic()`), from the visits of the last 30 days (D152), the share of cookie choices that accepted statistics,
 * and the store's own funnel; the arithmetic is `estimateRuntime()`'s, the one the results use. Pure, so the new-test form works it out in
 * the browser as choices change, and the AI manager's `suggest_experiments` the same way. Nothing is guessed: a figure the store did not
 * count is null, and the owner can give their own.
 */

/** The goals whose rate today the store counts for every visit; a click or a form depends on the button or form, which it does not. */
export const COUNTED_GOALS = ["orders", "cart", "checkout"] as const satisfies readonly Goal[];
export type CountedGoal = (typeof COUNTED_GOALS)[number];

/** Where a target's visitors were counted from. */
export type TrafficBasis = "landing" | "site" | "products" | "product_viewers" | "cart" | "checkout";

export type TrafficFacts = {
  /** Whether the store counts visits (D152); without it nothing below is known. */
  counting: boolean;
  /** Days of the last 30 with visits counted. */
  days: number;
  /** The share of cookie choices in the last 90 days that accepted statistics; null with fewer than 20 choices. */
  consentShare: number | null;
  /** Today's rate of each counted goal, per visit, over the same days; null while there were no visits. */
  baselines: Record<CountedGoal, number | null>;
  /** Each testable target's visits a day (all visitors, before consent) and what they were counted from; null when unknown. */
  targets: Record<string, { visitsPerDay: number | null; basis: TrafficBasis | null }>;
};

export const isCountedGoal = (goal: Goal): goal is CountedGoal => (COUNTED_GOALS as readonly Goal[]).includes(goal);

/** Visitors a day who could take part in a test of the target: its visits a day times the share who accept statistics cookies. */
export function eligiblePerDay(facts: TrafficFacts, targetId: string): number | null {
  const visits = facts.targets[targetId]?.visitsPerDay ?? null;
  if (!facts.counting || visits === null || facts.consentShare === null) return null;
  return visits * facts.consentShare;
}

/** How long a test of the target with the goal would take at today's traffic, or null when the store did not count what it needs. */
export function goalEstimate(input: {
  facts: TrafficFacts;
  targetId: string;
  goal: Goal;
  trafficShare: number;
  versions: number;
  relativeChange?: number;
  minDays?: number;
  words?: ExperimentsMessages;
  numberLocale?: string;
}): RuntimeEstimate | null {
  if (!isCountedGoal(input.goal)) return null;
  const baseline = input.facts.baselines[input.goal];
  const perDay = eligiblePerDay(input.facts, input.targetId);
  if (baseline === null || !(baseline > 0 && baseline < 1) || perDay === null || !(perDay > 0)) return null;
  return estimateRuntime({
    baseline,
    relativeChange: input.relativeChange ?? 0.2,
    versions: input.versions,
    eligiblePerDay: perDay,
    trafficShare: input.trafficShare,
    minDays: input.minDays ?? MIN_DAYS,
    words: input.words,
    numberLocale: input.numberLocale,
  });
}

/**
 * The goal to start from for a target: orders when a test of them answers within six weeks, else the counted goal that answers soonest
 * (usually adding to the cart, which has a higher rate), else orders. A small store learns sooner from the cart than from orders.
 */
export function recommendedGoal(facts: TrafficFacts, targetId: string, trafficShare = 1, versions = 2): Goal {
  const orders = goalEstimate({ facts, targetId, goal: "orders", trafficShare, versions });
  if (orders && !orders.tooLong) return "orders";
  const others = (["cart", "checkout"] as const)
    .map((goal) => ({ goal, estimate: goalEstimate({ facts, targetId, goal, trafficShare, versions }) }))
    .filter((g): g is { goal: "cart" | "checkout"; estimate: RuntimeEstimate } => g.estimate !== null)
    .sort((a, b) => a.estimate.days - b.estimate.days);
  return others[0]?.goal ?? "orders";
}

/** The changes a test can look for, from subtle to bold. */
export const CHANGES = [0.1, 0.2, 0.3, 0.5] as const;

/**
 * The smallest change a test of the target could find within six weeks at today's traffic, and how long that takes; null when even a bold
 * change would take longer, or nothing is counted. A small shop's way to an answer: change more at once.
 */
export function findableChange(input: { facts: TrafficFacts; targetId: string; goal: Goal; trafficShare: number; versions: number; minDays?: number }): { change: number; estimate: RuntimeEstimate } | null {
  for (const change of CHANGES) {
    const estimate = goalEstimate({ ...input, relativeChange: change });
    if (estimate && !estimate.tooLong) return { change, estimate };
  }
  return null;
}

/** The weeks an estimate takes, for "About 3 weeks". */
export const weeksOf = (estimate: RuntimeEstimate) => Math.round(estimate.days / 7);
