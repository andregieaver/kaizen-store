import { z } from "zod";

import { BONUS_EXPIRY_MONTHS_MAX, BONUS_PENDING_DAYS_MAX, BONUS_REDEEM_PERCENT_MAX } from "./bonus";
import { adjustmentPhrase } from "./bonus-admin";
import { SIMPLE_FIELD_TYPES, TOOL_FIELD_ENTITIES } from "./field-tools";

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
const fieldEntity = z.enum(TOOL_FIELD_ENTITIES).describe("What the fields are on: a product, a page, a blog article, or the store itself (its own site-wide fields such as opening hours or a brand story).");
const fieldThing = z.string().trim().min(1).max(200).describe("The product's id, handle or title, or the page's or article's id or address (slug). Leave it out for the store itself.");
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
    "list_campaigns",
    "The store's campaigns (offers without a code): name, what each gives (a percentage off, 3 for 2, a free product over an amount), what it applies to, when it runs, its limits, how many orders got it and what it has given.",
    z.object({}),
  ),
  tool(
    "list_field_groups",
    "The store's custom field groups (extra fields such as a size guide, ingredients or a warranty): name, what each group is on (products, pages, articles or the store itself), where it applies in words, whether it is on, and each field's label, name, type, whether it is required, whether it shows on the site (public) or only for staff (private), and its choices. Use it before get_fields, set_fields or create_field_group.",
    z.object({}),
  ),
  tool(
    "get_fields",
    "The custom fields that apply to one product, page or article (or to the store itself: entity store, no item), with what is entered in each (short readable text, in the store's main language; long text is cut). Fields that do not apply to it are left out. Use it to answer what a product's material, size guide or warranty says, or before changing it.",
    z.object({ entity: fieldEntity, item: fieldThing.optional() }),
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
    "customer_insights",
    "How customers buy: how many come back, new and returning customers in the period, average order, time between orders, the best customers, and customers at risk of not coming back (with their emails, for a win-back).",
    z.object({ days: z.number().int().min(7).max(730).default(90).describe("The period for new and returning customers and the average order.") }),
  ),
  tool(
    "product_performance",
    "Each product's sales in a period: units, orders and takings, how often it was wished for and opened from search, its stock, and products in stock that did not sell.",
    z.object({ days: z.number().int().min(1).max(365).default(30) }),
  ),
  tool(
    "sales_trend",
    "Paid orders and takings per day, week or month, with the change from the one before (worked out in code).",
    z.object({
      period: z.enum(["day", "week", "month"]).default("week"),
      count: z.number().int().min(2).max(24).default(8).describe("How many days, weeks or months back, the current one included."),
    }),
  ),
  tool(
    "sales_funnel",
    "From cart to paid order in a period: carts, checkouts started and left, orders placed and paid, carts won back by reminders, and searches that found nothing or led nowhere. Product views are not tracked.",
    z.object({ days: z.number().int().min(1).max(365).default(30) }),
  ),
  tool(
    "restock_suggestions",
    "What to reorder: each shipped product's sales per day, the days its stock lasts, and how many to order to cover the days asked for plus the supplier's delivery time. Worked out in code from paid orders.",
    z.object({
      days: z.number().int().min(7).max(365).default(30).describe("The sales period the pace is taken from."),
      cover_days: z.number().int().min(1).max(365).default(30).describe("How many days the new stock should last."),
      lead_days: z.number().int().min(0).max(120).default(7).describe("Days from ordering until the goods arrive."),
    }),
  ),
  tool(
    "list_integrations",
    "The store's connected services (Zapier, Make and Slack): which events each gets, and whether deliveries have failed lately.",
    z.object({}),
  ),
  tool(
    "ai_usage",
    "How much of the AI the store used in a period: requests and tokens in total, per provider and model, per feature (such as the AI manager or the chat agent) and, for all their stores, per store; and whether it ran on Kaizen's AI or the owner's own key.",
    z.object({
      days: z.number().int().min(1).max(365).default(30),
      scope: z.enum(["this_store", "all_my_stores"]).default("this_store").describe("Only this store, or every store the owner owns."),
    }),
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
    "create_campaign",
    "Creates a campaign, an offer that needs no code, for a time: a percentage off, buy N pay for M (3 for 2), or a free product when the basket comes to an amount. For the whole store, or only the products, categories or tags named. It takes money off goods bought once, before customer groups' discounts and codes. Needs the owner's approval.",
    z.object({
      name: z.string().trim().min(1).max(80).describe("What shoppers see in the cart: \"Summer sale\", \"3 for 2 on mugs\"."),
      kind: z.enum(["percent", "multi_buy", "gift"]),
      percent: z.number().int().min(1).max(100).optional().describe("How much off, for a percentage."),
      buy_quantity: z.number().int().min(2).max(20).optional().describe("How many the shopper buys, for multi_buy: 3 in 3 for 2."),
      pay_quantity: z.number().int().min(1).max(19).optional().describe("How many they pay for, for multi_buy: 2 in 3 for 2."),
      gift_sku: z.string().trim().min(1).max(100).optional().describe("The SKU of the free product, for a gift: goods the store ships."),
      gift_quantity: z.number().int().min(1).max(5).default(1),
      amount: z.string().trim().max(30).optional().describe("What the basket must come to for a gift, in the store's main country's currency, such as 500."),
      products: z.array(productRef).max(50).optional().describe("Only these products; leave out with categories and tags for the whole store."),
      categories: z.array(z.string().trim().min(1).max(80)).max(20).optional().describe("Product categories by name; their subcategories are included."),
      tags: z.array(z.string().trim().min(1).max(80)).max(20).optional().describe("Product tags by name."),
      customer_groups: z.array(z.string().trim().min(1).max(80)).max(20).optional().describe("Only customers in these customer groups, by name."),
      starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day is written 2026-10-01.").optional().describe("The first day, as 2026-10-01; from now unless given."),
      ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day is written 2026-10-01.").optional().describe("The last day, as 2026-10-31."),
      usage_limit: z.number().int().min(1).max(1_000_000).optional().describe("How many orders it can go to in all."),
      per_customer_limit: z.number().int().min(1).max(1000).optional().describe("How many orders one customer can get it on; 1 for once per customer. Customers must be signed in."),
      countries: z.array(z.string().trim().min(1).max(60)).max(30).optional().describe("Only in these countries, by name or country code such as NO; leave out for all the store's countries."),
      stacks: z.boolean().default(false).describe("For a percentage or 3 for 2: also apply on top of other campaigns, on what they left."),
    }),
    "public",
  ),
  tool(
    "set_campaign_active",
    "Switches a campaign off, or back on, by its name. Needs the owner's approval.",
    z.object({ campaign: z.string().trim().min(1).max(80), active: z.boolean() }),
    "public",
  ),
  tool(
    "get_bonus_program",
    "The store's bonus program (credits that signed-in customers earn on what they pay and use on a later order): whether it is on, how much customers earn back, the wait before credits can be used, the most of an order they can pay, the least to use, whether credits expire, the rules in plain words, and what the store owes (credits outstanding and pending, earned, used and expired in the last 30 days). With `customer` (an email) it also gives that customer's balance and latest history. Use it before set_bonus_program or adjust_customer_credits, and for any question about credits or loyalty; never work out a balance yourself.",
    z.object({ customer: z.string().trim().min(3).max(200).optional().describe("A customer's email, to read their credits too.") }),
  ),
  tool(
    "set_bonus_program",
    "Changes the bonus program: switches it on or off and sets the rules. Give only what changes; everything else stays as it is. Customers must be signed in to earn or use credits; existing customers start at zero; turning it off keeps balances. This changes what shoppers are promised, so say the resulting rules back in plain words. Needs the owner's approval.",
    z.object({
      enabled: z.boolean().optional().describe("True turns the program on, false off."),
      percent_back: z.number().min(0).max(50).optional().describe("Credits earned per 100 paid for goods online, in percent with at most two decimals: 5 is 5%. 0 to 50."),
      wait_days: z.number().int().min(0).max(BONUS_PENDING_DAYS_MAX).optional().describe(`Days after an order is paid before its credits can be used (the return period), 0 to ${BONUS_PENDING_DAYS_MAX}.`),
      max_percent_of_order: z.number().int().min(1).max(BONUS_REDEEM_PERCENT_MAX).optional().describe(`The most of an order's goods credits may pay, in percent, 1 to ${BONUS_REDEEM_PERCENT_MAX}.`),
      min_credits_to_use: z.string().trim().max(30).optional().describe("The least credits a customer can use at once, as the owner writes it in the store's main currency (such as 50 or 49,50); 0 for no minimum."),
      expires_after_months: z.number().int().min(1).max(BONUS_EXPIRY_MONTHS_MAX).nullable().optional().describe("Months after which unused credits expire (oldest first, with a reminder email); null so they never expire."),
    }),
    "public",
  ),
  tool(
    "adjust_customer_credits",
    "Adds bonus credits to one customer, or takes some away, with a reason that stays in their history: a goodwill gesture, a correction. Only customers with an account have credits. The amount is in the store's main currency, written as the owner writes it: 50 adds 50, -20 takes 20 away; credits never go below zero. Needs the owner's approval.",
    z.object({
      customer: z.string().trim().min(3).max(200).describe("The customer's email (from list_customers) or id."),
      amount: z.string().trim().min(1).max(30).describe("What to add (50) or take away (-20), in the store's main currency."),
      reason: z.string().trim().min(3).max(200).describe("Why, for the customer's history; staff see it."),
    }),
    "spend",
  ),
  tool(
    "create_field_group",
    "Makes a group of custom fields for products, pages, articles or the store itself, on every one of that kind: a name and its fields, each with a label, a type, and choices for select, radio, button group and checkbox types. Fields are private (only staff see them) unless you set access public because the owner wants them on the site; the site then shows them through the product layout's Custom fields component (the standard product page shows public groups after the description). Only plain types can be made here: pictures, files, links, things that point at products or pages, groups and repeaters are made in the admin editor. Needs the owner's approval.",
    z.object({
      name: z.string().trim().min(1).max(80).describe("The group's name, such as Specifications or Size guide."),
      entity: fieldEntity.default("product"),
      fields: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(80).describe("What the field is called, such as Material."),
            type: z.enum(SIMPLE_FIELD_TYPES).default("text").describe("text, textarea (several lines), richText, number, measurement (a number with a unit), email, url, phone, select, radio, buttons, checkbox (several of a list), boolean (yes or no), date, datetime, time or color."),
            required: z.boolean().default(false).describe("Products need it filled in before they are published."),
            options: z.array(z.string().trim().min(1).max(80)).max(100).optional().describe("The choices, for select, radio, buttons and checkbox."),
            units: z.array(z.string().trim().min(1).max(12)).max(20).optional().describe("The units to choose from, for a measurement: g and kg."),
            access: z.enum(["private", "public"]).default("private").describe("private: only staff; public: shown on the site. Public only if the owner said it should show."),
          }),
        )
        .min(1)
        .max(30),
    }),
    "public",
  ),
  tool(
    "set_fields",
    "Fills in, changes or clears (null) custom fields on one product, page or article, or on the store itself (entity store, no item), by the fields' names from get_fields or list_field_groups. Plain types only: text, numbers, yes or no, choices (by their label), dates and the like; text is written in the store's main language and must not carry claims the store cannot back. Pictures, files, links, groups and repeaters are changed in the admin editor. What changes shows on the site if the field is public. Needs the owner's approval.",
    z.object({
      entity: fieldEntity,
      item: fieldThing.optional(),
      values: z
        .record(
          z.string().trim().min(1).max(80),
          z.union([z.string().max(8000), z.number(), z.boolean(), z.array(z.string().max(200)).max(100), z.null()]),
        )
        .describe("The field's name (or label) to its new value; a checkbox field takes a list of choices, a yes-or-no field true or false, null clears the field."),
    }),
    "public",
  ),
  tool(
    "email_customer",
    "Emails one customer of the store, in the store's name, with a subject and a message you write with the owner (replies go to the store's contact email). Plain text; no prices, stock or promises the tools did not give. Needs the owner's approval.",
    z.object({
      to: z.string().trim().min(1).max(200).describe("The customer's email, or an order number to write to its customer."),
      subject: z.string().trim().min(1).max(150),
      message: z.string().trim().min(1).max(3000).describe("The email's text, in the customer's language, signed as the store."),
    }),
    "send",
  ),
  tool(
    "resend_order_email",
    "Sends a customer their order confirmation, or the latest shipping notice with its tracking, again. Needs the owner's approval.",
    z.object({ order: orderRef, which: z.enum(["confirmation", "shipped"]).default("confirmation") }),
    "send",
  ),
  tool(
    "set_stock",
    "Sets how many of a variant are in stock, by its SKU (from get_product or restock_suggestions), such as after a delivery from a supplier. Needs the owner's approval.",
    z.object({
      sku: z.string().trim().min(1).max(100),
      quantity: z.number().int().min(0).max(1_000_000).describe("The new number in stock, not the number to add."),
    }),
    "public",
  ),
  tool(
    "post_to_slack",
    "Posts a message to the store's Slack channel (connected under Integrations), such as a note to the team. Never customers' emails, phones or addresses. Needs the owner's approval.",
    z.object({ message: z.string().trim().min(1).max(2000) }),
    "send",
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
    case "create_campaign": {
      const gives =
        input.kind === "multi_buy"
          ? `${text("buy_quantity")} for ${text("pay_quantity")}`
          : input.kind === "gift"
            ? `a free product (${text("gift_sku")}) when the basket comes to ${text("amount")}`
            : `${text("percent")} % off`;
      const list = (key: string) => (Array.isArray(input[key]) ? (input[key] as unknown[]).map(String).join(", ") : "");
      const reach = [list("products") && `products ${list("products")}`, list("categories") && `categories ${list("categories")}`, list("tags") && `tags ${list("tags")}`].filter(Boolean).join("; ");
      return `Create the campaign "${text("name")}": ${gives}, ${reach || "for the whole store"}${input.starts_on ? `, from ${text("starts_on")}` : ""}${input.ends_on ? `, until ${text("ends_on")}` : ""}${list("customer_groups") ? `, only for the customer groups ${list("customer_groups")}` : ""}${input.usage_limit ? `, at most ${text("usage_limit")} orders` : ""}${input.per_customer_limit ? `, ${text("per_customer_limit")} per customer` : ""}${list("countries") ? `, only in ${list("countries")}` : ""}${input.stacks ? ", on top of other campaigns" : ""}.`;
    }
    case "set_campaign_active":
      return `${input.active ? "Switch on" : "Switch off"} the campaign "${text("campaign")}".`;
    case "set_bonus_program": {
      const parts = [
        input.enabled === true ? "switch the bonus program on" : input.enabled === false ? "switch the bonus program off" : "",
        input.percent_back !== undefined ? `credits back ${text("percent_back")} %` : "",
        input.wait_days !== undefined ? `wait ${text("wait_days")} days before credits can be used` : "",
        input.max_percent_of_order !== undefined ? `credits can pay at most ${text("max_percent_of_order")} % of an order's goods` : "",
        input.min_credits_to_use !== undefined ? `least to use ${text("min_credits_to_use")}` : "",
        input.expires_after_months === null ? "credits never expire" : input.expires_after_months !== undefined ? `credits expire after ${text("expires_after_months")} months` : "",
      ].filter(Boolean);
      const sentence = parts.join("; ");
      return `Change the bonus program: ${sentence || "no change"}.`;
    }
    case "adjust_customer_credits":
      return `${adjustmentPhrase(text("amount"), text("customer"))} (${text("reason")}).`;
    case "create_field_group": {
      const fields = Array.isArray(input.fields) ? (input.fields as { label?: unknown; type?: unknown; access?: unknown }[]) : [];
      const list = fields.map((f) => `${String(f.label)} (${String(f.type ?? "text")}${f.access === "public" ? ", shown on the site" : ""})`).join(", ");
      const on = { product: "products", page: "pages", article: "articles", store: "the store" }[String(input.entity ?? "product")] ?? "products";
      return `Create the custom field group "${text("name")}" for ${on}: ${list}.`;
    }
    case "set_fields": {
      const values = typeof input.values === "object" && input.values !== null ? Object.entries(input.values as Record<string, unknown>) : [];
      const show = (v: unknown) => (v === null ? "cleared" : Array.isArray(v) ? `"${v.join(", ")}"` : typeof v === "string" ? `"${v.length > 200 ? `${v.slice(0, 199)}…` : v}"` : String(v));
      return `Set the custom fields of ${input.entity === "store" ? "the store" : `the ${text("entity") || "product"} "${text("item")}"`}: ${values.map(([name, v]) => `${name} ${v === null ? "" : "= "}${show(v)}`).join("; ")}.`;
    }
    case "email_customer":
      return `Email ${text("to")}: "${text("subject")}"\n\n${text("message")}`;
    case "resend_order_email":
      return `Send the ${input.which === "shipped" ? "shipping notice" : "order confirmation"} for order ${text("order")} to its customer again.`;
    case "set_stock":
      return `Set the stock of ${text("sku")} to ${text("quantity")}.`;
    case "post_to_slack":
      return `Post to the store's Slack channel: "${text("message")}"`;
    case "approve_access_request":
      return `Approve ${text("request")}'s request: create the store at /s/${text("slug")} and email them a sign-in link.`;
    case "decline_access_request":
      return `Decline ${text("request")}'s request to open a store.`;
    default:
      return `Run ${name}.`;
  }
}
