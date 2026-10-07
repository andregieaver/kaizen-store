import { z } from "zod";

import { DRAFT_DISCOUNT_LABEL_MAX, DRAFT_LINES_MAX, DRAFT_QUANTITY_MAX, DRAFT_VALID_DAYS_MAX, DRAFT_VALID_DAYS_MIN, ORDERS_PAGE_SIZE } from "./order-limits";
import {
  ARCHIVED_FILTERS,
  PAY_FILTERS,
  RANGE_FILTERS,
  SHIP_FILTERS,
  SHOW_VIEWS,
  SORT_KEYS,
  SOURCE_FILTERS,
  STATUS_FILTERS,
  type OrderListInput,
} from "./order-list";
import { DRAFT_STATUSES } from "./draft-status";
import { BULK_REASON_TEXT, type BulkReason } from "./order-bulk";

/**
 * What the AI manager's order tools (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.6 and 5.5) do that needs no database: their arguments, how a list request becomes the
 * Orders page's own address (so the tool and the page read one parser), the words for a batch's answer and the words a gated send is kept with. Every figure the tools
 * give is the store's own (`listOrdersPage()`, `previewDraft()`, `runBulk()`); the model repeats it and works nothing out, and there is NO tool that records a payment, deletes a
 * draft or refunds (an order paid outside Kaizen is refunded on its page).
 */

/** How many orders one `tag_orders` or `archive_orders` call may name: a handful the owner just talked about, not a sweep (the page's bulk bar does 250). */
export const TOOL_ORDERS_MAX = 25;
/** Tags in one call. */
export const TOOL_TAGS_MAX = 10;

const orderRef = z.string().trim().min(1).max(64).describe("The order's number, such as 1042, or its id.");
const tagText = z.string().trim().min(1).max(120).describe("A tag as the owner writes it (up to 40 characters, no comma).");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day is written YYYY-MM-DD.");

/** The filters of `list_orders`: the Orders page's own (docs 2.2), one parameter each, so the tool and the page answer the same. */
export const LIST_ORDER_FILTERS = {
  show: z.enum(SHOW_VIEWS).optional().describe("A built-in view: to-send, waiting (for stock), unpaid (unfinished checkouts) or archived."),
  pay: z.array(z.enum(PAY_FILTERS)).max(PAY_FILTERS.length).optional().describe("Payment state: paid, partially_refunded, refunded, balance_due or unpaid."),
  ship: z.array(z.enum(SHIP_FILTERS)).max(SHIP_FILTERS.length).optional().describe("Fulfilment: to_send, partly_sent, sent, waiting, no_shipping or edit_pending (a change waits for the customer's payment)."),
  status: z.array(z.enum(STATUS_FILTERS)).max(STATUS_FILTERS.length).optional().describe("The order's own status."),
  tag: z.array(z.string().trim().min(1).max(120)).max(TOOL_TAGS_MAX).optional().describe("Only orders with all of these tags."),
  from: day.optional().describe("From this day, in the store's own days."),
  to: day.optional().describe("Up to and including this day."),
  range: z.enum(RANGE_FILTERS).optional().describe("Relative days: 7d, 30d, 90d, this_month or last_month (used when from and to are left out)."),
  market: z.string().trim().length(2).optional().describe("A country code of the store's markets."),
  source: z.enum(SOURCE_FILTERS).optional().describe("checkout (a shopper's), draft (staff-made) or copied (history from another store)."),
  gift: z.boolean().optional().describe("True: gift orders only."),
  archived: z.enum(ARCHIVED_FILTERS).optional().describe("no (the default), yes (only archived) or all."),
  sort: z.enum(SORT_KEYS).optional(),
  after: z.string().trim().max(512).optional().describe("The `next` value of the previous answer, for the next page."),
} as const;

export const listOrdersInput = z.object({
  which: z.enum(["all", "to_send", "unpaid"]).default("all"),
  search: z.string().trim().max(100).optional().describe("One to five words: they must all match the order number, the email or name, a product title or SKU, a tag or a tracking number."),
  ...LIST_ORDER_FILTERS,
  limit: z.number().int().min(1).max(ORDERS_PAGE_SIZE).default(10).describe(`How many at most (1–${ORDERS_PAGE_SIZE}).`),
});
export type ListOrdersInput = z.output<typeof listOrdersInput>;

/** The arguments of `list_orders` as the Orders page's address reads them (`readOrderListParams()` drops what means nothing). `which` is the older way to say the built-in view. */
export function listOrdersAddress(input: ListOrdersInput): OrderListInput {
  const out: Record<string, string> = {};
  const show = input.show ?? (input.which === "to_send" ? "to-send" : input.which === "unpaid" ? "unpaid" : undefined);
  if (show) out.show = show;
  if (input.search) out.q = input.search.replace(/^#/, "");
  for (const key of ["pay", "ship", "status", "tag"] as const) {
    const values = input[key];
    if (values && values.length > 0) out[key] = values.join(",");
  }
  for (const key of ["from", "to", "range", "market", "source", "archived", "sort", "after"] as const) {
    const value = input[key];
    if (value) out[key] = value;
  }
  if (input.gift) out.gift = "1";
  return out;
}

export const tagOrdersInput = z.object({
  orders: z.array(orderRef).min(1).max(TOOL_ORDERS_MAX).describe(`The orders, by number or id (at most ${TOOL_ORDERS_MAX}).`),
  add: z.array(tagText).max(TOOL_TAGS_MAX).default([]).describe("Tags to put on them."),
  remove: z.array(tagText).max(TOOL_TAGS_MAX).default([]).describe("Tags to take off them."),
});
export type TagOrdersInput = z.output<typeof tagOrdersInput>;

export const archiveOrdersInput = z.object({
  orders: z.array(orderRef).min(1).max(TOOL_ORDERS_MAX).describe(`The orders, by number or id (at most ${TOOL_ORDERS_MAX}).`),
  archived: z.boolean().default(true).describe("True archives them (they leave the default list and the queues); false brings archived orders back."),
});
export type ArchiveOrdersInput = z.output<typeof archiveOrdersInput>;

const draftRef = z.string().trim().min(1).max(64).describe("The draft order's number, such as D-12, or its id.");

export const listDraftOrdersInput = z.object({
  status: z.enum([...DRAFT_STATUSES, "all"]).default("all").describe("open (being written), sent (waiting for payment), paid, expired, cancelled or all."),
  limit: z.number().int().min(1).max(50).default(15).describe("How many at most (1–50)."),
});
export type ListDraftOrdersInput = z.output<typeof listDraftOrdersInput>;

export const createDraftOrderInput = z.object({
  email: z.string().trim().email().max(254).describe("The customer's email: the pay link goes there only when the owner sends the draft."),
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(100).describe("The variant's SKU, as list_products or get_product give it."),
        quantity: z.number().int().min(1).max(DRAFT_QUANTITY_MAX),
      }),
    )
    .min(1)
    .max(DRAFT_LINES_MAX),
  market: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(?:-[a-z]{2,3}){0,2}$/, "A market is written like no, se or no-en.")
    .optional()
    .describe("The market's address, such as no or no-en-eur; the store's first market when left out. Prices, VAT and shipping are the market's."),
  discount_percent: z.string().trim().min(1).max(12).optional().describe("A percent off the goods the owner asked for, as they wrote it (10 or 7,5). Needs discount_label."),
  discount_label: z.string().trim().min(1).max(DRAFT_DISCOUNT_LABEL_MAX).optional().describe("What the customer sees the discount called on the pay page and the invoice, such as Loyal customer."),
});
export type CreateDraftOrderInput = z.output<typeof createDraftOrderInput>;

export const sendDraftOrderInput = z.object({
  draft: draftRef,
  valid_days: z.number().int().min(DRAFT_VALID_DAYS_MIN).max(DRAFT_VALID_DAYS_MAX).optional().describe(`How many days the pay link works (${DRAFT_VALID_DAYS_MIN}–${DRAFT_VALID_DAYS_MAX}); the store's own default when left out.`),
  approved_version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Never set this: the store writes it when the owner is asked, so what is sent is the draft as the owner was shown it."),
});
export type SendDraftOrderInput = z.output<typeof sendDraftOrderInput>;

/** The words for a batch's answer: what was applied and what was not, each refusal in plain words. Numbers only for orders that are the store's (a refusal never names another's). */
export function batchAnswer(
  verb: string,
  result: { requested: number; applied: number; refused: readonly { number: string | null; reason: BulkReason }[] },
): { done: string; not_done: { order: string; why: string }[] } {
  const orders = (n: number) => `${n} ${n === 1 ? "order" : "orders"}`;
  return {
    done: `${verb} ${result.applied} of ${orders(result.requested)}.`,
    not_done: result.refused.map((r) => ({ order: r.number ?? "(not found)", why: BULK_REASON_TEXT[r.reason] })),
  };
}

/** The words a gated `send_draft_order` is kept with when nothing more is known (the assistant adds the draft's own figures, `draftApprovalSummary()`). */
export function sendDraftSummary(draft: string, validDays?: number | null): string {
  return `Email the pay link of draft order ${draft} to its customer. The order is made now and its goods are held until the link ends${validDays ? ` (${validDays} ${validDays === 1 ? "day" : "days"})` : ""}.`;
}
