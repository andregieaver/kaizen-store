import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { CUSTOMERS_API, SUBSCRIPTION_STATES_API } from "@/lib/admin-api-customers";
import type { AdminAnswer, ApiRoute } from "@/lib/admin-api-routes";
import { DISCOUNT_KINDS } from "@/lib/discounts";
import { sameEmail } from "@/lib/email-address";
import { GIFT_CARD_STATES } from "@/lib/gift-card-admin";
import { formatPriceInput } from "@/lib/product-input";

import { cursorAt, fail, holds, ok, paging, readBody, record, sinceWhere, type ApiAnswer } from "./admin-api-kit";
import type { ApiCaller } from "./api-tokens";
import { customerBonus } from "./bonus";
import { createCustomer, staffFormValues, updateCustomer, type StaffProblem } from "./customer-staff";
import { customerEmailsOf, getDiscount, saveDiscount } from "./discounts";
import { deactivateGiftCard, issueGiftCard } from "./gift-cards-admin";
import { evaluateSegment, getSegment, listSegments } from "./segments";
import { sendSubscriptionChanged } from "./shopper-emails";
import { changeSubscription, getSubscription } from "./subscriptions";
import { col, typedRows } from "./typed-rows";

/**
 * The Admin API's customers and marketing (wave 14 unit C3, D440): customers through `createCustomer()` and `updateCustomer()` (the customer
 * page's writers, the form's whole state from `staffFormValues()` with the API's change laid over it), segments counted by
 * `evaluateSegment()` (how many, never who), a code changed or switched off through `saveDiscount()` with its stored form, gift cards issued
 * by `issueGiftCard()` and deactivated by `deactivateGiftCard()` (the code answered once and never kept for a replay), subscriptions paused
 * or cancelled by `changeSubscription()` as staff with the subscriber's email, and store credit and bonus credits read. Each change audited
 * `integration.api_{what}`.
 */

export const CUSTOMERS_NAMES = CUSTOMERS_API.map((o) => o.name);
type CustomersName = (typeof CUSTOMERS_API)[number]["name"];
export type CustomersRoute = Extract<ApiRoute, { name: CustomersName }>;

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/** A customer as `GET /customers/{id}` answers it. */
async function customerById(storeId: string, id: string) {
  const [r] = await typedRows(
    z.object({ id: col.uuid, email: col.text, name: col.textOrNull, phone: col.textOrNull, created_at: col.timestamp, updated_at: col.timestamp, verified: col.bool, tags: z.array(z.string()) }),
    sql`
      select c.id, c.email, c.name, c.phone, c.created_at, c.updated_at, c.email_verified_at is not null as verified,
        coalesce((select array_agg(t.label order by t.label) from commerce.customer_tags t where t.store_id = c.store_id and t.email = lower(c.email)), '{}') as tags
      from commerce.customers c where c.store_id = ${storeId}::uuid and c.id = ${id}::uuid and c.copied_from is null
    `,
  );
  if (!r) return fail("not_found", "No such customer in this store.");
  return { id: r.id, email: r.email, name: r.name ?? "", phone: r.phone ?? "", email_verified: r.verified, tags: r.tags, created_at: r.created_at, updated_at: r.updated_at };
}

function customerRefusal(problem: StaffProblem): never {
  switch (problem.code) {
    case "taken":
      return fail("conflict", "email: that address is a customer of this store already.");
    case "not_found":
      return fail("not_found", "No such customer in this store.");
    case "forbidden":
      return fail("forbidden", "The token's owner may not change customers in the store now.");
    case "email":
      return fail("invalid", "email: not an email address.");
    case "phone":
      return fail("invalid", "phone: not a phone number.");
    case "address":
      return fail("invalid", `address: give the whole address (${problem.field === "postalCode" ? "postal_code" : problem.field} is missing).`);
    case "company_both":
      return fail("invalid", "A company needs company_name and organisation_number together.");
    case "company_number":
      return fail("invalid", "organisation_number: not a valid number for the country.");
    default:
      return fail("invalid", "The customer's details are not valid.");
  }
}

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------

type ApiDiscountDetail = AdminAnswer<"discounts.get">["data"];

async function discountOut(storeId: string, id: string): Promise<ApiDiscountDetail> {
  const d = (await getDiscount(storeId, id)) ?? fail("not_found", "No such discount code in this store.");
  const [dates] = await typedRows(z.object({ starts_at: col.timestampOrNull, ends_at: col.timestampOrNull }), sql`select starts_at, ends_at from commerce.discount_codes where id = ${id}::uuid`);
  return {
    id: d.id,
    code: d.code,
    kind: (DISCOUNT_KINDS as readonly string[]).includes(d.kind) ? d.kind : "percent",
    percent: d.kind === "percent" ? d.percent : null,
    amounts_minor: d.amounts,
    min_subtotals_minor: d.minSubtotals,
    active: d.active,
    starts_at: dates?.starts_at ?? null,
    ends_at: dates?.ends_at ?? null,
    usage_limit: d.usageLimit,
    once_per_customer: d.oncePerCustomer,
    used: d.used,
    applies_to: d.productIds !== null || d.termIds.length > 0 ? "some" : "everything",
    for_some_customers: d.tierIds.length > 0 || d.customerIds.length > 0 || d.segmentId !== null,
  };
}

/** The admin form's whole state of a stored code (its own reader's), with the API's change laid over it, for `saveDiscount()`. */
async function changedDiscount(caller: ApiCaller, id: string, change: Record<string, unknown>) {
  const store = caller.member.store;
  const d = (await getDiscount(store.id, id)) ?? fail("not_found", "No such discount code in this store.");
  if (d.reward) return fail("conflict", "This code is a loyalty reward's: it changes with its reward, on the Bonus page.");
  const typed = (amounts: Record<string, number>) =>
    Object.fromEntries(Object.entries(amounts).flatMap(([market, minorUnits]) => {
      const m = store.keptMarkets.find((k) => k.code === market);
      return m ? [[market, formatPriceInput(minorUnits, m.nativeCurrency)]] : [];
    }));
  return {
    code: change.code ?? d.code,
    kind: d.kind,
    percent: change.percent ?? d.percent,
    amounts: change.amounts ?? typed(d.amounts),
    minSubtotals: change.min_subtotals ?? typed(d.minSubtotals),
    productIds: d.productIds,
    recurring: d.recurring,
    startsAt: change.starts_at !== undefined ? change.starts_at : d.startsAt,
    endsAt: change.ends_at !== undefined ? change.ends_at : d.endsAt,
    usageLimit: change.usage_limit !== undefined ? change.usage_limit : d.usageLimit,
    oncePerCustomer: change.once_per_customer ?? d.oncePerCustomer,
    active: change.active ?? d.active,
    termIds: d.termIds,
    minQuantity: d.minQuantity,
    tierIds: d.tierIds,
    customerEmails: (await customerEmailsOf(store.id, d.customerIds)).join("\n"),
    uniqueCodes: d.uniqueCodes,
    combinesWith: d.combinesWith,
    combinesWithCampaigns: d.combinesWithCampaigns,
    segmentId: d.segmentId,
  };
}

// ---------------------------------------------------------------------------
// Gift cards and store credit
// ---------------------------------------------------------------------------

const CARD_STATE = sql`case when g.status = 'deactivated' then 'deactivated' when g.sent_at is null then 'waiting'
  when g.expires_at is not null and g.expires_at <= now() then 'expired' when commerce.gift_card_balance(g.id) <= 0 then 'spent' else 'active' end`;

const cardRow = z.object({
  id: col.uuid,
  last4: col.textOrNull,
  currency: col.currency,
  initial_minor: col.minor,
  balance_minor: col.minor,
  state: z.enum(GIFT_CARD_STATES),
  source: z.enum(["order", "staff", "refund"]),
  test: col.bool,
  issued_at: col.timestamp,
  cursor_at: z.string(),
  expires_at: col.timestampOrNull,
});

function readCards(storeId: string, where: SQL, limit: number) {
  return typedRows(
    cardRow,
    sql`
      select g.id, g.last4, trim(g.currency) as currency, g.initial_minor, commerce.gift_card_balance(g.id) as balance_minor, ${CARD_STATE} as state, g.source,
        g.test_mode as test, g.issued_at, ${cursorAt(sql`g.issued_at`)} as cursor_at, g.expires_at
      from commerce.gift_cards g where g.store_id = ${storeId}::uuid and ${where}
      order by g.issued_at desc, g.id desc limit ${limit}
    `,
  );
}

const cardOut = ({ cursor_at, ...card }: z.output<typeof cardRow>): AdminAnswer<"gift_cards.get">["data"] => {
  void cursor_at;
  return card;
};

async function cardById(storeId: string, id: string) {
  const [row] = await readCards(storeId, sql`g.id = ${id}::uuid`, 1);
  return row ? cardOut(row) : fail("not_found", "No such gift card in this store.");
}

/** When a card last changed: issued, delivered, spent or adjusted (its ledger), deactivated. */
const CARD_UPDATED = sql`greatest(g.issued_at, g.sent_at, g.deactivated_at,
  (select max(e.created_at) from commerce.gift_card_entries e where e.store_id = g.store_id and e.card_id = g.id))`;

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

async function subscriptionOut(storeId: string, id: string): Promise<AdminAnswer<"subscriptions.get">["data"]> {
  const s = (await getSubscription(storeId, id)) ?? fail("not_found", "No such subscription in this store.");
  const [extra] = await typedRows(
    z.object({ customer_id: col.uuid.nullable(), updated_at: col.timestamp }),
    sql`select customer_id, updated_at from commerce.subscriptions where store_id = ${storeId}::uuid and id = ${id}::uuid`,
  );
  // Never the subscriber's own link (`manageToken`): it is a secret of theirs.
  return {
    id: s.id,
    number: s.number,
    status: (SUBSCRIPTION_STATES_API as readonly string[]).includes(s.status) ? s.status : "active",
    market: s.marketCode,
    currency: s.currency,
    email: s.email,
    customer_id: extra?.customer_id ?? null,
    every: { interval: s.interval, count: s.intervalCount },
    total_per_renewal_minor: s.totalMinor,
    current_period_end: s.currentPeriodEnd,
    next_charge_at: s.nextChargeAt,
    paused_until: s.pausedUntil,
    ends_at: s.endsAt,
    cancelled_at: s.cancelledAt,
    lines: s.lines.map((l) => ({ sku: l.sku, title: l.title, quantity: l.quantity, unit_price_minor: l.unitPriceMinor })),
    created_at: s.createdAt,
    updated_at: extra?.updated_at ?? s.createdAt,
  };
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

export async function answerCustomers(caller: ApiCaller, route: CustomersRoute, request: Request): Promise<ApiAnswer> {
  const storeId = caller.member.store.id;
  const params = new URL(request.url).searchParams;
  switch (route.name) {
    case "customers.create": {
      const input = await readBody(route.name, request);
      const made = await createCustomer(caller.member, {
        email: input.email,
        name: input.name ?? "",
        phone: input.phone ?? "",
        line1: input.address?.line1 ?? "",
        line2: input.address?.line2 ?? "",
        postalCode: input.address?.postal_code ?? "",
        city: input.address?.city ?? "",
        country: input.address?.country ?? "",
        companyName: input.company_name ?? "",
        organisationNumber: input.organisation_number ?? "",
      });
      if (!made.ok) return customerRefusal(made.problem);
      await record(caller, "customer_created", {}, { type: "customer", id: made.id });
      return ok(route.name, { data: await customerById(storeId, made.id) }, 201);
    }
    case "customers.update": {
      await customerById(storeId, route.id);
      const change = await readBody(route.name, request);
      const form = (await staffFormValues(storeId, route.id)) ?? fail("not_found", "No such customer in this store.");
      // The email is what the customer signs in with (codes are emailed to it, D32): changing it is a power of its own (D440).
      if (change.email !== undefined && !sameEmail(change.email, form.email) && !holds(caller, "customers:email")) {
        return fail("gated", "Changing a customer's email takes a token with customers:email: it is the address they sign in with.");
      }
      const address = change.address === undefined ? null : change.address;
      const saved = await updateCustomer(caller.member, route.id, {
        email: change.email ?? form.email,
        name: change.name ?? form.name,
        phone: change.phone ?? form.phone,
        line1: change.address === undefined ? form.line1 : (address?.line1 ?? ""),
        line2: change.address === undefined ? form.line2 : (address?.line2 ?? ""),
        postalCode: change.address === undefined ? form.postalCode : (address?.postal_code ?? ""),
        city: change.address === undefined ? form.city : (address?.city ?? ""),
        country: change.address === undefined ? form.country : (address?.country ?? ""),
        companyName: change.company_name === undefined ? form.companyName : (change.company_name ?? ""),
        organisationNumber: change.organisation_number === undefined ? form.organisationNumber : (change.organisation_number ?? ""),
      });
      if (!saved.ok) return customerRefusal(saved.problem);
      await record(caller, "customer_changed", {}, { type: "customer", id: route.id });
      return ok(route.name, { data: await customerById(storeId, route.id) });
    }
    case "customers.store_credit": {
      const customer = await customerById(storeId, route.id);
      // Store credit is a gift card of the store's made by a refund (D364), the customer's by their account or the order's address.
      const rows = await readCards(
        storeId,
        sql`g.source = 'refund' and (g.customer_id = ${route.id}::uuid or lower(g.recipient_email) = lower(${customer.email}))`,
        200,
      );
      const cards = rows.map(cardOut);
      const totals = new Map<string, number>();
      for (const card of cards) if (card.state === "active") totals.set(card.currency, (totals.get(card.currency) ?? 0) + card.balance_minor);
      return ok(route.name, { data: { customer_id: route.id, cards, balances: [...totals].map(([currency, amount_minor]) => ({ currency, amount_minor })) } });
    }
    case "customers.loyalty": {
      await customerById(storeId, route.id);
      const { balance, entries } = await customerBonus(storeId, route.id);
      return ok(route.name, {
        data: {
          customer_id: route.id,
          currency: balance.currency,
          available_minor: balance.availableMinor,
          pending_minor: balance.pendingMinor,
          entries: entries.map((e) => ({ id: e.id, kind: e.kind, amount_minor: e.amountMinor, at: e.at, available_at: e.availableAt, expires_at: e.expiresAt, order_id: e.orderId })),
        },
      });
    }
    case "segments.list": {
      const changed = params.get("updated_after") ? await typedRows(z.object({ id: col.uuid }), sql`select id from commerce.segments where store_id = ${storeId}::uuid and ${sinceWhere(params, sql`updated_at`)}`) : null;
      const segments = (await listSegments(storeId)).filter((s) => !changed || changed.some((c) => c.id === s.id));
      return ok(route.name, { data: segments.map((s) => ({ id: s.id, name: s.name, rules: s.rules, updated_at: s.updatedAt })) });
    }
    case "segments.get": {
      const segment = (await getSegment(storeId, route.id)) ?? fail("not_found", "No such segment in this store.");
      // How many, as the Segments page counts them: never who (a page of people stays in the admin).
      const counted = segment.rules ? await evaluateSegment(caller.member.store, segment.rules) : null;
      return ok(route.name, { data: { id: segment.id, name: segment.name, rules: segment.rules, updated_at: segment.updatedAt, people: counted?.people ?? 0, capped: counted?.capped ?? false } });
    }
    case "discounts.get":
      return ok(route.name, { data: await discountOut(storeId, route.id) });
    case "discounts.update":
    case "discounts.disable": {
      const change = route.name === "discounts.update" ? await readBody("discounts.update", request) : { ...(await readBody("discounts.disable", request)), active: false };
      const input = await changedDiscount(caller, route.id, change);
      const saved = await saveDiscount(caller.member, route.id, input);
      if (!saved.ok) return fail("invalid", saved.problems.join(" "));
      await record(caller, route.name === "discounts.update" ? "discount_changed" : "discount_switched_off", {}, { type: "discount", id: route.id });
      return ok(route.name, { data: await discountOut(storeId, route.id) });
    }
    case "gift_cards.list": {
      const state = params.get("state");
      if (state && !(GIFT_CARD_STATES as readonly string[]).includes(state)) return fail("invalid", `state is one of ${GIFT_CARD_STATES.join(", ")}.`);
      const page = paging(params, sql`g.issued_at`, sql`g.id`);
      const rows = await readCards(storeId, sql`${page.where} and ${sinceWhere(params, CARD_UPDATED)} and ${state ? sql`${CARD_STATE} = ${state}` : sql`true`}`, page.limit + 1);
      return ok(route.name, { data: rows.slice(0, page.limit).map(cardOut), next: page.next(rows.map((r) => ({ id: r.id, created_at: r.issued_at, cursor_at: r.cursor_at }))) });
    }
    case "gift_cards.get":
      return ok(route.name, { data: await cardById(storeId, route.id) });
    case "gift_cards.issue": {
      const input = await readBody(route.name, request);
      const store = caller.member.store;
      const issued = await issueGiftCard(store, caller.member.account.id, {
        currency: input.currency,
        amountMinor: input.amount_minor,
        recipientEmail: input.recipient_email ?? null,
        recipientName: input.recipient_name ?? null,
        message: input.message ?? null,
        lang: store.localization.locales[0] ?? "en",
        note: input.note,
      });
      if (!issued.ok) {
        const words = { no_codes: "No code could be made right now. Try again.", amount: "amount_minor: give an amount above 0.", currency: `currency: the store does not sell in ${input.currency}.` };
        return issued.problem === "no_codes" ? fail("failed", words.no_codes) : fail("invalid", words[issued.problem]);
      }
      await record(caller, "gift_card_issued", { amount: input.amount_minor, currency: input.currency }, { type: "gift_card", id: issued.cardId });
      const card = await cardById(storeId, issued.cardId);
      // The code is answered this once; what a replay of the same request answers, and what is kept for it, has none.
      return { ...ok(route.name, { data: { ...card, code: issued.code, emailed: issued.emailed } }, 201), replay: { data: { ...card, code: null, emailed: issued.emailed } } };
    }
    case "gift_cards.disable": {
      const card = await cardById(storeId, route.id);
      const { reason } = await readBody(route.name, request);
      if (card.state === "deactivated") return fail("conflict", "The card is deactivated already.");
      const done = await deactivateGiftCard(storeId, caller.member.account.id, route.id, reason);
      if (!done.ok) return fail("conflict", "The card cannot be deactivated now.");
      await record(caller, "gift_card_deactivated", {}, { type: "gift_card", id: route.id });
      return ok(route.name, { data: await cardById(storeId, route.id) });
    }
    case "subscriptions.list": {
      const status = params.get("status");
      if (status && !(SUBSCRIPTION_STATES_API as readonly string[]).includes(status)) return fail("invalid", `status is one of ${SUBSCRIPTION_STATES_API.join(", ")}.`);
      const page = paging(params, sql`s.created_at`, sql`s.id`);
      const rows = await typedRows(
        z.object({ id: col.uuid, created_at: col.timestamp, cursor_at: z.string() }),
        sql`
          select s.id, s.created_at, ${cursorAt(sql`s.created_at`)} as cursor_at from commerce.subscriptions s
          where s.store_id = ${storeId}::uuid and ${page.where} and ${sinceWhere(params, sql`s.updated_at`)} and ${status ? sql`s.status::text = ${status}` : sql`true`}
          order by s.created_at desc, s.id desc limit ${page.limit + 1}
        `,
      );
      const data = await Promise.all(rows.slice(0, page.limit).map((r) => subscriptionOut(storeId, r.id)));
      return ok(route.name, { data, next: page.next(rows) });
    }
    case "subscriptions.get":
      return ok(route.name, { data: await subscriptionOut(storeId, route.id) });
    case "subscriptions.pause":
    case "subscriptions.cancel": {
      await subscriptionOut(storeId, route.id);
      const change =
        route.name === "subscriptions.pause"
          ? { kind: "pause" as const, periods: (await readBody("subscriptions.pause", request)).periods }
          : { kind: (await readBody("subscriptions.cancel", request)).at === "now" ? ("cancel_now" as const) : ("cancel" as const), periods: 1 };
      // As the subscription page's staff change: Stripe is asked first, its answer saved, and the subscriber told by email.
      const result = await changeSubscription(storeId, route.id, change.kind, { periods: change.periods, actor: "staff" });
      if (!result.ok) {
        if (result.problem === "not_found") return fail("conflict", "The subscription is not running, so it cannot be changed.");
        if (result.problem === "stripe") return fail("failed", "Stripe did not take the change. Nothing changed; try again.");
        return fail(result.problem === "invalid" ? "invalid" : "conflict", result.problem === "invalid" ? "periods: too many to pause for." : "That change is not allowed for the subscription now.");
      }
      await sendSubscriptionChanged(storeId, result.subscription, change.kind);
      await record(caller, `subscription_${change.kind}`, {}, { type: "subscription", id: route.id });
      return ok(route.name, { data: await subscriptionOut(storeId, route.id) });
    }
  }
}
