/** How an order's status reads in the admin. */
export const ORDER_STATUS_LABELS = {
  pending_payment: "Waiting for payment",
  paid: "Paid, to send",
  fulfilled: "Sent",
  cancelled: "Not completed",
  closed: "Closed",
} as const;
