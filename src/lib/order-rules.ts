/**
 * Order automation rules (wave 3, D238, `docs/wave-3-notifications.md` 2.5 and 4.9): *when an order is paid and {conditions} then tag, notify staff or
 * hold fulfilment*. A closed list of conditions over facts read once per event (`ruleFacts()` in `src/server/order-rules.ts`, before any rule runs, so
 * rules never chain), matched here in code; three actions, which the server performs. Pure and free of zod (the schemas that check input are
 * `order-rules-schema.ts`, for the admin), so the list page and the editor's sentence read the same rules as the job.
 */

export const RULE_LIMITS = {
  /** Rules a store may have (also the database's `order_rules_limit`). */
  rules: 50,
  conditions: 10,
  actions: 5,
  name: 80,
  /** A *Notify staff* note and a *Hold* reason. */
  note: 200,
  reason: 200,
  /** What an *Ask the AI manager* asks it to look at. */
  question: 300,
  /** Turns *Ask the AI manager* may start in a store in 24 hours (each is a model's turn). */
  asksPerDay: 20,
  /** Products of one `has_product` and countries of one `country_in`. */
  products: 50,
  countries: 40,
} as const;

export const RULE_EVENTS = ["order.paid"] as const;
export type RuleEvent = (typeof RULE_EVENTS)[number];

export const CONDITION_KINDS = [
  "total_at_least",
  "total_below",
  "country_in",
  "buyer_is",
  "first_order",
  "has_product",
  "delivery_is",
  "has_backorder",
  "is_gift",
  "source_is",
  "has_tag",
  "seller_is",
  "risk",
] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];

export const ACTION_KINDS = ["tag", "notify", "hold", "ask"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const RULE_DELIVERIES = ["shipping", "pickup", "local", "none"] as const;
export type RuleDelivery = (typeof RULE_DELIVERIES)[number];
export const RULE_SOURCES = ["checkout", "draft", "subscription", "delivery"] as const;
export type RuleSource = (typeof RULE_SOURCES)[number];

export type RuleCondition =
  /** An amount in the store's main currency, in minor units. */
  | { kind: "total_at_least"; amountMinor: number }
  | { kind: "total_below"; amountMinor: number }
  /** Market codes of the store. */
  | { kind: "country_in"; countries: string[] }
  | { kind: "buyer_is"; buyer: "business" | "consumer" }
  | { kind: "first_order"; value: boolean }
  /** The store's own product ids (kept to them on save). */
  | { kind: "has_product"; productIds: string[] }
  | { kind: "delivery_is"; deliveries: RuleDelivery[] }
  | { kind: "has_backorder" }
  | { kind: "is_gift" }
  | { kind: "source_is"; sources: RuleSource[] }
  /** A tag's key (`normaliseTag()`'s `key`) and its label as typed, for the sentence. */
  | { kind: "has_tag"; tagKey: string; label: string }
  | { kind: "seller_is"; seller: "store" | "host" }
  /** D288: Stripe's risk outcome on the order's payment is at least this level (`highest` alone, or `elevated` and `highest`). */
  | { kind: "risk"; level: "elevated" | "highest" };

export type RuleAction =
  /** A tag as `normaliseTag()` made it. */
  | { kind: "tag"; label: string }
  | { kind: "notify"; note: string }
  | { kind: "hold"; reason: string }
  /**
   * PSI AGT-04: the AI manager looks at the order and answers in a conversation of its own, as a follow-up in the name of whoever last saved the
   * rule (`askAiManager()` in `src/server/follow-ups.ts`); they are emailed where the answer is.
   */
  | { kind: "ask"; question: string };

export type OrderRule = {
  id: string;
  name: string;
  event: RuleEvent;
  match: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
  enabled: boolean;
  position: number;
  version: number;
};

/** What a rule can know about an order, read once per event (4.9). */
export type RuleFacts = {
  totalMinor: number;
  currency: string;
  /** The total in the store's main currency at its rates now; null when the order's currency has no rate. */
  mainMinor: number | null;
  marketCode: string;
  buyer: "business" | "consumer";
  /** Whether the signed-in customer had an earlier paid order; null for a guest (never matched by email, D162). */
  firstOrder: boolean | null;
  productIds: readonly string[];
  delivery: RuleDelivery;
  backorder: boolean;
  gift: boolean;
  source: RuleSource;
  /** Tag keys at the time of the event (before any rule ran). */
  tagKeys: readonly string[];
  seller: "store" | "host";
  /**
   * D288: Stripe's risk outcome on the order's captured Stripe payments, the highest of them; `none` when no Stripe payment was assessed (paid outside
   * Kaizena Flow, at a venue, or Stripe did not assess it), null while a Stripe payment's charge has not been read.
   */
  risk?: "normal" | "elevated" | "highest" | "none" | null;
};

export type ConditionOutcome = { kind: ConditionKind; met: boolean; why?: "no_rate" | "unknown" | "unread" };
export type ActionProblem = "not_found" | "limit" | "already_held" | "sent" | "invalid" | "no_recipients" | "failed" | "ask_limit" | "no_owner";
export type ActionOutcome = { kind: ActionKind; ok: boolean; problem?: ActionProblem };
/** `order_rule_runs.outcome`. */
export type RunOutcome = { conditions: ConditionOutcome[]; actions: ActionOutcome[] };

/** One condition against the facts. */
export function conditionMet(condition: RuleCondition, facts: RuleFacts): ConditionOutcome {
  const { kind } = condition;
  switch (condition.kind) {
    case "total_at_least":
    case "total_below": {
      if (facts.mainMinor === null) return { kind, met: false, why: "no_rate" };
      const met = condition.kind === "total_at_least" ? facts.mainMinor >= condition.amountMinor : facts.mainMinor < condition.amountMinor;
      return { kind, met };
    }
    case "country_in":
      return { kind, met: condition.countries.includes(facts.marketCode) };
    case "buyer_is":
      return { kind, met: facts.buyer === condition.buyer };
    case "first_order":
      if (facts.firstOrder === null) return { kind, met: false, why: "unknown" };
      return { kind, met: facts.firstOrder === condition.value };
    case "has_product":
      return { kind, met: condition.productIds.some((id) => facts.productIds.includes(id)) };
    case "delivery_is":
      return { kind, met: condition.deliveries.includes(facts.delivery) };
    case "has_backorder":
      return { kind, met: facts.backorder };
    case "is_gift":
      return { kind, met: facts.gift };
    case "source_is":
      return { kind, met: condition.sources.includes(facts.source) };
    case "has_tag":
      return { kind, met: facts.tagKeys.includes(condition.tagKey) };
    case "seller_is":
      return { kind, met: facts.seller === condition.seller };
    case "risk": {
      if (facts.risk === null || facts.risk === undefined) return { kind, met: false, why: "unread" };
      const met = condition.level === "highest" ? facts.risk === "highest" : facts.risk === "elevated" || facts.risk === "highest";
      return { kind, met };
    }
  }
}

/** Whether a rule matches: every condition (`all`) or one of them (`any`); a rule with no condition always matches. */
export function ruleMatches(rule: Pick<OrderRule, "match" | "conditions">, facts: RuleFacts): { matched: boolean; conditions: ConditionOutcome[] } {
  const conditions = rule.conditions.map((c) => conditionMet(c, facts));
  if (conditions.length === 0) return { matched: true, conditions };
  const matched = rule.match === "all" ? conditions.every((c) => c.met) : conditions.some((c) => c.met);
  return { matched, conditions };
}

// ---------------------------------------------------------------------------
// The sentence (2.5 point 1), written by code from the rule
// ---------------------------------------------------------------------------

export type DescribeContext = {
  /** An amount of the store's main currency, formatted (`formatMoney`). */
  money: (minor: number) => string;
  countryName: (code: string) => string;
  productName: (id: string) => string;
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
export type RuleSentenceWords = typeof RULE_SENTENCE_EN;

const put = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);

/** "a, b or c" (or "and"), the last word given in the sentence's language. */
export function listWords(words: readonly string[], last: "or" | "and", w: Pick<RuleSentenceWords, "or" | "and"> = RULE_SENTENCE_EN): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} ${w[last]} ${words[words.length - 1]}`;
}

export function describeCondition(c: RuleCondition, ctx: DescribeContext, w: RuleSentenceWords = RULE_SENTENCE_EN): string {
  switch (c.kind) {
    case "total_at_least":
      return put(w.totalAtLeast, { amount: ctx.money(c.amountMinor) });
    case "total_below":
      return put(w.totalBelow, { amount: ctx.money(c.amountMinor) });
    case "country_in":
      return put(w.countryIs, { countries: listWords(c.countries.map(ctx.countryName), "or", w) });
    case "buyer_is":
      return c.buyer === "business" ? w.buyerBusiness : w.buyerConsumer;
    case "first_order":
      return c.value ? w.firstOrder : w.orderedBefore;
    case "has_product":
      return put(w.hasProduct, { products: listWords(c.productIds.map(ctx.productName), "or", w) });
    case "delivery_is":
      return put(w.deliveryIs, { deliveries: listWords(c.deliveries.map((d) => w.deliveries[d]), "or", w) });
    case "has_backorder":
      return w.backorder;
    case "is_gift":
      return w.gift;
    case "source_is":
      return put(w.sourceIs, { sources: listWords(c.sources.map((s) => w.sources[s]), "or", w) });
    case "has_tag":
      return put(w.tagged, { tag: c.label });
    case "seller_is":
      return c.seller === "host" ? w.hostListing : w.ownSale;
    case "risk":
      return c.level === "highest" ? w.riskHighest : w.riskElevated;
  }
}

export function describeAction(a: RuleAction, w: RuleSentenceWords = RULE_SENTENCE_EN): string {
  switch (a.kind) {
    case "tag":
      return put(w.actionTag, { tag: a.label });
    case "notify":
      return w.actionNotify;
    case "hold":
      return w.actionHold;
    case "ask":
      return w.actionAsk;
  }
}

/** *When an order is paid and the total is at least 2 000 kr and the country is Sweden, tag "Big order" and hold it.* */
export function describeRule(rule: Pick<OrderRule, "match" | "conditions" | "actions">, ctx: DescribeContext, w: RuleSentenceWords = RULE_SENTENCE_EN): string {
  const when = rule.conditions.length
    ? put(w.whenAnd, { conditions: rule.conditions.map((c) => describeCondition(c, ctx, w)).join(rule.match === "all" ? w.joinAll : w.joinAny) })
    : "";
  return put(w.whenPaid, { when, actions: listWords(rule.actions.map((a) => describeAction(a, w)), "and", w) });
}

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
