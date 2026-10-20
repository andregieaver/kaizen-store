/**
 * Automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6): the kinds and statuses, with no imports, so the schema can read them.
 */

/** The three emails to people on the list, and back in stock (to people who asked about a sold-out variant). */
export const AUTOMATION_KINDS = ["welcome", "after_purchase", "win_back", "back_in_stock"] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

export const LIFECYCLE_KINDS = ["welcome", "after_purchase", "win_back"] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

/** Each lifecycle kind's days (6.1): the range and where it starts. */
export const DELAY_RANGES: Record<LifecycleKind, { min: number; max: number; start: number }> = {
  welcome: { min: 0, max: 30, start: 0 },
  after_purchase: { min: 1, max: 90, start: 7 },
  win_back: { min: 30, max: 730, start: 90 },
};

export const SEND_OUTCOMES = ["sent", "logged", "failed", "suppressed"] as const;
export type SendOutcomeKind = (typeof SEND_OUTCOMES)[number];

/** A back-in-stock request (6.4): waiting for its link, waiting for stock, told, or ended. */
export const STOCK_REQUEST_STATUSES = ["pending", "waiting", "sent", "cancelled"] as const;
export type StockRequestStatus = (typeof STOCK_REQUEST_STATUSES)[number];
