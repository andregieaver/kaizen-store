/** How an order's status reads in the admin. */
export const ORDER_STATUS_LABELS = {
  pending_payment: "Waiting for payment",
  paid: "Paid, to send",
  fulfilled: "Sent",
  cancelled: "Not completed",
  closed: "Closed",
} as const;

/** The signal of a status's chip in the admin's lists (docs/admin-style.md 5.7): what needs doing is a warning, done is positive. */
export const ORDER_STATUS_SIGNAL = {
  pending_payment: "insight",
  paid: "warning",
  fulfilled: "positive",
  cancelled: "neutral",
  closed: "neutral",
} as const satisfies Record<keyof typeof ORDER_STATUS_LABELS, "positive" | "warning" | "danger" | "neutral" | "insight">;
