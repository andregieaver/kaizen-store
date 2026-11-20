/**
 * The words of stock movements and of the stock policy, in English (bloat review step 2.50): beside `inventory.ts`, which re-exports them for its
 * functions, so the admin's `inventory` catalogue takes them from here and imports no code (`inventory.ts` imports zod). Imports nothing but types.
 */
import type { MovementReason, StockPolicy } from "./inventory";

/** The words of the page (the admin is English only). */
export const REASON_WORDS: Record<MovementReason, string> = {
  received: "Received",
  correction: "Correction",
  count: "Count",
  damaged: "Damaged",
  lost: "Theft or loss",
  promotion: "Promotion or donation",
  sale: "Sale",
  order_restock: "Put back after an order",
  return_restock: "Return put back",
  opening: "Opening figure",
  system: "System",
  transfer_out: "Sent to another location",
  transfer_in: "Arrived from another location",
};

export const POLICY_WORDS: Record<StockPolicy, string> = { deny: "Stop selling at zero", continue: "Keep selling" };
