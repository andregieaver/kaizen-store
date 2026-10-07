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

// ---------------------------------------------------------------------------------------------------------------------
// Sending in parts and changing an order after purchase (wave 3, run 3, D174, docs/wave-3-fulfilment.md 4.8)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The events written on an order by parcels and changes. A change's event carries `{ edit, seq, before, after, difference }` (amounts and ids, never a
 * person's data) and staff's note only as `data.note`, which the erasure removes. A copied order takes none of these (the copied-order guards are not
 * patched: a copied order is never sent or changed).
 */
export const FULFILMENT_EVENTS = {
  /** A change applied to the order: its lines and totals before and after, the difference and what happened to the money. */
  editApplied: "order.edit_applied",
  /** A change with a higher total was sent to the customer, or a link to share was made: the order is unchanged until it is paid. */
  editSent: "order.edit_sent",
  editCancelled: "order.edit_cancelled",
  editExpired: "order.edit_expired",
  /** Staff recorded a change's difference as paid outside Kaizen (method and reference in `data.method` and `data.note`). */
  editPaidOutside: "order.edit_paid_outside",
  /** A payment arrived for a change that could no longer be applied and was refunded in full. */
  editPaymentRefunded: "order.edit_payment_refunded",
  /** The refund of a change's lower total: the change's own credit note covers it (written by `commerce.make_credit_note()`). */
  coveredByEdit: "credit_note.covered_by_edit",
  /**
   * Stripe reported a change's refund as failed after the change was applied on its `pending` answer (review fix): the order reads lower and the customer is
   * owed the money (`data.refundId`, `data.edit`, `data.amount`). The order page, the store checkup and the control center say so until it is refunded again.
   */
  editRefundFailed: "order.edit_refund_failed",
  /**
   * Units never sent were put back with *These units were not sent* ticked (a refund, or a restock with nothing refunded) and taken off what is still to send
   * (`commerce.unsent_closures`): `data.units`, `data.lines` (`{ lineId, sku, title, quantity }`, as sold) and `data.refundId` when money went back with them.
   */
  unsentClosed: "order.unsent_closed",
} as const;
export type FulfilmentEvent = (typeof FULFILMENT_EVENTS)[keyof typeof FULFILMENT_EVENTS];

export const FULFILMENT_EVENT_LABELS: Record<FulfilmentEvent, string> = {
  "order.edit_applied": "Order changed",
  "order.edit_sent": "Change sent to the customer for payment",
  "order.edit_cancelled": "Change cancelled",
  "order.edit_expired": "Change expired unpaid",
  "order.edit_paid_outside": "Change paid outside Kaizen",
  "order.edit_payment_refunded": "Late payment for a change refunded",
  "credit_note.covered_by_edit": "Refund covered by the change's credit note",
  "order.edit_refund_failed": "Refund of a change failed",
  "order.unsent_closed": "Taken off what is still to send",
};

/** The audit actions of parcels and changes (amounts and counts only, never staff's note). Every one is in the activity log's `orders` area. */
export const FULFILMENT_AUDIT_ACTIONS = {
  sentPart: "order.sent_part",
  editApplied: "order.edit_applied",
  editSent: "order.edit_sent",
  editCancelled: "order.edit_cancelled",
  editPaidOutside: "order.edit_paid_outside",
  /** Units taken off what is still to send with a refund or restock (`notSent`): the units and the refund's id, never staff's words. */
  unsentClosed: "order.unsent_closed",
} as const;
export type FulfilmentAuditAction = (typeof FULFILMENT_AUDIT_ACTIONS)[keyof typeof FULFILMENT_AUDIT_ACTIONS];
export const FULFILMENT_AUDIT_ALL: readonly FulfilmentAuditAction[] = Object.values(FULFILMENT_AUDIT_ACTIONS);
export const fulfilmentInOrdersArea = (): boolean => FULFILMENT_AUDIT_ALL.every((a) => areaOfAction(a) === "orders");
