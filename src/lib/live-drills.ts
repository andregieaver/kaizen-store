/**
 * Live drills (D406): what Kaizena Flow can run for real in a store's Stripe test mode, and what a run found. Pure: the kinds, their order and the shape of a
 * result. The runs are `src/server/live-drills.ts`.
 */

/** In the order a run takes them: the checks that read come first, the drills that change an order after. */
export const DRILL_KINDS = ["webhooks", "payment_facts", "mark_sent", "partial_refund", "full_refund"] as const;
export type DrillKind = (typeof DRILL_KINDS)[number];

export const DRILL_WORDS: Record<DrillKind, string> = {
  webhooks: "Stripe's events reach Kaizena Flow at its own address and are processed",
  payment_facts: "Each paid test payment's method and risk are read from Stripe",
  mark_sent: "A paid order is marked sent with a tracking number",
  partial_refund: "1 unit of the order's currency is refunded through Stripe",
  full_refund: "What is left of an order is refunded through Stripe",
};

export type DrillOutcome = "passed" | "failed" | "skipped";

/** One drill's result: plain facts (order numbers, amounts in minor units, counts), never a shopper's details. */
export type DrillResult = { kind: DrillKind; outcome: DrillOutcome; detail: string; order?: string };

export function isDrillKind(value: unknown): value is DrillKind {
  return typeof value === "string" && (DRILL_KINDS as readonly string[]).includes(value);
}

/** The kinds asked, known ones only, once each, in the run's own order. */
export function drillPlan(kinds: readonly string[]): DrillKind[] {
  return DRILL_KINDS.filter((k) => kinds.includes(k));
}

/** Orders a drill may touch are paid to Resend's test address only (`@resend.dev`): a mailbox no person reads, never a shopper. */
export const DRILL_EMAIL_DOMAIN = "@resend.dev";
