import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";

import type { PaymentModeName } from "@/lib/stripe-account";

import { getStripeSecrets } from "./settings";
import { platformStripe, stripeFor } from "./stripe";
import { applySession } from "./stripe-webhooks";

type Row = Record<string, unknown>;

export type OrderStatus = "pending_payment" | "paid" | "fulfilled" | "cancelled" | "closed";

export type Address = {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
};

export type OrderView = {
  id: string;
  number: string;
  status: OrderStatus;
  marketCode: string;
  currency: string;
  locale: string;
  email: string;
  placedAt: string;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  shippingAddress: Address;
  billingAddress: Address;
  lines: { title: string; sku: string; quantity: number; unitPriceMinor: number; totalMinor: number }[];
};

const toOrder = (row: Row, lines: Row[]): OrderView => ({
  id: String(row.id),
  number: String(row.number),
  status: row.status as OrderStatus,
  marketCode: String(row.market_code),
  currency: String(row.currency),
  locale: String(row.locale),
  email: String(row.email ?? ""),
  placedAt: new Date(String(row.placed_at)).toISOString(),
  subtotalMinor: Number(row.subtotal_minor),
  shippingMinor: Number(row.shipping_minor),
  taxMinor: Number(row.tax_minor),
  totalMinor: Number(row.total_minor),
  shippingAddress: (row.shipping_address ?? {}) as Address,
  billingAddress: (row.billing_address ?? {}) as Address,
  lines: lines.map((line) => ({
    title: String(line.title),
    sku: String(line.sku),
    quantity: Number(line.quantity),
    unitPriceMinor: Number(line.unit_price_minor),
    totalMinor: Number(line.total_minor),
  })),
});

export async function getOrder(storeId: string, orderId: string): Promise<OrderView | null> {
  const [[order], lines] = await Promise.all([
    db().execute<Row>(sql`
      select * from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid
    `),
    db().execute<Row>(sql`
      select title, sku, quantity, unit_price_minor, total_minor from commerce.order_lines
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid order by title
    `),
  ]);
  return order ? toOrder(order, lines) : null;
}

/**
 * The order a shopper returns to from Stripe. The order id alone is not
 * enough: the Checkout session id Stripe adds to the return address must
 * match. If the webhook has not arrived yet, Stripe is asked directly.
 */
export async function getShopperOrder(
  storeId: string,
  orderId: string,
  sessionId: string,
): Promise<OrderView | null> {
  const [payment] = await db().execute<Row>(sql`
    select pay.provider_account, a.mode
    from commerce.payments pay
    left join commerce.stripe_accounts a on a.store_id = pay.store_id and a.account_id = pay.provider_account
    where pay.store_id = ${storeId}::uuid and pay.order_id = ${orderId}::uuid
      and pay.provider = 'stripe' and pay.provider_reference = ${sessionId}
  `);
  if (!payment) return null;

  let order = await getOrder(storeId, orderId);
  if (order?.status !== "pending_payment") return order;

  // Stripe is unreachable or slow: the webhook will follow.
  const apply = async (fetch: () => Promise<Stripe.Checkout.Session>) => {
    try {
      await applySession(storeId, await fetch());
      order = await getOrder(storeId, orderId);
      return true;
    } catch {
      return false;
    }
  };
  const stripe = payment.mode ? platformStripe(payment.mode as PaymentModeName) : null;
  if (stripe && payment.provider_account) {
    const stripeAccount = String(payment.provider_account);
    await apply(() => stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount }));
  } else {
    // A payment taken with the store's own keys, before Stripe Connect.
    for (const secret of await getStripeSecrets(storeId)) {
      if (await apply(() => stripeFor(secret).checkout.sessions.retrieve(sessionId))) break;
    }
  }
  return order;
}

/** Whether checkout can start in a market, and its shipping rate. */
export async function getCheckoutInfo(storeId: string, marketCode: string) {
  const [row] = await db().execute<Row>(sql`
    select
      exists (
        select 1 from commerce.payment_providers p
        join commerce.stripe_accounts a on a.store_id = p.store_id and a.mode = p.active_mode
        where p.store_id = ${storeId}::uuid and p.provider = 'stripe' and p.enabled
          and a.card_payments = 'active'
      ) as payments_on,
      (select amount_minor from commerce.shipping_rates
        where store_id = ${storeId}::uuid and market_code = ${marketCode}) as amount_minor,
      (select free_over_minor from commerce.shipping_rates
        where store_id = ${storeId}::uuid and market_code = ${marketCode}) as free_over_minor
  `);
  return {
    paymentsOn: Boolean(row?.payments_on),
    shipping:
      row?.amount_minor == null
        ? null
        : {
            amountMinor: Number(row.amount_minor),
            freeOverMinor: row.free_over_minor == null ? null : Number(row.free_over_minor),
          },
  };
}

export type OrderListRow = {
  id: string;
  number: string;
  status: OrderStatus;
  email: string;
  name: string | null;
  placedAt: string;
  totalMinor: number;
  currency: string;
  items: number;
};

/** The store's orders, newest first. Unpaid checkouts are left out unless asked for. */
export async function listOrders(
  storeId: string,
  { unpaid = false }: { unpaid?: boolean } = {},
): Promise<OrderListRow[]> {
  const rows = await db().execute<Row>(sql`
    select o.id, o.number, o.status, o.email, o.shipping_address ->> 'name' as name,
           o.placed_at, o.total_minor, o.currency,
           (select coalesce(sum(quantity), 0)::int from commerce.order_lines l where l.order_id = o.id) as items
    from commerce.orders o
    where o.store_id = ${storeId}::uuid
      and ${unpaid ? sql`o.status in ('pending_payment', 'cancelled')` : sql`o.status not in ('pending_payment', 'cancelled')`}
    order by o.placed_at desc
    limit 200
  `);
  return rows.map((row) => ({
    id: String(row.id),
    number: String(row.number),
    status: row.status as OrderStatus,
    email: String(row.email ?? ""),
    name: row.name ? String(row.name) : null,
    placedAt: new Date(String(row.placed_at)).toISOString(),
    totalMinor: Number(row.total_minor),
    currency: String(row.currency),
    items: Number(row.items),
  }));
}

export type OrderEvent = { type: string; actor: string; data: Record<string, unknown>; createdAt: string };

export async function getOrderEvents(storeId: string, orderId: string): Promise<OrderEvent[]> {
  const rows = await db().execute<Row>(sql`
    select type, actor, data, created_at from commerce.order_events
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid order by id
  `);
  return rows.map((row) => ({
    type: String(row.type),
    actor: String(row.actor),
    data: (row.data ?? {}) as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}
