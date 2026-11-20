/**
 * What staff read when an order cannot be archived (bloat review step 2.50): the English beside `order-archive.ts`, which re-exports it, so the
 * Orders catalogue (`admin-messages/orders.en.ts`) takes it from here and imports no code. Imports nothing but types.
 */
import type { ArchiveReason } from "./order-archive";

/** What staff read for each refusal (the code is `order-bulk.ts`'s reason code too). */
export const ARCHIVE_REASON_TEXT: Record<ArchiveReason, string> = {
  needs_sending: "It is paid and still has to be sent.",
  unfinished_checkout: "It was never paid.",
  open_return: "A return is still open on it.",
  already_archived: "It is already archived.",
};
