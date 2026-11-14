/**
 * The stall watch of the 100-day challenge (`docs/100-day-challenge.md` A6): what holds a challenge store's autopilot up, or waits on a person
 * too long, found by code every five minutes and told to Kaizena Flow's platform team at once (the store's owner hears of their own part on
 * the Autopilot page and their phone). Pure: the kinds, how long each may wait and the key that tells each once a day.
 */

export const STALL_KINDS = [
  /** The owner paused the autopilot: an intervention, which suspends the challenge. */
  "paused",
  /** The month's AI budget stopped it (spent, or a call no price covers). */
  "budget",
  /** A plan paused for a reason the budget does not lift (its maker gone, a person's pause). */
  "plan_paused",
  /** A step asks a question, which nobody answers in the challenge. */
  "asking",
  /** A refund or other money back waits on the owner past the agreed time. */
  "decision_waiting",
  /** A customer waits for a person because the AI was off, failed or reached its limit: a fault, not an escalation. */
  "support_fault",
  /** An escalated customer waits for the owner past the agreed time. */
  "escalation_waiting",
] as const;
export type StallKind = (typeof STALL_KINDS)[number];

/** How long a refund may wait on the owner before the team is told (the plan's recommended response time). */
export const DECISION_HOURS = 24;
/** How long an escalated customer may wait on the owner before the team is told. */
export const ESCALATION_HOURS = 4;
/** How long a customer may wait after a fault before the team is told. */
export const FAULT_MINUTES = 15;

export type Stall = { storeId: string; storeName: string; storeSlug: string; kind: StallKind; ref: string; count: number };

/** The email's key: one per store, kind, reference and day, so a stall that lasts is told again each day it lasts and never more. */
export const stallKey = (stall: Pick<Stall, "storeId" | "kind" | "ref">, day: string): string => `challenge-stall:${stall.storeId}:${stall.kind}:${stall.ref}:${day}`;
