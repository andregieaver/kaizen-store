import type { CustomerActionKind } from "./support-actions";

/**
 * The customer action kinds (D216, `docs/support.md` 4.4) and their names as staff read them, free of zod so client components can
 * draw them; `support-actions.test.ts` holds the list to `CUSTOMER_ACTIONS`.
 */
export const CUSTOMER_ACTION_KINDS: readonly CustomerActionKind[] = [
  "booking.cancel",
  "booking.move",
  "subscription.pause",
  "subscription.skip",
  "subscription.cancel",
  "subscription.resume",
  "subscription.unpause",
  "box.skip",
  "box.pause",
  "box.resume",
  "order.resend_confirmation",
  "order.resend_shipped",
  "return.request",
];

export const ACTION_KIND_WORDS: Record<CustomerActionKind, string> = {
  "booking.cancel": "Cancel a booking",
  "booking.move": "Move an appointment",
  "subscription.pause": "Pause a subscription",
  "subscription.skip": "Skip a subscription's next delivery",
  "subscription.cancel": "Cancel a subscription",
  "subscription.resume": "Take back a subscription's cancellation",
  "subscription.unpause": "End a subscription's pause",
  "box.skip": "Skip a subscription box",
  "box.pause": "Pause a subscription box",
  "box.resume": "Start a subscription box again",
  "order.resend_confirmation": "Send an order's confirmation again",
  "order.resend_shipped": "Send an order's shipping email again",
  "return.request": "Ask to return items (the store's own window)",
};
