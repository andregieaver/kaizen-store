import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { bookingWhen } from "@/lib/booking-text";
import { isSafeAddress } from "@/lib/field-parts";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { selfServiceOpen } from "@/lib/pay-later";
import { marketPath } from "@/lib/paths";
import { featureOn, type FeatureId } from "@/lib/store-features";
import { exchangeStateWords, SUPPORT_TOOLS, type SupportTool, type ToolNeeds } from "@/lib/support-tools";
import type { SupportChip } from "@/lib/support-visitor";

import type { ToolDefinition } from "./ai";
import { shopperBonus } from "./bonus";
import type { ChatSite, SupportToolOutcome, SupportToolSet } from "./chat-agent";
import { listCustomerOrders, listCustomerSubscriptions, ownsOrder } from "./customers";
import { findUsableDiscount } from "./discounts";
import { shopperFulfilment } from "./fulfilment";
import { getOrderDocuments } from "./invoices";
import { getOrder } from "./orders";
import { listOrderReturns } from "./returns";
import { getStandingOrder } from "./standing-orders";
import { allowedChanges, getSubscription } from "./subscriptions";
import type { DeskSettings } from "./support";
import { allowedKinds, proposeAction, requestStaffAction } from "./support-actions";
import type { Desk } from "./support-desk";
import { lookupWithdrawableOrder } from "./withdrawals";

type Row = Record<string, unknown>;
type StoreSite = Extract<ChatSite, { kind: "store" }>;

/**
 * The first line's tools for a store's desk with the AI first (D216, `docs/support.md` 4.3a, step 9): reading a signed-in customer's
 * own orders, parcels, returns, bookings, subscriptions, subscription boxes and bonus credits, and checking a discount code, through the
 * same readers the customer's own pages use. Every tool's `needs` is checked here, before its handler runs and whatever the model
 * offered; an order is found only among the customer's own (another customer's is "not found", as one that does not exist). Amounts
 * are written by code in the order's or the credits' own currency (`formatMoney`), links are made by code and passed
 * `isSafeAddress()`. Nothing here changes anything: a proposal only keeps an action for the customer's Confirm, and a request one for
 * a person (`src/server/support-actions.ts`, step 10).
 */

/** The customer the conversation is for: signed in on this browser and the conversation's own (a different signed-in customer is none). */
export type SupportCustomer = { id: string; email: string } | null;

export type SupportToolContext = {
  site: StoreSite;
  settings: DeskSettings;
  customer: SupportCustomer;
  desk: Desk;
  conversationId: string;
  /** A conversation by email (D332): no sign-in card, email form or Confirm button there, and nobody signed in. */
  email?: boolean;
};

/** What an email has no place for (D332): the sign-in card, the email form and the Confirm button. */
const NOT_BY_EMAIL = new Set(["ask_to_sign_in", "ask_for_email", "propose_action"]);

/** The first line's tools (`handoff_to_human` is the chat's own): the read-only ones (step 9), proposals and staff requests (step 10). */
const FIRST_LINE_TOOLS = new Set([
  "ask_to_sign_in",
  "ask_for_email",
  "my_orders",
  "order_details",
  "return_options",
  "my_bookings",
  "my_subscriptions",
  "my_boxes",
  "bonus_balance",
  "check_code",
  "propose_action",
  "request_staff_action",
]);

/** At most this many orders, bookings or subscriptions in one answer. */
const LIST_MAX = 10;

const json = (value: unknown) => JSON.stringify(value).slice(0, 6000);
const refuse = (error: string, note: string): SupportToolOutcome => ({ result: json({ error, note }) });

const NOT_SIGNED_IN = refuse("not_signed_in", "The visitor is not signed in. Call ask_to_sign_in so they can sign in, then try again. Never ask them for an email or order details in the chat.");
const NOT_FOUND = refuse("not_found", "The signed-in customer has no order with that number. Ask them to check the number; never guess.");

/** What the needs are checked against, worked out once per turn (whether the customer has orders only when a tool asks). */
type Facts = { shopOn: boolean; signedIn: boolean; emailFollowup: boolean; hasOrders: () => Promise<boolean>; features: (ids: readonly string[]) => boolean };

function factsOf(ctx: SupportToolContext): Facts {
  let orders: Promise<boolean> | null = null;
  return {
    shopOn: featureOn(ctx.site.store, "shop"),
    signedIn: ctx.customer !== null,
    emailFollowup: ctx.settings.emailFollowup,
    hasOrders: () =>
      (orders ??= ctx.customer ? listCustomerOrders(ctx.site.store.id, ctx.customer.id).then((list) => list.length > 0) : Promise.resolve(false)),
    features: (ids) => ids.some((id) => featureOn(ctx.site.store, id as FeatureId)),
  };
}

/**
 * Whether a tool may be offered (`offer`) or run: the shop on (or, for after-sale help, a signed-in customer with orders), the desk
 * taking emails, a feature on (or, signed in, the customer may already have such things, which the handler reads). Being signed in
 * is not needed to be offered: the handler then says so, and the model asks the customer to sign in.
 */
async function needsMet(needs: ToolNeeds, facts: Facts, run: boolean): Promise<boolean> {
  if (needs.shop && !facts.shopOn) return false;
  if (needs.shopOrAfterSale && !facts.shopOn && !(await facts.hasOrders())) return false;
  if (needs.emailFollowup && !facts.emailFollowup) return false;
  if (needs.feature && !facts.features(needs.feature) && !facts.signedIn) return false;
  if (run && needs.signedIn && !facts.signedIn) return false;
  return true;
}

/** The tools offered in this turn and their handler (null: none, as on Kaizen's desk and outside the AI first). */
export async function supportToolsFor(ctx: SupportToolContext): Promise<SupportToolSet | null> {
  if (ctx.settings.mode !== "ai_first") return null;
  const facts = factsOf(ctx);
  const offered: SupportTool[] = [];
  for (const tool of SUPPORT_TOOLS) {
    if (!FIRST_LINE_TOOLS.has(tool.name) || !(await needsMet(tool.needs, facts, false))) continue;
    // By email nobody is signed in and nothing can be pressed: those tools are left out, and orders go to a person.
    if (ctx.email && (NOT_BY_EMAIL.has(tool.name) || tool.needs.signedIn)) continue;
    // Proposals only of the kinds the desk allows (none: not offered).
    if (tool.name === "propose_action" && allowedKinds(ctx.settings).length === 0) continue;
    offered.push(tool);
  }
  if (offered.length === 0) return null;
  const definitions: ToolDefinition[] = offered.map((tool) => ({ name: tool.name, description: tool.description, parameters: z.toJSONSchema(tool.input) as Record<string, unknown> }));
  return {
    definitions,
    run: async (name, args) => {
      const tool = offered.find((candidate) => candidate.name === name);
      if (!tool) return refuse("unknown_tool", `No tool called ${name}.`);
      if (!(await needsMet(tool.needs, facts, true))) return tool.needs.signedIn && !facts.signedIn ? NOT_SIGNED_IN : refuse("not_offered", "This is not offered here.");
      const input = tool.input.safeParse(args);
      if (!input.success) return refuse("invalid", "The tool's input was not readable. Ask the customer again.");
      return runTool(ctx, name, input.data as Record<string, unknown>);
    },
  };
}

/** One tool's answer; the needs were checked by the caller. Exported for the tests. */
export async function runTool(ctx: SupportToolContext, name: string, args: Record<string, unknown>): Promise<SupportToolOutcome> {
  const customer = ctx.customer;
  switch (name) {
    case "ask_to_sign_in":
      if (customer) return { result: json({ ok: true, note: "The visitor is already signed in: use the other tools." }) };
      return { result: json({ ok: true, note: "The visitor sees a sign-in form under your reply (an emailed code). Tell them in one short sentence." }), card: "sign_in" };
    case "ask_for_email":
      return { result: json({ ok: true, note: "The visitor sees a form to leave their email under your reply. Tell them in one short sentence." }), card: "email" };
    case "check_code":
      return checkCode(ctx, String(args.code));
    case "request_staff_action": {
      const kept = await requestStaffAction(ctx, String(args.kind), typeof args.number === "string" ? args.number : undefined, String(args.details));
      return { result: json(kept.result), ...(kept.actionId ? { action: kept.actionId } : {}) };
    }
  }
  if (!customer) return NOT_SIGNED_IN;
  switch (name) {
    case "my_orders":
      return myOrders(ctx, customer.id);
    case "order_details":
      return orderDetails(ctx, customer.id, String(args.number));
    case "return_options":
      return returnOptions(ctx, customer.id, String(args.number));
    case "my_bookings":
      return myBookings(ctx, customer.id);
    case "my_subscriptions":
      return mySubscriptions(ctx, customer.id);
    case "my_boxes":
      return myBoxes(ctx, customer.id);
    case "bonus_balance":
      return bonusBalance(ctx, customer.id);
    case "propose_action": {
      const kept = await proposeAction(ctx, String(args.kind), args.args);
      return { result: json(kept.result), ...(kept.actionId ? { action: kept.actionId } : {}) };
    }
  }
  return refuse("unknown_tool", `No tool called ${name}.`);
}

// Helpers ----------------------------------------------------------------------------------------------------------------------

/** A chip, or nothing when the address is not one a link may point at. */
const chip = (kind: SupportChip["kind"], label: string, href: string | null | undefined): SupportChip[] => (href && isSafeAddress(href) ? [{ kind, label, href }] : []);

const path = (ctx: SupportToolContext, rest: string) => marketPath(ctx.site.store.slug, ctx.site.market.slug, rest);

const money = (ctx: SupportToolContext, minor: number, currency: string) => formatMoney(minor, currency, ctx.site.market.locale);

const day = (ctx: SupportToolContext, iso: string) => new Date(iso).toLocaleDateString(ctx.site.market.locale, { dateStyle: "long", timeZone: ctx.site.store.timeZone });

/** A store day (YYYY-MM-DD) in words. */
const storeDay = (ctx: SupportToolContext, date: string | null) => (date ? new Date(`${date}T12:00:00Z`).toLocaleDateString(ctx.site.market.locale, { dateStyle: "long", timeZone: "UTC" }) : null);

const statusWords = (ctx: SupportToolContext, status: string) => t(ctx.site.market.lang).account.status[status] ?? status;

/** The customer's own order with this number (the number as typed: spaces and a leading # are dropped), or null; never a copied one. */
async function ownOrderId(ctx: SupportToolContext, customerId: string, number: string): Promise<string | null> {
  const typed = number.replace(/\s+/g, "").replace(/^#/, "");
  if (!typed) return null;
  const [row] = await db().execute<Row>(sql`
    select id from commerce.orders
    where store_id = ${ctx.site.store.id}::uuid and customer_id = ${customerId}::uuid and upper(number) = upper(${typed})
      and copied_from is null and status <> 'pending_payment'
    limit 1
  `);
  if (!row) return null;
  const id = String(row.id);
  return (await ownsOrder(ctx.site.store.id, customerId, id)) ? id : null;
}

// The tools --------------------------------------------------------------------------------------------------------------------

async function myOrders(ctx: SupportToolContext, customerId: string): Promise<SupportToolOutcome> {
  const orders = (await listCustomerOrders(ctx.site.store.id, customerId)).slice(0, LIST_MAX);
  return {
    result: json({
      orders: orders.map((order) => ({ number: order.number, placed: day(ctx, order.placedAt), status: statusWords(ctx, order.status), total: money(ctx, order.totalMinor, order.currency), items: order.items })),
      note: orders.length === 0 ? "The customer has no orders in this store." : "The latest orders, newest first. Use order_details for one of them.",
    }),
  };
}

/**
 * The exchanges an order's returns have (their newest one past a draft, with its exchange order's number), and the return an order is the exchange of
 * (D239). The store's rows only; the order is already the signed-in customer's own, and so are an exchange order's returns and original.
 */
async function exchangeFacts(storeId: string, orderId: string, returnIds: string[]) {
  const [byReturn, of] = await Promise.all([
    returnIds.length === 0
      ? Promise.resolve([] as Row[])
      : db().execute<Row>(sql`
          select distinct on (x.return_id) x.return_id::text as return_id, x.status, eo.number as order_number
          from commerce.return_exchanges x
          left join commerce.orders eo on eo.store_id = x.store_id and eo.id = x.exchange_order_id
          where x.store_id = ${storeId}::uuid and x.order_id = ${orderId}::uuid and x.status <> 'draft'
          order by x.return_id, x.seq desc
        `),
    db().execute<Row>(sql`
      select r.number as return_number, oo.number as original_number
      from commerce.orders o
      join commerce.return_exchanges x on x.store_id = o.store_id and x.id = o.exchange_id
      join commerce.returns r on r.store_id = x.store_id and r.id = x.return_id
      join commerce.orders oo on oo.store_id = x.store_id and oo.id = x.order_id
      where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
    `),
  ]);
  const returns = new Map(byReturn.map((r) => [String(r.return_id), { status: String(r.status), orderNumber: r.order_number ? String(r.order_number) : null }]));
  const exchangeOf = of[0] ? { return: String(of[0].return_number), originalOrder: String(of[0].original_number) } : null;
  return { returns, exchangeOf };
}

async function orderDetails(ctx: SupportToolContext, customerId: string, number: string): Promise<SupportToolOutcome> {
  const id = await ownOrderId(ctx, customerId, number);
  if (!id) return NOT_FOUND;
  const storeId = ctx.site.store.id;
  const [order, fulfilment, documents, returns] = await Promise.all([getOrder(storeId, id), shopperFulfilment(storeId, id), getOrderDocuments(storeId, id), listOrderReturns(storeId, id)]);
  if (!order) return NOT_FOUND;
  const exchanges = await exchangeFacts(storeId, id, returns.map((r) => r.id));
  const m = t(ctx.site.market.lang);
  const amount = (minor: number) => money(ctx, minor, order.currency);
  const chips: SupportChip[] = [...chip("order", order.number, path(ctx, `/account/orders/${order.id}`))];
  for (const parcel of fulfilment?.parcels ?? []) chips.push(...chip("tracking", parcel.trackingNumber || parcel.carrier, parcel.trackingUrl));
  if (documents.invoice?.token) chips.push(...chip("invoice", documents.invoice.documentNumber, path(ctx, `/account/documents/${documents.invoice.token}`)));
  for (const note of documents.creditNotes) if (note.token) chips.push(...chip("credit_note", note.documentNumber, path(ctx, `/account/documents/${note.token}`)));
  for (const ret of returns) chips.push(...chip("return", ret.number, path(ctx, `/returns/${ret.token}`)));
  return {
    result: json({
      number: order.number,
      placed: day(ctx, order.placedAt),
      status: statusWords(ctx, order.status),
      paid: order.wasPaid,
      lines: order.lines.map((line) => ({
        title: line.title,
        quantity: line.booking ? 1 : line.quantity,
        total: line.gift ? m.freeGift : amount(line.totalMinor),
        ...(line.booking ? { booking: bookingWhen(line.booking, ctx.site.market.locale, m), bookingStatus: line.booking.status } : {}),
        ...(line.backorder ? { backordered: line.backorder.units, backorderShipsWithinDays: line.backorder.days } : {}),
      })),
      subtotal: amount(order.subtotalMinor),
      shipping: amount(order.shippingMinor),
      ...(order.delivery ? { delivery: order.delivery.label } : {}),
      ...(order.discountMinor > 0 ? { discount: amount(order.discountMinor) } : {}),
      ...(order.creditMinor > 0 ? { bonusCreditsUsed: amount(order.creditMinor) } : {}),
      total: amount(order.totalMinor),
      ...(order.balanceMinor > 0 ? { toPayAtTheVenue: amount(order.balanceMinor) } : {}),
      sending: fulfilment ? fulfilment.state : null,
      parcels: (fulfilment?.parcels ?? []).map((parcel) => ({ sent: day(ctx, parcel.createdAt), carrier: parcel.carrier, trackingNumber: parcel.trackingNumber, items: parcel.lines.map((line) => `${line.quantity} × ${line.title}`) })),
      stillToCome: (fulfilment?.stillToCome ?? []).map((line) => ({ title: line.title, quantity: line.quantity, ...(line.backordered > 0 ? { backordered: line.backordered, backorderShipsWithinDays: line.backorderDays } : {}) })),
      returns: returns.map((ret) => {
        const x = exchanges.returns.get(ret.id);
        const words = exchangeStateWords(x?.status);
        return { number: ret.number, kind: ret.kind, status: ret.status, ...(words ? { exchange: words, ...(x?.orderNumber ? { exchangeOrder: x.orderNumber } : {}) } : {}) };
      }),
      ...(exchanges.exchangeOf
        ? { exchangeFor: { return: exchanges.exchangeOf.return, originalOrder: exchanges.exchangeOf.originalOrder, means: "This order is an exchange: replacement goods for that return, paid by its credit." } }
        : {}),
      invoice: documents.invoice?.documentNumber ?? null,
      creditNotes: documents.creditNotes.map((note) => note.documentNumber),
      note: "Links to the order, tracking, the invoice and returns are shown under your answer.",
    }),
    chips,
  };
}

async function returnOptions(ctx: SupportToolContext, customerId: string, number: string): Promise<SupportToolOutcome> {
  const id = await ownOrderId(ctx, customerId, number);
  if (!id) return NOT_FOUND;
  const view = await lookupWithdrawableOrder(ctx.site.store.id, { orderNumber: number.replace(/\s+/g, "").replace(/^#/, ""), email: "" }, { customerId, floorMs: 0 });
  if (!view || view.orderId !== id) return NOT_FOUND;
  const window = view.window;
  const withdraw = path(ctx, `/withdraw?${new URLSearchParams({ order: view.number }).toString()}`);
  const anything = view.right !== "none";
  return {
    result: json({
      number: view.number,
      period: window.state,
      periodCountsFrom: window.basis,
      withdrawUntil: storeDay(ctx, window.statutoryEndDay),
      returnUntil: storeDay(ctx, window.voluntaryEndDay),
      daysLeft: window.daysLeft,
      returnShippingPaidBy: view.whoPaysReturn === "store" ? "the store" : "the customer",
      business: view.business,
      lines: view.lines.map((line) => ({ lineId: line.lineId, title: line.title, can: line.right, upTo: line.maxQuantity, ...(line.refusal ? { why: line.refusal } : {}), ...(line.sealed ? { onlyWhileSealed: true } : {}) })),
      note: anything
        ? "The customer withdraws or returns on the withdrawal page, shown as a link under your answer. You never withdraw for them and never ask why."
        : "Nothing in this order can be withdrawn or returned now; say why from `why` in plain words.",
    }),
    chips: anything ? chip("withdraw", view.number, withdraw) : [],
  };
}

async function myBookings(ctx: SupportToolContext, customerId: string): Promise<SupportToolOutcome> {
  const storeId = ctx.site.store.id;
  const rows = await db().execute<Row>(sql`
    select distinct o.id, min(b.starts_at) over (partition by o.id) as first
    from commerce.bookings b
    join commerce.orders o on o.store_id = b.store_id and o.id = b.order_id
    where b.store_id = ${storeId}::uuid and o.customer_id = ${customerId}::uuid and o.copied_from is null
      and o.status in ('paid', 'fulfilled') and b.status = 'confirmed' and b.ends_at > now()
    order by first
    limit ${LIST_MAX}
  `);
  const m = t(ctx.site.market.lang);
  const now = Date.now();
  const bookings: Record<string, unknown>[] = [];
  const chips: SupportChip[] = [];
  for (const row of rows) {
    const order = await getOrder(storeId, String(row.id));
    if (!order) continue;
    for (const line of order.lines) {
      const booking = line.booking;
      if (!booking || booking.status !== "confirmed" || Date.parse(booking.endsAt) <= now) continue;
      bookings.push({ bookingId: booking.id, kind: booking.kind, order: order.number, title: line.title, when: bookingWhen(booking, ctx.site.market.locale, m), canChangeOrCancel: selfServiceOpen(booking.startsAt, booking.cancelHours, now) });
    }
    chips.push(...chip("booking", order.number, path(ctx, `/account/orders/${order.id}`)));
  }
  return {
    result: json({ bookings: bookings.slice(0, LIST_MAX), note: bookings.length === 0 ? "The customer has no upcoming bookings." : "Changes and cancellations are made on the order's page, linked under your answer, while canChangeOrCancel is true." }),
    chips,
  };
}

async function mySubscriptions(ctx: SupportToolContext, customerId: string): Promise<SupportToolOutcome> {
  const storeId = ctx.site.store.id;
  const list = (await listCustomerSubscriptions(storeId, customerId)).slice(0, LIST_MAX);
  const subscriptions: Record<string, unknown>[] = [];
  const chips: SupportChip[] = [];
  for (const row of list) {
    const view = await getSubscription(storeId, row.id);
    const allowed = view ? allowedChanges(view) : null;
    subscriptions.push({
      subscriptionId: row.id,
      number: row.number,
      status: row.status,
      items: row.titles,
      price: money(ctx, row.totalMinor, row.currency),
      every: `${row.intervalCount} ${row.interval}`,
      ...(row.currentPeriodEnd ? { periodEnds: day(ctx, row.currentPeriodEnd) } : {}),
      ...(row.cancelAtPeriodEnd || row.cancelAt ? { ends: day(ctx, row.cancelAt ?? row.currentPeriodEnd ?? new Date().toISOString()) } : {}),
      ...(row.pausedUntil ? { pausedUntil: day(ctx, row.pausedUntil) } : {}),
      ...(row.trialEndsAt ? { trialEnds: day(ctx, row.trialEndsAt) } : {}),
      canBeChanged: allowed ? Object.entries(allowed).filter(([, yes]) => yes).map(([what]) => what) : [],
    });
    chips.push(...chip("subscription", row.number, path(ctx, `/subscription/${row.manageToken}`)));
  }
  return {
    result: json({ subscriptions, note: subscriptions.length === 0 ? "The customer has no subscriptions." : "Changes are made on the subscription's page, linked under your answer." }),
    chips,
  };
}

async function myBoxes(ctx: SupportToolContext, customerId: string): Promise<SupportToolOutcome> {
  const list = await getStandingOrder(ctx.site.store.id, customerId, ctx.site.market);
  if (!list) return { result: json({ boxes: null, note: "The customer has no subscription box." }) };
  return {
    result: json({
      listId: list.id,
      status: list.status,
      deliveryDay: list.schedule.name,
      upcomingDates: list.upcoming,
      nextDelivery: storeDay(ctx, list.next.date),
      changesUntil: new Date(list.next.cutoffAt).toLocaleString(ctx.site.market.locale, { dateStyle: "long", timeStyle: "short", timeZone: ctx.site.store.timeZone }),
      items: list.lines.map((line) => ({ title: line.title, quantity: line.quantity, available: line.available })),
      estimate: money(ctx, list.estimate.totalMinor, list.currency),
      skipped: list.skipDates.map((date) => storeDay(ctx, date)),
      unpaidDeliveries: list.unpaid.length,
      note: "Changes are made on the subscription box page, linked under your answer. The estimate is at today's prices.",
    }),
    chips: chip("boxes", "", path(ctx, "/deliveries")),
  };
}

async function bonusBalance(ctx: SupportToolContext, customerId: string): Promise<SupportToolOutcome> {
  const bonus = await shopperBonus({ storeId: ctx.site.store.id, market: ctx.site.market }, customerId);
  if (!bonus.enabled) return { result: json({ enabled: false, note: "The store has no bonus program right now." }) };
  const { balance } = bonus;
  return {
    result: json({
      available: money(ctx, balance.availableMinor, balance.currency),
      pending: money(ctx, balance.pendingMinor, balance.currency),
      ...(balance.pendingAvailableAt ? { pendingUsableFrom: day(ctx, balance.pendingAvailableAt) } : {}),
      ...(balance.expiringSoon ? { expiringSoon: { amount: money(ctx, balance.expiringSoon.amountMinor, balance.currency), on: day(ctx, balance.expiringSoon.at) } } : {}),
      earnPercent: bonus.earnPercent,
    }),
    chips: chip("bonus", "", path(ctx, "/account/bonus")),
  };
}

async function checkCode(ctx: SupportToolContext, code: string): Promise<SupportToolOutcome> {
  const { market } = ctx.site;
  const found = await findUsableDiscount(db(), ctx.site.store.id, code, { market, customerId: ctx.customer?.id ?? null });
  if (!found.ok) return { result: json({ works: false, why: found.problem, note: found.problem === "sign_in" ? "The code needs a signed-in customer: offer ask_to_sign_in." : "Say plainly that the code does not work now, and why." }) };
  const discount = found.discount;
  const minimum = discount.minSubtotals[market.code];
  return {
    result: json({
      works: true,
      gives: discount.kind === "percent" ? `${discount.percent} %` : discount.kind === "free_shipping" ? "free shipping" : money(ctx, discount.amounts[market.code] ?? 0, market.currency),
      on: discount.productIds === null ? "everything in the store" : "some products only",
      ...(minimum ? { whenGoodsComeTo: money(ctx, minimum, market.currency) } : {}),
      ...(discount.endsAt ? { until: day(ctx, discount.endsAt) } : {}),
      ...(discount.oncePerCustomer ? { oncePerCustomer: true } : {}),
      ...(discount.recurring ? { alsoOnRenewals: true } : {}),
      note: "The customer enters the code in the cart, which checks it against what is in it. Never promise the amount off a particular cart.",
    }),
  };
}
