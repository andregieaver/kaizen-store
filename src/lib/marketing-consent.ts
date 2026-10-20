/**
 * The subscriber list (wave 5 unit A, D295, `docs/wave-5-marketing.md` 3): who agreed to a store's marketing email, and how a subscriber's state
 * may change. The database holds the same rules (`commerce.marketing_subscribers_rules()`); this is the copy the server and its tests read. No zod:
 * the checkout's box is on a pay route.
 */

export const SUBSCRIBER_STATUSES = ["pending", "subscribed", "unsubscribed"] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

/** Where a person joined: a page's newsletter form (the block's id), checkout (the order's id) or My account. */
export const SUBSCRIBE_SOURCES = ["form", "checkout", "account"] as const;
export type SubscribeSource = (typeof SUBSCRIBE_SOURCES)[number];

/** How a person left: the email's link or the mail app's one-click button, My account, staff for them, or their provider's complaint or hard bounce. */
export const UNSUBSCRIBE_SOURCES = ["link", "one_click", "account", "staff", "complaint", "bounce"] as const;
export type UnsubscribeSource = (typeof UNSUBSCRIBE_SOURCES)[number];

export const CONSENT_EVENT_KINDS = ["requested", "subscribed", "unsubscribed"] as const;
export type ConsentEventKind = (typeof CONSENT_EVENT_KINDS)[number];

/** A confirmation link works this long; a `pending` row whose link ran out goes 30 days after that (`pruneSubscribers()`). */
export const CONFIRM_DAYS = 7;
export const PENDING_KEEP_DAYS = 30;

/** The moves a subscriber may make: a person who comes back gives consent again (new words, new time), as a new `pending` or at once. */
const MOVES: Record<SubscriberStatus, readonly SubscriberStatus[]> = {
  pending: ["subscribed", "unsubscribed", "pending"],
  subscribed: ["unsubscribed"],
  unsubscribed: ["pending", "subscribed"],
};

export function mayMove(from: SubscriberStatus, to: SubscriberStatus): boolean {
  return MOVES[from].includes(to);
}

/** What the customer CSV says (D165): the consent of the subscriber that is the customer's, `none` without one. */
export type ConsentColumn = SubscriberStatus | "none";

export function consentColumn(status: SubscriberStatus | null | undefined): ConsentColumn {
  return status ?? "none";
}

/** An unsubscribe token: 32 random bytes, base64url (43 characters), as the cart reminders' are kept short enough for their route. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Staff words for the list. */
export const STATUS_WORDS: Record<SubscriberStatus, string> = {
  pending: "Waiting for their link",
  subscribed: "Subscribed",
  unsubscribed: "Unsubscribed",
};

export const SOURCE_WORDS: Record<SubscribeSource, string> = {
  form: "A form on the site",
  checkout: "Checkout",
  account: "My account",
};

export const UNSUBSCRIBE_WORDS: Record<UnsubscribeSource, string> = {
  link: "The email's link",
  one_click: "Their mail app's unsubscribe button",
  account: "My account",
  staff: "Staff, for them",
  complaint: "Marked as spam",
  bounce: "The address does not exist",
};

/** The columns of the subscriber export, in order. */
export const SUBSCRIBER_CSV_COLUMNS = [
  "email",
  "name",
  "status",
  "language",
  "market",
  "source",
  "consent_text",
  "consented_at",
  "confirmed_at",
  "unsubscribed_at",
  "unsubscribe_source",
  "customer",
  "created_at",
] as const;
