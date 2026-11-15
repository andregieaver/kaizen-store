import { challengeDay, daysBetween, type Challenge } from "./autopilot-challenge";
import { marketingReturn } from "./profit-figures";

/**
 * The challenge console (`docs/100-day-challenge.md` H2): what the platform team sees of each challenge store. Pure: the challenge's phase on a
 * day, the scoring period, the three ratios the winner is counted on (3.3) and how long the oldest of a queue has waited.
 */

/** The days the challenge is scored over, from Day 1. */
export const SCORED_DAYS = 100;

export type ChallengePhase = "upcoming" | "rehearsal" | "on" | "ended";

/** Where a challenge stands on a day (UTC dates): before it, in its rehearsal, from Day 1 to its end, or after. */
export function phaseOf(c: Challenge, today: string): ChallengePhase {
  if (today < c.startsOn) return "upcoming";
  if (today < c.dayOne) return "rehearsal";
  if (today <= c.endsOn) return "on";
  return "ended";
}

/** The last day the ratios count: Day 100, or the challenge's end if it ends sooner. */
export function scoredUntil(c: Challenge): string {
  const day100 = new Date(Date.parse(`${c.dayOne}T00:00:00Z`) + (SCORED_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  return day100 < c.endsOn ? day100 : c.endsOn;
}

/** The period the ratios are read over today: Day 1 to today or Day 100, whichever is first; null before Day 1. */
export function scoredPeriod(c: Challenge, today: string): { from: string; to: string; days: number } | null {
  if (today < c.dayOne) return null;
  const last = scoredUntil(c);
  const to = today < last ? today : last;
  return { from: c.dayOne, to, days: daysBetween(c.dayOne, to) + 1 };
}

/** The challenge's day shown on the console: Day 1 is 1, never more than the scored days, and none before Day 1. */
export function shownDay(c: Challenge, today: string): number | null {
  const day = challengeDay(c, today);
  return day < 1 ? null : Math.min(day, SCORED_DAYS);
}

/** What the ratios are worked out from, in minor units of the store's main currency (the analytics' own figures). */
export type RatioInput = { netRevenueMinor: number; contributionMinor: number | null; marketingMinor: number; revenuePerVisitorMinor: number | null };

/**
 * The three ratios (3.3): contribution margin (contribution profit ÷ net sales), profit per krone of marketing (`marketingReturn()`) and
 * revenue per visitor. A ratio that cannot be measured is null, never 0.
 */
export function challengeRatios(i: RatioInput): { margin: number | null; perKrone: number | null; perVisitorMinor: number | null } {
  return {
    margin: i.contributionMinor !== null && i.netRevenueMinor > 0 ? i.contributionMinor / i.netRevenueMinor : null,
    perKrone: marketingReturn(i.contributionMinor, i.marketingMinor),
    perVisitorMinor: i.revenuePerVisitorMinor,
  };
}

/** How long the oldest in a queue has waited, in whole hours (0 under an hour); null for an empty queue. */
export function waitedHours(oldestAt: string | null, now: Date): number | null {
  if (oldestAt === null) return null;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(oldestAt)) / 3_600_000));
}

/** The AI budget's use this month as a share (1 is all of it); null without a budget. */
export function budgetShare(spentMicros: number, budgetUsd: number | null): number | null {
  if (budgetUsd === null) return null;
  if (budgetUsd <= 0) return spentMicros > 0 ? 1 : 0;
  return spentMicros / (budgetUsd * 1_000_000);
}
