import { z } from "zod";

import { all, byId, currency, id, marketCode, minor, one, op, page, paging, since, when } from "./admin-api-shapes";
import { DISCOUNT_KINDS } from "./discounts";
import { GIFT_CARD_STATES } from "./gift-card-admin";

/**
 * The Admin API's customers and marketing (wave 14 unit C3, D440, `docs/wave-14-developer-platform.md` C3): customers made, changed and
 * found by email through the customer page's own writers (D366), segments read (D296), a discount code changed or switched off through the
 * admin's form (D299), gift cards issued, listed and deactivated with the power scope `gift_cards:write` (D300; a code is answered once, at
 * issue, never after and never kept), subscriptions read, paused and cancelled (D29), and a customer's store credit (D364) and loyalty credits
 * (D130) read. Entries of `ADMIN_API`; their handlers are `src/server/admin-api-customers.ts`. Pure.
 */

// Customers (D366) ---------------------------------------------------------------------

const customerAddress = z.object({
  line1: z.string().trim().max(200),
  line2: z.string().trim().max(200).optional(),
  postal_code: z.string().trim().max(20),
  city: z.string().trim().max(100),
  country: z.string().trim().regex(/^[A-Z]{2}$/).describe("An ISO 3166-1 code, such as NO."),
});

const customerFields = {
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  address: customerAddress.nullable().optional().describe("The customer's address; null takes it away."),
  company_name: z.string().trim().max(200).nullable().optional(),
  organisation_number: z.string().trim().max(40).nullable().optional().describe("A company's number, checked by its country's rule; given with company_name."),
};

export const customerCreateBody = z.object({
  email: z.string().trim().min(3).max(254).describe("Their email: an account with no password, signed into with a code sent there."),
  ...customerFields,
});
export const customerUpdateBody = z
  .object({ email: z.string().trim().min(3).max(254).optional().describe("A changed email is unproven again; the person's tags and notes move with it."), ...customerFields })
  .refine((b) => Object.keys(b).length > 0, "Send what changes.");

// Segments (D296) -------------------------------------------------------------------------

export const apiSegment = z.object({
  id,
  name: z.string(),
  rules: z.unknown().nullable().describe("The segment's conditions as the Segments page keeps them; null for a set that no longer reads."),
  updated_at: when,
});

export const apiSegmentCount = apiSegment.extend({
  people: z.int().describe("How many customers and subscribers it holds now."),
  capped: z.boolean().describe("The count stopped at the most a segment counts at once."),
});

// Discount codes (D299) ---------------------------------------------------------------------

export const apiDiscountDetail = z.object({
  id,
  code: z.string(),
  kind: z.enum(DISCOUNT_KINDS),
  percent: z.number().nullable(),
  amounts_minor: z.record(z.string(), z.number()).describe("For a fixed amount off: per market code, in minor units of the market's currency."),
  min_subtotals_minor: z.record(z.string(), z.number()),
  active: z.boolean(),
  starts_at: when.nullable(),
  ends_at: when.nullable(),
  usage_limit: z.number().nullable(),
  once_per_customer: z.boolean(),
  used: z.int().describe("Paid orders that used it."),
  applies_to: z.enum(["everything", "some"]).describe("some: chosen products, categories or tags (set in the admin)."),
  for_some_customers: z.boolean().describe("Only groups, named customers or a segment (set in the admin)."),
});

export const discountUpdateBody = z
  .object({
    code: z.string().trim().min(1).max(100).optional(),
    percent: z.int().min(1).max(100).optional().describe("For percent: how much is taken off."),
    amounts: z.record(z.string(), z.string()).optional().describe("For fixed: the amount off per market code, written in the market's currency; replaces what is there."),
    min_subtotals: z.record(z.string(), z.string()).optional(),
    starts_at: z.string().nullable().optional().describe("As the store's local time (YYYY-MM-DDTHH:mm), or ISO 8601; null: at once."),
    ends_at: z.string().nullable().optional().describe("null: never."),
    usage_limit: z.int().min(1).max(1_000_000).nullable().optional(),
    once_per_customer: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Send what changes.");

// Gift cards (D300) -----------------------------------------------------------------------------

export const apiGiftCard = z.object({
  id,
  last4: z.string().nullable().describe("The code's last four characters, to tell cards apart. The code itself is never answered after it is issued."),
  currency,
  initial_minor: minor,
  balance_minor: minor,
  state: z.enum(GIFT_CARD_STATES).describe("active, waiting (not delivered yet), spent, expired or deactivated."),
  source: z.enum(["order", "staff", "refund"]).describe("Bought with an order, issued by staff (or here), or store credit from a refund (D364)."),
  test: z.boolean().describe("A card of the store's test mode, spent only in test mode."),
  issued_at: when,
  expires_at: when.nullable(),
});

export const giftCardIssueBody = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).describe("One of the store's currencies."),
  amount_minor: z.int().min(1).max(100_000_000).describe("What it holds, in minor units."),
  recipient_email: z.string().trim().max(254).nullable().optional().describe("Email the code to this address, as the admin's Issue does."),
  recipient_name: z.string().trim().max(120).nullable().optional(),
  message: z.string().trim().max(500).nullable().optional().describe("A message in its email."),
  note: z.string().trim().max(500).default("Issued over the API").describe("Why, for the store's own record."),
});

export const giftCardDisableBody = z.object({ reason: z.string().trim().min(1).max(500).default("Deactivated over the API").describe("Why, for the card's history.") });

// Subscriptions (D29) -------------------------------------------------------------------------------

export const SUBSCRIPTION_STATES_API = ["pending", "active", "past_due", "paused", "cancelled", "expired"] as const;

export const apiSubscription = z.object({
  id,
  number: z.string(),
  status: z.enum(SUBSCRIPTION_STATES_API),
  market: marketCode,
  currency,
  email: z.string(),
  customer_id: id.nullable(),
  every: z.object({ interval: z.string(), count: z.int() }).describe("How often it renews: every `count` `interval`s."),
  total_per_renewal_minor: minor,
  current_period_end: when.nullable(),
  next_charge_at: when.nullable(),
  paused_until: when.nullable(),
  ends_at: when.nullable().describe("When it ends, if a cancellation waits."),
  cancelled_at: when.nullable(),
  lines: z.array(z.object({ sku: z.string(), title: z.string(), quantity: z.int(), unit_price_minor: minor })),
  created_at: when,
  updated_at: when,
});

export const subscriptionPauseBody = z.object({ periods: z.int().min(1).max(12).default(1).describe("Deliveries to pause for (the store's limit applies).") });
export const subscriptionCancelBody = z.object({
  at: z.enum(["period_end", "now"]).default("period_end").describe("period_end: at the end of the paid period or of a commitment. now: at once, with no refund."),
});

// Store credit (D364) and loyalty credits (D130) ----------------------------------------------------

export const apiStoreCredit = z.object({
  customer_id: id,
  cards: z.array(apiGiftCard).describe("Store credit issued to the customer from refunds, as gift cards of the store's."),
  balances: z.array(z.object({ currency, amount_minor: minor })).describe("What the customer holds per currency on live cards."),
});

export const apiLoyalty = z.object({
  customer_id: id,
  currency,
  available_minor: minor,
  pending_minor: minor,
  entries: z.array(
    z.object({ id: z.string(), kind: z.string(), amount_minor: z.int(), at: when, available_at: when.nullable(), expires_at: when.nullable(), order_id: id.nullable() }),
  ),
});

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

export const CUSTOMERS_API = [
  op({
    name: "customers.create",
    method: "POST",
    path: "/customers",
    scope: "customers:write",
    permission: "customers:write",
    tag: "Customers",
    summary: "Create a customer",
    description: "Adds a customer account through the customer page's own writer: refused as `conflict` when the email is a customer of the store already.",
    body: customerCreateBody,
    response: one(z.object({ id, email: z.string(), name: z.string(), phone: z.string(), email_verified: z.boolean(), tags: z.array(z.string()), created_at: when, updated_at: when })),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "customers.update",
    method: "PATCH",
    path: "/customers/{id}",
    scope: "customers:write",
    permission: "customers:write",
    tag: "Customers",
    summary: "Change a customer",
    description: "Changes only what is given of the customer's name, email, phone, address and company, through the customer page's own writer.",
    params: byId,
    body: customerUpdateBody,
    response: one(z.object({ id, email: z.string(), name: z.string(), phone: z.string(), email_verified: z.boolean(), tags: z.array(z.string()), created_at: when, updated_at: when })),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "customers.store_credit",
    method: "GET",
    path: "/customers/{id}/store-credit",
    scope: "customers:read",
    permission: "customers:read",
    tag: "Customers",
    summary: "Get a customer's store credit",
    description: "The store credit a customer was given from refunds (D364), each card with its balance; never a code.",
    params: byId,
    response: one(apiStoreCredit),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "customers.loyalty",
    method: "GET",
    path: "/customers/{id}/loyalty",
    scope: "customers:read",
    permission: "customers:read",
    feature: "bonus",
    tag: "Customers",
    summary: "Get a customer's bonus credits",
    description: "The customer's bonus credits (D130): usable now, waiting, and the latest entries, in the program's currency.",
    params: byId,
    response: one(apiLoyalty),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "segments.list",
    method: "GET",
    path: "/segments",
    scope: "customers:read",
    permission: "marketing:read",
    tag: "Segments",
    summary: "List segments",
    description: "The store's saved segments (D296), A to Z, with their conditions.",
    query: z.object(since),
    response: all(apiSegment),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "segments.get",
    method: "GET",
    path: "/segments/{id}",
    scope: "customers:read",
    permission: "marketing:read",
    tag: "Segments",
    summary: "Get a segment",
    description: "One segment with how many people it holds now, counted as the Segments page counts them (never who).",
    params: byId,
    response: one(apiSegmentCount),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "discounts.get",
    method: "GET",
    path: "/discounts/{id}",
    scope: "discounts:read",
    permission: "marketing:read",
    tag: "Discounts",
    summary: "Get a discount code",
    description: "One discount code with how often it was used.",
    params: byId,
    response: one(apiDiscountDetail),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "discounts.update",
    method: "PATCH",
    path: "/discounts/{id}",
    scope: "discounts:write",
    permission: "marketing:write",
    tag: "Discounts",
    summary: "Change a discount code",
    description:
      "Changes only what is given, through the admin's own form and its checks; what it reaches and who may use it stay as set in the admin. Orders already placed keep what they got. A loyalty reward's code is changed with its reward.",
    params: byId,
    body: discountUpdateBody,
    response: one(apiDiscountDetail),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "discounts.disable",
    method: "POST",
    path: "/discounts/{id}/disable",
    scope: "discounts:write",
    permission: "marketing:write",
    tag: "Discounts",
    summary: "Switch a discount code off",
    description: "Switches the code off, as its form's switch does: shoppers can no longer use it; nothing else changes.",
    params: byId,
    body: z.object({}),
    response: one(apiDiscountDetail),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "gift_cards.list",
    method: "GET",
    path: "/gift-cards",
    scope: "gift_cards:write",
    permission: "products:read",
    feature: "gift_cards",
    tag: "Gift cards",
    summary: "List gift cards",
    description: "The store's gift cards and store credit, newest first, each with its balance; never a code.",
    query: z.object({ ...paging, ...since, state: z.enum(GIFT_CARD_STATES).optional().describe("Only cards in this state.") }),
    response: page(apiGiftCard),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "gift_cards.get",
    method: "GET",
    path: "/gift-cards/{id}",
    scope: "gift_cards:write",
    permission: "products:read",
    feature: "gift_cards",
    tag: "Gift cards",
    summary: "Get a gift card",
    description: "One gift card with its balance; never its code.",
    params: byId,
    response: one(apiGiftCard),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "gift_cards.issue",
    method: "POST",
    path: "/gift-cards",
    scope: "gift_cards:write",
    permission: "products:write",
    feature: "gift_cards",
    tag: "Gift cards",
    summary: "Issue a gift card",
    description:
      "Issues a card by hand through the admin's own Issue: in one of the store's currencies, in its payment mode, emailed to `recipient_email` when given. Its code is answered this once: it is kept only as a hash, never answered again (a replay of the request answers it without), and never sent in a webhook.",
    body: giftCardIssueBody,
    response: one(apiGiftCard.extend({ code: z.string().nullable().describe("The card's code, this once."), emailed: z.enum(["sent", "failed", "not_asked"]) })),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "gift_cards.disable",
    method: "POST",
    path: "/gift-cards/{id}/disable",
    scope: "gift_cards:write",
    permission: "products:write",
    feature: "gift_cards",
    tag: "Gift cards",
    summary: "Deactivate a gift card",
    description: "Deactivates the card: what is left on it goes and it is never spent again; orders it paid keep their money.",
    params: byId,
    body: giftCardDisableBody,
    response: one(apiGiftCard),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "subscriptions.list",
    method: "GET",
    path: "/subscriptions",
    scope: "orders:read",
    permission: "orders:read",
    feature: "subscriptions",
    tag: "Subscriptions",
    summary: "List subscriptions",
    description: "Customers' subscriptions (D29), newest first, each with what renews and when.",
    query: z.object({ ...paging, ...since, status: z.enum(SUBSCRIPTION_STATES_API).optional().describe("Only subscriptions in this state.") }),
    response: page(apiSubscription),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "subscriptions.get",
    method: "GET",
    path: "/subscriptions/{id}",
    scope: "orders:read",
    permission: "orders:read",
    feature: "subscriptions",
    tag: "Subscriptions",
    summary: "Get a subscription",
    description: "One subscription with its lines and its next charge.",
    params: byId,
    response: one(apiSubscription),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "subscriptions.pause",
    method: "POST",
    path: "/subscriptions/{id}/pause",
    scope: "orders:write",
    permission: "orders:write",
    feature: "subscriptions",
    tag: "Subscriptions",
    summary: "Pause a subscription",
    description: "Pauses charges and deliveries for some periods, as the subscription page does (never in a free trial or while a payment is failing); the subscriber is emailed.",
    params: byId,
    body: subscriptionPauseBody,
    response: one(apiSubscription),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "subscriptions.cancel",
    method: "POST",
    path: "/subscriptions/{id}/cancel",
    scope: "orders:write",
    permission: "orders:write",
    feature: "subscriptions",
    tag: "Subscriptions",
    summary: "Cancel a subscription",
    description: "Cancels at the end of the paid period (or of a commitment), or at once with `now`, as staff may; the subscriber is emailed.",
    params: byId,
    body: subscriptionCancelBody,
    response: one(apiSubscription),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
] as const;
