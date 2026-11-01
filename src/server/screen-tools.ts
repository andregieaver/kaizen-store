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
import { RESOURCE_KINDS, listResources, saveResource } from "./bookings";
import { bonusProgram } from "./bonus";
import { listRewards, saveReward, switchReward } from "./bonus-rewards";
import { listCompanies } from "./companies";
import { decideCreator, listCreators, recordCreatorPayout, setCreatorRate } from "./creators";
import { listTiers, setCustomerTier } from "./customer-tiers";
import { liabilityRows } from "./liabilities";
import { listBreaks, listCurrencies, listPriceLists, setAssignments, setListBreaks, setListRules, setPrices, setScope } from "./price-lists";
import { findProduct } from "./product-tools";
import { listTerms } from "./taxonomy";
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

/** The list by name, and the groups and companies it is for by theirs: a name that fits none, or more than one, is refused. */
async function listBuyers(ctx: Ctx, input: OwnerToolInput<"set_price_list_buyers">) {
  const lists = (await listPriceLists(ctx.store.id)).filter((l) => same(l.name, input.list));
  if (lists.length !== 1) return fail(lists.length === 0 ? `The store has no price list "${input.list}". list_price_lists lists them.` : `More than one price list is called "${input.list}".`);
  const [tiers, companies] = await Promise.all([listTiers(ctx.store.id), input.companies.length ? listCompanies(ctx.store.id) : Promise.resolve([])]);
  const one = <T extends { id: string; name: string }>(all: T[], name: string, what: string) => {
    const found = all.filter((x) => same(x.name, name));
    if (found.length !== 1) return fail(found.length === 0 ? `The store has no ${what} "${name}".` : `More than one ${what} is called "${name}".`);
    return found[0].id;
  };
  return { list: lists[0], tierIds: input.groups.map((g) => one(tiers, g, "customer group")), companyIds: input.companies.map((c) => one(companies, c, "company")) };
}

export async function setPriceListBuyersTool(ctx: Ctx, input: OwnerToolInput<"set_price_list_buyers">) {
  const { list, tierIds, companyIds } = await listBuyers(ctx, input);
  const saved = await setAssignments(memberOf(ctx), list.id, { tierIds, companyIds });
  if (!saved.ok) return fail(saved.problems.join(" "));
  const count = tierIds.length + companyIds.length;
  return { done: count === 0 ? `The price list "${list.name}" is for nobody now.` : `The price list "${list.name}" is for ${tierIds.length} ${tierIds.length === 1 ? "group" : "groups"} and ${companyIds.length} ${companyIds.length === 1 ? "company" : "companies"}.` };
}

// ---------------------------------------------------------------------------
// Working hours (D65) and loyalty rewards (D401)
// ---------------------------------------------------------------------------

/** The member of staff by name, with their hours changed as asked, checked as their page checks them. */
async function staffHours(ctx: Ctx, input: OwnerToolInput<"set_working_hours">) {
  const found = (await listResources(ctx.store.id, ["staff"])).filter((r) => same(r.name, input.staff));
  if (found.length !== 1) return fail(found.length === 0 ? `No member of staff called "${input.staff}" takes appointments here. booking_resources lists them.` : `More than one member of staff is called "${input.staff}".`);
  const person = found[0];
  for (const [day, h] of Object.entries(input.week)) if (h && h.open >= h.close) return fail(`On ${day} the day must end after it starts (${h.open}–${h.close}).`);
  if (Object.keys(input.week).length === 0 && input.takes_bookings === undefined) return fail("Nothing to change: give the days that change, or whether they take bookings.");
  const hours = { ...person.hours, week: { ...person.hours.week, ...input.week } };
  return { person, hours, active: input.takes_bookings ?? person.active };
}

export async function setWorkingHoursTool(ctx: Ctx, input: OwnerToolInput<"set_working_hours">) {
  const { person, hours, active } = await staffHours(ctx, input);
  const saved = await saveResource(memberOf(ctx), person.id, { name: person.name, email: person.email, capacity: person.capacity, active, hours: JSON.stringify(hours) }, "staff");
  if (!saved.ok) return fail(saved.problems.join(" "));
  return { done: `${person.name} ${active ? "takes appointments" : "takes no new bookings"}: ${weekSummary(hours.week) || "no hours in the week"}.` };
}

const REWARD_KIND = { free_shipping: "free shipping", product: "a product free", amount: "an amount off" } as const;

export async function listLoyaltyRewardsTool(ctx: Ctx) {
  const [rewards, program] = await Promise.all([listRewards(ctx.store.id), bonusProgram(db(), ctx.store.id)]);
  const currency = program.currency;
  return {
    rewards: rewards.map((r) => ({ name: r.name, gives: REWARD_KIND[r.kind], costs: money(r.costMinor, currency), on: r.active })),
    note: rewards.length === 0 ? "The store has no loyalty rewards." : "A reward's cost is in bonus credits, counted in the credits' own currency.",
  };
}

async function rewardTarget(ctx: Ctx, input: OwnerToolInput<"switch_loyalty_reward">) {
  const found = (await listRewards(ctx.store.id)).filter((r) => same(r.name, input.reward));
  if (found.length !== 1) return fail(found.length === 0 ? `The store has no loyalty reward "${input.reward}". list_loyalty_rewards lists them.` : `More than one reward is called "${input.reward}".`);
  if (found[0].active === input.on) return fail(`"${found[0].name}" is ${input.on ? "on" : "off"} already.`);
  return found[0];
}

export async function switchLoyaltyRewardTool(ctx: Ctx, input: OwnerToolInput<"switch_loyalty_reward">) {
  const reward = await rewardTarget(ctx, input);
  if (!(await switchReward(memberOf(ctx), reward.id, input.on))) return fail("That reward is gone.");
  return { done: `"${reward.name}" is ${input.on ? "on" : "off"}${input.on ? "" : ": codes handed out for it stop working"}.` };
}

/** A reward made or changed (D401), resolved as the bonus page's form would be filled: a name that is new makes one, an existing one changes it. */
async function rewardSave(ctx: Ctx, input: OwnerToolInput<"save_loyalty_reward">) {
  const [rewards, program] = await Promise.all([listRewards(ctx.store.id), bonusProgram(db(), ctx.store.id)]);
  const found = rewards.filter((r) => same(r.name, input.reward));
  if (found.length > 1) return fail(`More than one reward is called "${input.reward}".`);
  const current = found[0] ?? null;
  if (!current && (!input.costs || !input.gives)) return fail(`The store has no reward "${input.reward}" yet: to make it, say what it costs and what it gives.`);
  if (current && Object.entries(input).every(([key, value]) => key === "reward" || value === undefined)) return fail(`Say what to change about "${current.name}".`);
  const costMinor = input.costs ? parsePrice(input.costs, program.currency) : (current?.costMinor ?? null);
  if (costMinor === null || costMinor <= 0) return fail(`"${input.costs}" is not a cost in credits (${program.currency}), such as 100 or 99,50.`);
  const kind = input.gives ?? current!.kind;
  let productId = kind === "product" ? (current?.kind === "product" ? current.productId : null) : null;
  if (kind === "product" && input.product) productId = (await findProduct(ctx.store, input.product)).id;
  if (kind === "product" && !productId) return fail("Say which product the reward gives free (its handle or title).");
  let amounts: Record<string, number> = kind === "amount" && current?.kind === "amount" ? current.amounts : {};
  if (kind === "amount" && input.amounts) {
    amounts = {};
    for (const [code, typed] of Object.entries(input.amounts)) {
      const market = ctx.store.markets.find((m) => m.code === code.toUpperCase());
      if (!market) return fail(`${code.toUpperCase()} is not a country the store sells in (${ctx.store.markets.map((m) => m.code).join(", ")}).`);
      const minor = parsePrice(typed, market.currency);
      if (minor === null || minor <= 0) return fail(`"${typed}" is not an amount in ${market.currency}.`);
      amounts[market.code] = minor;
    }
  }
  if (kind === "amount" && Object.keys(amounts).length === 0) return fail("Say the amount off in at least one country, such as { NO: \"100\" }.");
  const name = input.new_name ?? current?.name ?? input.reward;
  if (input.new_name && rewards.some((r) => r.id !== current?.id && same(r.name, input.new_name!))) return fail(`Another reward is called "${input.new_name}" already.`);
  return {
    id: current?.id ?? null,
    currency: program.currency,
    form: { name, names: current?.names ?? {}, costMinor, kind, productId, amounts, active: input.on ?? current?.active ?? true },
  };
}

export async function saveLoyaltyRewardTool(ctx: Ctx, input: OwnerToolInput<"save_loyalty_reward">) {
  const { id, form, currency } = await rewardSave(ctx, input);
  const saved = await saveReward(memberOf(ctx), id, form);
  if (!saved.ok) return fail(saved.problems.join(" "));
  return {
    done: `${id ? "Changed" : "Made"} the loyalty reward "${form.name}": it gives ${REWARD_KIND[form.kind]} for ${money(form.costMinor, currency)} in credits, ${form.active ? "on" : "off"}.`,
    pages: { bonus: adminLink(ctx.store, "/bonus") },
  };
}

// ---------------------------------------------------------------------------
// A price list's scope, quantity breaks and rules (D321, D323 E3)
// ---------------------------------------------------------------------------

/** One price list of the store by its name; none, or more than one, is refused. */
async function oneList(ctx: Ctx, name: string) {
  const lists = (await listPriceLists(ctx.store.id)).filter((l) => same(l.name, name));
  if (lists.length !== 1) return fail(lists.length === 0 ? `The store has no price list "${name}". list_price_lists lists them.` : `More than one price list is called "${name}".`);
  return lists[0];
}

/** The store's variants by SKU (case aside); an SKU the store does not have is refused. */
async function variantsBySku(ctx: Ctx, skus: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(skus.map((s) => s.toLowerCase()))];
  const rows = await db().execute<Row>(sql`
    select id, sku from commerce.product_variants where store_id = ${ctx.store.id}::uuid and lower(sku) in (${sql.join(wanted.map((k) => sql`${k}`), sql`, `)})
  `);
  const ids = new Map(rows.map((r) => [String(r.sku).toLowerCase(), String(r.id)]));
  for (const sku of wanted) if (!ids.has(sku)) fail(`The store has no variant with the SKU ${sku}.`);
  return ids;
}

async function listScope(ctx: Ctx, input: OwnerToolInput<"set_price_list_scope">) {
  const list = await oneList(ctx, input.list);
  const productIds = [];
  for (const ref of input.products) productIds.push((await findProduct(ctx.store, ref)).id);
  const categories = input.categories.length ? (await listTerms({ storeId: ctx.store.id, contentType: "product" })).filter((term) => term.kind === "category") : [];
  const termIds = input.categories.map((name) => {
    const found = categories.filter((c) => same(c.name, name));
    if (found.length !== 1) return fail(found.length === 0 ? `The store has no product category "${name}".` : `More than one product category is called "${name}".`);
    return found[0].id;
  });
  return { list, productIds, termIds };
}

export async function setPriceListScopeTool(ctx: Ctx, input: OwnerToolInput<"set_price_list_scope">) {
  const { list, productIds, termIds } = await listScope(ctx, input);
  const saved = await setScope(memberOf(ctx), list.id, { productIds, termIds });
  if (!saved.ok) return fail(saved.problems.join(" "));
  return {
    done:
      productIds.length + termIds.length === 0
        ? `The price list "${list.name}"'s percentage reaches every product.`
        : `The price list "${list.name}"'s percentage reaches ${productIds.length} ${productIds.length === 1 ? "product" : "products"} and ${termIds.length} ${termIds.length === 1 ? "category" : "categories"}.`,
    pages: { price_list: adminLink(ctx.store, `/price-lists/${list.id}`) },
  };
}

/** The list's breaks with those of the variants named replaced (the others kept as they are), in the shape the list's page saves. */
async function listBreakRows(ctx: Ctx, input: OwnerToolInput<"set_price_list_breaks">) {
  const list = await oneList(ctx, input.list);
  const ids = await variantsBySku(ctx, input.variants.map((v) => v.sku));
  const named = new Set(input.variants.map((v) => ids.get(v.sku.toLowerCase())!));
  for (const v of input.variants) {
    for (const b of v.breaks) {
      const priced = b.prices && Object.keys(b.prices).length > 0;
      if ((b.percent_off === undefined) === !priced) return fail(`${v.sku} from ${b.from}: give either a percentage off or prices, one of the two.`);
    }
  }
  const kept = (await listBreaks(ctx.store.id, list.id, ctx.store.localization.locales[0] ?? "")).filter((b) => !named.has(b.variantId));
  const keptRows = kept.map((b) => ({ variantId: b.variantId, from: b.from, percent: b.percent, prices: b.prices }));
  const given = input.variants.flatMap((v) =>
    v.breaks.map((b) => ({
      variantId: ids.get(v.sku.toLowerCase())!,
      from: b.from,
      percent: b.percent_off ?? null,
      prices: Object.fromEntries(Object.entries(b.prices ?? {}).map(([c, a]) => [c.toUpperCase(), a])),
    })),
  );
  return { list, rows: [...keptRows, ...given], count: given.length };
}

export async function setPriceListBreaksTool(ctx: Ctx, input: OwnerToolInput<"set_price_list_breaks">) {
  const { list, rows, count } = await listBreakRows(ctx, input);
  const saved = await setListBreaks(memberOf(ctx), list.id, rows);
  if (!saved.ok) return fail(saved.problems.join(" "));
  return {
    done: `The price list "${list.name}" has ${count} quantity ${count === 1 ? "break" : "breaks"} for the ${input.variants.length} ${input.variants.length === 1 ? "variant" : "variants"} named; its other variants keep theirs.`,
    pages: { price_list: adminLink(ctx.store, `/price-lists/${list.id}`) },
  };
}

/** The rules of the variants named, as the list's page saves them: each variant's own (all three empty takes it away); the list's other variants are not touched. */
async function listRuleRows(ctx: Ctx, input: OwnerToolInput<"set_price_list_rules">) {
  const list = await oneList(ctx, input.list);
  const ids = await variantsBySku(ctx, input.rules.map((r) => r.sku));
  for (const r of input.rules) {
    if (r.min !== null && r.max !== null && r.min > r.max) return fail(`${r.sku}: the least (${r.min}) is more than the most (${r.max}).`);
  }
  const rows = input.rules.map((r) => ({ variantId: ids.get(r.sku.toLowerCase())!, min: r.min, max: r.max, step: r.step }));
  const set = rows.filter((r) => r.min !== null || r.max !== null || r.step !== null).length;
  return { list, rows, set, removed: rows.length - set };
}

export async function setPriceListRulesTool(ctx: Ctx, input: OwnerToolInput<"set_price_list_rules">) {
  const { list, rows, set, removed } = await listRuleRows(ctx, input);
  const saved = await setListRules(memberOf(ctx), list.id, rows);
  if (!saved.ok) return fail(saved.problems.join(" "));
  return {
    done: `The price list "${list.name}" has quantity rules for ${set} ${set === 1 ? "variant" : "variants"}${removed ? ` and none for ${removed}` : ""}; its other variants keep theirs.`,
    pages: { price_list: adminLink(ctx.store, `/price-lists/${list.id}`) },
  };
}

// ---------------------------------------------------------------------------
// Checked before the owner's yes is asked
// ---------------------------------------------------------------------------

/** A change that could not be made is refused now, never kept for a yes: the same resolution the tool makes, without writing. */
export const SCREEN_CHECKED = [
  "receive_purchase_order",
  "schedule_report",
  "set_customer_group",
  "decide_creator",
  "set_creator_rate",
  "record_creator_payout",
  "set_price_list_prices",
  "set_price_list_buyers",
  "set_working_hours",
  "switch_loyalty_reward",
  "save_loyalty_reward",
  "set_price_list_scope",
  "set_price_list_breaks",
  "set_price_list_rules",
] as const;
export type ScreenChecked = (typeof SCREEN_CHECKED)[number];

export async function preflightScreenTool(ctx: Ctx, name: ScreenChecked, input: Record<string, unknown>): Promise<void> {
  if (name === "receive_purchase_order") await orderToReceive(ctx, input as OwnerToolInput<"receive_purchase_order">);
  else if (name === "schedule_report") await scheduleTarget(ctx, input as OwnerToolInput<"schedule_report">);
  else if (name === "set_customer_group") await groupTarget(ctx, input as OwnerToolInput<"set_customer_group">);
  else if (name === "set_price_list_prices") await priceRows(ctx, input as OwnerToolInput<"set_price_list_prices">);
  else if (name === "set_price_list_buyers") await listBuyers(ctx, input as OwnerToolInput<"set_price_list_buyers">);
  else if (name === "set_working_hours") await staffHours(ctx, input as OwnerToolInput<"set_working_hours">);
  else if (name === "switch_loyalty_reward") await rewardTarget(ctx, input as OwnerToolInput<"switch_loyalty_reward">);
  else if (name === "save_loyalty_reward") await rewardSave(ctx, input as OwnerToolInput<"save_loyalty_reward">);
  else if (name === "set_price_list_scope") await listScope(ctx, input as OwnerToolInput<"set_price_list_scope">);
  else if (name === "set_price_list_breaks") await listBreakRows(ctx, input as OwnerToolInput<"set_price_list_breaks">);
  else if (name === "set_price_list_rules") await listRuleRows(ctx, input as OwnerToolInput<"set_price_list_rules">);
  else await creatorChecked(ctx, name, input);
}
