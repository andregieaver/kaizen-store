/**
 * A return's life (D153, `docs/returns.md`): the statuses, who may do what next, and the labels' keys. The table below
 * is the same as the database's (`returns_rules` in the returns migration, which refuses anything else), so a screen
 * only ever offers what the database accepts.
 */

export const RETURN_KINDS = ["withdrawal", "return"] as const;
export type ReturnKind = (typeof RETURN_KINDS)[number];

/** In the order of the steps; `declined` and `cancelled` end a return elsewhere. */
export const RETURN_STATUSES = ["requested", "approved", "in_transit", "received", "inspected", "closed", "declined", "cancelled"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_OUTCOMES = ["refunded", "declined", "no_refund", "cancelled"] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];

export const isReturnStatus = (value: unknown): value is ReturnStatus =>
  typeof value === "string" && (RETURN_STATUSES as readonly string[]).includes(value);
export const isReturnKind = (value: unknown): value is ReturnKind => value === "withdrawal" || value === "return";

/** The steps a return goes through, in order (the happy path). */
export const STEPS = ["requested", "approved", "in_transit", "received", "inspected", "closed"] as const satisfies readonly ReturnStatus[];

/** Where a return can go from each status: forward only, never back. */
export const TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  requested: ["approved", "declined", "cancelled"],
  approved: ["in_transit", "received", "closed", "cancelled"],
  in_transit: ["received", "closed", "cancelled"],
  received: ["inspected", "closed", "cancelled"],
  inspected: ["closed"],
  closed: [],
  declined: [],
  cancelled: [],
};

/** A withdrawal return starts approved (the right is not the store's to refuse); a voluntary return starts requested. */
export const startStatus = (kind: ReturnKind): ReturnStatus => (kind === "withdrawal" ? "approved" : "requested");

export const isEnded = (status: ReturnStatus): boolean => TRANSITIONS[status].length === 0;
export const isOpen = (status: ReturnStatus): boolean => !isEnded(status);

/**
 * The statuses a return can move to now. A withdrawal return is never declined (the right is not the store's to refuse),
 * and never cancelled either: it is effective on the statement, so when the goods never come back it is closed without
 * a refund, a decision the store confirms, and the withdrawal and its refund deadline stay on record.
 */
export function nextStatuses(kind: ReturnKind, status: ReturnStatus): ReturnStatus[] {
  return TRANSITIONS[status].filter((next) => !(kind === "withdrawal" && (next === "declined" || next === "cancelled")));
}

export const canMove = (kind: ReturnKind, from: ReturnStatus, to: ReturnStatus): boolean => nextStatuses(kind, from).includes(to);

/** What a person at the store can do with a return (the buttons of its screen). */
export const RETURN_ACTIONS = [
  "approve",
  "decline",
  "set_instructions",
  "mark_in_transit",
  "mark_received",
  "inspect",
  "refund",
  "close",
  "cancel",
  "send_acknowledgement",
] as const;
export type ReturnAction = (typeof RETURN_ACTIONS)[number];

/** The status an action leads to; null for one that does not move the return. */
export const ACTION_TARGET: Record<ReturnAction, ReturnStatus | null> = {
  approve: "approved",
  decline: "declined",
  set_instructions: null,
  mark_in_transit: "in_transit",
  mark_received: "received",
  inspect: "inspected",
  refund: null,
  close: "closed",
  cancel: "cancelled",
  send_acknowledgement: null,
};

export type ActionContext = {
  kind: ReturnKind;
  status: ReturnStatus;
  /** A refund is recorded already. */
  refunded: boolean;
  /** `return_settings.refund_when`: with `request` a refund may be made before the goods arrive. */
  refundWhen: "received" | "request";
  /** The withdrawal's acknowledgement was not sent (`acknowledged_at` is null on a confirmed request). */
  acknowledgementPending?: boolean;
  /** An order paid outside Kaizen's Stripe: the refund is recorded as made outside. */
  refundOutside?: boolean;
  /** The withdrawal was made before the goods were sent: nothing to send back, so no refund is held back for the goods. */
  nothingToSendBack?: boolean;
};

/**
 * What can be done with a return now. Approve or decline only a voluntary return that waits for it (a withdrawal
 * return starts approved). A refund is made once, after approval, once the goods are there or on their way (the proof of
 * sending), or, when the store does not wait for them (or there are none to wait for), at any step; closing is for a return that is done (refunded, or with nothing to refund).
 */
export function actionsFor(ctx: ActionContext): ReturnAction[] {
  const { kind, status } = ctx;
  const out: ReturnAction[] = [];
  const allowed = nextStatuses(kind, status);
  if (isEnded(status)) return ctx.acknowledgementPending && kind === "withdrawal" ? ["send_acknowledgement"] : [];
  if (allowed.includes("approved")) out.push("approve");
  if (allowed.includes("declined")) out.push("decline");
  if (status === "approved" || status === "in_transit" || status === "requested") out.push("set_instructions");
  if (allowed.includes("in_transit")) out.push("mark_in_transit");
  if (allowed.includes("received")) out.push("mark_received");
  if (allowed.includes("inspected")) out.push("inspect");
  // Art. 13(3): the store may hold the refund until the goods are back or the shopper shows proof of sending, whichever is
  // earlier: so once the goods are in transit (the proof) the refund is available, as `refundDue()` says. Nothing is held for goods never sent.
  const holds = ctx.refundWhen === "received" && !ctx.nothingToSendBack;
  const refundable =
    !ctx.refunded && status !== "requested" && (!holds || status === "in_transit" || status === "received" || status === "inspected");
  if (refundable) out.push("refund");
  if (allowed.includes("closed")) out.push("close");
  if (allowed.includes("cancelled")) out.push("cancel");
  if (ctx.acknowledgementPending && kind === "withdrawal") out.push("send_acknowledgement");
  return out;
}

/** Whether closing without a refund recorded should be warned about (a withdrawal return that was not refunded). */
export const closeWithoutRefundNeedsConfirm = (kind: ReturnKind, refunded: boolean): boolean => kind === "withdrawal" && !refunded;

export type StepState = "done" | "current" | "upcoming" | "skipped";

/**
 * The timeline of a return for the screens: each step with whether it is done, the one it is at, or still to come. A
 * declined or cancelled return shows the steps it reached and that it ended.
 */
export function timeline(kind: ReturnKind, status: ReturnStatus): { step: (typeof STEPS)[number]; state: StepState }[] {
  const steps = kind === "withdrawal" ? STEPS.filter((s) => s !== "requested") : [...STEPS];
  if (status === "declined" || status === "cancelled") {
    return steps.map((step, i) => ({ step, state: i === 0 ? "done" : "skipped" }));
  }
  const at = steps.indexOf(status as (typeof STEPS)[number]);
  return steps.map((step, i) => ({
    step,
    state: i < at || status === "closed" ? "done" : i === at ? "current" : "upcoming",
  }));
}

/** The keys of the labels under `m.returns` (the texts are in `i18n.ts`, hand-written in nb, sv, da and en). */
export const STATUS_KEYS: Record<ReturnStatus, ReturnStatus> = Object.fromEntries(RETURN_STATUSES.map((s) => [s, s])) as Record<ReturnStatus, ReturnStatus>;
export const KIND_KEYS: Record<ReturnKind, ReturnKind> = { withdrawal: "withdrawal", return: "return" };
export const OUTCOME_KEYS: Record<ReturnOutcome, ReturnOutcome> = Object.fromEntries(RETURN_OUTCOMES.map((o) => [o, o])) as Record<ReturnOutcome, ReturnOutcome>;
export const ACTION_KEYS: Record<ReturnAction, ReturnAction> = Object.fromEntries(RETURN_ACTIONS.map((a) => [a, a])) as Record<ReturnAction, ReturnAction>;

/** The event type written to `order_events` for a status the return reaches (`docs/returns.md`). */
export const STATUS_EVENTS: Record<Exclude<ReturnStatus, "requested">, string> = {
  approved: "return.approved",
  in_transit: "return.in_transit",
  received: "return.received",
  inspected: "return.inspected",
  closed: "return.closed",
  declined: "return.declined",
  cancelled: "return.cancelled",
};
export const RETURN_EVENT_TYPES = [
  "return.requested",
  "return.confirmed",
  "return.approved",
  "return.declined",
  "return.in_transit",
  "return.received",
  "return.inspected",
  "return.refunded",
  "return.closed",
  "return.cancelled",
  "return.refund_overridden",
] as const;
export type ReturnEventType = (typeof RETURN_EVENT_TYPES)[number];
