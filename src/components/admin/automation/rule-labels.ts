import type { ConditionKind } from "@/lib/order-rules";

/** The admin's names of the automation conditions (the editor's choices and the log's "Not met"). */
export const CONDITION_LABELS: Record<ConditionKind, string> = {
  total_at_least: "Total is at least",
  total_below: "Total is below",
  country_in: "Country is",
  buyer_is: "Buyer is",
  first_order: "Customer's first order",
  has_product: "Has a product",
  delivery_is: "Delivery is",
  has_backorder: "Something is backordered",
  is_gift: "It is a gift",
  source_is: "It comes from",
  has_tag: "It has a tag",
  seller_is: "Seller is",
};
