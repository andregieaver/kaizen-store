/**
 * The reasons of the refund rows the Stripe webhook writes (D159, `src/server/stripe-refunds.ts`): a refund made in Stripe's Dashboard, and
 * one of Kaizen's own whose row was not written by the staff action. They are not refunds a person at Kaizen chose to make, so the
 * idempotency key of staff's next refund of the order does not count them (`refundKey()` in `order-admin.ts`). Pure.
 */
export const REFUND_REASON_DASHBOARD = "Refunded in Stripe";
export const REFUND_REASON_RECORDED = "Refund recorded from Stripe";

/** Whether a refund row's reason is one the webhook wrote. */
export const isAdoptedRefund = (reason: string | null | undefined): boolean => reason === REFUND_REASON_DASHBOARD || reason === REFUND_REASON_RECORDED;
