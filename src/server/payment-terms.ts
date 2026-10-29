import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, type Db } from "@/db/client";
import { checkCash } from "@/lib/cash-limits";
import { convertMinor, toRates, type Rates } from "@/lib/currency";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { PaymentModeName } from "@/lib/stripe-account";
import { editPaidOutsideInput } from "@/lib/order-edit-input";
import { MANUAL_RECEIVED_DAYS_MAX } from "@/lib/order-limits";
import { marketPath, storeOrigin } from "@/lib/paths";
import {
  isPaymentTerms,
  REMINDER_DAYS_BEFORE,
  termsOffer,
  TERMS_LABELS,
  type PaymentTerms,
  type TermsBasket,
  type TermsCompany,
  type TermsOffer,
} from "@/lib/payment-terms";

import { inMain } from "./analytics-sql";
import { audit, type Membership } from "./auth";
import type { PlacedOrder } from "./checkout";
import { cashLimitInCurrency } from "./draft-orders";
import { settleOrderSessions } from "./draft-sessions";
import { writeOrderEvent } from "./order-actor";
import { accountMayRecordOutside } from "./order-settings";
import { getOrder, type OrderView } from "./orders";
import { checkoutProviderOf } from "./mollie";
import { openMolliePayment } from "./payment-providers/mollie";
import { openPaymentSession, paymentConnection } from "./payment-session";
import { sendTermsNotice } from "./shopper-emails";
import { sendTermsOverdueAlert } from "./staff-alerts";
import type { Store } from "./stores";

type Row = Record<string, unknown>;
type Runner = Pick<Db, "execute">;

/**
 * Payment terms for company accounts (wave 4 unit F, D293, `docs/wave-4-payments.md` 8): a company the store trusts buys now and pays its invoice within
 * 15, 30 or 60 days. Who may is only `termsOffer()` (pure, `src/lib/payment-terms.ts`), here given the store's facts: whether it sells to businesses, the
 * customer's company with its terms and limit, what the company already owes on terms (by currency, converted to the limit's), and the store's day. An
 * order on terms is confirmed as a venue booking is (`confirmOnTerms()` in checkout.ts): `paid` as a shop status with its whole total as the balance, its
 * invoice issued at once with the payment line `due`; it is a sale only when its money arrives (`settleTerms()` from Stripe's page, or
 * `recordTermsPaidOutside()`), and before that it can only be cancelled whole (`voidTerms()`, a `void` refund: its credit note, no money).
 */

export const TERMS_EVENTS = {
  /** The order was bought on terms: `data.terms`, `data.dueOn`. */
  placed: "order.terms_placed",
  /** The balance arrived: `data.via` (`stripe` or `outside`), `data.amount`, and for money outside `data.method`, `data.receivedOn` and the reference as `data.note`. */
  paid: "order.terms_paid",
  /** Part of the balance arrived (D387): as `paid`, with `data.left`, what is still owed. The order is paid when it reaches zero. */
  partPaid: "order.terms_part_paid",
  /** The invoice was cancelled before it was paid (a `void` refund on the terms payment). */
  voided: "order.terms_voided",
  reminded: "order.terms_reminded",
  overdue: "order.terms_overdue",
} as const;

export const TERMS_AUDIT_ACTIONS = {
  /** A company's terms or credit limit were changed (customers area). */
  companyTerms: "company.terms_changed",
  /** Staff recorded an order on terms as paid outside Kaizena Flow (orders area). */
  paidOutside: "order.terms_paid_outside",
} as const;

/** The facts `termsOffer()` is given for one customer of a store. */
export type TermsFacts = {
  businessOn: boolean;
  today: string;
  company: (TermsCompany & { id: string; name: string; organisationNumber: string; creditCurrency: string | null }) | null;
  /** What the company owes on orders on terms not yet paid, by currency. */
  owed: { currency: string; minor: number }[];
  rates: Rates;
};

/**
 * Reads the facts for a customer: in a transaction with `lock`, the company row is locked, so two orders on terms of one company are checked against the
 * limit one after the other.
 */
export async function termsFacts(run: Runner, storeId: string, customerId: string | null, { lock = false }: { lock?: boolean } = {}): Promise<TermsFacts> {
  const [[store], [company], currencies] = await Promise.all([
    run.execute<Row>(sql`
      select commerce.store_audience(s.audience, s.features) <> 'consumers' as business_on, commerce.store_day(s.id, now())::text as today
      from commerce.stores s where s.id = ${storeId}::uuid
    `),
    customerId
      ? run.execute<Row>(sql`
          select co.id, co.name, co.organisation_number, co.active, co.payment_terms, co.credit_limit_minor, trim(co.credit_currency) as credit_currency, c.company_role
          from commerce.customers c
          join commerce.customer_companies co on co.store_id = c.store_id and co.id = c.company_id
          where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
          ${lock ? sql`for update of co` : sql``}
        `)
      : Promise.resolve([] as Row[]),
    run.execute<Row>(sql`select currency, rate from commerce.store_currencies where store_id = ${storeId}::uuid`),
  ]);
  const owed = company
    ? await run.execute<Row>(sql`
        select trim(o.currency) as currency, sum(o.balance_minor)::bigint as minor
        from commerce.order_payment_terms t
        join commerce.orders o on o.store_id = t.store_id and o.id = t.order_id
        where t.store_id = ${storeId}::uuid and t.company_id = ${String(company.id)}::uuid and t.paid_at is null
          and o.status in ('paid', 'fulfilled') and o.balance_minor > 0
        group by 1
      `)
    : [];
  return {
    businessOn: Boolean(store?.business_on),
    today: String(store?.today ?? new Date().toISOString().slice(0, 10)),
    company: company
      ? {
          id: String(company.id),
          name: String(company.name),
          organisationNumber: String(company.organisation_number ?? ""),
          role: company.company_role === "owner" ? "owner" : company.company_role === "employee" ? "employee" : null,
          active: Boolean(company.active),
          terms: isPaymentTerms(company.payment_terms) ? company.payment_terms : null,
          creditLimitMinor: company.credit_limit_minor === null || company.credit_limit_minor === undefined ? null : Number(company.credit_limit_minor),
          creditCurrency: company.credit_currency ? String(company.credit_currency) : null,
        }
      : null,
    owed: owed.map((r) => ({ currency: String(r.currency), minor: Number(r.minor) })),
    // Compared to the minor unit: a limit is not a shown price, so no rounding step.
    rates: toRates(currencies.map((c) => ({ currency: String(c.currency).trim(), rate: c.rate === null ? null : Number(c.rate), roundTo: 1 }))),
  };
}

/** Whether these facts allow this basket on terms: amounts are converted to the limit's currency here (a currency with no rate refuses, never guesses). */
export function decideTerms(facts: TermsFacts, basket: TermsBasket & { currency: string }): TermsOffer {
  const { company } = facts;
  let owedMinor: number | null = 0;
  let orderMinor: number | null = basket.totalMinor;
  if (company && company.creditLimitMinor !== null && company.creditCurrency) {
    const to = company.creditCurrency;
    owedMinor = 0;
    for (const o of facts.owed) {
      const converted = convertMinor(o.minor, o.currency, to, facts.rates);
      if (converted === null) {
        owedMinor = null;
        break;
      }
      owedMinor += converted;
    }
    orderMinor = convertMinor(basket.totalMinor, basket.currency, to, facts.rates);
  }
  return termsOffer({ businessOn: facts.businessOn, company, basket, today: facts.today, owedMinor, orderMinor });
}

/** Whether a signed-in customer's basket may be bought on terms, for the checkout's choice (no lock: `placeOrder()` checks again under one). */
export async function termsForBasket(storeId: string, customerId: string | null, basket: TermsBasket & { currency: string }): Promise<TermsOffer & { companyName: string | null }> {
  const facts = await termsFacts(db(), storeId, customerId);
  return { ...decideTerms(facts, basket), companyName: facts.company?.name ?? null };
}

/** Writes an order's terms in `placeOrder()`'s transaction (the database's rules: an order waiting for payment, not copied, not a host's). */
export async function recordOrderTerms(tx: Runner, storeId: string, orderId: string, companyId: string, offer: { terms: PaymentTerms; dueOn: string }): Promise<void> {
  await tx.execute(sql`
    insert into commerce.order_payment_terms (order_id, store_id, company_id, terms, due_on)
    values (${orderId}::uuid, ${storeId}::uuid, ${companyId}::uuid, ${offer.terms}, ${offer.dueOn}::date)
  `);
  await writeOrderEvent(tx, storeId, orderId, TERMS_EVENTS.placed, { terms: offer.terms, dueOn: offer.dueOn }, "shopper");
}

// ---------------------------------------------------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------------------------------------------------

/** An order on terms not yet paid, under its row lock, or null. */
async function unpaidTerms(tx: Runner, storeId: string, orderId: string): Promise<Row | null> {
  const [row] = await tx.execute<Row>(sql`
    select o.id, o.number, o.status, o.balance_minor, trim(o.currency) as currency, trim(o.market_code) as market_code, t.terms, t.due_on::text as due_on
    from commerce.orders o join commerce.order_payment_terms t on t.store_id = o.store_id and t.order_id = o.id
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and t.paid_at is null and o.status in ('paid', 'fulfilled') and o.balance_minor > 0
      and o.copied_from is null
    for update of o
  `);
  return row ?? null;
}

/**
 * Money towards an order's balance on terms (D387): the whole balance or more settles it (`markTermsPaid()`); less is a part paid, the balance lowered
 * and the history saying what is left. Under the order's lock (the caller's `unpaidTerms()`).
 */
async function applyTermsMoney(tx: Runner, storeId: string, order: Row, amount: number, data: Record<string, unknown>, actor: string): Promise<"paid" | "part"> {
  const orderId = String(order.id);
  const left = Number(order.balance_minor) - amount;
  if (left <= 0) {
    await markTermsPaid(tx, storeId, orderId, data, actor);
    return "paid";
  }
  await tx.execute(sql`update commerce.orders set balance_minor = ${left} where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
  await writeOrderEvent(tx, storeId, orderId, TERMS_EVENTS.partPaid, { ...data, left }, actor);
  return "part";
}

/** The balance is in: the order's balance is 0, the terms are paid, the terms payment (never money) ends, and the history says how. Once. */
async function markTermsPaid(tx: Runner, storeId: string, orderId: string, data: Record<string, unknown>, actor: string): Promise<void> {
  await tx.execute(sql`update commerce.orders set balance_minor = 0 where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
  await tx.execute(sql`update commerce.order_payment_terms set paid_at = now() where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and paid_at is null`);
  await tx.execute(sql`
    update commerce.payments set status = 'cancelled', updated_at = now()
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'terms' and status = 'pending'
  `);
  await writeOrderEvent(tx, storeId, orderId, TERMS_EVENTS.paid, data, actor);
}

export type TermsPayResult = { ok: true; url: string } | { ok: false; problem: "not_found" | "paid" | "processing" | "payments_off" | "payment_error" | "limit" };

/** The presses of *Pay now* one order takes in an hour (a link in a loop would make a Stripe session each time). */
export const TERMS_PRESSES_PER_ORDER_HOUR = 20;

async function takePress(storeId: string, orderId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${`terms:pay:${orderId}`}, date_trunc('hour', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0) <= TERMS_PRESSES_PER_ORDER_HOUR;
}

/** What Stripe is sent for a balance: one line, the invoice's amount, no shipping and no address to ask for (the invoice has the buyer's). */
function balanceOrder(order: OrderView, title: string): PlacedOrder {
  return {
    orderId: order.id,
    number: order.number,
    currency: order.currency,
    lines: [{ title, unitPriceMinor: order.balanceMinor, quantity: 1, recurring: false, dueNowMinor: order.balanceMinor, deposit: false }],
    ships: false,
    subscription: null,
    shippingMinor: 0,
    shippingDiscountMinor: 0,
    deliveryLabel: null,
    creditMinor: 0,
    referralMinor: 0,
    taxMinor: order.taxMinor,
    vatKind: order.vatKind,
    vatReliefMinor: 0,
    shippingReliefMinor: 0,
    treatment: null,
    totalMinor: order.balanceMinor,
    dueNowMinor: order.balanceMinor,
    balanceMinor: 0,
    company: null,
    discount: null,
    hostId: null,
  };
}

/**
 * The buyer pressed *Pay now* on the order page (its key checked by the caller, as the page's own): the balance of an order on terms is paid on Stripe's
 * hosted page, one session per press (the earlier ones closed first: one found paid settles the order, `paid`), with an idempotency key per press as a
 * draft's pay link (D173). A store whose payments are not on Stripe has none (`payments_off`): the buyer pays as the invoice says.
 */
export async function startTermsPayment(shop: { store: Store; market: Market }, orderId: string, origin: string): Promise<TermsPayResult> {
  const { store, market } = shop;
  const order = await getOrder(store.id, orderId);
  if (!order || !order.paymentTerms || order.copied) return { ok: false, problem: "not_found" };
  if (order.paymentTerms.paidAt || order.balanceMinor <= 0) return { ok: false, problem: "paid" };
  if (order.status !== "paid" && order.status !== "fulfilled") return { ok: false, problem: "not_found" };
  if (order.marketCode.trim().toUpperCase() !== market.code.toUpperCase()) return { ok: false, problem: "not_found" };
  if (!(await takePress(store.id, orderId))) return { ok: false, problem: "limit" };
  // A store whose checkout is Mollie's (D292) takes the balance through Mollie too (D387).
  const mollieMode = await mollieTermsMode(store.id);
  if (mollieMode) return startMollieTermsPayment(shop, order, origin, mollieMode);
  const connected = await paymentConnection(store.id);
  if (!connected) return { ok: false, problem: "payments_off" };
  const settled = await settleOrderSessions(store.id, orderId);
  if (settled === "paid") return { ok: false, problem: "paid" };
  if (settled === "processing") return { ok: false, problem: "processing" };
  const [earlier] = await db().execute<Row>(sql`select count(*)::int as n from commerce.payments where store_id = ${store.id}::uuid and order_id = ${orderId}::uuid and provider = 'stripe'`);
  const base = `${storeOrigin(store.slug) ?? origin}${marketPath(store.slug, market.slug)}`;
  const [key] = await db().execute<Row>(sql`
    select provider_reference from commerce.payments where store_id = ${store.id}::uuid and order_id = ${orderId}::uuid and provider = 'terms' order by created_at limit 1
  `);
  const opened = await openPaymentSession({ storeId: store.id, storeSlug: store.slug, market }, balanceOrder(order, t(market.lang).paymentTerms.stripeLine(order.number)), origin, t(market.lang).shipping, {
    ...connected,
    ui: "hosted",
    exactAmounts: true,
    termsBalance: true,
    idempotencyKey: `terms-pay-${orderId}-${Number(earlier?.n ?? 0)}`,
    allowedCountry: order.marketCode.trim().toUpperCase(),
    expiresInSeconds: 24 * 60 * 60 - 60,
    cancelUrl: key ? `${base}/order/${orderId}?session_id=${encodeURIComponent(String(key.provider_reference))}` : `${base}/account`,
    ...(order.email ? { customerEmail: order.email } : {}),
  });
  if (!opened.ok) return { ok: false, problem: "payment_error" };
  return { ok: true, url: opened.url };
}

/** The mode a store's checkout runs on Mollie in, or null when its checkout is Stripe's (`checkoutProviderOf()`, as `startCheckout()` asks it). */
async function mollieTermsMode(storeId: string): Promise<PaymentModeName | null> {
  const [row] = await db().execute<Row>(sql`
    select active_mode from commerce.payment_providers where store_id = ${storeId}::uuid and provider = 'stripe' and enabled
  `);
  if (!row) return null;
  const mode = row.active_mode as PaymentModeName;
  return (await checkoutProviderOf(storeId, mode)) === "mollie" ? mode : null;
}

/**
 * *Pay now* for a store whose checkout is Mollie's (D387): the balance as one Mollie payment on its hosted page, one per press (Mollie's idempotency key
 * counts the earlier ones), returning to the order. Mollie's answer settles it through `applyPaymentAnswer()`'s `terms` purpose, as Stripe's does.
 */
async function startMollieTermsPayment(shop: { store: Store; market: Market }, order: OrderView, origin: string, mode: PaymentModeName): Promise<TermsPayResult> {
  const { store, market } = shop;
  const [open] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.payments where store_id = ${store.id}::uuid and order_id = ${order.id}::uuid and provider = 'mollie' and status = 'pending'
  `);
  if (Number(open?.n ?? 0) > 0) return { ok: false, problem: "processing" };
  const [earlier] = await db().execute<Row>(sql`select count(*)::int as n from commerce.payments where store_id = ${store.id}::uuid and order_id = ${order.id}::uuid and provider = 'mollie'`);
  const opened = await openMolliePayment(
    { storeId: store.id, storeSlug: store.slug, market },
    balanceOrder(order, t(market.lang).paymentTerms.stripeLine(order.number)),
    origin,
    mode,
    { name: "", email: order.email, phone: "", address: null },
    { idempotencyKey: `terms-pay-${order.id}-${Number(earlier?.n ?? 0)}`, cancelPath: "/account" },
  );
  return opened.ok ? { ok: true, url: opened.url } : { ok: false, problem: opened.problem === "payments_off" ? "payments_off" : "payment_error" };
}

/**
 * A Stripe payment of a balance on terms is in (`applyPaymentAnswer()`'s `terms` purpose): the payment is captured and the order settled, under the
 * order's lock, once. Money that arrives for an order no longer owing (paid outside meanwhile, or cancelled) stays a captured payment on the order for staff
 * to refund (the order page shows it); nothing else is changed.
 */
export async function settleTerms(storeId: string, reference: string, provider: "stripe" | "mollie" = "stripe"): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [payment] = await tx.execute<Row>(sql`
      update commerce.payments set status = 'captured', updated_at = now()
      where store_id = ${storeId}::uuid and provider = ${provider} and provider_reference = ${reference} and status = 'pending'
      returning order_id, amount_minor
    `);
    if (!payment) return false;
    const orderId = String(payment.order_id);
    const order = await unpaidTerms(tx, storeId, orderId);
    if (!order) return false;
    // The payment was for what was owed when it was opened; money recorded outside meanwhile may make it the rest, or more (`applyTermsMoney()`).
    await applyTermsMoney(tx, storeId, order, Number(payment.amount_minor), { via: provider, amount: Number(payment.amount_minor) }, "shopper");
    return true;
  });
}

/** A balance payment on Stripe's (or Mollie's) page that failed or lapsed: its row ends; the order still owes. */
export async function endTermsSession(storeId: string, reference: string, status: "failed" | "cancelled", provider: "stripe" | "mollie" = "stripe"): Promise<void> {
  await db().execute(sql`
    update commerce.payments set status = ${status}, updated_at = now()
    where store_id = ${storeId}::uuid and provider = ${provider} and provider_reference = ${reference} and status = 'pending'
  `);
}

export type TermsOutsideResult =
  | { ok: true; cashWarning?: boolean; left?: number }
  | { ok: false; problem: "invalid" | "not_allowed" | "not_found" | "received_on" | "processing" | "already_paid" | "cash_limit" | "amount" };

/** Money received outside Kaizena Flow towards a balance on terms: D173's record, with the amount when it is only part of the balance (D387). */
const termsOutsideInput = editPaidOutsideInput.extend({ amountMinor: z.int().min(1).max(10_000_000_000).optional() });

/**
 * Staff record the balance of an order on terms as paid outside Kaizena Flow (D173's rule: the owner, or staff while `staff_mark_paid` is on): a `manual`
 * payment of the balance with its method, the day received and the reference (in the history's `data.note`, never the audit entry), and the order settled,
 * in one transaction. A Stripe session the buyer opened is closed first; one found paid means the order is settled already.
 */
export async function recordTermsPaidOutside(storeId: string, orderId: string, raw: unknown, accountId: string | null): Promise<TermsOutsideResult> {
  const parsed = termsOutsideInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  const input = parsed.data;
  if (!accountId || !(await accountMayRecordOutside(storeId, accountId))) return { ok: false, problem: "not_allowed" };
  if (input.receivedOn) {
    const [day] = await db().execute<Row>(sql`
      select commerce.store_day(${storeId}::uuid, now())::text as today, (commerce.store_day(${storeId}::uuid, now()) - ${MANUAL_RECEIVED_DAYS_MAX}::int)::text as earliest
    `);
    if (input.receivedOn > String(day?.today) || input.receivedOn < String(day?.earliest)) return { ok: false, problem: "received_on" };
  }
  const settled = await settleOrderSessions(storeId, orderId);
  if (settled === "paid") return { ok: false, problem: "already_paid" };
  if (settled === "processing") return { ok: false, problem: "processing" };
  let cashWarning = false;
  type Done = { ok: true; amount: number; currency: string; number: string; left: number } | { ok: false; problem: "not_found" | "processing" | "cash_limit" | "amount" };
  const done = await db().transaction(async (tx): Promise<Done> => {
    const order = await unpaidTerms(tx, storeId, orderId);
    if (!order) return { ok: false, problem: "not_found" };
    // The whole balance unless the person names a part of it (D387); never more than is owed.
    const balance = Number(order.balance_minor);
    const amount = input.amountMinor ?? balance;
    if (amount > balance) return { ok: false, problem: "amount" };
    const currency = String(order.currency);
    // A session the buyer opened after the step above (*Pay now* reads the order without this lock): money could still arrive, so nothing is recorded now.
    const [open] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.payments where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'stripe' and status = 'pending'`);
    if (Number(open?.n ?? 0) > 0) return { ok: false, problem: "processing" };
    if (input.method === "cash") {
      const code = String(order.market_code);
      const [cash] = await tx.execute<Row>(sql`
        select coalesce(sum(amount_minor), 0)::bigint as minor from commerce.payments
        where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'manual' and method = 'cash' and status = 'captured'
      `);
      const check = checkCash(code, Number(cash?.minor ?? 0) + amount, currency, await cashLimitInCurrency(storeId, code, currency));
      if (check.kind === "refuse") return { ok: false, problem: "cash_limit" };
      cashWarning = check.kind === "warn";
    }
    await tx.execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, kaizen_fee_minor, method, recorded_by, received_on)
      values (${storeId}::uuid, ${orderId}::uuid, 'manual', ${`manual_terms_${randomUUID()}`}, ${amount}, ${currency}, 'captured', 0, ${input.method},
              ${accountId}::uuid, ${input.receivedOn ?? null}::date)
    `);
    await applyTermsMoney(
      tx,
      storeId,
      order,
      amount,
      { via: "outside", amount, method: input.method, ...(input.receivedOn ? { receivedOn: input.receivedOn } : {}), ...(input.reference ? { note: input.reference } : {}) },
      "staff",
    );
    return { ok: true, amount, currency, number: String(order.number), left: balance - amount };
  });
  if (!done.ok) return done;
  await audit(accountId, storeId, TERMS_AUDIT_ACTIONS.paidOutside, { order: done.number, method: input.method, amountMinor: done.amount, currency: done.currency, leftMinor: done.left }, { target: { type: "order", id: orderId } });
  return { ok: true, ...(cashWarning ? { cashWarning } : {}), ...(done.left > 0 ? { left: done.left } : {}) };
}

/**
 * Cancels the invoice of an order on terms not yet paid, in `cancelOrder()`'s step: a `void` refund of the balance on the terms payment (no money, no
 * provider), so the database issues its credit note at commit (D159), and the terms payment ends. True when there was one; the caller then cancels the order.
 */
export async function voidTerms(storeId: string, orderId: string, reason: string, accountId: string | null): Promise<boolean> {
  return db().transaction(async (tx) => {
    const order = await unpaidTerms(tx, storeId, orderId);
    if (!order) return false;
    const [payment] = await tx.execute<Row>(sql`
      select id from commerce.payments where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'terms' and status = 'pending'
      order by created_at limit 1
    `);
    if (!payment) return false;
    await tx.execute(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind, created_by)
      values (${storeId}::uuid, ${String(payment.id)}::uuid, ${Number(order.balance_minor)}, ${reason}, 'succeeded', 'void', ${accountId}::uuid)
    `);
    await tx.execute(sql`update commerce.payments set status = 'cancelled', updated_at = now() where store_id = ${storeId}::uuid and id = ${String(payment.id)}::uuid`);
    await writeOrderEvent(tx, storeId, orderId, TERMS_EVENTS.voided, { amount: Number(order.balance_minor), reason }, "staff");
    return true;
  });
}

/** Whether an order is on terms and not yet paid (an order change, a refund and the venue's *Mark paid* wait until it is). */
export async function owesOnTerms(run: Runner, storeId: string, orderId: string): Promise<boolean> {
  const [row] = await run.execute<Row>(sql`
    select 1 from commerce.order_payment_terms where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and paid_at is null
  `);
  return Boolean(row);
}

// ---------------------------------------------------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------------------------------------------------

export type CompanyTermsInput = { terms: string | null; creditLimitMinor: number | null };

/**
 * Sets a company's terms and credit limit (staff with `customers:write`, checked by the caller), audited with what changed. The limit is kept in the store's
 * main currency as it is now (`credit_currency`); a limit needs terms, and no terms means no limit. Orders already placed keep their own terms.
 */
export async function saveCompanyTerms(member: Pick<Membership, "account" | "store">, companyId: string, input: CompanyTermsInput, mainCurrency: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  const terms = input.terms === null || input.terms === "" ? null : input.terms;
  if (terms !== null && !isPaymentTerms(terms)) return { ok: false, problem: "Choose 15, 30 or 60 days, or no payment terms." };
  const limit = terms === null ? null : input.creditLimitMinor;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) return { ok: false, problem: "The credit limit is a whole amount of zero or more." };
  const [before] = await db().execute<Row>(sql`
    select name, payment_terms, credit_limit_minor, trim(credit_currency) as credit_currency from commerce.customer_companies
    where store_id = ${member.store.id}::uuid and id = ${companyId}::uuid
  `);
  if (!before) return { ok: false, problem: "The company no longer exists." };
  await db().execute(sql`
    update commerce.customer_companies set payment_terms = ${terms}, credit_limit_minor = ${limit},
      credit_currency = ${limit === null ? null : mainCurrency}, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${companyId}::uuid
  `);
  const words = (v: unknown) => (isPaymentTerms(v) ? TERMS_LABELS[v] : "None");
  await audit(
    member.account.id,
    member.store.id,
    TERMS_AUDIT_ACTIONS.companyTerms,
    { name: String(before.name), terms: terms ?? null, creditLimitMinor: limit, currency: limit === null ? null : mainCurrency },
    {
      target: { type: "company", id: companyId },
      changes: {
        terms: { from: words(before.payment_terms), to: words(terms) },
        creditLimit: { from: before.credit_limit_minor === null ? null : `${before.credit_limit_minor} ${before.credit_currency}`, to: limit === null ? null : `${limit} ${mainCurrency}` },
      },
    },
  );
  return { ok: true };
}

/** What a company owes on terms now, by currency, and how much of it is overdue (the store's day). */
export async function companyOwes(storeId: string, companyId: string): Promise<{ currency: string; owedMinor: number; overdueMinor: number; orders: number }[]> {
  const rows = await db().execute<Row>(sql`
    select trim(o.currency) as currency, sum(o.balance_minor)::bigint as owed,
      coalesce(sum(o.balance_minor) filter (where t.due_on < commerce.store_day(t.store_id, now())), 0)::bigint as overdue, count(*)::int as orders
    from commerce.order_payment_terms t
    join commerce.orders o on o.store_id = t.store_id and o.id = t.order_id
    where t.store_id = ${storeId}::uuid and t.company_id = ${companyId}::uuid and t.paid_at is null and o.status in ('paid', 'fulfilled') and o.balance_minor > 0
    group by 1 order by 1
  `);
  return rows.map((r) => ({ currency: String(r.currency), owedMinor: Number(r.owed), overdueMinor: Number(r.overdue), orders: Number(r.orders) }));
}

/** Before a company is deleted: refused while it owes; otherwise its paid orders' terms forget it (the database lets only the company be cleared). */
export async function releaseCompanyTerms(storeId: string, companyId: string): Promise<boolean> {
  if ((await companyOwes(storeId, companyId)).length > 0) return false;
  await db().execute(sql`
    update commerce.order_payment_terms set company_id = null where store_id = ${storeId}::uuid and company_id = ${companyId}::uuid
  `);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------------------------------------------------

export type TermsRun = { reminded: number; overdue: number };

/**
 * The five-minute job: for each order on terms not yet paid in an open store, the reminder three days before its due day and the notice the day after it,
 * each once (claimed by `reminder_sent_at`/`overdue_sent_at` before it is sent; the email's own key makes a retry harmless), the notice also to staff as
 * the alert *Payment overdue*. A due day passed with no reminder sent gets the notice only. One failing order never stops the others.
 */
export async function runTermsJobs({ limit = 100, now = new Date() }: { limit?: number; now?: Date } = {}): Promise<TermsRun> {
  const run: TermsRun = { reminded: 0, overdue: 0 };
  const today = sql`commerce.store_day(t.store_id, ${now.toISOString()}::timestamptz)`;
  const due = await db().execute<Row>(sql`
    select t.store_id, t.order_id,
      case when t.due_on < ${today} then 'overdue' else 'due' end as kind
    from commerce.order_payment_terms t
    join commerce.orders o on o.store_id = t.store_id and o.id = t.order_id
    where t.paid_at is null and o.status in ('paid', 'fulfilled') and o.balance_minor > 0 and o.copied_from is null
      and commerce.store_is_active(t.store_id)
      and (
        (t.overdue_sent_at is null and t.due_on < ${today})
        or (t.reminder_sent_at is null and t.due_on >= ${today} and t.due_on - ${REMINDER_DAYS_BEFORE}::int <= ${today})
      )
    order by t.due_on limit ${limit}
  `);
  for (const row of due) {
    const storeId = String(row.store_id);
    const orderId = String(row.order_id);
    const overdue = row.kind === "overdue";
    try {
      const [claimed] = overdue
        ? await db().execute<Row>(sql`
            update commerce.order_payment_terms set overdue_sent_at = now()
            where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and overdue_sent_at is null and paid_at is null returning order_id
          `)
        : await db().execute<Row>(sql`
            update commerce.order_payment_terms set reminder_sent_at = now()
            where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and reminder_sent_at is null and paid_at is null returning order_id
          `);
      if (!claimed) continue;
      await writeOrderEvent(db(), storeId, orderId, overdue ? TERMS_EVENTS.overdue : TERMS_EVENTS.reminded, {}, "system");
      await sendTermsNotice(storeId, orderId, overdue ? "overdue" : "due");
      if (overdue) {
        await sendTermsOverdueAlert(storeId, orderId);
        run.overdue += 1;
      } else run.reminded += 1;
    } catch {
      // Tried no more for this order: its claim is kept, so a broken email never repeats every five minutes.
    }
  }
  return run;
}

// ---------------------------------------------------------------------------------------------------------------------
// Finance: what is owed (docs/analytics.md "Owed on payment terms")
// ---------------------------------------------------------------------------------------------------------------------

export type TermsOwed = {
  dueMinor: number;
  overdueMinor: number;
  dueOrders: number;
  overdueOrders: number;
  /** Orders in a currency with no rate, left out of the sums and counted. */
  unconverted: number;
  missingCurrencies: string[];
};

/** What the store's companies owe on payment terms now, in the main currency at today's rates: never revenue, a figure of today, not of a period. */
export async function termsOwedReport(store: Store): Promise<TermsOwed> {
  const rows = await db().execute<Row>(sql`
    select trim(o.currency) as currency,
      coalesce(sum(o.balance_minor) filter (where t.due_on >= commerce.store_day(t.store_id, now())), 0)::bigint as due,
      coalesce(sum(o.balance_minor) filter (where t.due_on < commerce.store_day(t.store_id, now())), 0)::bigint as overdue,
      count(*) filter (where t.due_on >= commerce.store_day(t.store_id, now()))::int as due_orders,
      count(*) filter (where t.due_on < commerce.store_day(t.store_id, now()))::int as overdue_orders
    from commerce.order_payment_terms t
    join commerce.orders o on o.store_id = t.store_id and o.id = t.order_id and o.copied_from is null
    where t.store_id = ${store.id}::uuid and t.paid_at is null and o.status in ('paid', 'fulfilled') and o.balance_minor > 0
    group by 1
  `);
  const { values, missing } = inMain(store, rows.map((r) => ({ ...r, currency: String(r.currency) })), ["due", "overdue"]);
  const left = rows.filter((r) => missing.includes(String(r.currency).trim()));
  return {
    dueMinor: values.due ?? 0,
    overdueMinor: values.overdue ?? 0,
    dueOrders: rows.reduce((sum, r) => sum + Number(r.due_orders), 0),
    overdueOrders: rows.reduce((sum, r) => sum + Number(r.overdue_orders), 0),
    unconverted: left.reduce((sum, r) => sum + Number(r.due_orders) + Number(r.overdue_orders), 0),
    missingCurrencies: missing,
  };
}
