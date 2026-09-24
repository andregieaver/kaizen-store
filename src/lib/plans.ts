import { formatMoney } from "./money";

/**
 * Plans Kaizen sells to stores (decision D18), as pure helpers shared by the
 * platform admin and the store's billing page.
 */

export type PlanInterval = "month" | "year";

export const PLAN_INTERVALS: readonly PlanInterval[] = ["month", "year"];

/** Stripe subscription statuses in which the store is on its plan (and pays its fee). */
export const ON_PLAN_STATUSES = ["trialing", "active", "past_due"] as const;

export function isOnPlan(status: string | null | undefined): boolean {
  return ON_PLAN_STATUSES.includes(status as (typeof ON_PLAN_STATUSES)[number]);
}

/**
 * Kaizen's fee on a store's sales: the store's own override if set, else its
 * plan's fee while it is on the plan, else the platform default.
 */
export function effectiveFeeBps(input: {
  overrideBps: number | null;
  planFeeBps: number | null;
  status: string | null;
  defaultBps: number;
}): number {
  if (input.overrideBps !== null) return input.overrideBps;
  if (input.planFeeBps !== null && isOnPlan(input.status)) return input.planFeeBps;
  return input.defaultBps;
}

/** "1.5" or "1,5" (percent) → 150 basis points; null if not a percentage between 0 and 20. */
export function percentToBps(text: string): number | null {
  const trimmed = text.trim().replace(",", ".").replace(/\s*%$/, "");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(trimmed)) return null;
  const bps = Math.round(Number(trimmed) * 100);
  return bps <= 2000 ? bps : null;
}

/** 150 → "1.5 %". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en", { maximumFractionDigits: 2 })} %`;
}

/** What Stripe's subscription status means to a person. */
export const SUBSCRIPTION_LABELS: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment overdue",
  unpaid: "Unpaid",
  incomplete: "Waiting for first payment",
  incomplete_expired: "Never started",
  canceled: "Cancelled",
  paused: "Paused",
};

/** "kr 299,00 / month". */
export function priceLabel(amountMinor: number, currency: string, interval: PlanInterval): string {
  return `${formatMoney(amountMinor, currency, "nb-NO")} / ${interval}`;
}
