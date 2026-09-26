import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { vatIncluded } from "@/lib/checkout";
import { t } from "@/lib/i18n";
import { variantLabel, type Delivery } from "@/lib/product-input";
import type { PaymentModeName } from "@/lib/stripe-account";
import {
  MAX_PAUSE_PERIODS,
  basketShipping,
  commitmentEnd,
  nextCharge,
  pauseEnd,
  planPrice,
  subscriptionStatusFor,
  type PlanInterval,
  type SubscriptionStatus,
} from "@/lib/subscriptions";

import { WEBHOOK_EVENTS, platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Subscriptions (decision D25). A checkout with a purchase option starts a
 * Stripe subscription on the store's own account; Stripe Billing charges each
 * renewal, and each paid renewal becomes an order here, drawn from stock and
 * with its downloads, like any other.
 */

export type SubscriptionLine = {
  id: string;
  variantId: string | null;
  productId: string | null;
  title: string;
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  delivery: Delivery;
  /** The VAT rate it was sold at (D65): its product's, kept when swapped for another variant of it. */
  taxRate: number;
};

export type SubscriptionView = {
  id: string;
  number: string;
  status: SubscriptionStatus;
  marketCode: string;
  currency: string;
  locale: string;
  email: string;
  interval: PlanInterval;
  intervalCount: number;
  subtotalMinor: number;
  shippingMinor: number;
  totalMinor: number;
  taxMinor: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  /** The free trial's end (D29), past or to come. */
  trialEndsAt: string | null;
  /** Charges and deliveries are paused until then (D29). */
  pausedUntil: string | null;
  /** When it ends, if a cancellation is waiting: at the period's end or the commitment's. */
  endsAt: string | null;
  /** The next charge, after any pause; null once it is ending or over. */
  nextChargeAt: string | null;
  minCycles: number;
  paidCycles: number;
  /** Until when the subscriber is committed (D29): cancelling before ends it then. */
  commitmentEndsAt: string | null;
  manageToken: string;
  createdAt: string;
  lines: SubscriptionLine[];
  orders: { id: string; number: string; status: string; totalMinor: number; placedAt: string }[];
};

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

/**
 * Payments made towards the subscription: each paid order, but not the
 * first when it came with a free trial (nothing that renews was charged).
 */
const paidCycles = sql`(
  select count(*)::int from commerce.orders o
  where o.store_id = s.store_id and o.subscription_id = s.id
    and (o.id <> s.first_order_id or s.trial_ends_at is null)
    and exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured')
)`;

async function view(storeId: string, where: ReturnType<typeof sql>): Promise<SubscriptionView | null> {
  const [row] = await db().execute<Row>(sql`
    select s.*, ${paidCycles} as paid_cycles from commerce.subscriptions s where s.store_id = ${storeId}::uuid and ${where}
  `);
  if (!row) return null;
  const [lines, orders] = await Promise.all([
    db().execute<Row>(sql`
      select l.id, l.variant_id, v.product_id, l.title, l.sku, l.quantity, l.unit_price_minor, l.total_minor, l.delivery, l.tax_rate
      from commerce.subscription_lines l
      left join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
      where l.store_id = ${storeId}::uuid and l.subscription_id = ${row.id} order by l.title
    `),
    db().execute<Row>(sql`
      select id, number, status, total_minor, placed_at from commerce.orders
      where store_id = ${storeId}::uuid and subscription_id = ${row.id} and status <> 'cancelled'
      order by placed_at desc
    `),
  ]);
  const status = row.status as SubscriptionStatus;
  const interval = row.interval as PlanInterval;
  const intervalCount = Number(row.interval_count);
  const periodEnd = iso(row.current_period_end);
  const pausedUntil = row.paused_until && new Date(String(row.paused_until)) > new Date() ? iso(row.paused_until) : null;
  const endsAt = iso(row.cancel_at) ?? (row.cancel_at_period_end ? periodEnd : null);
  const live = status === "active" || status === "paused" || status === "past_due";
  const next =
    live && periodEnd && !endsAt
      ? nextCharge(new Date(periodEnd), pausedUntil ? new Date(pausedUntil) : null, interval, intervalCount)
      : null;
  const minCycles = Number(row.min_cycles ?? 0);
  const paid = Number(row.paid_cycles);
  const commitment = next ? commitmentEnd(next, interval, intervalCount, minCycles, paid) : null;
  return {
    id: String(row.id),
    number: String(row.number),
    status,
    marketCode: String(row.market_code),
    currency: String(row.currency),
    locale: String(row.locale),
    email: String(row.email ?? ""),
    interval,
    intervalCount,
    subtotalMinor: Number(row.subtotal_minor),
    shippingMinor: Number(row.shipping_minor),
    totalMinor: Number(row.total_minor),
    taxMinor: Number(row.tax_minor),
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    cancelledAt: iso(row.cancelled_at),
    trialEndsAt: iso(row.trial_ends_at),
    pausedUntil,
    endsAt: live ? endsAt : null,
    nextChargeAt: next?.toISOString() ?? null,
    minCycles,
    paidCycles: paid,
    commitmentEndsAt: commitment?.toISOString() ?? null,
    manageToken: String(row.manage_token),
    createdAt: iso(row.created_at)!,
    lines: lines.map((l) => ({
      id: String(l.id),
      variantId: l.variant_id ? String(l.variant_id) : null,
      productId: l.product_id ? String(l.product_id) : null,
      title: String(l.title),
      sku: String(l.sku),
      quantity: Number(l.quantity),
      unitPriceMinor: Number(l.unit_price_minor),
      totalMinor: Number(l.total_minor),
      delivery: l.delivery === "digital" ? "digital" : "physical",
      taxRate: Number(l.tax_rate ?? 0),
    })),
    orders: orders.map((o) => ({
      id: String(o.id),
      number: String(o.number),
      status: String(o.status),
      totalMinor: Number(o.total_minor),
      placedAt: iso(o.placed_at)!,
    })),
  };
}

export function getSubscription(storeId: string, id: string) {
  return view(storeId, sql`s.id = ${id}::uuid`);
}

/** The shopper's view: only the secret in their link finds it. */
export function getSubscriptionByToken(storeId: string, token: string) {
  return view(storeId, sql`manage_token = ${token}`);
}

/** The subscription an order started or renewed. */
export function getSubscriptionForOrder(storeId: string, orderId: string) {
  return view(
    storeId,
    sql`s.id = (select subscription_id from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid)`,
  );
}

export type SubscriptionListRow = {
  id: string;
  number: string;
  status: SubscriptionStatus;
  email: string;
  name: string | null;
  interval: PlanInterval;
  intervalCount: number;
  totalMinor: number;
  currency: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  pausedUntil: string | null;
  trialEndsAt: string | null;
  items: number;
};

/** The store's subscriptions, newest first; ones that never started are left out. */
export async function listSubscriptions(storeId: string): Promise<SubscriptionListRow[]> {
  const rows = await db().execute<Row>(sql`
    select s.id, s.number, s.status, s.email, s.shipping_address ->> 'name' as name, s.interval, s.interval_count,
           s.total_minor, s.currency, s.current_period_end, s.cancel_at_period_end, s.cancel_at, s.paused_until, s.trial_ends_at,
           (select coalesce(sum(quantity), 0)::int from commerce.subscription_lines l where l.subscription_id = s.id) as items
    from commerce.subscriptions s
    where s.store_id = ${storeId}::uuid and s.status not in ('pending', 'expired')
    order by s.created_at desc
    limit 500
  `);
  return rows.map((row) => ({
    id: String(row.id),
    number: String(row.number),
    status: row.status as SubscriptionStatus,
    email: String(row.email ?? ""),
    name: row.name ? String(row.name) : null,
    interval: row.interval as PlanInterval,
    intervalCount: Number(row.interval_count),
    totalMinor: Number(row.total_minor),
    currency: String(row.currency),
    currentPeriodEnd: iso(row.current_period_end),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    cancelAt: iso(row.cancel_at),
    pausedUntil: iso(row.paused_until),
    trialEndsAt: iso(row.trial_ends_at),
    items: Number(row.items),
  }));
}

// ---------------------------------------------------------------------------
// From Stripe
// ---------------------------------------------------------------------------

const stripeId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

/**
 * The first payment went through: the subscription is on, with the Stripe
 * subscription behind it and the customer's details from the order.
 */
export async function activateSubscription(storeId: string, orderId: string, session: Stripe.Checkout.Session) {
  const reference = stripeId(session.subscription);
  if (!reference) return;
  await db().execute(sql`
    update commerce.subscriptions s set
      provider_reference = ${reference},
      provider_account = pay.provider_account,
      status = case when s.status = 'pending' then 'active' else s.status end,
      email = o.email,
      shipping_address = o.shipping_address,
      updated_at = now()
    from commerce.orders o, commerce.payments pay
    where s.store_id = ${storeId}::uuid and s.first_order_id = ${orderId}::uuid
      and o.store_id = s.store_id and o.id = s.first_order_id
      and pay.store_id = o.store_id and pay.order_id = o.id and pay.provider_reference = ${session.id}
  `);
}

/**
 * Brings the subscription up to date with Stripe's: status, renewal date,
 * free trial, pause and cancellation. A paused subscription stays active
 * at Stripe, with its charges held back; here it reads as paused.
 */
export async function syncSubscription(storeId: string, subscription: Stripe.Subscription) {
  const periodEnd = subscription.items?.data?.[0]?.current_period_end ?? null;
  // Before the checkout's own event, the subscription is known by the id Kaizen gave it.
  const ownId = subscription.metadata?.subscription_id ?? null;
  const resumesAt = subscription.pause_collection ? (subscription.pause_collection.resumes_at ?? null) : null;
  const mapped = subscriptionStatusFor(subscription.status);
  const status = mapped === "active" && subscription.pause_collection ? "paused" : mapped;
  const time = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);
  await db().execute(sql`
    update commerce.subscriptions set
      provider_reference = ${subscription.id},
      status = case when ${status} = 'pending' and status <> 'pending' then status
                    else ${status}::commerce.subscription_status end,
      current_period_end = ${time(periodEnd)}::timestamptz,
      trial_ends_at = ${time(subscription.trial_end)}::timestamptz,
      paused_until = ${time(resumesAt)}::timestamptz,
      cancel_at = ${subscription.cancel_at_period_end ? null : time(subscription.cancel_at)}::timestamptz,
      cancel_at_period_end = ${Boolean(subscription.cancel_at_period_end)},
      cancelled_at = ${time(subscription.ended_at)}::timestamptz,
      updated_at = now()
    where store_id = ${storeId}::uuid
      and (provider_reference = ${subscription.id}
           or (provider_reference is null and ${ownId}::text is not null and id::text = ${ownId}::text))
  `);
}

/**
 * A renewal was paid: a new order with the subscription's lines, paid,
 * drawn from stock and with its downloads. Once per invoice.
 */
export async function renewSubscription(storeId: string, invoice: Stripe.Invoice): Promise<string | null> {
  if (invoice.billing_reason !== "subscription_cycle") return null; // The first payment is the checkout's.
  const reference = stripeId(invoice.parent?.subscription_details?.subscription);
  if (!reference || !invoice.id) return null;

  return db().transaction(async (tx) => {
    const [sub] = await tx.execute<Row>(sql`
      select s.*, o.billing_address, o.digital_consent_at
      from commerce.subscriptions s
      join commerce.orders o on o.store_id = s.store_id and o.id = s.first_order_id
      where s.store_id = ${storeId}::uuid and s.provider = 'stripe' and s.provider_reference = ${reference}
      for update of s
    `);
    if (!sub) return null;
    const [done] = await tx.execute<Row>(sql`
      select order_id from commerce.payments
      where store_id = ${storeId}::uuid and provider = 'stripe' and provider_reference = ${invoice.id}
    `);
    if (done) return String(done.order_id);

    const [numbered] = await tx.execute<Row>(sql`
      select s.prefix || commerce.next_document_number(${storeId}::uuid, 'order')::text as number
      from commerce.document_series s
      where s.store_id = ${storeId}::uuid and s.series = 'order'
    `);
    const [order] = await tx.execute<Row>(sql`
      insert into commerce.orders (
        store_id, number, market_code, currency, locale, email, status,
        subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, digital_consent_at, subscription_id, customer_id
      ) values (
        ${storeId}::uuid, ${String(numbered.number)}, ${sub.market_code}, ${sub.currency}, ${sub.locale},
        ${sub.email}, 'pending_payment',
        ${sub.subtotal_minor}, ${sub.shipping_minor}, 0, ${sub.tax_minor}, ${sub.total_minor},
        ${JSON.stringify(sub.billing_address ?? {})}::jsonb, ${JSON.stringify(sub.shipping_address ?? {})}::jsonb,
        ${sub.digital_consent_at ?? null}::timestamptz, ${sub.id}::uuid, ${sub.customer_id ?? null}::uuid
      )
      returning id
    `);
    const orderId = String(order.id);
    await tx.execute(sql`
      insert into commerce.order_lines (
        store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor,
        total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion, delivery,
        selling_plan_id, plan_interval, plan_interval_count
      )
      select l.store_id, ${orderId}::uuid, l.variant_id, l.sku, l.title, l.quantity, l.unit_price_minor, 0,
             l.total_minor, round(l.total_minor * l.tax_rate / (1 + l.tax_rate))::bigint, l.tax_rate, l.tax_code,
             case when l.delivery = 'digital' then 'digital_content' else 'none' end::commerce.withdrawal_exclusion,
             l.delivery, l.selling_plan_id, ${sub.interval}::commerce.plan_interval, ${sub.interval_count}
      from commerce.subscription_lines l
      where l.store_id = ${storeId}::uuid and l.subscription_id = ${sub.id}::uuid
    `);
    await tx.execute(sql`
      insert into commerce.payments (
        store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status
      ) values (
        ${storeId}::uuid, ${orderId}::uuid, 'stripe', ${invoice.id}, ${sub.provider_account},
        ${invoice.amount_paid > 0 ? invoice.amount_paid : sub.total_minor}, ${sub.currency}, 'captured'
      )
    `);
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'subscription.renewed',
              ${JSON.stringify({ subscription: sub.number, invoice: invoice.id })}::jsonb, 'stripe')
    `);
    await tx.execute(sql`select commerce.complete_order_payment(${orderId}::uuid, ${invoice.id})`);
    const periodEnd = invoice.lines?.data?.[0]?.period?.end;
    if (periodEnd) {
      await tx.execute(sql`
        update commerce.subscriptions set current_period_end = ${new Date(periodEnd * 1000).toISOString()}::timestamptz,
          status = 'active', updated_at = now()
        where id = ${sub.id}::uuid
      `);
    }
    return orderId;
  });
}

// ---------------------------------------------------------------------------
// To Stripe
// ---------------------------------------------------------------------------

export type SubscriptionChange = "cancel" | "resume" | "cancel_now" | "pause" | "unpause" | "skip";

export type ChangeProblem = "not_found" | "not_allowed" | "invalid" | "stripe";
export type ChangeResult =
  | { ok: true; subscription: SubscriptionView; changed: boolean }
  | { ok: false; problem: ChangeProblem };

type Connected = {
  stripe: Stripe;
  reference: string;
  options: Stripe.RequestOptions;
  subscription: SubscriptionView;
  firstOrderId: string;
};

/** A running subscription with the Stripe client for the store's account. */
async function connected(storeId: string, subscriptionId: string): Promise<Connected | null> {
  const [row] = await db().execute<Row>(sql`
    select s.provider_reference, s.provider_account, s.first_order_id, a.mode
    from commerce.subscriptions s
    join commerce.stripe_accounts a on a.store_id = s.store_id and a.account_id = s.provider_account
    where s.store_id = ${storeId}::uuid and s.id = ${subscriptionId}::uuid
      and s.provider_reference is not null and s.status not in ('cancelled', 'expired', 'pending')
  `);
  const stripe = row ? platformStripe(row.mode as PaymentModeName) : null;
  const subscription = row && stripe ? await getSubscription(storeId, subscriptionId) : null;
  if (!row || !stripe || !subscription) return null;
  return {
    stripe,
    reference: String(row.provider_reference),
    options: { stripeAccount: String(row.provider_account) },
    subscription,
    firstOrderId: String(row.first_order_id),
  };
}

const unix = (date: Date) => Math.floor(date.getTime() / 1000);

async function logChange(storeId: string, orderId: string, type: string, data: Record<string, unknown>, actor: string) {
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${storeId}::uuid, ${orderId}::uuid, ${type}, ${JSON.stringify(data)}::jsonb, ${actor})
  `);
}

/**
 * What can be done to a subscription now (D29). While it runs, it can be
 * paused, skipped and changed; not paused in a free trial or while a
 * payment is failing, and nothing but taking it back once it is ending.
 * Pauses reach at most MAX_PAUSE_PERIODS deliveries ahead.
 */
export function allowedChanges(sub: SubscriptionView, now = new Date()) {
  const live = sub.status === "active" || sub.status === "paused" || sub.status === "past_due";
  const running = live && sub.endsAt === null;
  const inTrial = sub.trialEndsAt !== null && new Date(sub.trialEndsAt) > now;
  const canPause = running && !inTrial && sub.status !== "past_due" && sub.nextChargeAt !== null;
  const limit = sub.currentPeriodEnd
    ? pauseEnd(new Date(sub.currentPeriodEnd), sub.interval, sub.intervalCount, MAX_PAUSE_PERIODS)
    : null;
  const skipTo = sub.nextChargeAt ? pauseEnd(new Date(sub.nextChargeAt), sub.interval, sub.intervalCount, 1) : null;
  return {
    cancel: running,
    resume: live && sub.endsAt !== null,
    pause: canPause && sub.pausedUntil === null,
    skip: canPause && skipTo !== null && limit !== null && skipTo <= limit,
    unpause: running && sub.pausedUntil !== null,
    contents: running,
  };
}

/**
 * Cancels, takes a cancellation back, pauses for some deliveries, skips
 * the next one or ends a pause. A cancellation waits for the end of the
 * paid period, or of the commitment (D29); only staff end one at once.
 * Stripe is asked first; its answer is what is saved.
 */
export async function changeSubscription(
  storeId: string,
  subscriptionId: string,
  change: SubscriptionChange,
  { periods = 1, actor = "shopper" }: { periods?: number; actor?: "shopper" | "staff" } = {},
): Promise<ChangeResult> {
  const c = await connected(storeId, subscriptionId);
  if (!c) return { ok: false, problem: "not_found" };
  const { stripe, reference, options, subscription: sub } = c;
  const allowed = allowedChanges(sub);
  const next = sub.nextChargeAt ? new Date(sub.nextChargeAt) : null;

  let params: Stripe.SubscriptionUpdateParams;
  const data: Record<string, unknown> = {};
  switch (change) {
    case "cancel_now":
      if (actor !== "staff") return { ok: false, problem: "not_allowed" };
      params = {};
      break;
    case "cancel":
      if (!allowed.cancel) return { ok: false, problem: "not_allowed" };
      // Within a commitment, it ends when the last committed payment's period does.
      params = sub.commitmentEndsAt
        ? { cancel_at: unix(new Date(sub.commitmentEndsAt)), proration_behavior: "none" }
        : { cancel_at_period_end: true };
      break;
    case "resume":
      if (!allowed.resume) return { ok: false, problem: "not_allowed" };
      params = sub.cancelAtPeriodEnd ? { cancel_at_period_end: false } : { cancel_at: "" };
      break;
    case "pause":
    case "skip": {
      const count = change === "skip" ? 1 : periods;
      if (!allowed[change] || !next || !Number.isInteger(count) || count < 1 || count > MAX_PAUSE_PERIODS) {
        return { ok: false, problem: change === "pause" && allowed.pause ? "invalid" : "not_allowed" };
      }
      // Stripe voids the invoices due before then, so nothing is charged or sent.
      const until = pauseEnd(next, sub.interval, sub.intervalCount, count);
      params = { pause_collection: { behavior: "void", resumes_at: unix(until) } };
      data.periods = count;
      data.until = until.toISOString();
      break;
    }
    case "unpause":
      if (!allowed.unpause) return { ok: false, problem: "not_allowed" };
      params = { pause_collection: "" };
      break;
  }
  try {
    const updated =
      change === "cancel_now"
        ? await stripe.subscriptions.cancel(reference, {}, options)
        : await stripe.subscriptions.update(reference, params, options);
    await syncSubscription(storeId, updated);
  } catch {
    return { ok: false, problem: "stripe" };
  }
  await logChange(storeId, c.firstOrderId, `subscription.${change}`, data, actor);
  const fresh = await getSubscription(storeId, subscriptionId);
  return fresh ? { ok: true, subscription: fresh, changed: true } : { ok: false, problem: "not_found" };
}

export type SwapChoice = {
  variantId: string;
  sku: string;
  title: string;
  label: string;
  taxCode: string;
  unitPriceMinor: number;
};

/**
 * What each line can be swapped to (D29): the same product's variants
 * with the same delivery, on sale in the subscription's market, at the
 * subscriber's price of the line's purchase option.
 */
export async function swapChoices(storeId: string, subscriptionId: string): Promise<Map<string, SwapChoice[]>> {
  const rows = await db().execute<Row>(sql`
    select l.id as line_id, v.id as variant_id, v.sku, v.options, coalesce(v.tax_code, p.tax_code) as tax_code,
      coalesce(tl.title, tf.title, p.handle) as title, cp.amount_minor, sp.discount_percent
    from commerce.subscription_lines l
    join commerce.subscriptions s on s.store_id = l.store_id and s.id = l.subscription_id
    join commerce.product_variants lv on lv.store_id = l.store_id and lv.id = l.variant_id
    join commerce.product_variants v
      on v.store_id = l.store_id and v.product_id = lv.product_id and v.active and v.delivery = l.delivery
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.status = 'active'
    join commerce.selling_plans sp on sp.store_id = l.store_id and sp.id = l.selling_plan_id
    join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = s.market_code
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = s.locale
    left join lateral (
      select title from commerce.product_translations where product_id = p.id order by locale limit 1
    ) tf on true
    where l.store_id = ${storeId}::uuid and l.subscription_id = ${subscriptionId}::uuid
    order by v.sku
  `);
  const choices = new Map<string, SwapChoice[]>();
  for (const row of rows) {
    const options = (row.options ?? {}) as Record<string, string>;
    const named = Object.keys(options).length > 0;
    const choice: SwapChoice = {
      variantId: String(row.variant_id),
      sku: String(row.sku),
      title: named ? `${row.title} (${variantLabel(options)})` : String(row.title),
      label: named ? variantLabel(options) : String(row.title),
      taxCode: String(row.tax_code),
      unitPriceMinor: planPrice(Number(row.amount_minor), Number(row.discount_percent)),
    };
    const lineId = String(row.line_id);
    choices.set(lineId, [...(choices.get(lineId) ?? []), choice]);
  }
  return choices;
}

export type ContentChange = { lineId: string; variantId: string; quantity: number };

/**
 * Changes what the next deliveries hold (D29): another variant of the same
 * product, another quantity, or a line removed (one must stay; ending it
 * all is cancelling). A line kept as it was keeps its price; a swapped one
 * takes today's. Shipping is worked out again, and Stripe charges the new
 * amounts from the next renewal, with nothing prorated.
 */
export async function changeSubscriptionContents(
  storeId: string,
  subscriptionId: string,
  changes: ContentChange[],
  { actor = "shopper" }: { actor?: "shopper" | "staff" } = {},
): Promise<ChangeResult> {
  const c = await connected(storeId, subscriptionId);
  if (!c) return { ok: false, problem: "not_found" };
  const { stripe, reference, options, subscription: sub } = c;
  if (!allowedChanges(sub).contents) return { ok: false, problem: "not_allowed" };

  const byLine = new Map(changes.map((change) => [change.lineId, change]));
  const invalid =
    byLine.size !== changes.length ||
    changes.some(
      (change) =>
        !sub.lines.some((line) => line.id === change.lineId) ||
        !Number.isInteger(change.quantity) ||
        change.quantity < 0 ||
        change.quantity > MAX_LINE_QUANTITY,
    );
  if (invalid) return { ok: false, problem: "invalid" };

  const choices = await swapChoices(storeId, subscriptionId);
  type NextLine = SubscriptionLine & { taxCode: string | null };
  const lines: NextLine[] = [];
  for (const line of sub.lines) {
    const change = byLine.get(line.id);
    if (!change) {
      lines.push({ ...line, taxCode: null });
    } else if (change.quantity === 0) {
      continue;
    } else if (change.variantId === line.variantId) {
      lines.push({ ...line, taxCode: null, quantity: change.quantity, totalMinor: line.unitPriceMinor * change.quantity });
    } else {
      const choice = choices.get(line.id)?.find((v) => v.variantId === change.variantId);
      if (!choice) return { ok: false, problem: "invalid" };
      lines.push({
        ...line,
        variantId: choice.variantId,
        sku: choice.sku,
        title: choice.title,
        taxCode: choice.taxCode,
        quantity: change.quantity,
        unitPriceMinor: choice.unitPriceMinor,
        totalMinor: choice.unitPriceMinor * change.quantity,
      });
    }
  }
  if (lines.length === 0) return { ok: false, problem: "invalid" };
  const same =
    lines.length === sub.lines.length &&
    lines.every((line, i) => line.variantId === sub.lines[i].variantId && line.quantity === sub.lines[i].quantity);
  if (same) return { ok: true, subscription: sub, changed: false };

  const [[rate], [country]] = await Promise.all([
    db().execute<Row>(sql`
      select amount_minor, free_over_minor from commerce.shipping_rates
      where store_id = ${storeId}::uuid and market_code = ${sub.marketCode}
    `),
    db().execute<Row>(sql`select standard_vat_rate from commerce.countries where code = ${sub.marketCode}`),
  ]);
  if (!rate && lines.some((line) => line.delivery === "physical")) return { ok: false, problem: "not_allowed" };
  const shipping = basketShipping(
    lines.map((line) => ({ totalMinor: line.totalMinor, delivery: line.delivery, recurring: true })),
    rate
      ? {
          amountMinor: Number(rate.amount_minor),
          freeOverMinor: rate.free_over_minor === null ? null : Number(rate.free_over_minor),
        }
      : null,
  ).renewal;
  const vatRate = Number(country?.standard_vat_rate ?? 0);
  const subtotal = lines.reduce((sum, line) => sum + line.totalMinor, 0);
  // Each line keeps its rate (a swap stays within one product, D65); shipping takes the standard rate.
  const tax = lines.reduce((sum, line) => sum + vatIncluded(line.totalMinor, line.taxRate), 0) + vatIncluded(shipping, vatRate);

  try {
    // Stripe's items are replaced: one per line, and one for shipping.
    const current = await stripe.subscriptions.retrieve(reference, { expand: ["items.data.price.product"] }, options);
    const products = new Map<string, string>();
    for (const item of current.items.data) {
      const product = item.price.product;
      if (typeof product !== "string" && !product.deleted) products.set(product.name, product.id);
    }
    const shippingName =
      [...products.keys()].find((name) => !sub.lines.some((line) => line.title === name)) ??
      t(sub.locale.split("-")[0]).shipping;
    const productFor = async (name: string) => {
      const known = products.get(name);
      if (known) return known;
      const created = await stripe.products.create({ name }, options);
      products.set(name, created.id);
      return created.id;
    };
    const currency = sub.currency.toLowerCase();
    const recurring = { interval: sub.interval, interval_count: sub.intervalCount };
    const items: Stripe.SubscriptionUpdateParams.Item[] = current.items.data.map((item) => ({ id: item.id, deleted: true }));
    for (const line of lines) {
      items.push({
        quantity: line.quantity,
        price_data: { currency, product: await productFor(line.title), unit_amount: line.unitPriceMinor, recurring },
      });
    }
    if (shipping > 0) {
      items.push({
        quantity: 1,
        price_data: { currency, product: await productFor(shippingName), unit_amount: shipping, recurring },
      });
    }
    await stripe.subscriptions.update(reference, { items, proration_behavior: "none" }, options);
  } catch {
    return { ok: false, problem: "stripe" };
  }

  await db().transaction(async (tx) => {
    const kept = sql.join(
      [sql`null::uuid`, ...lines.map((line) => sql`${line.id}::uuid`)],
      sql`, `,
    );
    await tx.execute(sql`
      delete from commerce.subscription_lines
      where store_id = ${storeId}::uuid and subscription_id = ${subscriptionId}::uuid and id not in (${kept})
    `);
    for (const line of lines) {
      await tx.execute(sql`
        update commerce.subscription_lines set
          variant_id = ${line.variantId}::uuid, sku = ${line.sku}, title = ${line.title},
          quantity = ${line.quantity}, unit_price_minor = ${line.unitPriceMinor}, total_minor = ${line.totalMinor},
          tax_code = coalesce(${line.taxCode}, tax_code)
        where store_id = ${storeId}::uuid and id = ${line.id}::uuid
      `);
    }
    await tx.execute(sql`
      update commerce.subscriptions set
        subtotal_minor = ${subtotal}, shipping_minor = ${shipping}, total_minor = ${subtotal + shipping},
        tax_minor = ${tax}, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${subscriptionId}::uuid
    `);
  });
  await logChange(
    storeId,
    c.firstOrderId,
    "subscription.change",
    { lines: lines.map((line) => `${line.quantity} × ${line.title}`), totalMinor: subtotal + shipping },
    actor,
  );
  const fresh = await getSubscription(storeId, subscriptionId);
  return fresh ? { ok: true, subscription: fresh, changed: true } : { ok: false, problem: "not_found" };
}

/**
 * Makes sure the platform's webhook for stores' accounts sends the
 * subscription events (added with D25), without replacing it. Checked once
 * per server instance and mode.
 */
const eventsChecked = new Set<PaymentModeName>();

export async function ensureSubscriptionEvents(mode: PaymentModeName): Promise<void> {
  if (eventsChecked.has(mode)) return;
  const stripe = platformStripe(mode);
  const [row] = await db().execute<Row>(sql`
    select endpoint_id from commerce.platform_webhooks where provider = 'stripe' and mode = ${mode} and kind = 'snapshot'
  `);
  if (!stripe || !row) return;
  try {
    const endpoint = await stripe.webhookEndpoints.retrieve(String(row.endpoint_id));
    const missing = WEBHOOK_EVENTS.filter((event) => !endpoint.enabled_events.includes(event));
    if (missing.length > 0 && !endpoint.enabled_events.includes("*")) {
      await stripe.webhookEndpoints.update(endpoint.id, {
        enabled_events: [...endpoint.enabled_events, ...missing] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
      });
    }
    eventsChecked.add(mode);
  } catch {
    // Tried again on the next subscription checkout.
  }
}
