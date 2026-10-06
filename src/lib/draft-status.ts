/**
 * A draft order's life (wave 3, run 2, D173, `docs/wave-3-orders.md` 4.5): the statuses and where each can go. The table is the same as the
 * database's (`draft_orders_rules()` in `orders_ops_rules`, which refuses anything else), so a screen only offers what the database accepts.
 *
 * `open` is the editable quote (it holds no stock and no number). Sending makes the order (`pending_payment`, numbered, stock held to
 * `expires_at`) and the draft `sent`; it is read-only from then on. Paying the order marks the draft `paid` (the trigger `orders_draft_follow()`),
 * an order cancelled for want of payment marks it `expired`, closing a store's orders or staff's cancel `cancelled`; *Reopen* returns a
 * `sent`, `expired` or `cancelled` draft to `open` (a new send makes a new order and a new number). `paid` is final.
 */
import { DRAFT_DONE_RETENTION_DAYS, DRAFT_OPEN_RETENTION_DAYS } from "./order-limits";

export const DRAFT_STATUSES = ["open", "sent", "paid", "expired", "cancelled"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const isDraftStatus = (value: unknown): value is DraftStatus =>
  typeof value === "string" && (DRAFT_STATUSES as readonly string[]).includes(value);

/** Where a draft can go from each status. */
export const DRAFT_TRANSITIONS: Record<DraftStatus, readonly DraftStatus[]> = {
  open: ["sent"],
  sent: ["paid", "expired", "cancelled", "open"],
  paid: [],
  // A payment can still arrive for the order of a draft that expired (the buyer paid inside the session's last minutes): the order completes
  // (`complete_order_payment()` accepts a cancelled order) and the draft follows it (`orders_draft_follow()`).
  expired: ["open", "paid"],
  cancelled: ["open", "paid"],
};

export const canMoveDraft = (from: DraftStatus, to: DraftStatus): boolean => DRAFT_TRANSITIONS[from].includes(to);

/** A paid draft never changes again. */
export const isDraftFinal = (status: DraftStatus): boolean => DRAFT_TRANSITIONS[status].length === 0;

/** Only an open draft's lines, prices, discount, shipping and customer can be changed (the database refuses it otherwise). */
export const isDraftEditable = (status: DraftStatus): boolean => status === "open";

/**
 * A draft can be deleted unless it is `sent` (a live order waits for payment and a link is out: *Reopen* it first). `paid`, `expired` and
 * `cancelled` drafts are deleted by the daily clean-up after their retention, and with the person by an erasure.
 */
export const isDraftDeletable = (status: DraftStatus): boolean => status !== "sent";

/** *Reopen*: a sent draft (its unpaid order is cancelled first), an expired or a cancelled one. */
export const canReopenDraft = (status: DraftStatus): boolean => canMoveDraft(status, "open");

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  open: "Open",
  sent: "Sent",
  paid: "Paid",
  expired: "Expired",
  cancelled: "Cancelled",
};

/**
 * The status a draft's order's own change leads to, as `orders_draft_follow()` does it (null: the draft is not touched). It is only called for
 * a draft that names the order. An order that becomes paid makes a sent draft, and one that expired or was cancelled meanwhile, `paid`; an
 * order cancelled while it waited for payment makes a sent draft `expired`. (A reopen sets the draft `open` and clears its order before it
 * cancels the order, so the trigger finds nothing to follow.)
 */
export function draftFollowsOrder(
  draft: DraftStatus,
  orderStatus: "pending_payment" | "paid" | "fulfilled" | "cancelled" | "closed",
  wasPending: boolean,
): DraftStatus | null {
  if (orderStatus === "paid") return draft === "sent" || draft === "expired" || draft === "cancelled" ? "paid" : null;
  if (orderStatus === "cancelled" && wasPending) return draft === "sent" ? "expired" : null;
  return null;
}

/** The moments before which the daily clean-up deletes drafts: an open one not edited since `open`, a finished one that ended before `done`. */
export function draftPruneCutoffs(now: Date): { open: Date; done: Date } {
  const day = 24 * 60 * 60 * 1000;
  return {
    open: new Date(now.getTime() - DRAFT_OPEN_RETENTION_DAYS * day),
    done: new Date(now.getTime() - DRAFT_DONE_RETENTION_DAYS * day),
  };
}
