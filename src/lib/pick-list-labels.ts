/**
 * What the pick list says about an order it left out or picked with a warning (bloat review step 2.50): the English beside `pick-list.ts`, which
 * re-exports it, so the Orders catalogue (`admin-messages/orders.en.ts`) and the AI manager's tool read one text and the catalogue imports no code.
 * Imports nothing but types.
 */
import type { PickSkipReason } from "./pick-list";

export const PICK_SKIP_WORDS: Record<PickSkipReason, string> = {
  not_found: "Not found",
  copied: "A copied order (history, never sent)",
  unpaid: "Not paid",
  nothing_to_send: "Nothing left to send",
};

export const PICK_WARNING_WORDS = { edit_pending: "A change waits for the customer's payment: picked as the order stands now" } as const;
