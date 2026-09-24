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

export type PlanTerms = { interval: PlanInterval; intervalCount: number; discountPercent: number };

/** The subscriber's price for one unit, rounded to the minor unit. */
export function planPrice(unitMinor: number, discountPercent: number): number {
  return Math.round((unitMinor * (100 - discountPercent)) / 100);
}

/** Two purchase options renew together when they share a rhythm. */
export function sameRhythm(a: Pick<PlanTerms, "interval" | "intervalCount">, b: Pick<PlanTerms, "interval" | "intervalCount">) {
  return a.interval === b.interval && a.intervalCount === b.intervalCount;
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
export function basketShipping(lines: BasketLine[], rate: ShippingRate | null): { first: number; renewal: number } {
  const recurring = lines.filter((l) => l.recurring);
  if (rate && recurring.some((l) => l.delivery === "physical")) {
    const renewal = shippingCost(
      recurring.reduce((sum, l) => sum + l.totalMinor, 0),
      rate,
    );
    return { first: renewal, renewal };
  }
  if (rate && lines.some((l) => l.delivery === "physical")) {
    return { first: shippingCost(lines.reduce((sum, l) => sum + l.totalMinor, 0), rate), renewal: 0 };
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
