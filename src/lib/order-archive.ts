/**
 * When an order may be archived (wave 3, run 2, D173, `docs/wave-3-orders.md` 4.3). Archiving is a visibility state only (`orders.archived_at`): the order leaves
 * the default list and every queue, stays searchable, readable, refundable and counted, keeps its number, and changes no figure anywhere. This is the one rule:
 * the single action, the bulk action and the automatic job all ask `archiveBlock()`, and the database holds the one part it can (`orders_archived_not_pending`).
 *
 * An order may be archived unless it is an unfinished checkout, it still has to be sent (hiding it would hide work), or a return is open on it. Everything else may be:
 * sent, closed, cancelled after payment, paid with nothing to ship (downloads, services, bookings), copied history and hosts' orders. Unarchiving has no precondition.
 */
import { AUTO_ARCHIVE_MAX_DAYS, AUTO_ARCHIVE_MIN_DAYS } from "./order-limits";

export const ARCHIVE_REASONS = ["needs_sending", "unfinished_checkout", "open_return", "already_archived"] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

/** What staff read for each refusal (the code is `order-bulk.ts`'s reason code too). */
export const ARCHIVE_REASON_TEXT: Record<ArchiveReason, string> = {
  needs_sending: "It is paid and still has to be sent.",
  unfinished_checkout: "It was never paid.",
  open_return: "A return is still open on it.",
  already_archived: "It is already archived.",
};

export type ArchiveFacts = {
  status: "pending_payment" | "paid" | "fulfilled" | "cancelled" | "closed";
  /** A payment on the order was captured (a cancelled order that was never paid is an unfinished checkout). */
  paid: boolean;
  /** A line with something physical to ship (`order_lines.delivery = 'physical'`). */
  physical: boolean;
  /** Copied history (D129): never in *To send*, so it never needs sending. */
  copied: boolean;
  archived: boolean;
  /** A return of the order that is not in a final status (`returns.status` not closed, declined or cancelled). */
  openReturn: boolean;
};

/** Why an order cannot be archived now, or null when it can. The first that holds is the reason. */
export function archiveBlock(order: ArchiveFacts): ArchiveReason | null {
  if (order.archived) return "already_archived";
  if (order.status === "pending_payment" || (order.status === "cancelled" && !order.paid && !order.copied)) return "unfinished_checkout";
  if (order.status === "paid" && order.physical && !order.copied) return "needs_sending";
  if (order.openReturn) return "open_return";
  return null;
}

/** The event note when a return or a confirmed withdrawal brings an archived order back into the list. */
export const UNARCHIVE_RETURN_NOTE = "A return was started";

/** Whether a number of days is a valid setting for automatic archiving (never before the 14-day withdrawal period can have run). */
export const isAutoArchiveDays = (days: unknown): days is number =>
  typeof days === "number" && Number.isInteger(days) && days >= AUTO_ARCHIVE_MIN_DAYS && days <= AUTO_ARCHIVE_MAX_DAYS;

/** The moment before which an order's last event must lie for automatic archiving to take it: `now − days`. */
export const autoArchiveCutoff = (now: Date, days: number): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

/** Automatic archiving takes an order that may be archived and whose last event is older than the setting (a store that has not set it archives nothing). */
export function autoArchiveDue(order: ArchiveFacts & { lastEventAt: Date }, now: Date, days: number | null): boolean {
  if (days === null || !isAutoArchiveDays(days)) return false;
  return archiveBlock(order) === null && order.lastEventAt.getTime() < autoArchiveCutoff(now, days).getTime();
}
