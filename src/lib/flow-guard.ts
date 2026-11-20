/**
 * The flow guard (D767, email plan M3.9): a switched-on flow whose readers leave the list after its emails is switched off before it
 * trips the store's sending guard (D730) for every email. Over `FLOW_GUARD.days`, of the people who got one of its emails, those who left
 * the list within `FLOW_GUARD.withinHours` of it (unsubscribed, or marked it as spam, which unsubscribes them too). Pure: `guardFlows()`
 * in `src/server/flow-guard.ts` counts and acts.
 */

export const FLOW_GUARD = {
  /** The days counted back from now. */
  days: 7,
  /** How soon after an email leaving the list counts against it. */
  withinHours: 48,
  /** Too few readers to judge below this. */
  minSent: 30,
  /** Several times a usual unsubscribe rate (a few in a thousand): more than this share leaving pauses the flow. */
  share: 0.03,
} as const;

export type FlowGuardCounts = { sent: number; left: number };

export function flowGuardPauses(c: FlowGuardCounts): boolean {
  return c.sent >= FLOW_GUARD.minSent && c.left / c.sent > FLOW_GUARD.share;
}

/** The counts kept on the flow, read back safely (a stored value of another shape reads as none). */
export function guardCountsOf(value: unknown): FlowGuardCounts | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return typeof v.sent === "number" && typeof v.left === "number" ? { sent: v.sent, left: v.left } : null;
}
