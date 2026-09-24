/**
 * Subscription rules that need no database (decision D25). A product can be
 * bought once or through a purchase option: renewing every `intervalCount`
 * weeks, months or years, with a subscriber's discount.
 */

import { shippingCost, type ShippingRate } from "./checkout";

export const PLAN_INTERVALS = ["week", "month", "year"] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

/** Stripe renews at most every three years. */
export const MAX_INTERVAL_COUNT: Record<PlanInterval, number> = { week: 52, month: 12, year: 3 };

export const MAX_PLANS = 5;
export const MAX_DISCOUNT_PERCENT = 90;
export const MAX_TRIAL_DAYS = 90;
export const MAX_MIN_CYCLES = 24;
/** How many deliveries a shopper can pause at a time. */
export const MAX_PAUSE_PERIODS = 3;

export type PlanTerms = { interval: PlanInterval; intervalCount: number; discountPercent: number };

/** The subscriber's price for one unit, rounded to the minor unit. */
export function planPrice(unitMinor: number, discountPercent: number): number {
  return Math.round((unitMinor * (100 - discountPercent)) / 100);
}

/**
 * Two purchase options can be in one subscription when they renew on the
 * same schedule and start their free trial alike.
 */
export function sameRhythm(
  a: Pick<PlanTerms, "interval" | "intervalCount"> & { trialDays?: number },
  b: Pick<PlanTerms, "interval" | "intervalCount"> & { trialDays?: number },
) {
  return a.interval === b.interval && a.intervalCount === b.intervalCount && (a.trialDays ?? 0) === (b.trialDays ?? 0);
}

/** A date `n` periods later, by the calendar (a month from 31 January is the last of February). */
export function addPeriods(from: Date, interval: PlanInterval, intervalCount: number, n = 1): Date {
  const date = new Date(from.getTime());
  if (interval === "week") {
    date.setUTCDate(date.getUTCDate() + 7 * intervalCount * n);
    return date;
  }
  const months = (interval === "year" ? 12 : 1) * intervalCount * n;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date;
}

/** When the subscriber is next charged: the first renewal date not inside a pause. */
export function nextCharge(
  periodEnd: Date,
  pausedUntil: Date | null,
  interval: PlanInterval,
  intervalCount: number,
): Date {
  let next = periodEnd;
  for (let i = 0; pausedUntil && next < pausedUntil && i < 200; i++) next = addPeriods(periodEnd, interval, intervalCount, i + 1);
  return next;
}

/**
 * Until when a pause of `periods` deliveries lasts: just after the last
 * skipped charge, so the one after is charged as usual.
 */
export function pauseEnd(periodEnd: Date, interval: PlanInterval, intervalCount: number, periods: number): Date {
  const lastSkipped = addPeriods(periodEnd, interval, intervalCount, periods - 1);
  return new Date(lastSkipped.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * When a commitment of `minCycles` payments is met, given how many are
 * paid: the end of the period the last committed payment buys. Pauses
 * and skips move it, as they move the payments. Null once met.
 */
export function commitmentEnd(
  nextChargeAt: Date,
  interval: PlanInterval,
  intervalCount: number,
  minCycles: number,
  paidCycles: number,
): Date | null {
  const remaining = minCycles - paidCycles;
  return remaining > 0 ? addPeriods(nextChargeAt, interval, intervalCount, remaining) : null;
}

/**
 * Whether a reminder is due now, and for which charge: before a trial ends
 * (3 days ahead), and before renewals of a month or longer (7 days ahead).
 * Weekly renewals get none: the order confirmations are reminder enough.
 */
export function reminderDue(
  now: Date,
  sub: {
    interval: PlanInterval;
    intervalCount: number;
    nextChargeAt: Date;
    trialEndsAt: Date | null;
    remindedFor: Date | null;
  },
): { kind: "trial" | "renewal"; chargeAt: Date } | null {
  if (sub.remindedFor && sub.remindedFor.getTime() === sub.nextChargeAt.getTime()) return null;
  if (sub.nextChargeAt <= now) return null;
  const days = (sub.nextChargeAt.getTime() - now.getTime()) / 86_400_000;
  const trial = sub.trialEndsAt !== null && sub.trialEndsAt.getTime() === sub.nextChargeAt.getTime();
  if (trial) return days <= 3 ? { kind: "trial", chargeAt: sub.nextChargeAt } : null;
  if (sub.interval === "week") return null;
  return days <= 7 ? { kind: "renewal", chargeAt: sub.nextChargeAt } : null;
}

export type RenewalState = { kind: "ends" | "paused" | "trial" | "renews"; date: Date } | null;

/**
 * What to say about a running subscription's next step, for lists: it
 * ends, is paused until a charge, is in its free trial, or renews.
 */
export function renewalState(
  sub: {
    interval: PlanInterval;
    intervalCount: number;
    currentPeriodEnd: string | null;
    pausedUntil: string | null;
    trialEndsAt: string | null;
    cancelAt: string | null;
    cancelAtPeriodEnd: boolean;
  },
  now = new Date(),
): RenewalState {
  if (!sub.currentPeriodEnd) return null;
  const periodEnd = new Date(sub.currentPeriodEnd);
  if (sub.cancelAt || sub.cancelAtPeriodEnd) return { kind: "ends", date: sub.cancelAt ? new Date(sub.cancelAt) : periodEnd };
  const paused = sub.pausedUntil ? new Date(sub.pausedUntil) : null;
  if (paused && paused > now) return { kind: "paused", date: nextCharge(periodEnd, paused, sub.interval, sub.intervalCount) };
  if (sub.trialEndsAt && new Date(sub.trialEndsAt) > now) return { kind: "trial", date: new Date(sub.trialEndsAt) };
  return { kind: "renews", date: periodEnd };
}

export type BasketLine = {
  totalMinor: number;
  delivery: "physical" | "digital";
  /** Renews with the subscription. */
  recurring: boolean;
};

/**
 * Shipping for a basket, now and on each renewal. A subscription with
 * something to ship pays shipping on every delivery, worked out on what
 * each delivery holds (free above the store's threshold); items bought
 * once travel with the first delivery at no extra cost. Without one,
 * shipping is the usual rule on the whole basket. Stripe charges a
 * subscription's shipping as a line that renews with it, so the first
 * delivery and each renewal cost the same.
 */
export function basketShipping(
  lines: BasketLine[],
  rate: ShippingRate | null,
  { trial = false }: { trial?: boolean } = {},
): { first: number; renewal: number } {
  const recurring = lines.filter((l) => l.recurring);
  if (rate && recurring.some((l) => l.delivery === "physical")) {
    const renewal = shippingCost(
      recurring.reduce((sum, l) => sum + l.totalMinor, 0),
      rate,
    );
    // In a free trial the first delivery ships free; items bought once pay their own shipping.
    if (trial) {
      const once = lines.filter((l) => !l.recurring);
      const first = once.some((l) => l.delivery === "physical")
        ? shippingCost(once.reduce((sum, l) => sum + l.totalMinor, 0), rate)
        : 0;
      return { first, renewal };
    }
    return { first: renewal, renewal };
  }
  if (rate && lines.some((l) => l.delivery === "physical")) {
    // Lines in a free trial cost nothing now, so they do not count towards free shipping.
    const now = trial ? lines.filter((l) => !l.recurring) : lines;
    return { first: shippingCost(now.reduce((sum, l) => sum + l.totalMinor, 0), rate), renewal: 0 };
  }
  return { first: 0, renewal: 0 };
}

export type SubscriptionStatus = "pending" | "active" | "past_due" | "paused" | "cancelled" | "expired";

/** Statuses as staff read them in the admin. */
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  pending: "Waiting for first payment",
  active: "Active",
  past_due: "Payment failed, Stripe retries",
  paused: "Paused",
  cancelled: "Cancelled",
  expired: "Never started",
};

/** Kaizen's status for a Stripe subscription status. */
export function subscriptionStatusFor(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "paused":
      return "paused";
    case "incomplete":
      return "pending";
    case "incomplete_expired":
      return "expired";
    default:
      return "cancelled";
  }
}

/** A plan in English for the admin: "Every 2 weeks, 10% off". */
export function planSummary(plan: PlanTerms): string {
  const unit = plan.intervalCount === 1 ? plan.interval : `${plan.intervalCount} ${plan.interval}s`;
  return `Every ${unit}${plan.discountPercent > 0 ? `, ${plan.discountPercent}% off` : ""}`;
}
