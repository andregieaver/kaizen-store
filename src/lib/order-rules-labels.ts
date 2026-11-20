/**
 * The words of order automation rules, in English (D238, D312 A8, bloat review step 2.50): the conditions' names, the rule's sentence and the
 * log's outcomes, beside `order-rules.ts`, which re-exports them, so the admin's `notifications` catalogue
 * takes them from here and imports no code. Imports nothing but types and the limits it says out loud (`order-rule-limits.ts`).
 */
import type { ActionProblem, ConditionKind, ConditionOutcome, RuleDelivery, RuleSource } from "./order-rules";
import { RULE_LIMITS } from "./order-rule-limits";

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
  risk: "Stripe's risk is",
};

/** The words the rule's sentence is written in (D312 A8): English here, as the AI manager reads it; the admin passes its own language's. */
export const RULE_SENTENCE_EN = {
  deliveries: { shipping: "shipped", pickup: "collected", local: "delivered by the store", none: "not delivered" } as Record<RuleDelivery, string>,
  sources: { checkout: "the checkout", draft: "a draft order", subscription: "a subscription renewal", delivery: "a subscription box delivery" } as Record<RuleSource, string>,
  or: "or",
  and: "and",
  totalAtLeast: "the total is at least {amount}",
  totalBelow: "the total is below {amount}",
  countryIs: "the country is {countries}",
  buyerBusiness: "the buyer is a business",
  buyerConsumer: "the buyer is a consumer",
  firstOrder: "it is the customer's first order",
  orderedBefore: "the customer has ordered before",
  hasProduct: "it has {products}",
  deliveryIs: "it is {deliveries}",
  backorder: "some of it is backordered",
  gift: "it is a gift",
  sourceIs: "it comes from {sources}",
  tagged: 'it is tagged "{tag}"',
  hostListing: "it is a host's listing",
  ownSale: "it is the store's own sale",
  riskHighest: "Stripe judged its payment highest risk",
  riskElevated: "Stripe judged its payment elevated or highest risk",
  actionTag: 'tag "{tag}"',
  actionNotify: "notify staff",
  actionHold: "hold it",
  actionAsk: "ask the AI manager to look",
  whenPaid: "When an order is paid{when}, {actions}.",
  whenAnd: " and {conditions}",
  joinAll: " and ",
  joinAny: " or ",
};

/** The words of a condition's or an action's outcome in the log. */
export const OUTCOME_WORDS: Record<NonNullable<ConditionOutcome["why"]> | ActionProblem, string> = {
  no_rate: "No exchange rate for the order's currency",
  unknown: "Not known for a guest",
  unread: "Stripe's risk outcome was not read yet",
  not_found: "The order was not found",
  limit: "The order has as many tags as it can hold",
  already_held: "The order was already on hold",
  sent: "The order was already sent",
  invalid: "The action is not valid any more",
  no_recipients: "Nobody is chosen for automation emails",
  failed: "It could not be done",
  ask_limit: `The AI manager was already asked ${RULE_LIMITS.asksPerDay} times by rules in the last 24 hours`,
  no_owner: "Whoever saved the rule is no longer an owner of the store",
};
