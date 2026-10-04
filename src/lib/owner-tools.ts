import { z } from "zod";

import { AFFILIATE_COOKIE_DAYS_MAX, AFFILIATE_FRIEND_PERCENT_MAX } from "./affiliates";
import { BONUS_EXPIRY_MONTHS_MAX, BONUS_PENDING_DAYS_MAX, BONUS_REDEEM_PERCENT_MAX } from "./bonus";
import { adjustmentPhrase } from "./bonus-admin";
import { GOALS } from "./experiments";
import { SIMPLE_FIELD_TYPES, TOOL_FIELD_ENTITIES } from "./field-tools";
import { MAX_INSTRUCTIONS } from "./withdrawal";
import { approveSummary, declineSummary } from "./return-tools";

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
/** A return by its number (such as 1042-R1, as the queue shows it) or its id. */
const returnRef = z.string().trim().min(1).max(64).describe("The return's number, such as 1042-R1, or its id; an order number works when the order has one return.");
/** A privacy request by its id, as the log and `list_privacy_requests` give it. */
const privacyRequestRef = z.string().trim().min(8).max(64).describe("The privacy request's id, as list_privacy_requests gives it.");
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
    "list_returns",
    "The store's returns (D153), oldest first: customers' withdrawals from a purchase (their legal right to change their mind, which the store cannot refuse) and return requests inside the store's own longer window. Each has its number, kind, status, order, customer, units, when its refund is due and whether it is past the legal deadline; the answer also counts what waits: open, to answer, past the deadline, and acknowledgements not sent. `which` is open (the default), requested (waiting for an answer), overdue (past the refund deadline), or every status; `search` matches the return or order number, the name or the email. Read-only: the figures are the queue's own, never worked out by you.",
    z.object({
      which: z.enum(["open", "requested", "overdue", "approved", "in_transit", "received", "inspected", "closed", "declined", "cancelled", "all"]).default("open"),
      kind: z.enum(["all", "withdrawal", "return"]).default("all").describe("A withdrawal (the legal right) or a return request (the store's own window)."),
      search: z.string().trim().max(100).optional(),
      limit: limit(50, 15),
    }),
  ),
  tool(
    "explain_return",
    "One return in full, in words from the store's own data: what the customer asked for and why, each line with its decision and condition, where the return stands and what comes next, when the refund is due and whether it is overdue, what the refund would be now (worked out by the store, with its working) or what was refunded, and its history. It also says what can be done and where: approving or declining a return request can be done here (kept for the owner's approval); refunding and the other steps are done on the return's page. Repeat what it says and add nothing it did not give.",
    z.object({ return: returnRef }),
  ),
  tool(
    "list_privacy_requests",
    "The store's privacy requests (wave 1, GDPR): people asking for a copy of the data the store holds about them, or for it to be erased. The law gives one month from receipt to answer (extendable once, by up to two months, with reasons told within the first month). Each request has its id, kind, how it arrived, status, the day it was received, the day it is due and how many days are left or overdue; the answer also counts what waits: open, past the deadline, due within the week. It names no person: emails, notes and data are on the request's page. `which` is open (the default, soonest due first), overdue, due_soon (within seven days), answered, or all. Read-only: the dates are the log's own, never worked out by you. Exporting or erasing a person's data is not done here: it is done on their customer page, behind a confirmation.",
    z.object({
      which: z.enum(["open", "overdue", "due_soon", "answered", "all"]).default("open"),
      limit: limit(50, 15),
    }),
  ),
  tool(
    "explain_privacy_request",
    "One privacy request in words from the store's own log: what was asked, where it stands, the clock (received, due, days left or overdue, whether it was extended and until when), what can be done and where (download or erase on the customer's page, extend once, refuse with a reason, close as no data held), and for an answered request what was done, counted: how many rows of each kind were deleted, made anonymous, kept restricted or kept, and until when the kept accounts stay (the bookkeeping period). It never shows the person's name, email, notes or data. Repeat what it says and add nothing it did not give: no legal advice, no dates of your own.",
    z.object({ request: privacyRequestRef }),
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
    "One product: its texts in the main language, status, and each variant's SKU, price per country and stock. A variant with its content set (a pack's weight, volume or length) also gives that content and the price per kg, litre or metre in each country, as the store shows it.",
    z.object({ product: productRef }),
  ),
  tool(
    "unit_price_gaps",
    "The price per kg, litre or metre (unit price, D160) that shoppers see beside a price. Without `product`: the products that need their content set and still have an active variant without it (a product marked as sold by measure, or one in a category marked as needing a unit price), with the reason and the SKUs, and how many variants already have content. With `product`: each active variant's content and its unit price in each country, as the store shows it (with VAT, or without for businesses), or why none is shown. Read only and worked out by the store: repeat the figures and add no arithmetic. You cannot set a variant's content: the owner does that in the product editor, which refuses to save an active product that needs content and has none.",
    z.object({
      product: productRef.optional().describe("Leave out to list the products that need content; give one to see its variants' unit prices."),
      limit: limit(100, 25),
    }),
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
    "get_tax_profile",
    "The store's tax registration: whether it is registered for VAT and under which number, whether that number has been checked valid with VIES (and when), where goods are sent from, the OSS scheme and the IOSS number, intermediary and markets. Read only: a VAT number, a registration or a rate is changed by a person on the Tax page, never by the assistant.",
    z.object({}),
  ),
  tool(
    "tax_readiness",
    "What the store's VAT features need: for VAT registration, reverse charge for businesses in other EU countries, OSS and IOSS, whether each is on or off and what is missing, worked out in code, with the Tax page to fix it. Use it for 'can I sell VAT-free to a business in Germany' and 'why was this order charged VAT'.",
    z.object({}),
  ),
  tool(
    "list_invoices",
    "The store's own invoices and credit notes (D159), read only: each one's number, the day it was issued, its order, the VAT treatment, net, VAT and total in the order's currency, and whether a PDF is stored; the totals per currency are worked out in code. `which` is `invoices`, `credit_notes`, or `waiting`: paid orders still waiting for an invoice and refunds without a credit note (what is missing, and the page that fixes it). Buyers' names, addresses and emails are never given (open the order in the admin for those). Invoices are made by the store on payment, and credit notes from a refund that succeeded: you cannot make, change or send one. This is not tax or accounting advice.",
    z.object({
      which: z.enum(["invoices", "credit_notes", "waiting"]).default("invoices"),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day is written 2026-10-01.").optional().describe("The first day issued, as 2026-10-01 (the store's own day)."),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day is written 2026-10-01.").optional().describe("The last day issued, as 2026-10-31."),
      search: z.string().trim().max(60).optional().describe("A document number or an order number."),
      limit: limit(50, 20),
    }),
  ),
  tool(
    "invoice_readiness",
    "Whether the store can issue invoices (D159), worked out in code: whether invoicing is on, which of the seller's details an invoice needs are missing (legal name, address, organisation number, country, a VAT number when registered), whether the tax profile is saved, the two number series (prefix and next number, and whether they are locked by a first document), how many documents exist and how many orders wait, each with the page that fixes it. Read only: a person changes the invoicing settings and the numbering, never the assistant. This is not tax or accounting advice.",
    z.object({}),
  ),
  tool(
    "vat_report",
    "The store's VAT by delivery country and rate for a period (D161), read only and made from its own invoices and credit notes, never from orders: per country, VAT rate and basis (standard, reverse charge, exempt) the net, VAT and gross of the invoices, the credit notes, and the VAT after credits, in the invoice's currency and in the store's main currency (at the rate stored on each invoice), and where each sale is reported (the store's own return, OSS, IOSS, or why it is in no return). It also gives how it agrees with Finance's VAT, with every difference named, and how many paid orders have no document and are not in it. `period` is a named period, or give `from` and `to` (the first and last day). These are the owner's own figures for the owner's accountant: they are not a tax return and nothing is filed. You cannot make a file: the owner exports the CSV on the VAT page. Not tax or accounting advice.",
    z.object({
      period: z.enum(["last_month", "month", "last_quarter", "quarter", "last_year", "year"]).default("last_month").describe("The whole of last month, this month so far, the whole of last quarter, this quarter so far, last year, or this year so far (the store's own days)."),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day is written 2026-10-01.").optional().describe("The first day, as 2026-10-01; with `to` it replaces `period`."),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day is written 2026-10-31.").optional().describe("The last day included, as 2026-10-31; at most 800 days after `from`."),
    }),
  ),
  tool(
    "oss_return_data",
    "The data an OSS return (a quarter, `scheme` oss) or an IOSS return (a month, `scheme` ioss) asks for (D161), read only, made from the store's invoices and credit notes: for each Member State of consumption and rate the taxable amount and VAT in euro, corrections of earlier periods, the balance per Member State and the total, the euro rate used for each currency (the ECB's rate of the period's last day, or the owner's own with its reason), what is left out of the return and why, whether the store's registration fits its sales, and the deadline. `mode` filing is what a return holds (a later credit note is a correction of its sale's period); books counts every credit note in the period it was made. A return with a missing euro rate is incomplete and says which rate. The period is `2026-Q3` for oss or `2026-09` for ioss; leave it out for the last completed one. These are the owner's own figures for the owner's accountant: they are not a tax return, nothing is filed and you cannot make a file (the owner exports the CSV on the VAT page). Not tax or accounting advice.",
    z.object({
      scheme: z.enum(["oss", "ioss"]).default("oss").describe("oss: the Union scheme's quarter. ioss: the import scheme's month."),
      period: z.string().trim().max(10).optional().describe("The quarter such as 2026-Q3 (oss) or the month such as 2026-09 (ioss). Leave it out for the last completed one."),
      mode: z.enum(["filing", "books"]).default("filing").describe("filing: what the return holds. books: every credit note in the period it was made."),
    }),
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
    "analytics_overview",
    "The store's analytics for a period (D152), counted in code from paid orders: revenue, net revenue after refunds, orders, conversion rate, average order, gross profit and margin, new and returning customers, refund rate, visits and revenue per visit, each written out with its change against the previous period (or the same period last year). A figure that cannot be known is not given as zero: it says what is missing and where to add it (product costs, visit counting, fees). It also says how much of sales the profit figures rest on. Amounts are in the store's main currency without VAT. Use it for any question about how the store is doing in money terms; never add up or compare figures yourself.",
    z.object({
      period: z.enum(["7d", "30d", "month", "last_month", "year"]).default("30d").describe("The last 7 or 30 days (today included), this month so far, the whole of last month, or this year so far."),
      compare: z.enum(["previous", "year"]).default("previous").describe("What to compare with: the period just before it, or the same dates a year earlier."),
    }),
  ),
  tool(
    "explain_change",
    "Why revenue changed between a period and the one before it (or last year), worked out in code and never guessed: how much came from traffic, conversion and the average order (each one's part of the change), the device, channel, country and product that carry most of it, the day it began, and which analytics page to look at next. Revenue here is before refunds, without VAT. Repeat the sentences it gives and add no cause it did not find; when it says there is too little to explain, say so.",
    z.object({
      period: z.enum(["7d", "30d", "month", "last_month", "year"]).default("30d").describe("The period to explain: the last 7 or 30 days, this month so far, last month, or this year so far."),
      compare: z.enum(["previous", "year"]).default("previous").describe("What to compare with: the period just before it, or the same dates a year earlier."),
    }),
  ),
  tool(
    "analytics_alerts",
    "What needs a look in the store's analytics right now, most pressing first, worked out in code with a minimum volume for every rule so small numbers raise nothing: conversion falling, a day's revenue far under its weekday's usual, a product's refunds over twice its usual, a channel's cost per new customer up, stock running out, checkouts left unfinished, discounts creeping up, the month's target at risk, product costs missing, and good news. Each comes with its figures and the page to look at. An empty list means nothing needs a look.",
    z.object({}),
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
    "approve_return",
    "Approves a return request (a return inside the store's own window that waits for an answer) and emails the customer how to send the goods back. It cannot be used on a withdrawal: that is the customer's legal right and starts approved. Receiving, inspecting and refunding are done on the return's page, never here. Needs the owner's approval.",
    z.object({
      return: returnRef,
      instructions: z.string().trim().min(1).max(MAX_INSTRUCTIONS).optional().describe("What the customer should do to send it back, if it differs from the store's standing instructions; the store's own are used when left out."),
      note: z.string().trim().min(1).max(1000).optional().describe("A note kept with the approval."),
    }),
    "send",
  ),
  tool(
    "decline_return",
    "Declines a return request (a return inside the store's own window that waits for an answer) and emails the customer the reason. It can never be used on a withdrawal: the right of withdrawal is not the store's to refuse. Needs the owner's approval.",
    z.object({ return: returnRef, reason: z.string().trim().min(1).max(1000).describe("Why the return is declined, in plain words the customer is sent.") }),
    "send",
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
    "get_recommendations",
    "The store's product recommendations (upsells, cross-sells and complements picked for each shopper, shown in product grids that recommend, and used by the chat assistant): whether they are on, whether the store's AI re-ranks them, how much dearer than a product an upsell may be, the share of visitors who get the plain ranking, the monthly AI cap and what is used of it this month, the owner's pairing and exclusion rules, and what shoppers did over a period (visitors, shown, clicked, added to cart, revenue per currency) with the AI's order compared with the plain one, worked out by the store with its own significance test. Use it before set_recommendations or a rule change, and for any question about recommendations; never judge the comparison yourself.",
    z.object({ days: z.enum(["7", "30", "90"]).default("30").describe("The period the figures cover, in days.") }),
  ),
  tool(
    "set_recommendations",
    "Changes the store's recommendations: switches them on or off, lets the store's AI re-rank or not, sets the ceiling for upsells, the share of visitors who get the plain ranking (so the AI's order can be measured against it), and the monthly cap on the AI's tokens. Give only what changes. Recommendations only show where a content grid that recommends has been placed (page builder, content grid, Recommend products for each shopper), and on the chat assistant's suggestions. Needs the owner's approval.",
    z.object({
      enabled: z.boolean().optional().describe("True turns recommendations on, false off."),
      ai: z.boolean().optional().describe("Whether the store's text model may re-rank the best candidates; the plain ranking is always the fallback."),
      upsell_ceiling_percent: z.number().int().min(0).max(500).optional().describe("An upsell costs at most this much more than the product it is an upsell of, in percent."),
      holdout_percent: z.number().int().min(0).max(50).optional().describe("The share of visitors who get the plain ranking, 0 to 50."),
      monthly_token_cap_thousands: z.number().int().min(0).max(1_000_000).nullable().optional().describe("The most thousands of tokens the AI may use on recommendations in a calendar month; null for no cap."),
    }),
    "public",
  ),
  tool(
    "add_recommendation_rule",
    "Adds an owner's rule to the recommendations: `goes_with` (the other product is offered with the product, ahead of what the engine finds; `both` makes it work from the other product too), `never_with` (the two are never shown together) or `hide` (the product is never recommended anywhere). A rule already there is left as it is. Needs the owner's approval.",
    z.object({
      kind: z.enum(["goes_with", "never_with", "hide"]),
      product: productRef,
      other_product: productRef.optional().describe("The other product, for goes_with and never_with."),
      both: z.boolean().default(false).describe("For goes_with: also offer the product with the other one."),
    }),
    "public",
  ),
  tool(
    "remove_recommendation_rule",
    "Takes away an owner's rule from the recommendations, by its kind and products (both ways where both were made). Needs the owner's approval.",
    z.object({
      kind: z.enum(["goes_with", "never_with", "hide"]),
      product: productRef,
      other_product: productRef.optional().describe("The other product, for goes_with and never_with."),
    }),
    "public",
  ),
  tool(
    "check_recommendations",
    "Checks the recommendation engine against the store's past orders, worked out by the store: for its recent paid orders of two goods or more, one product is held back and the engine (the plain ranking, with that order left out of what it learns from, no AI) is asked what it would show a shopper who had looked at the others. Reports how often the product comes first, in the first four and in the first twelve, against showing the best sellers to everyone. It says nothing about what shoppers would click or about the AI's order: the live comparison in get_recommendations does.",
    z.object({}),
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
    "get_affiliate_program",
    "The store's referral program (signed-in customers share a link; a friend's first order gets a welcome discount and the customer who shared it earns bonus credits): whether it is on (it needs the bonus program), the friend's discount, what a referrer earns and for how many orders, the monthly limit, how long a link is remembered, the rules in plain words, and what it did lately (customers with a link, visits, orders through links, credits earned, credits usable and pending, orders that earned nothing). With `customer` (an email) it also gives that customer's link, friends and earnings, and who referred them. Use it before set_affiliate_program or block_affiliate and for any question about referrals or affiliates; never work out a figure yourself.",
    z.object({ customer: z.string().trim().min(3).max(200).optional().describe("A customer's email or id, to read their referrals too.") }),
  ),
  tool(
    "set_affiliate_program",
    "Changes the referral program: switches it on or off and sets the rules. Give only what changes; everything else stays as it is. It can be switched on only while the bonus program is on, because the reward is bonus credits (set_bonus_program first). Customers must be signed in; a friend gets the welcome discount only on their first paid order; nobody can refer themselves; existing credits are kept when it is turned off. This changes what shoppers are promised, so say the resulting rules back in plain words. Needs the owner's approval.",
    z.object({
      enabled: z.boolean().optional().describe("True turns the program on, false off."),
      friend_percent: z.number().int().min(0).max(AFFILIATE_FRIEND_PERCENT_MAX).optional().describe(`The friend's welcome discount on the goods of their first order, in whole percent, 0 for none, up to ${AFFILIATE_FRIEND_PERCENT_MAX}.`),
      friend_max: z.string().trim().max(30).nullable().optional().describe("The most the welcome discount takes off, as the owner writes it in the store's main currency (such as 100 or 99,50); null for no limit."),
      reward_percent: z.number().min(0).max(50).optional().describe("Bonus credits the referrer earns per 100 the friend pays online for goods, in percent with at most two decimals: 5 is 5%. 0 to 50."),
      reward_orders: z.number().int().min(1).max(100).nullable().optional().describe("How many of the friend's paid orders earn the referrer credits (1 is only the first); null for every order."),
      monthly_cap: z.string().trim().max(30).nullable().optional().describe("The most one referrer can earn in a calendar month, as the owner writes it in the store's main currency; null for no limit."),
      cookie_days: z.number().int().min(1).max(AFFILIATE_COOKIE_DAYS_MAX).optional().describe(`Days a visitor's link is remembered once they allow marketing cookies, 1 to ${AFFILIATE_COOKIE_DAYS_MAX}.`),
    }),
    "public",
  ),
  tool(
    "block_affiliate",
    "Stops one customer earning referral credits, or lets them earn again, with a reason that the audit log keeps: for abuse such as referring themselves with another account. What they have already earned stays; their pending friends' orders earn nothing once paid while they are blocked. The customer needs a link (they get one when they open Refer a friend). Unblocking lets them earn credits, which the store pays as price reductions, so it needs the owner's approval like blocking does.",
    z.object({
      customer: z.string().trim().min(3).max(200).describe("The customer's email (from list_customers) or id."),
      blocked: z.boolean().describe("True blocks them, false lets them earn again."),
      reason: z.string().trim().min(3).max(200).describe("Why, kept in the audit log; staff see it."),
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
    "list_experiments",
    "The store's A/B tests (the same thing shown to visitors in two versions, to see which works better): name, status (draft, scheduled, running, stopped, winner applied, discarded), what is tested (a page, a row or component of it, the header, the footer or a product layout), what it should improve, versions, visitors counted and, for a test that has run, the verdict in words worked out by the store. Use it before explain_results, start_experiment, stop_experiment or apply_winner, to find a test by its name.",
    z.object({ limit: limit(30, 15) }),
  ),
  tool(
    "explain_results",
    "What one A/B test found, worked out by the store in code: its verdict in plain words (too few visitors, too early, one version is better, the original is better, no clear difference, or something wrong with the split), each version's visitors and rate or revenue per visitor against the original with the chance it is better, the steps visitors took, revenue without VAT, how many days it has run, and what can be done next. Explain it in the owner's words and language; never give a verdict of your own or call a winner the verdict does not.",
    z.object({ experiment: z.string().trim().min(1).max(200).describe("The test's name or id, from list_experiments.") }),
  ),
  tool(
    "suggest_experiments",
    "Facts for choosing what to A/B test, all counted by the store: the pages, header, footer and product layouts that can be tested with what is on each (the headings, buttons and texts and their block ids), what was tested on them before and how it came out, how much of the store's visitors accepted statistics cookies (only they take part), orders and the way from cart to paid order over the last 30 days, and how many tests are running of the five allowed. Pick at most three things worth testing, say why in the owner's words, and say that nothing is started without their yes. Optionally give visitors a day and the share who do the thing now to get how long a test would take, worked out by the store; Kaizen does not count page views, so never guess these.",
    z.object({
      visitors_per_day: z.number().int().min(1).max(10_000_000).optional().describe("Roughly how many visitors a day see the page and accept cookies, if the owner knows."),
      current_rate_percent: z.number().min(0.01).max(99).optional().describe("The share (%) of those who do the thing the test should improve today, if the owner knows."),
      change_percent: z.number().int().min(5).max(200).default(20).describe("The relative change worth finding, in %."),
    }),
  ),
  tool(
    "draft_experiment",
    "Makes a DRAFT A/B test: a copy of a page, the header, the footer or a product layout as version B, with the words you give put into its headings, buttons or texts. Nothing is shown to visitors until it is started (start_experiment, which needs the owner's approval). Give the new words for blocks listed by suggest_experiments (block ids); one changed block makes a test of that block only, several a test of the whole page; no changes makes an unchanged copy the owner edits in the page builder. Write words the store can stand behind: no prices, stock, urgency, 'best' or green claims; they are checked. Choose one thing to improve.",
    z.object({
      target: z.string().trim().min(1).max(200).describe("What to test: a page's address (slug) or id, `header`, `footer`, or a product layout's title, as listed by suggest_experiments."),
      goal: z.enum(GOALS).describe("What should get better: orders, revenue (per visitor), cart (added to the cart), checkout (reached checkout) or click (on a button, named in `button`) or form (a form sent, named in `form`)."),
      button: z.string().trim().max(100).optional().describe("For the goal click: the text of the button whose clicks count (as it is now)."),
      form: z.string().trim().max(100).optional().describe("For the goal form: the text on the send button of the email form or newsletter sign-up whose answers count (as it is now); left out when the page has only one."),
      changes: z
        .array(z.object({ block: z.string().trim().min(1).max(64).describe("The block's id from suggest_experiments."), text: z.string().trim().min(1).max(2000).describe("The new words: one line for a heading or button, paragraphs for a text.") }))
        .max(6)
        .default([]),
      name: z.string().trim().max(120).optional(),
      hypothesis: z.string().trim().max(500).optional().describe("What you expect and why, in a sentence."),
      traffic_percent: z.number().int().min(1).max(100).default(100).describe("The share of visitors in the test."),
    }),
  ),
  tool(
    "start_experiment",
    "Starts a draft A/B test, now: visitors who accepted statistics cookies are split between the versions from their next page view. The store checks it can start (a version that is still the original, an unpublished page and the like are refused with the reason). It runs at least 14 days before it says anything, and can be stopped at any time. Needs the owner's approval.",
    z.object({ experiment: z.string().trim().min(1).max(200).describe("The test's name or id, from list_experiments.") }),
    "public",
  ),
  tool(
    "stop_experiment",
    "Stops a running A/B test: everyone sees the original again, and what was counted is kept. Needs the owner's approval.",
    z.object({ experiment: z.string().trim().min(1).max(200).describe("The test's name or id, from list_experiments.") }),
    "public",
  ),
  tool(
    "apply_winner",
    "Ends an A/B test by choosing: a version replaces the page (or the part, header, footer or layout) at once, with the address kept, or `original` keeps what is there. A running test is stopped first. Only after the owner has seen the results (explain_results); never choose a version the verdict does not support unless they say so. Needs the owner's approval.",
    z.object({
      experiment: z.string().trim().min(1).max(200).describe("The test's name or id, from list_experiments."),
      version: z.enum(["b", "c", "d", "original"]).describe("The version to use, or `original` to keep what is there."),
    }),
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
    case "approve_return":
      return approveSummary(text("return"), text("instructions") || null);
    case "decline_return":
      return declineSummary(text("return"), text("reason"));
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
    case "set_recommendations": {
      const parts = [
        input.enabled === true ? "switch the recommendations on" : input.enabled === false ? "switch the recommendations off" : "",
        input.ai === true ? "let the store's AI re-rank them" : input.ai === false ? "keep the AI out of them" : "",
        input.upsell_ceiling_percent !== undefined ? `an upsell costs at most ${text("upsell_ceiling_percent")} % more than its product` : "",
        input.holdout_percent !== undefined ? `${text("holdout_percent")} % of visitors get the plain ranking` : "",
        input.monthly_token_cap_thousands === null ? "no monthly cap on the AI" : input.monthly_token_cap_thousands !== undefined ? `the AI may use at most ${text("monthly_token_cap_thousands")} thousand tokens a month` : "",
      ].filter(Boolean);
      return `Change the recommendations: ${parts.join("; ") || "no change"}.`;
    }
    case "add_recommendation_rule":
      return input.kind === "hide"
        ? `Never recommend "${text("product")}".`
        : input.kind === "never_with"
          ? `Never show "${text("product")}" together with "${text("other_product")}".`
          : `Offer "${text("other_product")}" with "${text("product")}"${input.both ? " and the other way round" : ""}.`;
    case "remove_recommendation_rule":
      return input.kind === "hide"
        ? `Let "${text("product")}" be recommended again.`
        : `Take away the rule that "${text("product")}" ${input.kind === "never_with" ? "is never shown with" : "goes with"} "${text("other_product")}".`;
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
    case "set_affiliate_program": {
      const parts = [
        input.enabled === true ? "switch the referral program on" : input.enabled === false ? "switch the referral program off" : "",
        input.friend_percent !== undefined ? `friend's welcome discount ${text("friend_percent")} %` : "",
        input.friend_max === null ? "no limit on the welcome discount" : input.friend_max !== undefined ? `welcome discount at most ${text("friend_max")}` : "",
        input.reward_percent !== undefined ? `referrer earns ${text("reward_percent")} % in bonus credits` : "",
        input.reward_orders === null ? "credits for every order of the friend" : input.reward_orders !== undefined ? `credits for the friend's first ${text("reward_orders")} order${input.reward_orders === 1 ? "" : "s"}` : "",
        input.monthly_cap === null ? "no monthly limit per referrer" : input.monthly_cap !== undefined ? `at most ${text("monthly_cap")} a month per referrer` : "",
        input.cookie_days !== undefined ? `a link is remembered ${text("cookie_days")} days` : "",
      ].filter(Boolean);
      return `Change the referral program: ${parts.join("; ") || "no change"}.`;
    }
    case "block_affiliate":
      return `${input.blocked === false ? "Let" : "Stop"} ${text("customer")} ${input.blocked === false ? "earn" : "earning"} referral credits (${text("reason")}).`;
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
    case "start_experiment":
      return `Start the A/B test "${text("experiment")}": visitors who accepted statistics cookies are shown the versions from their next page view.`;
    case "stop_experiment":
      return `Stop the A/B test "${text("experiment")}": everyone sees the original again.`;
    case "apply_winner":
      return input.version === "original" ? `End the A/B test "${text("experiment")}" and keep the original.` : `End the A/B test "${text("experiment")}" and make version ${text("version").toUpperCase()} the page, the part or the layout under test.`;
    case "email_customer":
      return `Email ${text("to")}: "${text("subject")}"\n\n${text("message")}`;
    case "resend_order_email":
      return `Send the ${input.which === "shipped" ? "shipping notice" : "order confirmation"} for order ${text("order")} to its customer again.`;
    case "set_stock":
      return `Set the stock of ${text("sku")} to ${text("quantity")}.`;
    case "post_to_slack":
      return `Post to the store's Slack channel: "${text("message")}"`;
    case "set_referral_program": {
      const parts = [
        input.enabled === true ? "switch the referral program on" : input.enabled === false ? "switch the referral program off" : "",
        input.percent !== undefined ? `commission ${text("percent")} % of the fees a referred store pays Kaizen` : "",
        input.months !== undefined ? `earned for ${text("months")} months after a store opens` : "",
        input.pending_days !== undefined ? `credit waits ${text("pending_days")} days before it can be used` : "",
        input.cookie_days !== undefined ? `the referral cookie lasts ${text("cookie_days")} days` : "",
      ].filter(Boolean);
      return `Change the referral program: ${parts.join("; ") || "no change"}.`;
    }
    case "approve_access_request":
      return `Approve ${text("request")}'s request: create the store at /s/${text("slug")} and email them a sign-in link.`;
    case "decline_access_request":
      return `Decline ${text("request")}'s request to open a store.`;
    default:
      return `Run ${name}.`;
  }
}
