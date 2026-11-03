import { z } from "zod";

import { all, byId, currency, id, marketCode, minor, one, op, page, paging, since, when } from "./admin-api-shapes";
import { DRAFT_STATUSES } from "./draft-status";
import { DRAFT_DISCOUNT_LABEL_MAX, DRAFT_INTERNAL_NOTE_MAX, DRAFT_LINES_MAX, DRAFT_NOTE_TO_BUYER_MAX, DRAFT_QUANTITY_MAX, DRAFT_TITLE_MAX, DRAFT_VALID_DAYS_MAX, DRAFT_VALID_DAYS_MIN, TAGS_PER_ORDER } from "./order-limits";
import { QUOTE_REPLY_MAX } from "./quotes";
import { RETURN_KINDS, RETURN_STATUSES } from "./return-status";

/**
 * The Admin API's orders (wave 14 unit C2, D440, `docs/wave-14-developer-platform.md` C2): draft orders and requests for a quote through the
 * draft editor's own functions (D173, D431), made and changed with `orders:manage` and sent or declined with the power `orders:send`;
 * refunds only through `refundOrder()`, and cancelling an order nobody paid, with the power `orders:refund` (D174); returns' decisions and
 * arrival (D153), which email the customer, with `orders:send`; an order's notes and tags with `orders:manage`. Entries of `ADMIN_API`; their
 * handlers are `src/server/admin-api-orders.ts`. Pure.
 */

// Draft orders and requests for a quote (D173, D431) ------------------------------------

const draftAddress = z.object({
  name: z.string(),
  line1: z.string(),
  line2: z.string(),
  postal_code: z.string(),
  city: z.string(),
  country: z.string(),
});

export const apiDraft = z.object({
  id,
  number: z.string().describe("The draft's own number (D-…); the order it becomes gets the store's next order number."),
  status: z.enum(DRAFT_STATUSES).describe("open: being made. sent: its order waits for payment. paid, expired or cancelled: ended."),
  source: z.enum(["staff", "quote"]).describe("staff: made in the admin or here. quote: a shopper's request for a quote (D431)."),
  quote: z.enum(["requested", "declined"]).nullable().describe("A request for a quote: waiting (requested) or declined; null for any other draft."),
  version: z.int().describe("Raised by every change: give it back with a change or a send, and one made since is refused as `conflict`."),
  market: marketCode,
  currency,
  customer_id: id.nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  shipping_address: draftAddress,
  billing_address: draftAddress,
  company_name: z.string().nullable(),
  organisation_number: z.string().nullable(),
  note_to_buyer: z.string().nullable(),
  internal_note: z.string().nullable(),
  request_note: z.string().nullable().describe("What the shopper wrote with a request for a quote."),
  tags: z.array(z.string()),
  discount: z
    .object({ kind: z.enum(["percent", "amount"]), percent: z.number().nullable(), amount_minor: minor.nullable(), label: z.string() })
    .nullable()
    .describe("A discount staff give on the whole draft, with the words the buyer sees."),
  shipping: z.object({ kind: z.enum(["rate", "free", "custom"]), amount_minor: minor.nullable() }).describe("rate: the market's shipping rate. custom: the amount given."),
  lines: z.array(
    z.object({
      id,
      kind: z.enum(["goods", "custom"]),
      variant_id: id.nullable(),
      sku: z.string(),
      title: z.string(),
      quantity: z.int(),
      unit_price_minor: minor.describe("What one unit costs on the draft, VAT included."),
      list_price_minor: minor.nullable().describe("The market's list price when the line was last saved; null for a custom item."),
      custom_price: z.boolean().describe("A price given instead of the list price."),
      price_requested: z.boolean().describe("A requested product priced on request with no price given yet: the draft cannot be sent until it has one."),
      vat_category: z.string().nullable(),
    }),
  ),
  total_minor: minor.nullable().describe("What the draft totals now, with shipping, the discount and VAT, as the order would; null when it cannot be worked out yet."),
  blocking: z.array(z.string()).describe("Why a send would be refused now, in words; empty when it can be sent."),
  order_id: id.nullable().describe("The order a sent draft made."),
  sent_at: when.nullable(),
  expires_at: when.nullable().describe("When a sent draft's pay link ends and its order is cancelled."),
  created_at: when,
  updated_at: when,
});

const addressBody = z
  .object({
    name: z.string().trim().max(200).optional(),
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    postal_code: z.string().trim().max(20).optional(),
    city: z.string().trim().max(100).optional(),
    country: z.string().trim().max(2).optional().describe("An ISO 3166-1 code, such as NO."),
  })
  .describe("Each field given replaces the draft's; one left out stays.");

const draftLineBody = z
  .object({
    id: z.guid().optional().describe("A line of the draft to keep (its quantity and price as given here)."),
    variant_id: z.guid().optional().describe("A product's variant, by its id."),
    sku: z.string().trim().min(1).max(64).optional().describe("A product's variant, by its SKU."),
    title: z.string().trim().max(DRAFT_TITLE_MAX).optional().describe("A custom item's title (no variant)."),
    quantity: z.int().min(1).max(DRAFT_QUANTITY_MAX),
    unit_price_minor: z
      .int()
      .min(0)
      .max(100_000_000_00)
      .nullable()
      .optional()
      .describe("The price of one unit, VAT included, in minor units of the draft's currency; left out or null on a product's line, its list price. A custom item needs one."),
    vat_category: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/).optional().describe("A custom item's VAT category, such as standard."),
  })
  .refine((l) => !(l.variant_id && l.sku), "Name a line's variant by variant_id or by sku, not both.");

const draftFields = {
  customer_id: z.guid().nullable().optional().describe("One of the store's customers, or null for none."),
  email: z.string().trim().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  shipping_address: addressBody.optional(),
  billing_address: addressBody.optional(),
  company_name: z.string().trim().max(120).nullable().optional(),
  organisation_number: z.string().trim().max(30).nullable().optional(),
  note_to_buyer: z.string().max(DRAFT_NOTE_TO_BUYER_MAX).nullable().optional().describe("Words the buyer reads on the pay page and the order."),
  internal_note: z.string().max(DRAFT_INTERNAL_NOTE_MAX).nullable().optional().describe("Words for staff only."),
  tags: z.array(z.string().max(120)).max(TAGS_PER_ORDER).optional().describe("The draft's tags, carried to its order; replaces the tags there."),
  discount: z
    .object({
      kind: z.enum(["percent", "amount"]),
      percent: z.number().min(0.01).max(100).optional().describe("For percent: how much is taken off, such as 10 or 12.5."),
      amount_minor: z.int().min(1).optional().describe("For amount: what is taken off, in minor units."),
      label: z.string().trim().min(1).max(DRAFT_DISCOUNT_LABEL_MAX).describe("The words the buyer sees."),
    })
    .refine((d) => (d.kind === "percent" ? d.percent !== undefined : d.amount_minor !== undefined), "Give percent for a percent discount, amount_minor for an amount.")
    .nullable()
    .optional(),
  shipping: z
    .object({ kind: z.enum(["rate", "free", "custom"]), amount_minor: z.int().min(0).optional().describe("For custom: the shipping price in minor units, VAT included.") })
    .refine((s) => s.kind !== "custom" || s.amount_minor !== undefined, "A custom shipping price needs amount_minor.")
    .optional(),
  lines: z.array(draftLineBody).max(DRAFT_LINES_MAX).optional().describe("The draft's lines as they should be, in order: they replace the lines there."),
};

export const draftCreateBody = z.object({
  market: z.string().trim().regex(/^[A-Z]{2}$/).optional().describe("The market the draft sells in, by its code; the store's own market when left out."),
  ...draftFields,
});

export const draftUpdateBody = z
  .object({
    version: z.int().min(1).optional().describe("The version the change was made against: a draft changed since is refused as `conflict`. The draft as it is now when left out."),
    market: z.string().trim().regex(/^[A-Z]{2}$/).optional().describe("Moves the draft to another market: lines at their list price take that market's."),
    ...draftFields,
    prices: z
      .array(z.object({ sku: z.string().trim().min(1).max(64), unit_price_minor: z.int().min(0).max(100_000_000_00).nullable().describe("null: back to the list price.") }))
      .max(DRAFT_LINES_MAX)
      .optional()
      .describe("Prices of the draft's lines by SKU (D437): each line of the SKU takes it; the other lines keep theirs. A request priced on request is answered so."),
  })
  .refine((b) => !(b.lines && b.prices), "Send lines or prices, not both.");

export const draftSendBody = z.object({
  version: z.int().min(1).optional(),
  valid_days: z.int().min(DRAFT_VALID_DAYS_MIN).max(DRAFT_VALID_DAYS_MAX).optional().describe("How long the pay link lasts; the store's own when left out."),
  create_link: z.boolean().default(false).describe("true: answer the pay link (once) instead of emailing it to the customer."),
});

export const draftDeclineBody = z.object({
  reply: z.string().trim().min(1).max(QUOTE_REPLY_MAX).describe("What the shopper is emailed: why their request is declined."),
});

const draftQuery = z.object({
  ...paging,
  ...since,
  status: z.enum(DRAFT_STATUSES).optional().describe("Only drafts in this state."),
  quotes: z.enum(["true", "false"]).optional().describe("true: only shoppers' requests for a quote."),
});

// Refunds (D174) -------------------------------------------------------------------------

export const apiRefund = z.object({
  id,
  order_id: id,
  amount_minor: minor,
  currency,
  status: z.string().describe("pending (on its way), succeeded or failed."),
  kind: z.string().describe("How the money went back: to the payment, or as store credit."),
  restocked: z.boolean().describe("Units went back in stock with it."),
  created_at: when,
});

export const refundBody = z.object({
  amount_minor: z.int().min(0).describe("What goes back, in minor units of the order's currency; 0 to put units back in stock only."),
  reason: z.string().trim().min(1).max(500).default("Refund").describe("Why, for the order's history and the credit note."),
  restock: z
    .array(z.object({ line_id: z.guid(), quantity: z.int().min(1).max(100_000), location_id: z.guid().nullable().optional().describe("Where they go back; where they were taken from when left out.") }))
    .max(500)
    .default([])
    .describe("Units put back in stock, per order line."),
  not_sent: z.boolean().default(false).describe("The units put back were never sent: they come off what is still to send."),
  to_store_credit: z.boolean().default(false).describe("Give the amount as store credit (D364), emailed to the order's address, instead of to the payment."),
  notify: z.boolean().default(true).describe("Email the customer about the refund, as the admin's Refund does (store credit is emailed either way)."),
});

const refundAnswer = one(
  z.object({
    refund_ids: z.array(id).describe("Every refund made: an amount split over the order's payments makes one each."),
    amount_minor: minor,
    status: z.string().nullable(),
    closed_units: z.int().describe("Units taken off what was still to send (`not_sent`)."),
    store_credit: z.object({ card_id: id, amount_minor: minor, emailed: z.enum(["sent", "failed"]) }).nullable().describe("Store credit issued; its code goes only to the customer."),
  }),
);

// Returns (D153) --------------------------------------------------------------------------

export const apiReturn = z.object({
  id,
  number: z.string(),
  kind: z.enum(RETURN_KINDS).describe("withdrawal (the right of withdrawal) or return (a voluntary return)."),
  status: z.enum(RETURN_STATUSES),
  order_id: id,
  order_number: z.string(),
  currency,
  reason: z.string().nullable().describe("Why, as the shopper chose it."),
  lines: z.array(
    z.object({
      order_line_id: id,
      sku: z.string(),
      title: z.string(),
      quantity: z.int(),
      decision: z.enum(["accept", "decline"]),
      condition: z.enum(["as_new", "opened", "used", "damaged"]).nullable(),
      restock: z.boolean(),
    }),
  ),
  refund: z.object({ recorded: z.boolean(), amount_minor: minor.nullable(), at: when.nullable() }),
  created_at: when,
  approved_at: when.nullable(),
  received_at: when.nullable(),
  closed_at: when.nullable(),
  updated_at: when,
});

export const returnApproveBody = z.object({
  instructions: z.string().trim().max(2000).nullable().optional().describe("How to send the goods back; the store's own when left out."),
  label_url: z.union([z.literal(""), z.url({ protocol: /^https$/ })]).nullable().optional().describe("A return label's address (https)."),
  note: z.string().trim().max(1000).nullable().optional().describe("A note for staff."),
});
export const returnDeclineBody = z.object({ reason: z.string().trim().min(1).max(1000).describe("Why, as the shopper is emailed.") });
export const returnReceiveBody = z.object({ on: z.iso.date().nullable().optional().describe("The day the goods arrived (the store's day); today when left out.") });

// Notes, tags and cancelling ---------------------------------------------------------------

export const apiNote = z.object({ note: z.string(), by: z.string().describe("Who wrote it: a person's email, or the token's name."), created_at: when });
export const noteBody = z.object({ note: z.string().trim().min(1, "Write the note.").max(2000).describe("A note for staff; the customer never sees it.") });
export const orderTagBody = z.object({ tag: z.string().trim().min(1, "Type a tag.").max(120).describe("The tag's words; one the order has is kept once.") });
export const cancelBody = z.object({
  reason: z.string().trim().max(500).default("Cancelled by the store").describe("Why, for the order's history."),
  notify: z.boolean().default(false).describe("Email the customer that the order is cancelled."),
});

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

const draftResponse = one(apiDraft);

export const ORDERS_API = [
  // Draft orders and quotes
  op({
    name: "drafts.list",
    method: "GET",
    path: "/drafts",
    scope: "orders:read",
    permission: "orders:read",
    feature: "shop",
    tag: "Draft orders",
    summary: "List draft orders",
    description: "The store's draft orders and shoppers' requests for a quote (D173, D431), newest first, each with its lines and what it totals now.",
    query: draftQuery,
    response: page(apiDraft),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "drafts.get",
    method: "GET",
    path: "/drafts/{id}",
    scope: "orders:read",
    permission: "orders:read",
    feature: "shop",
    tag: "Draft orders",
    summary: "Get a draft order",
    description: "One draft order or request for a quote, with what would stop it being sent now.",
    params: byId,
    response: draftResponse,
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "drafts.create",
    method: "POST",
    path: "/drafts",
    scope: "orders:manage",
    permission: "orders:write",
    feature: "shop",
    tag: "Draft orders",
    summary: "Create a draft order",
    description: "Makes a draft order through the draft editor's own functions: an empty draft in the market, then saved with what is given, checked as the editor checks it. Nothing is held and no order number used until it is sent.",
    body: draftCreateBody,
    response: draftResponse,
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "drafts.update",
    method: "PATCH",
    path: "/drafts/{id}",
    scope: "orders:manage",
    permission: "orders:write",
    feature: "shop",
    tag: "Draft orders",
    summary: "Change a draft order",
    description: "Changes only what is given on an open draft, through the editor's save: its customer, addresses, notes, tags, discount, shipping, lines, or its lines' prices by SKU.",
    params: byId,
    body: draftUpdateBody,
    response: draftResponse,
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "drafts.send",
    method: "POST",
    path: "/drafts/{id}/send",
    scope: "orders:send",
    permission: "orders:write",
    feature: "shop",
    tag: "Draft orders",
    summary: "Send a draft order",
    description:
      "Makes the draft's order (waiting for payment, numbered, stock held until the link ends) and emails the customer its pay link, or answers the link once with `create_link`. A request for a quote goes as a quote. Refused while it has a problem (`blocking`).",
    params: byId,
    body: draftSendBody,
    response: one(
      z.object({
        draft: apiDraft,
        order_id: id,
        order_number: z.string(),
        expires_at: when,
        link: z.string().nullable().describe("The pay link, answered only this once and only with `create_link`."),
        emailed: z.enum(["sent", "logged", "failed", "duplicate", "suppressed"]).nullable(),
      }),
    ),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "drafts.decline",
    method: "POST",
    path: "/drafts/{id}/decline",
    scope: "orders:send",
    permission: "orders:write",
    feature: "shop",
    tag: "Draft orders",
    summary: "Decline a request for a quote",
    description: "Declines a shopper's open request for a quote with a short reply they are emailed, as the draft page does.",
    params: byId,
    body: draftDeclineBody,
    response: draftResponse,
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  // Refunds
  op({
    name: "orders.refunds",
    method: "GET",
    path: "/orders/{id}/refunds",
    scope: "orders:read",
    permission: "orders:read",
    tag: "Orders",
    summary: "List an order's refunds",
    description: "Every refund of the order, newest first, in its own currency.",
    params: byId,
    response: all(apiRefund),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "orders.refund",
    method: "POST",
    path: "/orders/{id}/refunds",
    scope: "orders:refund",
    permission: "orders:write",
    tag: "Orders",
    summary: "Refund an order",
    description:
      "Refunds part or all of what is left through `refundOrder()`, the admin's own refund: through the payment it was taken by (Stripe, Mollie, or recorded for money taken outside), or as store credit; units put back in stock where they came from. Needs `orders:refund`.",
    params: byId,
    body: refundBody,
    response: refundAnswer,
    status: 201,
    errors: ["not_found", "invalid", "gated", "conflict"],
  }),
  op({
    name: "orders.cancel",
    method: "POST",
    path: "/orders/{id}/cancel",
    scope: "orders:refund",
    permission: "orders:write",
    tag: "Orders",
    summary: "Cancel an unpaid order",
    description:
      "Cancels an order waiting for payment: its payment page is closed first (one found paid is refused), its stock goes back and its pay link dies. A paid order is refunded instead (`orders:refund`).",
    params: byId,
    body: cancelBody,
    response: one(z.object({ id, status: z.literal("cancelled") })),
    status: 200,
    errors: ["not_found", "invalid", "gated", "conflict"],
  }),
  // Notes and tags
  op({
    name: "orders.notes",
    method: "GET",
    path: "/orders/{id}/notes",
    scope: "orders:read",
    permission: "orders:read",
    tag: "Orders",
    summary: "List an order's notes",
    description: "Staff's notes on the order, newest first.",
    params: byId,
    response: all(apiNote),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "orders.note",
    method: "POST",
    path: "/orders/{id}/notes",
    scope: "orders:manage",
    permission: "orders:write",
    tag: "Orders",
    summary: "Add a note to an order",
    description: "Adds a note for staff to the order's history, as the order page does; the customer never sees it.",
    params: byId,
    body: noteBody,
    response: one(apiNote),
    status: 201,
    errors: ["not_found", "invalid", "gated", "conflict"],
  }),
  op({
    name: "orders.tag",
    method: "POST",
    path: "/orders/{id}/tags",
    scope: "orders:manage",
    permission: "orders:write",
    tag: "Orders",
    summary: "Tag an order",
    description: "Adds a tag to the order (at most 250 an order); one it has is kept once. Answers its tags.",
    params: byId,
    body: orderTagBody,
    response: one(z.object({ tags: z.array(z.string()) })),
    status: 201,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "orders.untag",
    method: "DELETE",
    path: "/orders/{id}/tags/{tag}",
    scope: "orders:manage",
    permission: "orders:write",
    tag: "Orders",
    summary: "Remove an order's tag",
    description: "Takes a tag off the order, named as it is written in any case. Answers its tags.",
    params: byId.extend({ tag: z.string().min(1).max(200).describe("The tag's words, URL-encoded.") }),
    response: one(z.object({ tags: z.array(z.string()) })),
    status: 200,
    errors: ["not_found"],
  }),
  // Returns (D153)
  op({
    name: "returns.list",
    method: "GET",
    path: "/returns",
    scope: "orders:read",
    permission: "orders:read",
    tag: "Returns",
    summary: "List returns",
    description: "Withdrawals and voluntary returns, newest first.",
    query: z.object({
      ...paging,
      ...since,
      status: z.enum(RETURN_STATUSES).optional().describe("Only returns in this state."),
      kind: z.enum(RETURN_KINDS).optional().describe("Only withdrawals, or only voluntary returns."),
    }),
    response: page(apiReturn),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "returns.get",
    method: "GET",
    path: "/returns/{id}",
    scope: "orders:read",
    permission: "orders:read",
    tag: "Returns",
    summary: "Get a return",
    description: "One return with its lines, its refund and its steps' times.",
    params: byId,
    response: one(apiReturn),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "returns.approve",
    method: "POST",
    path: "/returns/{id}/approve",
    scope: "orders:send",
    permission: "orders:write",
    tag: "Returns",
    summary: "Approve a return",
    description: "Approves a voluntary return through the returns page's own step; the shopper is emailed how to send the goods back.",
    params: byId,
    body: returnApproveBody,
    response: one(apiReturn),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "returns.decline",
    method: "POST",
    path: "/returns/{id}/decline",
    scope: "orders:send",
    permission: "orders:write",
    tag: "Returns",
    summary: "Decline a return",
    description: "Declines a voluntary return with the reason the shopper is emailed. A withdrawal is never declined.",
    params: byId,
    body: returnDeclineBody,
    response: one(apiReturn),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "returns.receive",
    method: "POST",
    path: "/returns/{id}/receive",
    scope: "orders:send",
    permission: "orders:write",
    tag: "Returns",
    summary: "Mark a return received",
    description: "Records that the goods arrived, on a day or today; the shopper is emailed. Inspecting and refunding stay in the admin.",
    params: byId,
    body: returnReceiveBody,
    response: one(apiReturn),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
] as const;

