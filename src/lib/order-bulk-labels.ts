/**
 * The words of the bulk actions on orders (bloat review step 2.50): the English beside `order-bulk.ts`, which re-exports it, so the Orders catalogue
 * (`admin-messages/orders.en.ts`) and the AI manager's tools read one text and the catalogue imports no code. Imports nothing but types and the
 * limits it says out loud (`order-limits.ts`, which imports nothing).
 */
import { BULK_MAX, BULK_PRINT_MAX } from "./order-limits";
import type { BulkAction, BulkReason, BulkRequestProblem } from "./order-bulk";

export const BULK_ACTION_LABELS: Record<BulkAction, string> = {
  add_tags: "Add tags",
  remove_tags: "Remove tags",
  archive: "Archive",
  unarchive: "Unarchive",
  mark_sent: "Mark as sent",
  print_slips: "Print packing slips",
  print_pick_list: "Print pick list",
  ready_for_pickup: "Ready for pickup",
  book_labels: "Book labels",
};

/** What staff read for each refusal. */
export const BULK_REASON_TEXT: Record<BulkReason, string> = {
  not_found: "It was not found.",
  tag_limit: "It already has 250 tags.",
  needs_sending: "It is paid and still has to be sent.",
  unfinished_checkout: "It was never paid.",
  open_return: "A return is still open on it.",
  already_archived: "It is already archived.",
  not_archived: "It is not archived.",
  copied: "It is copied history, which cannot be changed this way.",
  unpaid: "It has not been paid.",
  nothing_to_send: "There is nothing to send.",
  already_sent: "It was already sent.",
  withdrawn_in_full: "The customer withdrew from all of it.",
  waiting_for_stock: "Some of it is waiting for stock: send it from the order.",
  delivery_unpaid: "It is a weekly box that has not been charged yet.",
  changed: "It changed while the batch ran.",
  nothing_to_ship: "There is nothing physical to ship.",
  store_closed: "The store is not open.",
  failed: "It could not be done. Try it from the order.",
  edit_pending: "A change to it waits for the customer's payment: nothing is sent until it is paid, cancelled or expired.",
  pickup_order: "It is collected at your place: mark it ready or collected instead.",
  not_pickup: "It is not collected at your place.",
  already_ready: "It was already marked ready.",
  collected: "It was already collected.",
  cancelled: "It is cancelled.",
  local_order: "Your own driver takes it out: mark it out for delivery instead.",
  no_carrier: "No carrier that books labels is connected for it: the customer chose a carrier that is not set up, or no carrier is set up.",
  carrier_cannot_book: "The customer chose a carrier that cannot book labels from Kaizena Flow yet: book it with the carrier and enter the tracking number on the order.",
  no_weight: "Some of what is left to send has no weight: book it from the order, where you enter the parcel's weight.",
  test_booking: "The carrier booked it as a test (its test environment is on): nothing is shipped and the order is not marked as sent.",
  carrier_refused: "The carrier did not book it:",
};

export const BULK_REQUEST_TEXT: Record<BulkRequestProblem, string> = {
  unknown_action: "That action is not known.",
  empty: "Choose at least one order.",
  too_many: `A request names at most ${BULK_MAX} orders (${BULK_PRINT_MAX} to print or to book labels). Narrow the list or do it in steps.`,
  invalid_tag: "A tag cannot be empty, hold a comma or a control character, or be over 40 characters.",
  no_tags: "Write at least one tag.",
  too_many_tags: "Add or remove at most 50 tags at a time.",
};
