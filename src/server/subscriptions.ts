import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import type { Delivery } from "@/lib/product-input";
import type { PaymentModeName } from "@/lib/stripe-account";
import { subscriptionStatusFor, type PlanInterval, type SubscriptionStatus } from "@/lib/subscriptions";

import { WEBHOOK_EVENTS, platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Subscriptions (decision D25). A checkout with a purchase option starts a
 * Stripe subscription on the store's own account; Stripe Billing charges each
 * renewal, and each paid renewal becomes an order here, drawn from stock and
 * with its downloads, like any other.
 */

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
  manageToken: string;
  createdAt: string;
  lines: { title: string; sku: string; quantity: number; unitPriceMinor: number; totalMinor: number; delivery: Delivery }[];
  orders: { id: string; number: string; status: string; totalMinor: number; placedAt: string }[];
};

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

async function view(storeId: string, where: ReturnType<typeof sql>): Promise<SubscriptionView | null> {
  const [row] = await db().execute<Row>(sql`
    select * from commerce.subscriptions where store_id = ${storeId}::uuid and ${where}
  `);
  if (!row) return null;
  const [lines, orders] = await Promise.all([
    db().execute<Row>(sql`
      select title, sku, quantity, unit_price_minor, total_minor, delivery from commerce.subscription_lines
      where store_id = ${storeId}::uuid and subscription_id = ${row.id} order by title
    `),
    db().execute<Row>(sql`
      select id, number, status, total_minor, placed_at from commerce.orders
      where store_id = ${storeId}::uuid and subscription_id = ${row.id} and status <> 'cancelled'
      order by placed_at desc
    `),
  ]);
  return {
    id: String(row.id),
    number: String(row.number),
    status: row.status as SubscriptionStatus,
    marketCode: String(row.market_code),
    currency: String(row.currency),
    locale: String(row.locale),
    email: String(row.email ?? ""),
    interval: row.interval as PlanInterval,
    intervalCount: Number(row.interval_count),
    subtotalMinor: Number(row.subtotal_minor),
    shippingMinor: Number(row.shipping_minor),
    totalMinor: Number(row.total_minor),
    taxMinor: Number(row.tax_minor),
    currentPeriodEnd: iso(row.current_period_end),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    cancelledAt: iso(row.cancelled_at),
    manageToken: String(row.manage_token),
    createdAt: iso(row.created_at)!,
    lines: lines.map((l) => ({
      title: String(l.title),
      sku: String(l.sku),
      quantity: Number(l.quantity),
      unitPriceMinor: Number(l.unit_price_minor),
      totalMinor: Number(l.total_minor),
      delivery: l.delivery === "digital" ? "digital" : "physical",
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
  return view(storeId, sql`id = ${id}::uuid`);
}

/** The shopper's view: only the secret in their link finds it. */
export function getSubscriptionByToken(storeId: string, token: string) {
  return view(storeId, sql`manage_token = ${token}`);
}

/** The subscription an order started or renewed. */
export function getSubscriptionForOrder(storeId: string, orderId: string) {
  return view(
    storeId,
    sql`id = (select subscription_id from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid)`,
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
  items: number;
};

/** The store's subscriptions, newest first; ones that never started are left out. */
export async function listSubscriptions(storeId: string): Promise<SubscriptionListRow[]> {
  const rows = await db().execute<Row>(sql`
    select s.id, s.number, s.status, s.email, s.shipping_address ->> 'name' as name, s.interval, s.interval_count,
           s.total_minor, s.currency, s.current_period_end, s.cancel_at_period_end,
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

/** Brings the subscription up to date with Stripe's: status, renewal date, cancellation. */
export async function syncSubscription(storeId: string, subscription: Stripe.Subscription) {
  const periodEnd = subscription.items?.data?.[0]?.current_period_end ?? null;
  // Before the checkout's own event, the subscription is known by the id Kaizen gave it.
  const ownId = subscription.metadata?.subscription_id ?? null;
  const status = subscriptionStatusFor(subscription.status);
  await db().execute(sql`
    update commerce.subscriptions set
      provider_reference = ${subscription.id},
      status = case when ${status} = 'pending' and status <> 'pending' then status
                    else ${status}::commerce.subscription_status end,
      current_period_end = ${periodEnd ? new Date(periodEnd * 1000).toISOString() : null}::timestamptz,
      cancel_at_period_end = ${Boolean(subscription.cancel_at_period_end)},
      cancelled_at = ${subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : null}::timestamptz,
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

export type SubscriptionChange = "cancel" | "resume" | "cancel_now";

/**
 * Cancels at the end of the paid period (what shoppers do), takes that back,
 * or (staff only) ends the subscription at once. Stripe is asked first; its
 * answer is what is saved.
 */
export async function changeSubscription(
  storeId: string,
  subscriptionId: string,
  change: SubscriptionChange,
): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select s.provider_reference, s.provider_account, a.mode
    from commerce.subscriptions s
    join commerce.stripe_accounts a on a.store_id = s.store_id and a.account_id = s.provider_account
    where s.store_id = ${storeId}::uuid and s.id = ${subscriptionId}::uuid
      and s.provider_reference is not null and s.status not in ('cancelled', 'expired', 'pending')
  `);
  const stripe = row ? platformStripe(row.mode as PaymentModeName) : null;
  if (!row || !stripe) return false;
  const reference = String(row.provider_reference);
  const options = { stripeAccount: String(row.provider_account) };
  try {
    const updated =
      change === "cancel_now"
        ? await stripe.subscriptions.cancel(reference, {}, options)
        : await stripe.subscriptions.update(reference, { cancel_at_period_end: change === "cancel" }, options);
    await syncSubscription(storeId, updated);
  } catch {
    return false;
  }
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    select store_id, first_order_id, ${`subscription.${change}`}, '{}'::jsonb, 'system'
    from commerce.subscriptions where store_id = ${storeId}::uuid and id = ${subscriptionId}::uuid
  `);
  return true;
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
