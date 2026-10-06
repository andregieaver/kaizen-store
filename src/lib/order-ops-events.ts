/**
 * The names of the events and audit actions of wave 3's order operations (run 2, D173, `docs/wave-3-orders.md` 2.2 to 2.4), in one place so the server that writes them,
 * the order page that labels them and the database that lets a copied order take three of them say the same words. An event is a row of `order_events` (the history of one order,
 * append-only; its free text is `data.reason` and `data.note`, the two keys the erasure removes, D162); an audit action is a row of `audit_log` (what staff did, never an email, a name, a
 * search text or a payment reference). The prefix `order.` is the `orders` area of the activity log (`AUDIT_AREAS`).
 */
import { areaOfAction } from "./audit";

/** The events written on an order. */
export const ORDER_OPS_EVENTS = {
  /** Tags added or removed: `data.note` says it in words (`tagChangeNote()`), nothing else. */
  tagsChanged: "order.tags_changed",
  archived: "order.archived",
  /** Unarchived by staff, or by a return or withdrawal (`data.note` is `UNARCHIVE_RETURN_NOTE`). */
  unarchived: "order.unarchived",
  /** A payment taken outside Kaizen was recorded: `data.method` and the reference as `data.note`. */
  paidOutside: "order.paid_outside",
  /** A refund of money that was taken outside Kaizen was recorded (no Stripe call): `data.note` is the reason. */
  refundedOutside: "order.refunded_outside",
} as const;
export type OrderOpsEvent = (typeof ORDER_OPS_EVENTS)[keyof typeof ORDER_OPS_EVENTS];

/**
 * The events a copied order (D129) takes besides `copied`: the three of tagging and archiving, which are all it may be given. The migration patches
 * `commerce.refuse_copied_order_event()` with exactly these names (`orders-ops.test.ts` holds the two to each other).
 */
export const COPIED_ORDER_EVENTS: readonly OrderOpsEvent[] = [ORDER_OPS_EVENTS.tagsChanged, ORDER_OPS_EVENTS.archived, ORDER_OPS_EVENTS.unarchived];

/** What the order page's history says for each (the labels of `EVENT_LABELS`). */
export const ORDER_OPS_EVENT_LABELS: Record<OrderOpsEvent, string> = {
  "order.tags_changed": "Tags changed",
  "order.archived": "Archived",
  "order.unarchived": "Unarchived",
  "order.paid_outside": "Payment recorded outside Kaizen",
  "order.refunded_outside": "Refund recorded outside Kaizen",
};

/** The audit actions of these operations. One entry for a batch (counts only, never the order numbers) or for a change to a view, a draft or a payment. */
export const ORDER_AUDIT_ACTIONS = {
  viewSaved: "order.view_saved",
  viewDeleted: "order.view_deleted",
  tagsChanged: "order.tags_changed",
  archived: "order.archived",
  unarchived: "order.unarchived",
  bulkTagged: "order.bulk_tagged",
  bulkArchived: "order.bulk_archived",
  bulkUnarchived: "order.bulk_unarchived",
  bulkSent: "order.bulk_sent",
  draftCreated: "order.draft_created",
  draftSent: "order.draft_sent",
  draftReopened: "order.draft_reopened",
  draftDeleted: "order.draft_deleted",
  draftPaidOutside: "order.draft_paid_outside",
  refundedOutside: "order.refunded_outside",
  settingsChanged: "order.settings_changed",
} as const;
export type OrderAuditAction = (typeof ORDER_AUDIT_ACTIONS)[keyof typeof ORDER_AUDIT_ACTIONS];

/** Every audit action here is in the activity log's `orders` area (a scan test fails for one that is not). */
export const ORDER_AUDIT_ALL: readonly OrderAuditAction[] = Object.values(ORDER_AUDIT_ACTIONS);
export const allInOrdersArea = (): boolean => ORDER_AUDIT_ALL.every((a) => areaOfAction(a) === "orders");
