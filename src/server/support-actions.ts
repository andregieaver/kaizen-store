import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { bookingWhen } from "@/lib/booking-text";
import { t, type Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { selfServiceOpen } from "@/lib/pay-later";
import { pauseEnd } from "@/lib/subscriptions";
import {
  CUSTOMER_ACTION_KINDS,
  STAFF_REQUEST_KINDS,
  actionExpiry,
  isCustomerAction,
  readActionArgs,
  type CustomerActionKind,
  type StaffRequestKind,
} from "@/lib/support-actions";

import { audit } from "./auth";
import { cancelOwnBooking, moveOwnBooking } from "./booking-changes";
import type { ChatSite } from "./chat-agent";
import { getCustomer } from "./customers";
import { getOrder, type OrderView } from "./orders";
import { sendOrderConfirmation, sendShipped } from "./shopper-emails";
import { getStandingOrder, setListStatus, setSkip } from "./standing-orders";
import { allowedChanges, changeSubscription, getSubscription, type SubscriptionChange } from "./subscriptions";
import { addMessage, type Conversation, type DeskSettings } from "./support";
import type { Desk, StaffDesk } from "./support-desk";
import type { SupportCustomer } from "./support-tools";
import { lookupWithdrawableOrder, startReturnRequest } from "./withdrawals";

type Row = Record<string, unknown>;
type StoreSite = Extract<ChatSite, { kind: "store" }>;

/**
 * Actions and requests (D216, `docs/support.md` 4.4, step 10). The AI may **propose** a customer action (self-service the customer
 * could do on their own pages): it is checked now as it would run (`prepare()`), kept with a summary written by code in the
 * customer's language, and runs only when the customer presses Confirm in the chat, within `ACTION_MINUTES`, when it is checked
 * again and done through the existing function with the customer's own authority (`perform()`). Anything else the AI passes to a
 * person as a **staff request**, which someone at the store marks done or declines, with a note that reaches the customer. Nothing
 * here refunds, withdraws, edits an order or gives a code or credit.
 */

export type ActionContext = { site: StoreSite; settings: DeskSettings; customer: SupportCustomer; desk: Desk; conversationId: string };

/** Why an action cannot be done, in the customer's words (`m.chat.actions.why`). */
export type Why = keyof Messages["chat"]["actions"]["why"];

type Prepared = { ok: true; summary: string } | { ok: false; why: Why };
type Performed = { ok: true; note?: string; result?: Record<string, unknown> } | { ok: false; why: Why };

const words = (site: StoreSite) => t(site.market.lang).chat.actions;
const when = (site: StoreSite, iso: string) =>
  new Date(iso).toLocaleString(site.market.locale, { dateStyle: "long", timeStyle: "short", timeZone: site.store.timeZone });
const day = (site: StoreSite, iso: string) => new Date(iso).toLocaleDateString(site.market.locale, { dateStyle: "long", timeZone: site.store.timeZone });
const storeDay = (site: StoreSite, date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(site.market.locale, { dateStyle: "long", timeZone: "UTC" });

/** The kinds the desk lets the AI propose (null in the settings: all). */
export const allowedKinds = (settings: Pick<DeskSettings, "aiActions">): readonly CustomerActionKind[] => settings.aiActions ?? CUSTOMER_ACTION_KINDS;

// Finding the customer's own things -------------------------------------------------------------------------------------------

const typedNumber = (value: unknown) => String(value ?? "").replace(/\s+/g, "").replace(/^#/, "");

async function ownOrder(site: StoreSite, customerId: string, number: unknown): Promise<OrderView | null> {
  const typed = typedNumber(number);
  if (!typed) return null;
  const [row] = await db().execute<Row>(sql`
    select id from commerce.orders
    where store_id = ${site.store.id}::uuid and customer_id = ${customerId}::uuid and upper(number) = upper(${typed})
      and copied_from is null and status <> 'pending_payment'
  `);
  return row ? getOrder(site.store.id, String(row.id)) : null;
}

/** The customer's confirmed booking and its order line, or null. */
async function ownBookingLine(site: StoreSite, customerId: string, bookingId: unknown) {
  const [row] = await db().execute<Row>(sql`
    select b.order_id from commerce.bookings b join commerce.orders o on o.store_id = b.store_id and o.id = b.order_id
    where b.store_id = ${site.store.id}::uuid and b.id = ${String(bookingId)}::uuid and o.customer_id = ${customerId}::uuid and o.copied_from is null
  `);
  if (!row) return null;
  const order = await getOrder(site.store.id, String(row.order_id));
  const line = order?.lines.find((l) => l.booking?.id === bookingId);
  if (!order || !line?.booking || line.booking.status !== "confirmed" || (order.status !== "paid" && order.status !== "fulfilled")) return null;
  return { order, line, booking: line.booking };
}

async function ownSubscription(site: StoreSite, customerId: string, subscriptionId: unknown) {
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.subscriptions where store_id = ${site.store.id}::uuid and id = ${String(subscriptionId)}::uuid and customer_id = ${customerId}::uuid
  `);
  return row ? getSubscription(site.store.id, String(subscriptionId)) : null;
}

async function ownList(site: StoreSite, customerId: string, listId: unknown) {
  const list = await getStandingOrder(site.store.id, customerId, site.market);
  return list && list.id === listId ? list : null;
}

/** Whether this order's email was already sent again from the chat in the last day. */
async function resentToday(storeId: string, kind: string, orderId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.support_actions
    where store_id = ${storeId}::uuid and kind = ${kind} and status = 'done' and result ->> 'orderId' = ${orderId} and decided_at > now() - interval '1 day'
    limit 1
  `);
  return Boolean(row);
}

const latestParcel = async (storeId: string, orderId: string) => {
  const [row] = await db().execute<Row>(sql`
    select id, carrier, tracking_number, tracking_url from commerce.shipments
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and undone_at is null order by created_at desc, id desc limit 1
  `);
  return row ? { id: String(row.id), carrier: String(row.carrier ?? ""), trackingNumber: String(row.tracking_number ?? ""), trackingUrl: row.tracking_url ? String(row.tracking_url) : null } : null;
};

const SUBSCRIPTION_CHANGES: Record<string, SubscriptionChange> = {
  "subscription.pause": "pause",
  "subscription.skip": "skip",
  "subscription.cancel": "cancel",
  "subscription.resume": "resume",
  "subscription.unpause": "unpause",
};

// Checking and doing ----------------------------------------------------------------------------------------------------------

/** Whether the action would run now, and what it does in the customer's words. Read-only. */
export async function prepare(site: StoreSite, customerId: string, kind: CustomerActionKind, args: Record<string, unknown>, now = Date.now()): Promise<Prepared> {
  const w = words(site);
  const m = t(site.market.lang);
  switch (kind) {
    case "booking.cancel":
    case "booking.move": {
      const found = await ownBookingLine(site, customerId, args.bookingId);
      if (!found) return { ok: false, why: "notFound" };
      if (!selfServiceOpen(found.booking.startsAt, found.booking.cancelHours, now)) return { ok: false, why: "closed" };
      const at = bookingWhen(found.booking, site.market.locale, m);
      if (kind === "booking.cancel") return { ok: true, summary: `${w.summary.bookingCancel(found.line.title, at)} ${w.summary.refundNote}` };
      if (found.booking.kind !== "appointment") return { ok: false, why: "notAllowed" };
      if (Date.parse(String(args.startsAt)) <= now) return { ok: false, why: "taken" };
      return { ok: true, summary: w.summary.bookingMove(found.line.title, at, when(site, String(args.startsAt))) };
    }
    case "subscription.pause":
    case "subscription.skip":
    case "subscription.cancel":
    case "subscription.resume":
    case "subscription.unpause": {
      const sub = await ownSubscription(site, customerId, args.subscriptionId);
      if (!sub) return { ok: false, why: "notFound" };
      const change = SUBSCRIPTION_CHANGES[kind];
      if (!allowedChanges(sub, new Date(now))[change as keyof ReturnType<typeof allowedChanges>]) return { ok: false, why: "notAllowed" };
      if (kind === "subscription.pause") {
        if (!sub.currentPeriodEnd) return { ok: false, why: "notAllowed" };
        const until = pauseEnd(new Date(sub.currentPeriodEnd), sub.interval, sub.intervalCount, Number(args.periods));
        return { ok: true, summary: w.summary.subscriptionPause(sub.number, day(site, until.toISOString())) };
      }
      const say = { "subscription.skip": w.summary.subscriptionSkip, "subscription.cancel": w.summary.subscriptionCancel, "subscription.resume": w.summary.subscriptionResume, "subscription.unpause": w.summary.subscriptionUnpause }[kind];
      return { ok: true, summary: say(sub.number) };
    }
    case "box.skip":
    case "box.pause":
    case "box.resume": {
      const list = await ownList(site, customerId, args.listId);
      if (!list) return { ok: false, why: "notFound" };
      if (kind === "box.skip") {
        if (list.status !== "active" || !list.upcoming.includes(String(args.date)) || list.skipDates.includes(String(args.date))) return { ok: false, why: "notAllowed" };
        return { ok: true, summary: w.summary.boxSkip(storeDay(site, String(args.date))) };
      }
      if (kind === "box.pause") return list.status === "active" ? { ok: true, summary: w.summary.boxPause } : { ok: false, why: "notAllowed" };
      return list.status === "paused" ? { ok: true, summary: w.summary.boxResume } : { ok: false, why: "notAllowed" };
    }
    case "order.resend_confirmation":
    case "order.resend_shipped": {
      const order = await ownOrder(site, customerId, args.orderNumber);
      if (!order || order.status === "cancelled") return { ok: false, why: "notFound" };
      if (await resentToday(site.store.id, kind, order.id)) return { ok: false, why: "tooOften" };
      if (kind === "order.resend_confirmation") return { ok: true, summary: w.summary.resendConfirmation(order.number) };
      if (!(await latestParcel(site.store.id, order.id))) return { ok: false, why: "notSent" };
      return { ok: true, summary: w.summary.resendShipped(order.number) };
    }
    case "return.request": {
      const order = await ownOrder(site, customerId, args.orderNumber);
      if (!order) return { ok: false, why: "notFound" };
      const view = await lookupWithdrawableOrder(site.store.id, { orderNumber: order.number, email: "" }, { customerId, floorMs: 0 });
      if (!view) return { ok: false, why: "notFound" };
      const asked = args.lines as { lineId: string; quantity: number }[];
      const items: string[] = [];
      for (const want of asked) {
        const line = view.lines.find((l) => l.lineId === want.lineId);
        if (!line) return { ok: false, why: "notFound" };
        if (line.right !== "return" || want.quantity > line.maxQuantity) return { ok: false, why: "notAllowed" };
        items.push(`${want.quantity} × ${line.title}`);
      }
      return { ok: true, summary: w.summary.returnRequest(order.number, items.join(", ")) };
    }
  }
}

/** Does the action, checked again by the function that does it, with the customer's own authority. */
async function perform(site: StoreSite, customer: { id: string; email: string }, kind: CustomerActionKind, args: Record<string, unknown>): Promise<Performed> {
  const storeId = site.store.id;
  const w = words(site);
  switch (kind) {
    case "booking.cancel": {
      const found = await ownBookingLine(site, customer.id, args.bookingId);
      if (!found) return { ok: false, why: "notFound" };
      const done = await cancelOwnBooking(storeId, found.order.id, { customerId: customer.id }, String(args.bookingId));
      if (done.outcome !== "done") return { ok: false, why: done.outcome === "closed" ? "closed" : done.outcome === "taken" ? "taken" : "notFound" };
      return { ok: true, ...(done.refundMinor > 0 ? { note: w.refunded(formatMoney(done.refundMinor, found.order.currency, site.market.locale)) } : {}) };
    }
    case "booking.move": {
      const found = await ownBookingLine(site, customer.id, args.bookingId);
      if (!found) return { ok: false, why: "notFound" };
      const outcome = await moveOwnBooking(storeId, found.order.id, { customerId: customer.id }, String(args.bookingId), String(args.startsAt));
      return outcome === "done" ? { ok: true } : { ok: false, why: outcome === "closed" ? "closed" : outcome === "taken" ? "taken" : "notFound" };
    }
    case "subscription.pause":
    case "subscription.skip":
    case "subscription.cancel":
    case "subscription.resume":
    case "subscription.unpause": {
      if (!(await ownSubscription(site, customer.id, args.subscriptionId))) return { ok: false, why: "notFound" };
      const result = await changeSubscription(storeId, String(args.subscriptionId), SUBSCRIPTION_CHANGES[kind], { periods: Number(args.periods ?? 1), actor: "shopper" });
      if (result.ok) return { ok: true };
      return { ok: false, why: result.problem === "not_found" ? "notFound" : result.problem === "stripe" ? "payment" : "notAllowed" };
    }
    case "box.skip": {
      const result = await setSkip(storeId, customer.id, String(args.date), true);
      return result.ok ? { ok: true } : { ok: false, why: result.problem === "no_list" ? "notFound" : "notAllowed" };
    }
    case "box.pause":
    case "box.resume": {
      const result = await setListStatus(storeId, customer.id, kind === "box.pause" ? "pause" : "resume");
      return result.ok ? { ok: true } : { ok: false, why: result.problem === "no_list" ? "notFound" : "notAllowed" };
    }
    case "order.resend_confirmation":
    case "order.resend_shipped": {
      const order = await ownOrder(site, customer.id, args.orderNumber);
      if (!order) return { ok: false, why: "notFound" };
      if (await resentToday(storeId, kind, order.id)) return { ok: false, why: "tooOften" };
      // Always to the order's own address (sendOrderConfirmation and sendShipped read it from the order), never one typed in the chat.
      if (kind === "order.resend_confirmation") {
        const sent = await sendOrderConfirmation(storeId, order.id, { resend: true });
        return sent ? { ok: true, result: { orderId: order.id } } : { ok: false, why: "failed" };
      }
      const parcel = await latestParcel(storeId, order.id);
      if (!parcel) return { ok: false, why: "notSent" };
      await sendShipped(storeId, order.id, parcel, { resend: true });
      return { ok: true, result: { orderId: order.id } };
    }
    case "return.request": {
      const order = await ownOrder(site, customer.id, args.orderNumber);
      if (!order) return { ok: false, why: "notFound" };
      const person = await getCustomer(storeId);
      const name = (person && person.id === customer.id && person.name.trim()) || customer.email;
      const lines = (args.lines as { lineId: string; quantity: number }[]).map((line) => ({ ...line, reason: null }));
      const outcome = await startReturnRequest(storeId, { orderNumber: order.number, email: customer.email, name, lines, reason: null, note: null }, { customerId: customer.id, floorMs: 0 });
      if (!outcome.ok) return { ok: false, why: outcome.reason === "limited" ? "tooOften" : "notAllowed" };
      if (!outcome.matched) return { ok: false, why: "notFound" };
      return outcome.created ? { ok: true, result: { returnId: outcome.created.id } } : { ok: false, why: "notAllowed" };
    }
  }
}

// Proposing and requesting (the AI's tools) -----------------------------------------------------------------------------------

export type ToolAnswer = { result: Record<string, unknown>; actionId?: string };

/** `propose_action`: checked as it would run, then kept for the customer's Confirm (the AI's message carries it). */
export async function proposeAction(ctx: ActionContext, kind: string, rawArgs: unknown): Promise<ToolAnswer> {
  if (!ctx.customer) return { result: { error: "not_signed_in", note: "Call ask_to_sign_in first." } };
  if (!isCustomerAction(kind) || !allowedKinds(ctx.settings).includes(kind)) {
    return { result: { error: "not_offered", note: "The store does not let you propose that. Use request_staff_action, or tell the customer where they can do it themselves." } };
  }
  const args = readActionArgs(kind, rawArgs);
  if (!args) return { result: { error: "invalid", note: "The arguments do not fit this kind. Read the customer's things with the other tools first and use their ids." } };
  const check = await prepare(ctx.site, ctx.customer.id, kind, args);
  if (!check.ok) return { result: { error: check.why, note: `It would not work: ${words(ctx.site).why[check.why]}` } };
  const expires = actionExpiry(kind, new Date())!;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.support_actions (conversation_id, store_id, kind, confirmer, args, summary, expires_at)
    values (${ctx.conversationId}::uuid, ${ctx.site.store.id}::uuid, ${kind}, 'customer', ${JSON.stringify(args)}::jsonb, ${check.summary.slice(0, 500)}, ${expires.toISOString()}::timestamptz)
    returning id
  `);
  return {
    result: { ok: true, summary: check.summary, note: "The customer sees this summary with Confirm and No thanks under your reply. Nothing happens until they press Confirm: never say it is done." },
    actionId: String(row.id),
  };
}

/** `request_staff_action`: a request a person at the store decides; the summary is code's, the details the AI's words for the staff. */
export async function requestStaffAction(ctx: ActionContext, kind: string, number: string | undefined, details: string): Promise<ToolAnswer> {
  if (!(STAFF_REQUEST_KINDS as readonly string[]).includes(kind)) return { result: { error: "invalid" } };
  const args = readActionArgs(kind, number ? { orderNumber: number } : {});
  if (!args) return { result: { error: "needs_order_number", note: "Ask the customer which order it is about." } };
  const s = words(ctx.site).summary;
  const base = { refund: s.refund, cancel_order: s.cancelOrder, change_address: s.changeAddress } as Record<string, (n: string) => string>;
  const orderNumber = typeof args.orderNumber === "string" ? args.orderNumber : null;
  const summary = base[kind] ? base[kind](orderNumber!) : orderNumber ? s.onOrder(kind === "exception" ? s.exception : s.other, orderNumber) : kind === "exception" ? s.exception : s.other;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.support_actions (conversation_id, store_id, kind, confirmer, args, summary, details)
    values (${ctx.conversationId}::uuid, ${ctx.site.store.id}::uuid, ${kind as StaffRequestKind}, 'staff', ${JSON.stringify(args)}::jsonb, ${summary.slice(0, 500)}, ${details.slice(0, 500)})
    returning id
  `);
  return {
    result: { ok: true, summary, note: "A person at the store will decide, and the customer is told here (and by email when away). Never promise the outcome." },
    actionId: String(row.id),
  };
}

// The customer's Confirm ------------------------------------------------------------------------------------------------------

export type ConfirmOutcome = { ok: true; status: "done" | "failed" | "declined" | "expired" } | { ok: false; reason: "not_found" | "not_signed_in" };

/**
 * The customer's answer to a proposal: only an open proposal of this conversation, before it expires, and only from the signed-in
 * customer the conversation is for. Confirm checks it again and runs it; No thanks declines it. Either way a line in the
 * conversation says what happened (`action_done`, `action_failed`, `action_declined`), and a second press changes nothing.
 */
export async function confirmAction(ctx: ActionContext & { conversation: Pick<Conversation, "id" | "customerId"> }, actionId: string, confirm: boolean): Promise<ConfirmOutcome> {
  const claimed = await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      select id, kind, args, summary, status, expires_at < now() as expired from commerce.support_actions
      where id = ${actionId}::uuid and conversation_id = ${ctx.conversationId}::uuid and confirmer = 'customer'
      for update
    `);
    if (!row || row.status !== "proposed") return null;
    if (row.expired) {
      await tx.execute(sql`update commerce.support_actions set status = 'expired' where id = ${actionId}::uuid`);
      return { row, settled: "expired" as const };
    }
    if (!confirm) {
      await tx.execute(sql`update commerce.support_actions set status = 'declined', decided_at = now() where id = ${actionId}::uuid`);
      return { row, settled: "declined" as const };
    }
    // Taken under the lock, so two presses run it once: the outcome is written below.
    await tx.execute(sql`update commerce.support_actions set status = 'failed', result = '{"running": true}'::jsonb, decided_at = now() where id = ${actionId}::uuid`);
    return { row, settled: null };
  });
  if (!claimed) return { ok: false, reason: "not_found" };
  const { row } = claimed;
  const summary = String(row.summary);
  if (claimed.settled) {
    if (claimed.settled === "declined") await addMessage(ctx.desk, ctx.conversationId, "system", null, "", { kind: "action_declined", data: { actionId, summary } });
    return { ok: true, status: claimed.settled };
  }
  const customer = ctx.customer;
  let outcome: Performed;
  if (!customer || ctx.conversation.customerId !== customer.id) outcome = { ok: false, why: "notYours" };
  else {
    try {
      outcome = await perform(ctx.site, customer, String(row.kind) as CustomerActionKind, row.args as Record<string, unknown>);
    } catch (error) {
      console.warn(`[support] action ${actionId}: ${error instanceof Error ? error.message : String(error)}`);
      outcome = { ok: false, why: "failed" };
    }
  }
  await db().execute(sql`
    update commerce.support_actions set status = ${outcome.ok ? "done" : "failed"},
      result = ${JSON.stringify(outcome.ok ? { done: true, ...(outcome.result ?? {}) } : { error: outcome.why })}::jsonb, decided_at = now()
    where id = ${actionId}::uuid
  `);
  await addMessage(ctx.desk, ctx.conversationId, "system", null, "", {
    kind: outcome.ok ? "action_done" : "action_failed",
    data: outcome.ok ? { actionId, summary, ...(outcome.note ? { note: outcome.note } : {}) } : { actionId, summary, why: outcome.why },
  });
  return { ok: true, status: outcome.ok ? "done" : "failed" };
}

/** Proposals past their time are marked expired (the five-minute job); a Confirm after it is refused anyway. */
export async function expireActions(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    update commerce.support_actions set status = 'expired' where confirmer = 'customer' and status = 'proposed' and expires_at < now() returning id
  `);
  return rows.length;
}

// Staff requests --------------------------------------------------------------------------------------------------------------

export type RequestRow = {
  id: string;
  conversationId: string;
  kind: StaffRequestKind;
  summary: string;
  details: string | null;
  orderNumber: string | null;
  orderId: string | null;
  customer: { name: string; email: string } | null;
  status: "proposed" | "done" | "declined";
  note: string | null;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
};

/** A desk's staff requests: the open ones oldest first, or the decided ones newest first. */
export async function listRequests(desk: Desk, which: "open" | "decided", limit = 100): Promise<RequestRow[]> {
  const rows = await db().execute<Row>(sql`
    select a.id, a.conversation_id, a.kind, a.summary, a.details, a.args ->> 'orderNumber' as order_number, a.status, a.result ->> 'note' as note,
      a.created_at, a.decided_at, d.name as decided_by, cu.name as customer_name, cu.email as customer_email,
      (select o.id from commerce.orders o where o.store_id = a.store_id and upper(o.number) = upper(a.args ->> 'orderNumber')
         and o.copied_from is null limit 1) as order_id
    from commerce.support_actions a
    join commerce.support_conversations c on c.id = a.conversation_id
    left join commerce.customers cu on cu.store_id = c.store_id and cu.id = c.customer_id
    left join commerce.accounts d on d.id = a.decided_by
    where a.confirmer = 'staff' and ${desk.storeId ? sql`a.store_id = ${desk.storeId}::uuid` : sql`a.store_id is null`}
      and ${which === "open" ? sql`a.status = 'proposed'` : sql`a.status in ('done', 'declined')`}
    order by ${which === "open" ? sql`a.created_at` : sql`a.decided_at desc`}
    limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    conversationId: String(r.conversation_id),
    kind: String(r.kind) as StaffRequestKind,
    summary: String(r.summary),
    details: r.details ? String(r.details) : null,
    orderNumber: r.order_number ? String(r.order_number) : null,
    orderId: r.order_id ? String(r.order_id) : null,
    customer: r.customer_email ? { name: String(r.customer_name ?? ""), email: String(r.customer_email) } : null,
    status: String(r.status) as RequestRow["status"],
    note: r.note ? String(r.note) : null,
    decidedBy: r.decided_by ? String(r.decided_by) : null,
    createdAt: new Date(String(r.created_at)).toISOString(),
    decidedAt: r.decided_at ? new Date(String(r.decided_at)).toISOString() : null,
  }));
}

/** How many requests wait on a desk (the Requests tab's badge). */
export async function openRequestCount(desk: Desk): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.support_actions
    where confirmer = 'staff' and status = 'proposed' and ${desk.storeId ? sql`store_id = ${desk.storeId}::uuid` : sql`store_id is null`}
  `);
  return Number(row?.n ?? 0);
}

export const REQUEST_NOTE_MAX = 500;

export type DecideResult = { ok: true; conversationId: string } | { ok: false; problem: string };

/**
 * A person marks a request done (they did it in the store's own screens) or declines it, with an optional note for the customer.
 * A line in the conversation tells the customer (`request_done` or `request_declined`), and an email when they are away
 * (`sendRequestDecisionEmail()`, the caller's `after()`); the activity log has it (`support.request_decided`). Decided once.
 */
export async function decideRequest(staff: StaffDesk, actionId: string, decision: "done" | "declined", rawNote: string | null): Promise<DecideResult> {
  if (!staff.canWrite) return { ok: false, problem: "You can read this desk's requests but not decide them." };
  const note = rawNote?.trim().slice(0, REQUEST_NOTE_MAX) || null;
  const desk = staff.desk;
  const [row] = await db().execute<Row>(sql`
    update commerce.support_actions set status = ${decision}, decided_by = ${staff.account.id}::uuid, decided_at = now(),
      result = ${JSON.stringify(note ? { note } : {})}::jsonb
    where id = ${actionId}::uuid and confirmer = 'staff' and status = 'proposed'
      and ${desk.storeId ? sql`store_id = ${desk.storeId}::uuid` : sql`store_id is null`}
    returning conversation_id, kind, summary
  `);
  if (!row) return { ok: false, problem: "This request was already decided, or is not this desk's." };
  const conversationId = String(row.conversation_id);
  try {
    await addMessage(desk, conversationId, "system", staff.account.id, "", { kind: decision === "done" ? "request_done" : "request_declined", data: { actionId, summary: String(row.summary), ...(note ? { note } : {}) } });
  } catch (error) {
    // An anonymised conversation takes no line; the decision stands.
    console.warn(`[support] request ${actionId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  await audit(staff.account.id, desk.storeId, "support.request_decided", { kind: String(row.kind), decision, note: note !== null }, {
    area: "support",
    target: { type: "support_conversation", id: conversationId },
  });
  return { ok: true, conversationId };
}

export { CUSTOMER_ACTION_KINDS, STAFF_REQUEST_KINDS };
