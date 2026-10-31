import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { presetPeriod, todayIn } from "@/lib/analytics-period";
import { normaliseEmail } from "@/lib/email-address";
import { formatMoney } from "@/lib/money";
import { weekSummary } from "@/lib/opening-hours";
import { parsePrice } from "@/lib/product-input";
import type { OwnerToolInput } from "@/lib/owner-tools";

import type { Membership } from "./auth";
import { RESOURCE_KINDS, listResources } from "./bookings";
import { decideCreator, listCreators, recordCreatorPayout, setCreatorRate } from "./creators";
import { listTiers, setCustomerTier } from "./customer-tiers";
import { liabilityRows } from "./liabilities";
import { listCurrencies, listPriceLists, setPrices } from "./price-lists";
import { OwnerToolError } from "./owner-tool-error";
import { getPurchaseOrder, listPurchaseOrders, receivePurchaseOrder } from "./purchase-orders";
import { listReportSchedules, reportRecipients, saveReportSchedule } from "./report-schedules";
import { listSavedReports } from "./saved-reports";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The AI manager's tools for the screens it had none for (PSI AGT-01, re-score of 31 October 2026): purchase orders counted in, what the
 * store owes its customers, report schedules, customer groups, creators and what can be booked. Each answers from the screen's own
 * functions, and each change is the screen's own service with the person behind it, kept for the owner's yes first and checked before it
 * is kept (the `preflight…` functions): a name that fits nothing, or more than one thing, is a refusal in words, never a guess.
 */

type Ctx = { account: Membership["account"]; store: Store; holder?: Pick<Membership, "role" | "kind" | "permissions"> };

const memberOf = (ctx: Ctx): Membership => ({ account: ctx.account, store: ctx.store, role: ctx.holder?.role ?? "owner", kind: ctx.holder?.kind, permissions: ctx.holder?.permissions });
const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;
const fail = (message: string): never => {
  throw new OwnerToolError(message);
};
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const money = (minor: number, currency: string) => formatMoney(minor, currency, "en-GB");

// ---------------------------------------------------------------------------
// Purchase orders (D383)
// ---------------------------------------------------------------------------

/** The order a name means, with what is still to come on each line: by its reference, else by its supplier when one order of theirs is open. */
async function orderToReceive(ctx: Ctx, input: OwnerToolInput<"receive_purchase_order">) {
  const all = await listPurchaseOrders(ctx.store.id, { open: false, limit: 200 });
  const byReference = all.filter((o) => o.reference && same(o.reference, input.order));
  const bySupplier = all.filter((o) => same(o.supplier, input.order) && (o.state === "open" || o.state === "partly_received"));
  const found = byReference.length > 0 ? byReference : bySupplier;
  if (found.length === 0) return fail(`No purchase order "${input.order}" waiting to be counted in. list_purchase_orders lists them by supplier and reference.`);
  if (found.length > 1) return fail(`More than one purchase order fits "${input.order}": name it by its reference (${found.map((o) => o.reference ?? "no reference").join(", ")}).`);
  const order = await getPurchaseOrder(ctx.store.id, found[0].id);
  if (!order) return fail("That purchase order is gone.");
  if (order.state === "draft") return fail(`Purchase order ${order.reference ?? order.supplier} is still a draft: mark it as ordered on its page first.`);
  if (order.state === "received" || order.state === "cancelled") return fail(`Purchase order ${order.reference ?? order.supplier} is ${order.state === "received" ? "received in full" : "cancelled"}: there is nothing to count in.`);
  const toCome = order.items.map((i) => ({ ...i, left: Math.max(0, i.quantity - i.received) }));
  let lines: { variantId: string; quantity: number; sku: string }[];
  if (input.lines && input.lines.length > 0) {
    lines = input.lines.map((l) => {
      const item = toCome.find((i) => same(i.sku, l.sku));
      if (!item) return fail(`SKU ${l.sku} is not on purchase order ${order.reference ?? order.supplier}.`);
      if (l.quantity > item.left) return fail(`Only ${item.left} of ${item.sku} are still to come on this order, not ${l.quantity}.`);
      return { variantId: item.variantId, quantity: l.quantity, sku: item.sku };
    });
  } else {
    lines = toCome.filter((i) => i.left > 0).map((i) => ({ variantId: i.variantId, quantity: i.left, sku: i.sku }));
  }
  if (lines.every((l) => l.quantity === 0)) return fail("Nothing is left to count in on that order.");
  return { order, lines };
}

/** Counts a purchase order in with the screen's own `receivePurchaseOrder()`: the stock and the costs are the service's to write. */
export async function receivePurchaseOrderTool(ctx: Ctx, input: OwnerToolInput<"receive_purchase_order">) {
  const { order, lines } = await orderToReceive(ctx, input);
  const done = await receivePurchaseOrder(memberOf(ctx), order.id, { lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) });
  if (!done.ok) return fail(done.problems.join(" "));
  return {
    done: `Counted in ${done.received ?? lines.reduce((sum, l) => sum + l.quantity, 0)} units on purchase order ${order.reference ?? order.supplier}, at ${order.location}.`,
    costs_kept: done.costsKept ?? 0,
    pages: { purchase_order: adminLink(ctx.store, `/inventory/purchase-orders/${order.id}`) },
  };
}

// ---------------------------------------------------------------------------
// What the store owes its customers (D381)
// ---------------------------------------------------------------------------

/** Bonus credits and gift card balances owed now, and this month's movements, from `liabilityRows()` as Finance shows them. */
export async function owedToCustomersTool(ctx: Ctx) {
  const period = presetPeriod("month", todayIn(new Date(), ctx.store.timeZone || "Europe/Oslo"));
  const rows = await liabilityRows(ctx.store, period);
  return {
    owed: rows.map((r) => ({
      what: r.ledger === "bonus" ? "bonus credits" : "gift cards",
      owed_now: r.owedNowMinor === null ? null : money(r.owedNowMinor, r.currency),
      in_main_currency: r.owedNowMain && r.owedNowMain.minor !== null ? money(r.owedNowMain.minor, r.owedNowMain.currency) : undefined,
      this_month: Object.fromEntries(Object.entries(r.columns).filter(([, v]) => v !== 0).map(([k, v]) => [k, money(v, r.currency)])),
    })),
    period: period.label,
    note: rows.length === 0 ? "The store owes its customers nothing: no bonus credits and no gift cards." : "Each in its own currency; never added across currencies.",
    pages: { finance: adminLink(ctx.store, "/analytics/finance") },
  };
}

// ---------------------------------------------------------------------------
// Report schedules (D395)
// ---------------------------------------------------------------------------

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The schedules as the report page lists them, the recipients by name (never their emails). */
export async function listReportSchedulesTool(ctx: Ctx) {
  const [schedules, people] = await Promise.all([listReportSchedules(ctx.store.id), reportRecipients(ctx.store.id)]);
  const nameOf = new Map(people.map((p) => [p.accountId, p.name || "a member of the team"]));
  return {
    schedules: schedules.map((s) => ({
      report: s.reportTitle,
      when: s.frequency === "weekly" ? `weekly on ${WEEKDAYS[s.weekday ?? 0] ?? "?"}` : s.frequency === "monthly" ? `monthly on day ${s.monthDay}` : "daily",
      hour: `${String(s.hour).padStart(2, "0")}:00`,
      to: s.recipients.map((id) => nameOf.get(id) ?? "someone no longer with the store"),
      on: s.enabled,
      last_sent: s.lastRunOn,
    })),
    note: schedules.length === 0 ? "No report is emailed on a schedule." : undefined,
    pages: { reports: adminLink(ctx.store, "/analytics/reports") },
  };
}

/** The report and the people a schedule is for, by title and emails; the asker when no one is named. */
async function scheduleTarget(ctx: Ctx, input: OwnerToolInput<"schedule_report">) {
  const reports = (await listSavedReports(ctx.store.id)).filter((r) => same(r.title, input.report));
  if (reports.length === 0) return fail(`The store has no saved report "${input.report}". run_report and save_report make one.`);
  if (reports.length > 1) return fail(`More than one saved report is called "${input.report}": rename one on the Reports page first.`);
  if (input.frequency === "weekly" && !input.weekday) return fail("A weekly report needs its weekday (1 Monday to 7 Sunday).");
  if (input.frequency === "monthly" && !input.month_day) return fail("A monthly report needs its date (1 to 28).");
  const people = await reportRecipients(ctx.store.id);
  const wanted = input.recipients && input.recipients.length > 0 ? input.recipients.map((e) => normaliseEmail(e)) : null;
  const recipients = wanted
    ? wanted.map((email) => people.find((p) => normaliseEmail(p.email) === email)?.accountId ?? fail(`${email} is not one of the store's people who may get its reports.`))
    : [people.find((p) => p.accountId === ctx.account.id)?.accountId ?? fail("You are not among the store's people who may get its reports; name who should.")];
  return { report: reports[0], recipients };
}

/** A schedule saved by the report page's own `saveReportSchedule()`, which checks it again and keeps the audit entry. */
export async function scheduleReportTool(ctx: Ctx, input: OwnerToolInput<"schedule_report">) {
  const { report, recipients } = await scheduleTarget(ctx, input);
  const saved = await saveReportSchedule(ctx.store.id, ctx.account.id, {
    reportId: report.id,
    frequency: input.frequency,
    weekday: input.weekday ?? null,
    monthDay: input.month_day ?? null,
    hour: input.hour,
    recipients,
    enabled: true,
  });
  if (!saved.ok) return fail(`The schedule could not be saved (${saved.problem}).`);
  return { done: `"${report.title}" is emailed ${input.frequency} at ${String(input.hour).padStart(2, "0")}:00 to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}.`, pages: { reports: adminLink(ctx.store, "/analytics/reports") } };
}

// ---------------------------------------------------------------------------
// Customer groups (D108)
// ---------------------------------------------------------------------------

export async function listCustomerGroupsTool(ctx: Ctx) {
  const tiers = await listTiers(ctx.store.id);
  return {
    groups: tiers.map((t) => ({ name: t.name, discount_percent: t.percent, on: t.active, customers: t.customers, companies: t.companies })),
    note: tiers.length === 0 ? "The store has no customer groups." : undefined,
    pages: { groups: adminLink(ctx.store, "/customer-groups") },
  };
}

/** The customer by email and the group by name (or none), as the customer's page would set them. */
async function groupTarget(ctx: Ctx, input: OwnerToolInput<"set_customer_group">) {
  const email = normaliseEmail(input.customer);
  const [row] = await db().execute<Row>(sql`select id from commerce.customers where store_id = ${ctx.store.id}::uuid and lower(email) = ${email} limit 1`);
  if (!row) return fail(`The store has no customer with the email ${email}.`);
  if (input.group === null) return { customerId: String(row.id), tier: null };
  const tiers = (await listTiers(ctx.store.id)).filter((t) => same(t.name, input.group ?? ""));
  if (tiers.length !== 1) return fail(tiers.length === 0 ? `The store has no customer group "${input.group}". list_customer_groups lists them.` : `More than one group is called "${input.group}".`);
  return { customerId: String(row.id), tier: tiers[0] };
}

export async function setCustomerGroupTool(ctx: Ctx, input: OwnerToolInput<"set_customer_group">) {
  const { customerId, tier } = await groupTarget(ctx, input);
  const saved = await setCustomerTier(memberOf(ctx), customerId, tier?.id ?? null);
  if (!saved.ok) return fail(saved.problems.join(" "));
  return { done: tier ? `${input.customer} is in the group "${tier.name}" (${tier.percent} % off) from their next order.` : `${input.customer} is in no customer group now.` };
}

// ---------------------------------------------------------------------------
// Creators (D386) and what can be booked (D65)
// ---------------------------------------------------------------------------

/** The creators as their page lists them, never their emails; earnings in each currency, written by code. */
export async function listCreatorsTool(ctx: Ctx, { status, limit }: OwnerToolInput<"list_creators">) {
  const rows = (await listCreators(ctx.store.id)).filter((c) => status === "all" || c.status === status).slice(0, limit);
  return {
    creators: rows.map((c) => ({
      name: c.name,
      status: c.status,
      code: c.code,
      commission_percent: c.commissionBps === null ? null : c.commissionBps / 100,
      orders: c.orders,
      visits: c.visits,
      earned: c.balances.map((b) => ({ currency: b.currency, earned: money(b.earnedMinor, b.currency), paid: money(b.paidMinor, b.currency), owed: money(b.owedMinor, b.currency) })),
      applied: c.appliedAt.slice(0, 10),
    })),
    note: rows.length === 0 ? "No creators match." : undefined,
    pages: { creators: adminLink(ctx.store, "/creators") },
  };
}

/** The bookable people, rooms and things, their hours in words (`weekSummary()`); a person's email is never given. */
export async function bookingResourcesTool(ctx: Ctx, { kind }: OwnerToolInput<"booking_resources">) {
  const rows = await listResources(ctx.store.id, kind === "all" ? RESOURCE_KINDS : [kind]);
  return {
    resources: rows.map((r) => ({ name: r.name, kind: r.kind, takes_bookings: r.active, hours: weekSummary(r.hours.week), at_once: r.capacity, services: r.services, upcoming_bookings: r.upcoming })),
    note: rows.length === 0 ? "Nothing can be booked yet." : undefined,
  };
}

// ---------------------------------------------------------------------------
// A creator's decision, rate and payout (D386)
// ---------------------------------------------------------------------------

const CREATOR_WORDS: Record<string, string> = {
  owner_only: "Only the store's owner can do that.",
  no_access: "You are not a member of this store.",
  not_found: "That creator is gone.",
  status: "That change does not fit where the creator is: an application is approved or declined, an approved creator stopped, and a declined or stopped one approved again.",
  payout_over: "That is more than the creator is owed in that currency.",
  code: "No free code could be made for the creator just now; try again.",
  invalid: "The values could not be read.",
};

/** The creator a name means: by their code, else by their name; two creators of one name are named by their code. */
async function creatorTarget(ctx: Ctx, name: string) {
  const all = await listCreators(ctx.store.id);
  const byCode = all.filter((c) => c.code && same(c.code, name));
  const found = byCode.length > 0 ? byCode : all.filter((c) => same(c.name, name));
  if (found.length === 0) return fail(`The store has no creator "${name}". list_creators lists them by name and code.`);
  if (found.length > 1) return fail(`More than one creator is called "${name}": name them by their code.`);
  return found[0];
}

function creatorPayout(input: OwnerToolInput<"record_creator_payout">) {
  const currency = input.currency.toUpperCase();
  const amountMinor = parsePrice(input.amount, currency);
  if (amountMinor === null || amountMinor <= 0) return fail(`"${input.amount}" could not be read as an amount in ${currency}.`);
  return { currency, amountMinor, paidOn: input.paid_on, reference: input.reference };
}

async function creatorChecked(ctx: Ctx, name: "decide_creator" | "set_creator_rate" | "record_creator_payout", input: Record<string, unknown>) {
  const creator = await creatorTarget(ctx, String(input.creator ?? ""));
  if (name === "decide_creator") {
    const decision = input.decision;
    if (decision === "approve" && creator.status === "approved") return fail(`${creator.name} is approved already.`);
    if (decision === "decline" && creator.status !== "applied") return fail(`Only an application is declined; ${creator.name} is ${creator.status}.`);
    if (decision === "stop" && creator.status !== "approved") return fail(`Only an approved creator is stopped; ${creator.name} is ${creator.status}.`);
  } else if (name === "record_creator_payout") {
    const payout = creatorPayout(input as OwnerToolInput<"record_creator_payout">);
    const owed = creator.balances.find((b) => b.currency === payout.currency)?.owedMinor ?? 0;
    if (payout.amountMinor > owed) return fail(`${creator.name} is owed ${money(owed, payout.currency)}, less than ${money(payout.amountMinor, payout.currency)}.`);
  }
  return creator;
}

export async function decideCreatorTool(ctx: Ctx, input: OwnerToolInput<"decide_creator">) {
  const creator = await creatorChecked(ctx, "decide_creator", input);
  const done = await decideCreator(ctx.account, ctx.store.id, creator.id, input.decision);
  if (!done.ok) return fail(CREATOR_WORDS[done.problem] ?? CREATOR_WORDS.invalid);
  const words = { approve: "is approved: their link earns commission from now", decline: "is declined", stop: "is stopped: their code earns nothing new" } as const;
  return { done: `${creator.name} ${words[input.decision]}.`, pages: { creators: adminLink(ctx.store, "/creators") } };
}

export async function setCreatorRateTool(ctx: Ctx, input: OwnerToolInput<"set_creator_rate">) {
  const creator = await creatorTarget(ctx, input.creator);
  const bps = input.percent === null ? null : Math.round(input.percent * 100);
  const done = await setCreatorRate(ctx.account, ctx.store.id, creator.id, bps);
  if (!done.ok) return fail(CREATOR_WORDS[done.problem] ?? CREATOR_WORDS.invalid);
  return { done: bps === null ? `${creator.name} earns the programme's commission again.` : `${creator.name} earns ${bps / 100} % from now.` };
}

export async function recordCreatorPayoutTool(ctx: Ctx, input: OwnerToolInput<"record_creator_payout">) {
  const creator = await creatorChecked(ctx, "record_creator_payout", input);
  const payout = creatorPayout(input);
  const done = await recordCreatorPayout(ctx.account, ctx.store.id, creator.id, payout);
  if (!done.ok) return fail(CREATOR_WORDS[done.problem] ?? CREATOR_WORDS.invalid);
  return { done: `Recorded ${money(payout.amountMinor, payout.currency)} paid to ${creator.name} on ${payout.paidOn}.`, pages: { creators: adminLink(ctx.store, "/creators") } };
}

// ---------------------------------------------------------------------------
// A price list's fixed prices (D321)
// ---------------------------------------------------------------------------

/** The list by its name and each row's variant by its SKU and currency among the markets', every row checked before anything is kept. */
async function priceRows(ctx: Ctx, input: OwnerToolInput<"set_price_list_prices">) {
  const lists = (await listPriceLists(ctx.store.id)).filter((l) => same(l.name, input.list));
  if (lists.length !== 1) return fail(lists.length === 0 ? `The store has no price list "${input.list}". list_price_lists lists them.` : `More than one price list is called "${input.list}".`);
  const skus = [...new Set(input.prices.map((p) => p.sku.toLowerCase()))];
  const variants = await db().execute<Row>(sql`
    select id, sku from commerce.product_variants where store_id = ${ctx.store.id}::uuid and lower(sku) in (${sql.join(skus.map((k) => sql`${k}`), sql`, `)})
  `);
  const idOf = new Map(variants.map((v) => [String(v.sku).toLowerCase(), String(v.id)]));
  const currencies = new Set(await listCurrencies(ctx.store.id));
  const rows = input.prices.map((p) => {
    const variantId = idOf.get(p.sku.toLowerCase()) ?? fail(`The store has no variant with the SKU ${p.sku}.`);
    const currency = p.currency.toUpperCase();
    if (!currencies.has(currency)) return fail(`${currency} is not a currency of the store's markets (${[...currencies].join(", ")}).`);
    if (p.amount !== null && parsePrice(p.amount, currency) === null) return fail(`"${p.amount}" could not be read as a price in ${currency}.`);
    return { variantId, currency, amount: p.amount ?? "" };
  });
  return { list: lists[0], rows };
}

export async function setPriceListPricesTool(ctx: Ctx, input: OwnerToolInput<"set_price_list_prices">) {
  const { list, rows } = await priceRows(ctx, input);
  const saved = await setPrices(memberOf(ctx), list.id, rows);
  if (!saved.ok) return fail(saved.problems.join(" "));
  const removed = rows.filter((r) => r.amount === "").length;
  return {
    done: `The price list "${list.name}" has ${rows.length - removed} fixed ${rows.length - removed === 1 ? "price" : "prices"} set${removed ? ` and ${removed} taken away` : ""}.`,
    pages: { price_list: adminLink(ctx.store, `/price-lists/${list.id}`) },
  };
}

// ---------------------------------------------------------------------------
// Checked before the owner's yes is asked
// ---------------------------------------------------------------------------

/** A change that could not be made is refused now, never kept for a yes: the same resolution the tool makes, without writing. */
export const SCREEN_CHECKED = ["receive_purchase_order", "schedule_report", "set_customer_group", "decide_creator", "set_creator_rate", "record_creator_payout", "set_price_list_prices"] as const;
export type ScreenChecked = (typeof SCREEN_CHECKED)[number];

export async function preflightScreenTool(ctx: Ctx, name: ScreenChecked, input: Record<string, unknown>): Promise<void> {
  if (name === "receive_purchase_order") await orderToReceive(ctx, input as OwnerToolInput<"receive_purchase_order">);
  else if (name === "schedule_report") await scheduleTarget(ctx, input as OwnerToolInput<"schedule_report">);
  else if (name === "set_customer_group") await groupTarget(ctx, input as OwnerToolInput<"set_customer_group">);
  else if (name === "set_price_list_prices") await priceRows(ctx, input as OwnerToolInput<"set_price_list_prices">);
  else await creatorChecked(ctx, name, input);
}
