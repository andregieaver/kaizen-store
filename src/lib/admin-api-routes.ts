import { z } from "zod";

import { type ApiErrorCode, type ApiMethod, type ApiScope } from "./admin-api";
import { apiProduct, byId, currency, id, madeId, marketCode, minor, one, op, page, paging, PRODUCT_STATES, since, when } from "./admin-api-shapes";

export { apiProduct, PRODUCT_STATES };
import { CATALOGUE_API } from "./admin-api-catalogue";
import { CONTENT_API } from "./admin-api-content";
import { CUSTOMERS_API } from "./admin-api-customers";
import { ORDERS_API } from "./admin-api-orders";
import { fieldInputSchema, ruleInputSchema, conditionSchema, effectSchema } from "./checkout-rules-schema";
import { DISCOUNT_KINDS } from "./discounts";
import { FULFILMENT_STATES } from "./fulfilment";
import { ADJUST_REASONS } from "./inventory";
import { DELIVERIES } from "./product-input";
import { createProductInput, updateProductInput } from "./product-tools";

/**
 * The Admin API's registry (wave 14 unit A, D438, `docs/wave-14-developer-platform.md` A1): every operation once, with its method, path,
 * name, scope, the staff permission and store feature its screen asks for (D440), words, and the zod of its path parameters, query, body and
 * answer, and the errors it can answer. `routeOf()` routes by it, the Apps and API page lists it (`API_ROUTES`), `adminOpenApi()` publishes
 * it, and the integration tests parse every answer they get with its `response`. A new operation is an entry here (or in its slice's file,
 * `admin-api-catalogue.ts` and the others of wave 14 unit C) first; its handler builds its answer as `AdminAnswer<name>`. Pure: no database,
 * nothing of the server.
 */

// ---------------------------------------------------------------------------
// Shapes the answers share
// ---------------------------------------------------------------------------

// Products -------------------------------------------------------------------

// Stock ----------------------------------------------------------------------

export const apiLocation = z.object({
  id,
  name: z.string(),
  country: z.string().nullable(),
  active: z.boolean(),
  priority: z.int().describe("The order stock is taken in: lowest first."),
});

export const apiLevel = z.object({
  variant_id: id,
  location_id: id,
  sku: z.string().nullable(),
  on_hand: z.int(),
  available: z.number().nullable().describe("What can be sold now across the store's locations: on hand less what open orders hold."),
  can_buy: z.boolean().nullable(),
  updated_at: when,
});

const ADJUST_OUTCOMES = ["written", "unchanged", "conflict", "refused", "failed"] as const;

export const apiStockAnswer = z.object({
  written: z.int(),
  unchanged: z.int(),
  conflicts: z.int(),
  refused: z.int(),
  failed: z.int(),
  rows: z.array(
    z.object({
      variant_id: id,
      location_id: id,
      outcome: z.enum(ADJUST_OUTCOMES).describe("conflict: the level moved since `compare` (or since it was read) and nothing was written for the row."),
      before: z.int().nullable(),
      after: z.int().nullable(),
      problem: z.string().nullable().describe("For a row not written: why, in a sentence."),
    }),
  ),
});

/** A variant by its id, or by its SKU (a warehouse knows the SKU). */
const variantRef = {
  variant_id: z.guid().optional().describe("The variant, by its id."),
  sku: z.string().trim().min(1).max(64).optional().describe("The variant, by its SKU."),
};
const named = (row: { variant_id?: string; sku?: string }) => Boolean(row.variant_id) !== Boolean(row.sku);
const NAME_ONE = "Name each row's variant by variant_id or by sku, not both.";

export const adjustBody = z.object({
  reason: z.string().default("correction").describe(`Why: one of ${ADJUST_REASONS.join(", ")}; correction when left out.`),
  note: z.string().max(200).nullable().default(null),
  rows: z
    .array(z.object({ ...variantRef, location_id: z.guid(), delta: z.int().min(-1_000_000).max(1_000_000).describe("Units to add (negative to take away).") }).refine(named, NAME_ONE))
    .min(1)
    .max(250),
});

export const setBody = z.object({
  reason: z.string().default("count").describe(`Why: one of ${ADJUST_REASONS.join(", ")}; count when left out.`),
  note: z.string().max(200).nullable().default(null),
  rows: z
    .array(
      z
        .object({
          ...variantRef,
          location_id: z.guid(),
          on_hand: z.int().min(0).max(10_000_000).describe("The level as counted."),
          compare: z
            .int()
            .min(-10_000_000)
            .max(10_000_000)
            .optional()
            .describe("The level the count was made against: a level that moved since is a conflict, never overwritten. The level now when left out."),
        })
        .refine(named, NAME_ONE),
    )
    .min(1)
    .max(250),
});

// Orders ---------------------------------------------------------------------

export const ORDER_STATES = ["pending_payment", "authorized", "paid", "fulfilled", "closed", "cancelled"] as const;
/** The carriers a parcel names (`CARRIERS` of `src/server/order-admin.ts`, held to this list by `admin-api.int.test.ts`). */
export const SEND_CARRIERS = ["posten", "bring", "porterbuddy", "helthjem", "instabox", "postnord", "dhl", "ups", "other"] as const;

const address = z.object({
  name: z.string(),
  line1: z.string(),
  line2: z.string(),
  postal_code: z.string(),
  city: z.string(),
  country: z.string(),
  phone: z.string(),
});

export const apiOrder = z.object({
  id,
  number: z.string().describe("The order's number, one sequence per store."),
  status: z.enum(ORDER_STATES),
  fulfilment: z.enum(FULFILMENT_STATES).describe("What is sent: none (nothing to send), unsent, partly_sent, sent, withdrawn or closed."),
  copied: z.boolean().describe("History copied from another store: read-only."),
  placed_at: when,
  market: marketCode,
  currency,
  email: z.string(),
  subtotal_minor: minor,
  shipping_minor: minor,
  tax_minor: minor,
  total_minor: minor,
  paid_minor: minor,
  refunded_minor: minor,
  shipping_address: address,
  billing_address: address,
  lines: z.array(
    z.object({
      id,
      variant_id: id.nullable(),
      sku: z.string(),
      title: z.string(),
      quantity: z.int(),
      unit_price_minor: minor,
      total_minor: minor,
      delivery: z.enum(DELIVERIES),
      to_send: z.int().describe("Units still to send."),
    }),
  ),
  shipments: z.array(
    z.object({
      id,
      carrier: z.string(),
      tracking_number: z.string(),
      tracking_url: z.string().nullable(),
      created_at: when,
      lines: z.array(z.object({ line_id: id, quantity: z.int() })),
    }),
  ),
  tags: z.array(z.string()).describe("Staff's tags on the order."),
  updated_at: when.describe("When it last changed: placed, paid, sent, refunded, edited or noted (its timeline's latest entry)."),
});

export const fulfilBody = z.object({
  carrier: z.enum(SEND_CARRIERS),
  tracking_number: z.string().trim().max(100).default(""),
  tracking_url: z.union([z.literal(""), z.url({ protocol: /^https$/ })]).default("").describe("The parcel's tracking page; the carrier's own when left out."),
  lines: z
    .array(z.object({ line_id: z.guid(), quantity: z.int().min(1).max(100_000) }))
    .max(500)
    .optional()
    .describe("What is in the parcel; everything still to send when left out."),
  notify: z.boolean().default(true).describe("Email the customer about the parcel, as the admin's Send does."),
});

export const apiDocument = z.object({
  file_name: z.string(),
  content_type: z.literal("application/xml"),
  xml: z.string().describe("The document as EN 16931 UBL 2.1."),
});

// Customers ------------------------------------------------------------------

export const apiCustomer = z.object({
  id,
  email: z.string(),
  name: z.string(),
  phone: z.string(),
  email_verified: z.boolean(),
  tags: z.array(z.string()),
  created_at: when,
  updated_at: when,
});

export const tagBody = z.object({
  tag: z.string().trim().min(1, "Type a tag.").max(200).describe("The tag's words: at most 40 characters and no comma. A tag the customer has is kept once."),
});

// Discounts ------------------------------------------------------------------

export const apiDiscount = z.object({
  id,
  code: z.string(),
  kind: z.enum(DISCOUNT_KINDS),
  percent: z.number().nullable(),
  amounts_minor: z.record(z.string(), z.number()).describe("For a fixed amount off: the amount per market, in minor units of the market's currency."),
  active: z.boolean(),
  starts_at: when.nullable(),
  ends_at: when.nullable(),
  usage_limit: z.number().nullable(),
  created_at: when,
  updated_at: when,
});

/** A code as the admin's form makes it, in the API's words (snake case); the form's own checks run after these. */
export const discountBody = z.object({
  code: z.string().trim().min(1, "Give the code.").max(100).describe("What shoppers type: 3 to 40 letters, digits, - or _. Kept in capitals, without spaces."),
  kind: z.enum(DISCOUNT_KINDS),
  percent: z.number().int().min(1).max(100).optional().describe("For percent: how much is taken off; 10 when left out."),
  amounts: z.record(z.string(), z.string()).optional().describe("For fixed: the amount off per market code, written in the market's currency, such as { \"NO\": \"100\" }."),
  min_subtotals: z.record(z.string(), z.string()).optional().describe("The least a basket must hold per market code, written in the market's currency."),
  starts_at: z.string().nullable().optional().describe("When it starts, as the store's local time (YYYY-MM-DDTHH:mm); at once when left out."),
  ends_at: z.string().nullable().optional().describe("When it ends, as the store's local time; never when left out."),
  usage_limit: z.number().int().min(1).max(1_000_000).nullable().optional().describe("How many times it may be used in all; no limit when left out."),
  once_per_customer: z.boolean().optional(),
  active: z.boolean().optional().describe("False makes it switched off; on when left out."),
});

// Checkout rules and questions ----------------------------------------------

const words = z.object({ text: z.string(), byLocale: z.record(z.string(), z.string()) });

export const apiCheckoutRule = z.object({
  id,
  name: z.string(),
  position: z.int(),
  enabled: z.boolean(),
  conditions: z.array(conditionSchema),
  effect: effectSchema,
  skipped: z
    .array(z.object({ reason: z.string(), count: z.int(), lastAt: when }))
    .describe("Why the rule was skipped at checkout (it names something gone or could not be read), how often and when last."),
});

export const apiCheckoutField = z.object({
  id,
  kind: z.enum(["text", "checkbox"]),
  required: z.boolean(),
  label: words,
  help: words.nullable(),
  position: z.int(),
  enabled: z.boolean(),
});

const enabledOnly = z.strictObject({ enabled: z.boolean().describe("Switches it on or off; nothing else changes.") });
export const ruleUpdateBody = z.union([enabledOnly, ruleInputSchema.extend({ enabled: z.boolean().optional() })]);
export const fieldUpdateBody = z.union([enabledOnly, fieldInputSchema.extend({ enabled: z.boolean().optional() })]);

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** Every operation also answers these: no token, a scope the token lacks, the budget spent, and an error of ours. */
export const COMMON_ERRORS = ["unauthorized", "forbidden", "rate_limited", "failed"] as const satisfies readonly ApiErrorCode[];

const CORE_API = [
  // Products
  op({
    name: "products.list",
    method: "GET",
    path: "/products",
    scope: "products:read",
    permission: "products:read",
    tag: "Products",
    summary: "List products",
    description: "The store's products, newest first, each with its variants and every market's price in the market's own currency.",
    query: z.object({ ...paging, ...since, status: z.enum(PRODUCT_STATES).optional().describe("Only products in this state; any other value lists every state.") }),
    response: page(apiProduct),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "products.get",
    method: "GET",
    path: "/products/{id}",
    scope: "products:read",
    permission: "products:read",
    tag: "Products",
    summary: "Get a product",
    description: "One product with its variants and prices.",
    params: byId,
    response: one(apiProduct),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "products.create",
    method: "POST",
    path: "/products",
    scope: "products:write",
    permission: "products:write",
    tag: "Products",
    summary: "Create a draft product",
    description:
      "Makes a product as a draft, through the product editor's own save: its words, prices per market as typed in each market's currency, options, variants, stock and categories. Its pictures are added with `POST /products/{id}/media`, and it is published with `POST /products/{id}/publish` (the power `products:publish`) or in the admin.",
    body: createProductInput.omit({ pictures: true }),
    response: one(apiProduct),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "products.update",
    method: "PATCH",
    path: "/products/{id}",
    scope: "products:write",
    permission: "products:write",
    tag: "Products",
    summary: "Change a draft product",
    description:
      "Changes only the fields given, through the editor's save. A product on the site (`active`) is changed only by a token with the power `products:publish`, and is refused as `gated` without it. `status` itself is refused here as `gated`: it changes with `POST /products/{id}/publish`, `/unpublish` or `/archive`, or in the admin.",
    params: byId,
    body: updateProductInput.omit({ product: true, pictures: true, add_pictures: true }),
    response: one(apiProduct),
    status: 200,
    errors: ["not_found", "invalid", "gated"],
  }),
  // Stock
  op({
    name: "inventory.locations",
    method: "GET",
    path: "/inventory/locations",
    scope: "inventory:read",
    permission: "products:read",
    tag: "Inventory",
    summary: "List stock locations",
    description: "The store's stock locations, in the order stock is taken from them.",
    response: z.object({ data: z.array(apiLocation) }),
    status: 200,
    errors: [],
  }),
  op({
    name: "inventory.levels",
    method: "GET",
    path: "/inventory/levels",
    scope: "inventory:read",
    permission: "products:read",
    tag: "Inventory",
    summary: "List stock levels",
    description: "Stock per variant and location, the most recently changed first, with what can be sold now.",
    query: z.object({ ...paging, ...since, variant_id: z.guid().optional().describe("Only this variant."), location_id: z.guid().optional().describe("Only this location.") }),
    response: page(apiLevel),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "inventory.adjust",
    method: "POST",
    path: "/inventory/adjust",
    scope: "inventory:write",
    permission: "products:write",
    tag: "Inventory",
    summary: "Adjust stock",
    description:
      "Adds or takes away units per variant and location, as the Inventory page does, recorded with source `api`. Each row stands alone: one refused or in conflict never stops the others.",
    body: adjustBody,
    response: one(apiStockAnswer),
    status: 200,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "inventory.set",
    method: "POST",
    path: "/inventory/set",
    scope: "inventory:write",
    permission: "products:write",
    tag: "Inventory",
    summary: "Set stock to a count",
    description: "Sets levels to what was counted. A level that moved since the count (`compare`) is a conflict and is never overwritten.",
    body: setBody,
    response: one(apiStockAnswer),
    status: 200,
    errors: ["invalid", "conflict"],
  }),
  // Orders
  op({
    name: "orders.list",
    method: "GET",
    path: "/orders",
    scope: "orders:read",
    permission: "orders:read",
    tag: "Orders",
    summary: "List orders",
    description: "The store's orders, newest first, in each order's own currency. History copied from another store is left out.",
    query: z.object({
      ...paging,
      ...since,
      status: z.enum(ORDER_STATES).optional().describe("Only orders in this state."),
      unfulfilled: z.enum(["true", "false"]).optional().describe("true: only paid orders with something still to send."),
    }),
    response: page(apiOrder),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "orders.get",
    method: "GET",
    path: "/orders/{id}",
    scope: "orders:read",
    permission: "orders:read",
    tag: "Orders",
    summary: "Get an order",
    description: "One order with its lines, what is left to send, its parcels and tags.",
    params: byId,
    response: one(apiOrder),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "orders.fulfil",
    method: "POST",
    path: "/orders/{id}/fulfillments",
    scope: "orders:write",
    permission: "orders:write",
    tag: "Orders",
    summary: "Send a parcel",
    description:
      "Records a parcel with its carrier and tracking, as the admin's Send does, and emails the customer unless `notify` is false. Answers the order as it is now.",
    params: byId,
    body: fulfilBody,
    response: one(apiOrder),
    status: 201,
    errors: ["not_found", "invalid", "gated", "conflict"],
  }),
  op({
    name: "invoices.ubl",
    method: "GET",
    path: "/invoices/{id}/ubl",
    scope: "orders:read",
    permission: "orders:read",
    tag: "Orders",
    summary: "Get an invoice as UBL",
    description: "An invoice as an EN 16931 electronic invoice (UBL 2.1), for accounting systems.",
    params: byId,
    response: one(apiDocument),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "credit_notes.ubl",
    method: "GET",
    path: "/credit-notes/{id}/ubl",
    scope: "orders:read",
    permission: "orders:read",
    tag: "Orders",
    summary: "Get a credit note as UBL",
    description: "A credit note as an EN 16931 electronic document (UBL 2.1).",
    params: byId,
    response: one(apiDocument),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  // Customers
  op({
    name: "customers.list",
    method: "GET",
    path: "/customers",
    scope: "customers:read",
    permission: "customers:read",
    tag: "Customers",
    summary: "List customers",
    description: "The store's customer accounts, newest first, with their tags.",
    query: z.object({ ...paging, ...since, email: z.string().max(254).optional().describe("Only the customer with this email, in any case (D440: find by email).") }),
    response: page(apiCustomer),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "customers.get",
    method: "GET",
    path: "/customers/{id}",
    scope: "customers:read",
    permission: "customers:read",
    tag: "Customers",
    summary: "Get a customer",
    description: "One customer account with its tags.",
    params: byId,
    response: one(apiCustomer),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "customers.tag",
    method: "POST",
    path: "/customers/{id}/tags",
    scope: "customers:write",
    permission: "customers:write",
    tag: "Customers",
    summary: "Tag a customer",
    description: "Adds a tag to the customer, as the customer's page does. Segments and discounts can then use it.",
    params: byId,
    body: tagBody,
    response: one(z.object({ added: z.literal(true) })),
    status: 201,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "customers.untag",
    method: "DELETE",
    path: "/customers/{id}/tags/{tag}",
    scope: "customers:write",
    permission: "customers:write",
    tag: "Customers",
    summary: "Remove a customer's tag",
    description: "Takes a tag off the customer; the tag is named as it is written, in any case.",
    params: byId.extend({ tag: z.string().min(1).max(200).describe("The tag's words, URL-encoded.") }),
    response: one(z.object({ removed: z.literal(true) })),
    status: 200,
    errors: ["not_found"],
  }),
  // Discounts
  op({
    name: "discounts.list",
    method: "GET",
    path: "/discounts",
    scope: "discounts:read",
    permission: "marketing:read",
    tag: "Discounts",
    summary: "List discount codes",
    description: "The store's discount codes, newest first.",
    query: z.object({ ...paging, ...since }),
    response: page(apiDiscount),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "discounts.create",
    method: "POST",
    path: "/discounts",
    scope: "discounts:write",
    permission: "marketing:write",
    tag: "Discounts",
    summary: "Create a discount code",
    description: "Makes a discount code through the admin's own form and its checks: a percent, a fixed amount per market, or free shipping.",
    body: discountBody,
    response: madeId,
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  // Checkout rules and questions (D399)
  op({
    name: "checkout.rules",
    method: "GET",
    path: "/checkout/rules",
    scope: "checkout:read",
    permission: "settings:read",
    tag: "Checkout",
    summary: "List checkout rules",
    description: "The store's checkout rules in the order they run, each with its conditions, its effect and why it was skipped, if it was.",
    query: z.object(since),
    response: z.object({ data: z.array(apiCheckoutRule) }),
    status: 200,
    errors: [],
  }),
  op({
    name: "checkout.rule_create",
    method: "POST",
    path: "/checkout/rules",
    scope: "checkout:write",
    permission: "settings:write",
    tag: "Checkout",
    summary: "Create a checkout rule",
    description: "Makes a rule through the Shipping page's own writer, switched off; `enabled` on an update switches it on. An option or method the store does not have is refused.",
    body: ruleInputSchema,
    response: madeId,
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "checkout.rule_update",
    method: "PATCH",
    path: "/checkout/rules/{id}",
    scope: "checkout:write",
    permission: "settings:write",
    tag: "Checkout",
    summary: "Change or switch a checkout rule",
    description: "`{ enabled }` alone switches the rule; anything else is the whole rule as it should be, its switch kept unless `enabled` is given too.",
    params: byId,
    body: ruleUpdateBody,
    response: madeId,
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "checkout.rule_delete",
    method: "DELETE",
    path: "/checkout/rules/{id}",
    scope: "checkout:write",
    permission: "settings:write",
    tag: "Checkout",
    summary: "Delete a checkout rule",
    description: "Deletes the rule.",
    params: byId,
    response: one(z.object({ id, deleted: z.literal(true) })),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "checkout.fields",
    method: "GET",
    path: "/checkout/fields",
    scope: "checkout:read",
    permission: "settings:read",
    tag: "Checkout",
    summary: "List checkout questions",
    description: "The questions the checkout asks, in order, with their words per language.",
    query: z.object(since),
    response: z.object({ data: z.array(apiCheckoutField) }),
    status: 200,
    errors: [],
  }),
  op({
    name: "checkout.field_create",
    method: "POST",
    path: "/checkout/fields",
    scope: "checkout:write",
    permission: "settings:write",
    tag: "Checkout",
    summary: "Create a checkout question",
    description: "Adds a question the checkout asks: a text or a checkbox, with its words.",
    body: fieldInputSchema,
    response: madeId,
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "checkout.field_update",
    method: "PATCH",
    path: "/checkout/fields/{id}",
    scope: "checkout:write",
    permission: "settings:write",
    tag: "Checkout",
    summary: "Change or switch a checkout question",
    description: "`{ enabled }` alone switches the question; anything else is the whole question as it should be.",
    params: byId,
    body: fieldUpdateBody,
    response: madeId,
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "checkout.field_delete",
    method: "DELETE",
    path: "/checkout/fields/{id}",
    scope: "checkout:write",
    permission: "settings:write",
    tag: "Checkout",
    summary: "Delete a checkout question",
    description: "Deletes the question; answers already given stay on their orders.",
    params: byId,
    response: one(z.object({ id, deleted: z.literal(true) })),
    status: 200,
    errors: ["not_found"],
  }),
] as const;

export const ADMIN_API = [...CORE_API, ...CATALOGUE_API, ...ORDERS_API, ...CUSTOMERS_API, ...CONTENT_API] as const;

export type AdminOperation = (typeof ADMIN_API)[number];
export type AdminApiName = AdminOperation["name"];
export type AdminOperationOf<N extends AdminApiName> = Extract<AdminOperation, { name: N }>;

/** What an operation answers on success, as its handler builds it. */
export type AdminAnswer<N extends AdminApiName> = z.output<AdminOperationOf<N>["response"]>;
/** An operation's body as read. */
export type AdminBody<N extends AdminApiName> = AdminOperationOf<N> extends { body: infer B extends z.ZodType } ? z.output<B> : never;

type ParamsOf<O> = O extends { params: infer P extends z.ZodType } ? z.output<P> : Record<never, never>;

/** A routed call: the operation's name, the scope it needs and its path parameters, read. */
export type ApiRoute = { [N in AdminApiName]: { name: N; scope: ApiScope } & ParamsOf<AdminOperationOf<N>> }[AdminApiName];

export const ADMIN_API_BY_NAME = Object.fromEntries(ADMIN_API.map((o) => [o.name, o])) as { [N in AdminApiName]: AdminOperationOf<N> };

/** The segments of a path template: a literal, or a parameter's name. */
const segmentsOf = (path: string) => path.split("/").filter(Boolean).map((s) => (/^\{\w+\}$/.test(s) ? { param: s.slice(1, -1) } : { literal: s }));

function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The route a method and path (after `/api/admin/v1/`) name, or null for none (a 404): the most literal template that matches and whose parameters read. */
export function routeOf(method: ApiMethod, path: readonly string[]): ApiRoute | null {
  let best: { route: ApiRoute; literals: number } | null = null;
  for (const o of ADMIN_API) {
    if (o.method !== method) continue;
    const segments = segmentsOf(o.path);
    if (segments.length !== path.length) continue;
    const captured: Record<string, string> = {};
    let fits = true;
    let literals = 0;
    for (const [i, s] of segments.entries()) {
      if ("literal" in s) {
        if (s.literal !== path[i]) fits = false;
        else literals += 1;
      } else {
        const value = decoded(path[i]);
        if (value === null) fits = false;
        else captured[s.param] = value;
      }
      if (!fits) break;
    }
    if (!fits) continue;
    const params = "params" in o ? o.params.safeParse(captured) : { success: true as const, data: {} };
    if (!params.success) continue;
    if (!best || literals > best.literals) best = { route: { name: o.name, scope: o.scope, ...params.data } as ApiRoute, literals };
  }
  return best?.route ?? null;
}

/** Every operation as the Apps and API page lists it: the method, the path after `/api/admin/v1` and the scope it needs. */
export const API_ROUTES: { method: ApiMethod; path: string; scope: ApiScope }[] = ADMIN_API.map((o) => ({ method: o.method, path: o.path, scope: o.scope }));

/**
 * A body's problems in words, each with where it is (D438): what a 422 says before any screen's check runs. A body that may be one of two
 * shapes (`{ enabled }` alone, or the whole rule) is told the problems of the shape it came nearest.
 */
export function bodyProblems(issues: readonly z.core.$ZodIssue[], at: PropertyKey[] = []): string[] {
  return issues.flatMap((issue) => {
    const path = [...at, ...issue.path];
    if (issue.code === "invalid_union" && issue.errors.length > 0) {
      const strays = (branch: readonly z.core.$ZodIssue[]) => Number(branch.some((i) => i.code === "unrecognized_keys"));
      const nearest = [...issue.errors].sort((a, b) => a.length - b.length || strays(a) - strays(b))[0];
      return bodyProblems(nearest, path);
    }
    return [`${path.map(String).join(".") || "body"}: ${issue.message}`];
  });
}

/** The errors an operation can answer, the common ones first. */
export const errorsOf = (o: AdminOperation): ApiErrorCode[] => [
  ...new Set<ApiErrorCode>([...COMMON_ERRORS, ...o.errors, ...("feature" in o ? (["feature_off"] as const) : [])]),
];
