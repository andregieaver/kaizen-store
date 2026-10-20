import { z } from "zod";

import { DELAY_RANGES, type AutomationKind, type LifecycleKind } from "./automation-kinds";
import { broadcastContentSchema } from "./broadcasts";

export * from "./automation-kinds";

/**
 * Automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6): the owner's settings as the editor sends them, and the staff's words for
 * each kind. Server and admin only (zod); the shopper's form has its own plain check (`isRequestAddress()` in `stock-request-check.ts`).
 */

/** How far back a moment may be and still start an email (6.2): an older one is old news. */
export const CATCH_UP_DAYS = 7;
/** Emails per kind per run (6.2). */
export const AUTOMATION_BATCH = 200;
/** How long sends are kept (6.7): longer than any key needs. */
export const SENDS_KEEP_DAYS = 90;

/** A back-in-stock request (6.4 and 6.5). */
export const STOCK_CONFIRM_DAYS = 7;
export const STOCK_WAITING_DAYS = 180;
export const STOCK_ENDED_DAYS = 30;
/** Requests a visitor key makes per store and day, and open confirmations an address has per store. */
export const STOCK_VISITOR_DAY = 10;
export const STOCK_PENDING_MAX = 5;

export const isLifecycle = (kind: string): kind is LifecycleKind => kind in DELAY_RANGES;

/** A lifecycle automation as the editor saves it: its days within the kind's range and its words (a broadcast's shape). */
export function automationInput(kind: LifecycleKind) {
  const range = DELAY_RANGES[kind];
  return z.object({
    delayDays: z.number().int().min(range.min).max(range.max),
    content: broadcastContentSchema,
  });
}

/** What each kind is, in the staff's words (6.6): what the owner gets, then what the days mean. */
export const AUTOMATION_WORDS: Record<AutomationKind, { title: string; does: string; days?: (n: number) => string; daysLabel?: string }> = {
  welcome: {
    title: "Welcome",
    does: "Welcomes people who join your list.",
    daysLabel: "Days after they join",
    days: (n) => (n === 0 ? "Sent as soon as they join." : `Sent ${n} ${n === 1 ? "day" : "days"} after they join.`),
  },
  after_purchase: {
    title: "After a purchase",
    does: "Thanks people on your list after their order is delivered.",
    daysLabel: "Days after delivery",
    days: (n) => `Sent ${n} ${n === 1 ? "day" : "days"} after the order is delivered.`,
  },
  win_back: {
    title: "Win-back",
    does: "Writes to people on your list who have not ordered for a while.",
    daysLabel: "Days without an order",
    days: (n) => `Sent when ${n} days have passed since their last order.`,
  },
  back_in_stock: {
    title: "Back in stock",
    does: "Lets shoppers ask to hear when a sold-out product is back, and emails them once when it is.",
  },
};
