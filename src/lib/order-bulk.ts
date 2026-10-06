/**
 * Bulk actions on orders (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2.5): the actions, the limits, what comes back and the words for every refusal. Pure; the
 * server (`runBulk()` in `src/server/order-bulk.ts`) handles each order in its own transaction, one after another, so one refusal or failure never undoes the others,
 * and answers with a `BulkResult`. A request names at most `BULK_MAX` orders (250; a printed document `BULK_PRINT_MAX`, 100); duplicates collapse; an id that
 * is not this store's is reported as `not_found` and never revealed. "All matching" is never a client list: the server re-runs the list's own query.
 */
import { BULK_MAX, BULK_PRINT_MAX } from "./order-limits";
import type { OrderListParams } from "./order-list";

export { BULK_MAX, BULK_PRINT_MAX };

export const BULK_ACTIONS = ["add_tags", "remove_tags", "archive", "unarchive", "mark_sent", "print_slips"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const isBulkAction = (value: unknown): value is BulkAction => typeof value === "string" && (BULK_ACTIONS as readonly string[]).includes(value);

export const BULK_ACTION_LABELS: Record<BulkAction, string> = {
  add_tags: "Add tags",
  remove_tags: "Remove tags",
  archive: "Archive",
  unarchive: "Unarchive",
  mark_sent: "Mark as sent",
  print_slips: "Print packing slips",
};

/** The permission each action needs: printing is a read, everything else a write. */
export const BULK_ACTION_PERMISSION: Record<BulkAction, "orders:read" | "orders:write"> = {
  add_tags: "orders:write",
  remove_tags: "orders:write",
  archive: "orders:write",
  unarchive: "orders:write",
  mark_sent: "orders:write",
  print_slips: "orders:read",
};

/** The most orders one request of this action names. */
export const bulkMaxFor = (action: BulkAction): number => (action === "print_slips" ? BULK_PRINT_MAX : BULK_MAX);

/** The orders a bulk action is for: ticked ones, or every order the list's own query matches (the server runs the query again). */
export type BulkSelection = { kind: "ids"; ids: readonly string[] } | { kind: "matching"; params: OrderListParams };

export type BulkRequest = {
  action: BulkAction;
  selection: BulkSelection;
  /** Add and remove tags: the tags as typed (validated once before anything runs). */
  tags?: readonly string[];
  /** Mark as sent: tell the customers (the *shipped* email, with no tracking line). Off by default. */
  notify?: boolean;
};

/** Every reason an order is refused in a bulk action, by code. */
export const BULK_REASONS = [
  "not_found",
  "tag_limit",
  "needs_sending",
  "unfinished_checkout",
  "open_return",
  "already_archived",
  "not_archived",
  "copied",
  "unpaid",
  "nothing_to_send",
  "already_sent",
  "withdrawn_in_full",
  "waiting_for_stock",
  "delivery_unpaid",
  "changed",
  "nothing_to_ship",
  "store_closed",
  "failed",
] as const;
export type BulkReason = (typeof BULK_REASONS)[number];

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
};

/** Why a whole request is refused before anything runs. */
export const BULK_REQUEST_PROBLEMS = ["unknown_action", "empty", "too_many", "invalid_tag", "no_tags", "too_many_tags"] as const;
export type BulkRequestProblem = (typeof BULK_REQUEST_PROBLEMS)[number];

export const BULK_REQUEST_TEXT: Record<BulkRequestProblem, string> = {
  unknown_action: "That action is not known.",
  empty: "Choose at least one order.",
  too_many: `A request names at most ${BULK_MAX} orders (${BULK_PRINT_MAX} to print). Narrow the list or do it in steps.`,
  invalid_tag: "A tag cannot be empty, hold a comma or a control character, or be over 40 characters.",
  no_tags: "Write at least one tag.",
  too_many_tags: "Add or remove at most 50 tags at a time.",
};

/** Tags in one request: more is a mistake (an order holds 250 in all). */
export const BULK_TAGS_MAX = 50;

/** One order a bulk action did not apply to: its number when it could be read (never an id that is not this store's), and why. */
export type BulkRefusal = { id: string; number: string | null; reason: BulkReason };

export type BulkResult = {
  action: BulkAction;
  /** Orders named (after duplicates collapsed). */
  requested: number;
  applied: number;
  refused: BulkRefusal[];
  /** Mark as sent with *Tell the customers*: emails that were sent. */
  emailed?: number;
};

/** Collapses duplicate ids, keeping the first of each, in order. */
export function dedupeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Checks the size of a request before anything runs: none chosen, or more than the action allows (after duplicates collapsed). */
export function checkBulkSize(action: BulkAction, count: number): BulkRequestProblem | null {
  if (count <= 0) return "empty";
  if (count > bulkMaxFor(action)) return "too_many";
  return null;
}

/**
 * The part of a request that can be checked without the database: a known action, a selection that is not empty and not too large (for ticked ids; a matching
 * selection is counted by the server), and for the tag actions a list of valid tags (`invalidTags` is how many of the typed tags were refused).
 */
export function checkBulkRequest(request: { action: unknown; ids?: readonly string[]; tags?: readonly unknown[]; invalidTags?: number }): BulkRequestProblem | null {
  if (!isBulkAction(request.action)) return "unknown_action";
  if (request.ids !== undefined) {
    const size = checkBulkSize(request.action, dedupeIds(request.ids).length);
    if (size) return size;
  }
  if (request.action === "add_tags" || request.action === "remove_tags") {
    if (!request.tags || request.tags.length === 0) return "no_tags";
    if (request.tags.length > BULK_TAGS_MAX) return "too_many_tags";
    if ((request.invalidTags ?? 0) > 0) return "invalid_tag";
  }
  return null;
}

/** "Applied to 41 of 43 orders" (and "1 order" in the singular). */
export function bulkSummary(result: Pick<BulkResult, "requested" | "applied">): string {
  const noun = result.requested === 1 ? "order" : "orders";
  return `Applied to ${result.applied} of ${result.requested} ${noun}`;
}

/** The refusals grouped by reason, for a panel that says "6 were not paid" once rather than six times. */
export function groupRefusals(refused: readonly BulkRefusal[]): { reason: BulkReason; text: string; orders: BulkRefusal[] }[] {
  const groups = new Map<BulkReason, BulkRefusal[]>();
  for (const r of refused) groups.set(r.reason, [...(groups.get(r.reason) ?? []), r]);
  return [...groups].map(([reason, orders]) => ({ reason, text: BULK_REASON_TEXT[reason], orders }));
}

/** "37 customers will get an email" (the line shown beside the *Tell the customers* tick). */
export const notifyText = (count: number): string => (count === 1 ? "1 customer will get an email" : `${count} customers will get an email`);

// ---------------------------------------------------------------------------------------------------------------------
// The pure pre-checks (the server asks these before it calls `markSent()` or builds a slip)
// ---------------------------------------------------------------------------------------------------------------------

export type MarkSentFacts = {
  status: "pending_payment" | "paid" | "fulfilled" | "cancelled" | "closed";
  /** A payment on the order was captured. */
  paid: boolean;
  /** A line with something physical to ship. */
  physical: boolean;
  copied: boolean;
  /** Every unit is withdrawn (a confirmed withdrawal of all of it, D153). */
  withdrawnInFull: boolean;
  /** Units sold beyond stock (D172): staff send those from the order, where they see which. */
  backorderUnits: number;
  /** A weekly box (D102) whose card has not been charged yet: `markSent()` would charge it first. */
  deliveryUnpaid: boolean;
};

/** Why *Mark as sent* cannot be done in bulk to this order, or null when it can (the first that holds). `store_closed` and `changed` are the server's. */
export function markSentBlock(order: MarkSentFacts): BulkReason | null {
  if (order.copied) return "copied";
  if (order.status === "fulfilled") return "already_sent";
  if (order.status === "pending_payment" || (order.status === "cancelled" && !order.paid)) return "unpaid";
  if (order.status !== "paid" || !order.physical) return "nothing_to_send";
  if (order.withdrawnInFull) return "withdrawn_in_full";
  if (order.backorderUnits > 0) return "waiting_for_stock";
  if (order.deliveryUnpaid) return "delivery_unpaid";
  return null;
}

/** Why an order is left out of a printed set of packing slips, or null when it is printed. */
export function slipSkip(order: { copied: boolean; physical: boolean }): "copied" | "nothing_to_ship" | null {
  if (order.copied) return "copied";
  if (!order.physical) return "nothing_to_ship";
  return null;
}
