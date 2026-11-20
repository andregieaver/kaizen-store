/**
 * Server code and tests only: an admin client module must not import this (admin-bundle.scan.test.ts).
 * The returns screens' English constants (D153, D312 A4), as the AI manager's tools and the analytics read them; a screen reads the
 * `returns` catalogue in the account's language, which takes these groups from here (bloat review step 2.50), so that code brings no
 * catalogue. Imports nothing but types.
 */
import type { WorkingRow } from "./return-refund";
import type { ReturnAction, ReturnKind, ReturnStatus } from "./return-status";
import type { ReturnReason } from "./withdrawal";

export const RETURN_STATUS_EN = {
  requested: "Requested",
  approved: "Approved",
  in_transit: "On its way back",
  received: "Received",
  inspected: "Inspected",
  closed: "Closed",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const RETURN_STATUS_HINTS_EN = {
  requested: "The customer asks to return goods the law does not require you to take back. Approve or decline.",
  approved: "Waiting for the goods. Tell the customer where to send them.",
  in_transit: "The customer says the goods are on their way, or has shown proof of sending.",
  received: "The goods are back. Inspect them, then refund.",
  inspected: "The goods are checked. Refund, then close.",
  closed: "Done.",
  declined: "Not accepted. The customer was told why.",
  cancelled: "The return did not go ahead.",
};

export const RETURN_KIND_EN = { withdrawal: "Withdrawal", return: "Return request" };

export const RETURN_KIND_HINTS_EN = {
  withdrawal: "The customer withdrew from the contract inside the legal period. You cannot refuse it.",
  return: "The customer asks to return goods inside your own longer window. You may approve or decline.",
};

export const RETURN_REASON_EN = {
  changed_mind: "Changed their mind",
  too_big: "Too big",
  too_small: "Too small",
  defective: "Defective",
  not_as_described: "Not as described",
  damaged_in_transit: "Damaged in transit",
  wrong_item: "Wrong item",
  arrived_late: "Arrived late",
  other: "Other",
};

export const RETURN_ACTION_EN = {
  approve: "Approve",
  decline: "Decline",
  set_instructions: "Return instructions",
  mark_in_transit: "Mark in transit",
  mark_received: "Mark received",
  inspect: "Inspect the goods",
  refund: "Refund",
  close: "Close",
  cancel: "Cancel the return",
  send_acknowledgement: "Send the acknowledgement again",
  process_exchange: "Process the exchange",
  cancel_exchange: "Cancel the exchange and refund instead",
};

export const RETURN_WORKING_EN = {
  goods: "What the customer paid for the returned goods",
  deductions: "Deduction for handling beyond what was needed to inspect the goods",
  shipping: "Original standard delivery (the whole order is withdrawn)",
  return_shipping: "Return shipping the customer pays",
};

export const RETURN_CAPPED_EN = {
  zero: "The sum is below zero, so nothing is refunded.",
  refundable: "The sum is more than is left to refund, so the refund is held to what is left.",
};

export const RETURN_COUNTS_EN = {
  overdue: "{n} past the refund deadline",
  unacknowledged: { one: "{n} acknowledgement was not sent", many: "{n} acknowledgements were not sent" },
  toApprove: "{n} to approve",
  openNoneWaiting: "{n} open, none waiting on you.",
  none: "No returns are open.",
};

export const RETURN_EVENTS_EN = {
  anAmount: "an amount",
  requested: "Return requested by the customer",
  confirmed: "Withdrawal confirmed by the customer",
  approvedAutomatic: "Approved automatically: the right of withdrawal is not the store's to refuse",
  approved: "Approved",
  lineDeclined: "A line was declined",
  declined: "Declined",
  withReason: "{text}: {reason}",
  inTransit: "Goods marked as on their way back",
  received: "Goods received",
  inspected: "Goods inspected",
  exchanged: "Exchanged: {credit} of the credit paid the new order{back}",
  exchangedBack: ", {amount} refunded",
  refunded: "Refunded {amount}{outside}",
  refundedOutside: ", outside Kaizena Flow's Stripe",
  overridden: "The refund was changed from {from} to {to}",
  closedNoRefund: "Closed with no refund",
  closed: "Closed",
  cancelled: "Cancelled",
  exchangeWished: "The customer asked for an exchange",
  exchangeProposed: "Exchange proposed: credit {credit}, replacements {total}",
  agreementRecorded: "The customer's agreement to the exchange was recorded ({channel}{day})",
  agreementDay: ", {day}",
  exchangeConfirmed: "The customer confirmed the exchange",
  exchangeDeclined: "The customer declined the exchange: refund as usual",
  proposalReplaced: "The proposal was replaced by a new one",
  exchangeCancelled: "The exchange was cancelled",
  exchangeExpired: "The exchange ended without being confirmed or paid: refund as usual",
  exchangeProcessed: "Exchange processed: order {order}",
  orderMade: "made",
  labelBooked: "Return label booked{test}",
  labelTest: " (a test label)",
  labelFailed: "The return label could not be booked",
  labelGivenUp: "The return label was not booked after several tries: book it by hand or paste a label",
  exchangeRefundFailed: "The exchange's refund did not go through",
  latePaymentRefunded: "A late payment for the exchange was refunded: {amount}",
};

export const RETURN_MARKS_EN = {
  refunded: "Refunded",
  overdue: "Refund overdue{by}{was}",
  overdueBy: " by {days}",
  wasDue: " (was due {day})",
  waitingLate: "Past the refund deadline{by}, still waiting for the goods",
  waitingLateBy: " ({day})",
  dueToday: "Refund due today",
  dueBy: "Refund due by {day}{left}",
  left: " ({days} left)",
  ready: "Ready to refund",
  waiting: "Waiting for the goods{by}",
  waitingBy: ", refund due by {day}",
  days: { one: "{n} day", many: "{n} days" },
};

export const RETURN_CHANNELS_EN = { web: "on the exchange page", email: "by email", letter: "by letter", phone: "by phone", in_person: "in person", other: "another way" };

export const STATUS_LABELS: Record<ReturnStatus, string> = RETURN_STATUS_EN;

/** What each status means for the person who works the return, a line under the status. */
export const STATUS_HINTS: Record<ReturnStatus, string> = RETURN_STATUS_HINTS_EN;

export const KIND_LABELS: Record<ReturnKind, string> = RETURN_KIND_EN;

export const KIND_HINTS: Record<ReturnKind, string> = RETURN_KIND_HINTS_EN;

export const REASON_LABELS: Record<ReturnReason, string> = RETURN_REASON_EN;

export const ACTION_LABELS: Record<ReturnAction, string> = RETURN_ACTION_EN;

export const WORKING_LABELS: Record<WorkingRow["key"], string> = RETURN_WORKING_EN;

export const CAPPED_WORDS: Record<"zero" | "refundable", string> = RETURN_CAPPED_EN;

/** What `countsSentence()`, `dueMark()` and `eventSentence()` read, in English, for the AI manager's return tools. */
export const RETURN_TOOL_WORDS = { counts: RETURN_COUNTS_EN, events: RETURN_EVENTS_EN, marks: RETURN_MARKS_EN, labels: { channels: RETURN_CHANNELS_EN } };
