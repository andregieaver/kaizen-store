/**
 * The intervention log of the 100-day challenge (`docs/100-day-challenge.md` A5): every action a person took on a challenge store, classed so
 * the scoreboard can show that a person only approved refunds and answered escalated support. Pure: the classes and the rules; the server
 * reads the audit log, the decided calls and the people's support messages.
 */

export const INTERVENTION_CLASSES = ["refund", "escalation", "platform", "other"] as const;
export type InterventionClass = (typeof INTERVENTION_CLASSES)[number];

/** Calls the challenge lets a person decide: money back to a customer (`docs/100-day-challenge.md` 4A2). */
export const REFUND_TOOLS: ReadonlySet<string> = new Set(["refund_order", "adjust_customer_credits", "issue_gift_card", "process_exchange", "change_order"]);

/** Audit actions of a refund made by a person, on the order or the return. */
const REFUND_ACTIONS: ReadonlySet<string> = new Set(["order.refunded", "order.refunded_outside", "order.edit_payment_refunded", "return.refunded", "return.refund_overridden", "gift_card.refund_credit"]);

/** Audit actions that are not a person working the store: their support work is counted from the messages, never twice. */
const COUNTED_ELSEWHERE = /^support\./;

/** A call the autopilot kept that a person decided: a refund, or anything else (which the challenge does not allow). */
export const classOfDecision = (tool: string): InterventionClass => (REFUND_TOOLS.has(tool) ? "refund" : "other");

/** A person's answer to a customer: on an escalated conversation it is allowed, on any other it is an intervention. */
export const classOfReply = (escalated: boolean): InterventionClass => (escalated ? "escalation" : "other");

/**
 * A person's audited action on the store: a platform admin's is a platform fix, a refund is a refund, support work is counted from the
 * messages (null: not counted here), and the rest is an intervention.
 */
export function classOfAction(action: string, byPlatformAdmin: boolean): InterventionClass | null {
  if (COUNTED_ELSEWHERE.test(action)) return null;
  if (byPlatformAdmin) return "platform";
  if (REFUND_ACTIONS.has(action)) return "refund";
  return "other";
}

export type InterventionCounts = Record<InterventionClass, number>;

export const noInterventions = (): InterventionCounts => ({ refund: 0, escalation: 0, platform: 0, other: 0 });
