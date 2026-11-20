/**
 * The words of the Orders list's columns, filters and cells (bloat review step 2.50): the English beside `order-list.ts` and `order-list-row.ts`, which
 * re-export it, so the Orders catalogue (`admin-messages/orders.en.ts`), the filter chips and the AI manager's tools read one text and the catalogue
 * imports no code. Imports nothing but types.
 */
import type { OrderColumn, RangeFilter, SourceFilter } from "./order-list";
import type { PayCell, ShipCell } from "./order-list-row";

export const COLUMN_LABELS: Record<OrderColumn, string> = {
  placed: "Placed",
  customer: "Customer",
  market: "Market",
  payment: "Payment",
  fulfilment: "Fulfilment",
  delivery: "Delivery",
  items: "Items",
  total: "Total",
  tags: "Tags",
  source: "Source",
};

export const RANGE_LABELS: Record<RangeFilter, string> = {
  "7d": "last 7 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  this_month: "this month",
  last_month: "last month",
};

export const SOURCE_LABELS: Record<SourceFilter, string> = { checkout: "Checkout", draft: "Staff-made", exchange: "Exchange", replacement: "Replacement", copied: "Copied history" };

export const PAY_CELL_LABELS: Record<PayCell, string> = {
  unpaid: "Unpaid",
  authorized: "Card held",
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  balance_due: "Balance due",
  copied: "Copied",
};

export const SHIP_CELL_LABELS: Record<ShipCell, string> = {
  to_send: "To send",
  partly_sent: "Partly sent",
  waiting: "Waiting for stock",
  sent: "Sent",
  no_shipping: "Nothing to ship",
  none: "-",
  copied: "Copied",
};
