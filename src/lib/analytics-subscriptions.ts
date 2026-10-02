import { safeRatio } from "./analytics-core";

/**
 * Subscription figures (D152, docs/analytics.md): monthly recurring revenue
 * and how it moved. Amounts are minor units of the main currency, without VAT.
 */

/** How often a subscription renews, as `commerce.subscriptions.interval`. */
export type SubscriptionInterval = "week" | "month" | "year";

const WEEKS_PER_MONTH = 52 / 12;

/**
 * What a renewal is worth per month: a week is 52/12 of a month's renewals, a
 * year is a twelfth, divided by how many intervals pass between renewals
 * ("every 2 weeks"). Whole minor units, rounded half up. Null for an interval
 * or count that makes no sense, so a bad row is not summed as 0.
 */
export function monthlyMinor(totalMinor: number, interval: SubscriptionInterval | string, count: number): number | null {
  if (!Number.isFinite(totalMinor) || !Number.isInteger(count) || count < 1) return null;
  switch (interval) {
    case "week":
      return Math.round((totalMinor * WEEKS_PER_MONTH) / count);
    case "month":
      return Math.round(totalMinor / count);
    case "year":
      return Math.round(totalMinor / 12 / count);
    default:
      return null;
  }
}

/** Annual recurring revenue: twelve months of MRR. */
export function arr(mrrMinor: number): number {
  return mrrMinor * 12;
}

/** Share of subscriptions at the start of the period that were cancelled during it; null when none were active, so no rate. */
export function churnRate(cancelled: number, activeAtStart: number): number | null {
  if (activeAtStart <= 0) return null;
  return Math.max(0, cancelled) / activeAtStart;
}

/**
 * MRR at the two ends of a period and what is known to have moved it. `new`
 * and `churned` are subscriptions that began or were cancelled in the period,
 * each at its monthly value.
 */
export type MrrInput = {
  startMrr: number;
  newMrr: number;
  churnedMrr: number;
  endMrr: number;
};

export type MrrMovements = {
  start: number;
  new: number;
  /** Not tracked: Kaizen keeps no history of a subscription's price or quantity. Null, never 0. */
  expansion: null;
  /** Not tracked, as above. */
  contraction: null;
  /** Not tracked: there is no status history to tell a return from a new subscription. Null, never 0. */
  reactivation: null;
  /** Positive: the MRR lost. */
  churned: number;
  end: number;
  /** New − churned. */
  netNew: number;
  /**
   * End − (start + new − churned): what moved MRR that is not tracked above
   * (price changes, paused or past-due subscriptions, returns, other
   * currencies at today's rates).
   */
  otherMinor: number;
  /** Whether the tracked movements explain the end exactly (within the tolerance given). */
  reconciles: boolean;
  /** End against start; null when there was no MRR to start with. */
  growth: number | null;
};

/**
 * Lays the period's MRR out as start, movements and end. The movements that
 * cannot be known are explicit nulls; whatever they would have accounted for is
 * `otherMinor`, and `reconciles` says whether it is within `toleranceMinor`
 * (rounding of many subscriptions' monthly values).
 */
export function mrrMovements(input: MrrInput, toleranceMinor = 0): MrrMovements {
  const { startMrr, newMrr, churnedMrr, endMrr } = input;
  const other = endMrr - (startMrr + newMrr - churnedMrr);
  return {
    start: startMrr,
    new: newMrr,
    expansion: null,
    contraction: null,
    reactivation: null,
    churned: churnedMrr,
    end: endMrr,
    netNew: newMrr - churnedMrr,
    otherMinor: other,
    reconciles: Math.abs(other) <= Math.max(0, toleranceMinor),
    growth: safeRatio(endMrr - startMrr, startMrr > 0 ? startMrr : null),
  };
}
