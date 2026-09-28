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

const tool = <N extends string, I extends z.ZodType>(name: N, description: string, input: I, gate?: GateCategory): OwnerTool<I, N> => ({
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
    default:
      return `Run ${name}.`;
  }
}
