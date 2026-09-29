import { z } from "zod";

/**
 * The owner assistant's tools (D94), modelled on Kaizen Life's MCP catalogue:
 * each has a name, what it does for the model, and its arguments, checked
 * with zod and offered as JSON Schema. The same catalogue serves the
 * assistant in the admin and, later, the store's MCP server, so a tool added
 * here is available to both. Every answer comes from the store's own data
 * (`src/server/owner-tools.ts`); amounts are worked out and written in code.
 *
 * A tool with a `gate` never runs from the model alone: the call is kept as
 * a pending approval and runs when the owner says yes (the approval gate,
 * as Kaizen Life's): anything sent in the store's name (`send`), made
 * public (`public`) or costing money (`spend`). Everything else, reading and
 * notes inside the admin, runs freely.
 */

export type GateCategory = "send" | "public" | "spend";

export type OwnerTool<I extends z.ZodType = z.ZodType, N extends string = string> = {
  name: N;
  description: string;
  input: I;
  gate?: GateCategory;
};

export const tool = <N extends string, I extends z.ZodType>(name: N, description: string, input: I, gate?: GateCategory): OwnerTool<I, N> => ({
  name,
  description,
  input,
  ...(gate && { gate }),
});

const limit = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback).describe(`How many at most (1–${max}).`);
/** An order by its number (as the owner says it, such as 1042) or its id. */
const orderRef = z.string().trim().min(1).max(64).describe("The order's number, such as 1042, or its id.");
const productRef = z.string().trim().min(1).max(200).describe("The product's id, its handle, or its title as listed.");

export const OWNER_TOOLS = [
  tool(
    "store_overview",
    "The store at a glance: its name, whether it is open, its countries with their currencies and languages, who it sells to, its modules, and how many products and orders it has. Start here when unsure what the store is.",
    z.object({}),
  ),
  tool(
    "sales_summary",
    "Paid sales over a period, worked out by the store: number of orders, total taken, refunds and average order, per currency, and the best-selling products. Use it for any question about revenue, sales or how the store is doing; never add up orders yourself.",
    z.object({
      days: z.number().int().min(1).max(366).default(30).describe("The last this many days, today included (1–366)."),
    }),
  ),
  tool(
    "list_orders",
    "The store's orders, newest first: number, status, customer, total and items. `which` narrows them: all orders taken, those paid and waiting to be sent, or unpaid checkouts. `search` matches the number, email or name.",
    z.object({
      which: z.enum(["all", "to_send", "unpaid"]).default("all"),
      search: z.string().trim().max(100).optional(),
      limit: limit(50, 10),
    }),
  ),
  tool(
    "get_order",
    "One order in full: its lines, totals, payment, what is left to refund, shipments, bookings and history.",
    z.object({ order: orderRef }),
  ),
  tool(
    "list_products",
    "The store's products: title, status, price range in the main country, stock and variants. `search` matches the title or handle.",
    z.object({
      search: z.string().trim().max(100).optional(),
      status: z.enum(["active", "draft", "archived"]).optional(),
      limit: limit(50, 20),
    }),
  ),
  tool(
    "get_product",
    "One product: its texts in the main language, status, and each variant's SKU, price per country and stock.",
    z.object({ product: productRef }),
  ),
  tool(
    "low_stock",
    "Active variants with stock at or below a level (goods only; services and digital files have none).",
    z.object({ at_most: z.number().int().min(0).max(1000).default(3).describe("Stock at or below this.") }),
  ),
  tool(
    "list_bookings",
    "Bookings from a day on, for a number of days: appointments, stays and rentals, with who or what is booked, the customer and the order.",
    z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day is written 2026-10-01.").optional().describe("The first day, as 2026-10-01; today unless given."),
      days: z.number().int().min(1).max(31).default(7),
    }),
  ),
  tool(
    "list_discounts",
    "The store's discount codes: code, what they give, when they run and how often they have been used.",
    z.object({}),
  ),
  tool(
    "list_pages",
    "The store's pages or blog articles: title, address and whether they are published.",
    z.object({ type: z.enum(["page", "article"]).default("page") }),
  ),
  tool(
    "search_insights",
    "What shoppers searched for in the store's search, most often first, and the searches that found nothing.",
    z.object({ days: z.number().int().min(1).max(90).default(30), limit: limit(30, 10) }),
  ),
  tool(
    "setup_progress",
    "What the store has done before it can open, and what is left: details, countries, shipping, payments, products and a plan, with the page for each.",
    z.object({}),
  ),
  tool(
    "store_checkup",
    "A check of the store's health worked out in code: orders waiting too long to be sent, stock running out, searches finding nothing, setup left to do, integrations failing, changes waiting for approval. Each finding comes with the page to fix it. Use it for 'how is my store doing' and to suggest what to do next.",
    z.object({}),
  ),
  tool(
    "list_customers",
    "The store's customers, most recently active first: name, email, orders, live subscriptions and what they spent. `search` matches the name or email.",
    z.object({ search: z.string().trim().max(100).optional(), limit: limit(50, 10) }),
  ),
  tool(
    "get_customer",
    "One customer: their account, orders, subscriptions, wishlist and whether they take cart reminders.",
    z.object({ customer: z.string().trim().min(1).max(200).describe("The customer's email, or their key from list_customers.") }),
  ),
  tool(
    "list_subscriptions",
    "Shoppers' subscriptions: number, status, customer, what each renewal costs and when it renews.",
    z.object({ limit: limit(50, 20) }),
  ),
  tool(
    "cart_reminder_stats",
    "The last 30 days of cart reminders: checkouts left with an email, reminded, and bought after a reminder, with the amount won back.",
    z.object({}),
  ),
  tool(
    "wishlist_insights",
    "Shoppers' wishlists: how many, items saved, put in the cart and bought, and the most wished products.",
    z.object({}),
  ),
  tool(
    "list_emails",
    "The latest emails the store sent shoppers: what, to whom, and whether they went out.",
    z.object({ limit: limit(50, 15) }),
  ),
  tool(
    "subscription_boxes",
    "Subscription boxes: each delivery day, the round being packed with its orders, and the next cutoff.",
    z.object({}),
  ),
  tool(
    "add_order_note",
    "Adds a note to an order's history, for the store's staff only; the customer never sees it.",
    z.object({ order: orderRef, note: z.string().trim().min(1).max(1000) }),
  ),
  tool(
    "mark_order_sent",
    "Marks a paid order as sent with the parcel's carrier and tracking number, and emails the customer. Needs the owner's approval.",
    z.object({
      order: orderRef,
      carrier: z.string().trim().min(1).max(40).describe("The carrier, such as posten, bring, postnord, dhl, ups, other."),
      tracking_number: z.string().trim().max(100).default(""),
      notify: z.boolean().default(true).describe("Email the customer that it is on its way."),
    }),
    "send",
  ),
  tool(
    "cancel_booking",
    "Cancels a confirmed booking, freeing its time, and tells the customer by email if asked. Paying back is done from the order. Needs the owner's approval.",
    z.object({ booking: z.uuid("A booking is given by its id, from list_bookings."), notify: z.boolean().default(true) }),
    "send",
  ),
  tool(
    "archive_product",
    "Takes a product off the site (archive), or puts an archived one back. Needs the owner's approval.",
    z.object({ product: productRef, archived: z.boolean().default(true).describe("True takes it off; false puts it back.") }),
    "public",
  ),
  tool(
    "refund_order",
    "Refunds all or part of a paid order through Stripe, optionally putting its items back in stock, and emails the customer. Needs the owner's approval.",
    z.object({
      order: orderRef,
      amount: z.string().trim().max(30).optional().describe("How much to refund, as the owner writes it (such as 199 or 199,50); the whole refundable amount if left out."),
      reason: z.string().trim().min(1).max(500).describe("Why, for the order's history."),
      restock: z.boolean().default(true).describe("Put the order's items back in stock."),
      notify: z.boolean().default(true).describe("Email the customer about the refund."),
    }),
    "spend",
  ),
  tool(
    "create_discount",
    "Creates a discount code shoppers can use at once: a percentage off, or free shipping. Needs the owner's approval.",
    z.object({
      code: z.string().trim().min(3).max(40).describe("The code shoppers type, such as SUMMER20."),
      kind: z.enum(["percent", "free_shipping"]).default("percent"),
      percent: z.number().int().min(1).max(100).default(10).describe("How much off, for a percentage code."),
      ends_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day is written 2026-10-01.").optional().describe("The last day it works, as 2026-10-31."),
      usage_limit: z.number().int().min(1).max(1_000_000).optional().describe("How many times it can be used in all."),
      once_per_customer: z.boolean().default(false),
    }),
    "public",
  ),
  tool(
    "set_discount_active",
    "Switches a discount code off, or back on. Needs the owner's approval.",
    z.object({ code: z.string().trim().min(1).max(40), active: z.boolean() }),
    "public",
  ),
  tool(
    "unpublish_page",
    "Takes a published page or article off the site; its draft is kept. Needs the owner's approval.",
    z.object({ page: z.uuid("A page is given by its id, from list_pages."), type: z.enum(["page", "article"]).default("page") }),
    "public",
  ),
] as const satisfies readonly OwnerTool[];

export type OwnerToolName = (typeof OWNER_TOOLS)[number]["name"];
export type OwnerToolInput<N extends OwnerToolName> = z.output<Extract<(typeof OWNER_TOOLS)[number], { name: N }>["input"]>;

export const OWNER_TOOLS_BY_NAME: Record<string, OwnerTool> = Object.fromEntries(OWNER_TOOLS.map((t) => [t.name, t]));

/** A tool as the model is offered it: an OpenAI-compatible function. */
export function toolDefinition(t: OwnerTool): { name: string; description: string; parameters: Record<string, unknown> } {
  const schema = z.toJSONSchema(t.input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: t.name, description: t.description, parameters: schema };
}

/** The arguments the model gave, checked; the first problem in words otherwise. */
export function readToolInput(t: OwnerTool, raw: unknown): { ok: true; input: unknown } | { ok: false; problem: string } {
  const parsed = t.input.safeParse(raw ?? {});
  return parsed.success ? { ok: true, input: parsed.data } : { ok: false, problem: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
}

/** What a gate's category means to the owner. */
export const GATE_WORDS: Record<GateCategory, string> = {
  send: "Sends something in the store's name",
  public: "Changes what the site shows",
  spend: "Costs money",
};

/**
 * What a gated call will do, in words made from its arguments (never the
 * model's), shown on the approval the owner says yes or no to.
 */
export function approvalSummary(name: string, input: Record<string, unknown>): string {
  const text = (key: string) => String(input[key] ?? "");
  switch (name) {
    case "mark_order_sent":
      return `Mark order ${text("order")} as sent with ${text("carrier")}${text("tracking_number") ? `, tracking number ${text("tracking_number")}` : ""}${input.notify === false ? "" : ", and email the customer"}.`;
    case "cancel_booking":
      return `Cancel booking ${text("booking")}${input.notify === false ? "" : " and email the customer"}.`;
    case "archive_product":
      return input.archived === false ? `Put the product "${text("product")}" back as a draft.` : `Take the product "${text("product")}" off the site.`;
    case "unpublish_page":
      return `Take the ${input.type === "article" ? "article" : "page"} ${text("page")} off the site, keeping its draft.`;
    case "refund_order":
      return `Refund ${text("amount") || "everything left to refund"} on order ${text("order")} (${text("reason")})${input.restock === false ? "" : ", putting its items back in stock"}${input.notify === false ? "" : ", and email the customer"}.`;
    case "create_discount":
      return `Create the code ${text("code").toUpperCase()}: ${input.kind === "free_shipping" ? "free shipping" : `${text("percent") || "10"} % off`}${input.ends_at ? `, until ${text("ends_at")}` : ""}${input.usage_limit ? `, at most ${text("usage_limit")} uses` : ""}${input.once_per_customer ? ", once per customer" : ""}.`;
    case "set_discount_active":
      return `${input.active ? "Switch on" : "Switch off"} the code ${text("code").toUpperCase()}.`;
    case "approve_access_request":
      return `Approve ${text("request")}'s request: create the store at /s/${text("slug")} and email them a sign-in link.`;
    case "decline_access_request":
      return `Decline ${text("request")}'s request to open a store.`;
    default:
      return `Run ${name}.`;
  }
}
