/**
 * Automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6): the kinds and statuses, with no imports, so the schema can read them.
 */

/**
 * The emails to people on the list (welcome, after a purchase, win-back, and since D4 of `docs/100-day-challenge.md` cross-sell,
 * restock and browse abandonment), and back in stock (to people who asked about a sold-out variant).
 */
export const AUTOMATION_KINDS = ["welcome", "after_purchase", "win_back", "cross_sell", "replenish", "browse", "back_in_stock"] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

export const LIFECYCLE_KINDS = ["welcome", "after_purchase", "win_back", "cross_sell", "replenish", "browse"] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

/** Each lifecycle kind's days (6.1): the range and where it starts. */
export const DELAY_RANGES: Record<LifecycleKind, { min: number; max: number; start: number }> = {
  welcome: { min: 0, max: 30, start: 0 },
  after_purchase: { min: 1, max: 90, start: 7 },
  win_back: { min: 30, max: 730, start: 90 },
  cross_sell: { min: 1, max: 90, start: 14 },
  replenish: { min: 7, max: 365, start: 30 },
  // Products a signed-in subscriber looked at (D691): views are kept `PRODUCT_VIEW_DAYS` days, so the email goes within them.
  browse: { min: 1, max: 5, start: 1 },
};

/**
 * The kinds whose email shows products chosen for each reader by code (D4): cross-sell what was bought with their order's products by other
 * customers, restock their order's products that customers buy again, browse the products they looked at and did not buy (D691), bought
 * their order's own products still on sale (a flow asking for reviews, M3.1). Never chosen by a model.
 */
export const PICK_KINDS = ["cross_sell", "replenish", "browse", "bought"] as const;

/** The goals a flow does that no automation did (M3.1): kept in a flow's `replaces` beside the automations' kinds, so a store has each once. */
export const FLOW_ONLY_GOALS = ["reviews"] as const;

/**
 * How long a signed-in subscriber's product views are kept for browse abandonment (D691): only while they are signed in, subscribed and
 * allowed marketing cookies; deleted after this many days.
 */
export const PRODUCT_VIEW_DAYS = 7;
export type PickKind = (typeof PICK_KINDS)[number];
export const isPickKind = (kind: string): kind is PickKind => (PICK_KINDS as readonly string[]).includes(kind);

/**
 * Follow-ups (D4): up to two more emails after an automation's first, each its days after the one before, to the same person for the same
 * moment. Positions 2 and 3; a paid order by the reader since the first email ends the flow.
 */
export const FOLLOW_UP_POSITIONS = [2, 3] as const;
export type FollowUpPosition = (typeof FOLLOW_UP_POSITIONS)[number];
export const FOLLOW_UP_DAYS = { min: 1, max: 60, start: 3 } as const;

export const SEND_OUTCOMES = ["sent", "logged", "failed", "suppressed"] as const;
export type SendOutcomeKind = (typeof SEND_OUTCOMES)[number];

/** A back-in-stock request (6.4): waiting for its link, waiting for stock, told, or ended. */
export const STOCK_REQUEST_STATUSES = ["pending", "waiting", "sent", "cancelled"] as const;
export type StockRequestStatus = (typeof STOCK_REQUEST_STATUSES)[number];
