import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";

import type { Delivery } from "@/lib/product-input";
import type { PaymentModeName } from "@/lib/stripe-account";

import { getStripeSecrets } from "./settings";
import { platformModes, platformStripe, stripeFor } from "./stripe";
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
  /** What a discount code took off, and the code (D31). */
  discountMinor: number;
  discountCode: string | null;
  taxMinor: number;
  totalMinor: number;
  shippingAddress: Address;
  billingAddress: Address;
  lines: {
    id: string;
    variantId: string | null;
    title: string;
    sku: string;
    quantity: number;
    unitPriceMinor: number;
    totalMinor: number;
    delivery: Delivery;
  }[];
  /** Something to ship (false when the order is downloads only). */
  ships: boolean;
  /** When the shopper agreed that downloads start at once (D24). */
  digitalConsentAt: string | null;
  /** The subscription this order started or renewed (D25). */
  subscriptionId: string | null;
};

/** A file the shopper can download from a paid order (D24). */
export type OrderDownload = {
  token: string;
  name: string;
  sizeBytes: number;
  /** Times downloaded so far. */
  used: number;
  /** Downloads left, or null for no limit. */
  left: number | null;
  expiresAt: string | null;
  /** The limit is reached or the link has expired. */
  gone: boolean;
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
  discountMinor: Number(row.discount_minor ?? 0),
  discountCode: row.discount_code ? String(row.discount_code) : null,
  taxMinor: Number(row.tax_minor),
  totalMinor: Number(row.total_minor),
  shippingAddress: (row.shipping_address ?? {}) as Address,
  billingAddress: (row.billing_address ?? {}) as Address,
  lines: lines.map((line) => ({
    id: String(line.id),
    variantId: line.variant_id ? String(line.variant_id) : null,
    title: String(line.title),
    sku: String(line.sku),
    quantity: Number(line.quantity),
    unitPriceMinor: Number(line.unit_price_minor),
    totalMinor: Number(line.total_minor),
    delivery: line.delivery === "digital" ? "digital" : "physical",
  })),
  ships: lines.some((line) => line.delivery !== "digital"),
  digitalConsentAt: row.digital_consent_at ? new Date(String(row.digital_consent_at)).toISOString() : null,
  subscriptionId: row.subscription_id ? String(row.subscription_id) : null,
});

export async function getOrder(storeId: string, orderId: string): Promise<OrderView | null> {
  const [[order], lines] = await Promise.all([
    db().execute<Row>(sql`
      select * from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid
    `),
    db().execute<Row>(sql`
      select id, variant_id, title, sku, quantity, unit_price_minor, total_minor, delivery from commerce.order_lines
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid order by title
    `),
  ]);
  return order ? toOrder(order, lines) : null;
}

/** The paid order's download links, in the files' order. */
export async function getOrderDownloads(storeId: string, orderId: string): Promise<OrderDownload[]> {
  const rows = await db().execute<Row>(sql`
    select d.token, d.downloads, d.max_downloads, d.expires_at, f.name, f.size_bytes,
      (d.max_downloads is not null and d.downloads >= d.max_downloads)
        or (d.expires_at is not null and d.expires_at <= now()) as gone
    from commerce.order_downloads d
    join commerce.product_files f on f.store_id = d.store_id and f.id = d.file_id
    where d.store_id = ${storeId}::uuid and d.order_id = ${orderId}::uuid
    order by f.product_id, f.position, f.name
  `);
  return rows.map((row) => ({
    token: String(row.token),
    name: String(row.name),
    sizeBytes: Number(row.size_bytes),
    used: Number(row.downloads),
    left: row.max_downloads === null ? null : Math.max(0, Number(row.max_downloads) - Number(row.downloads)),
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    gone: Boolean(row.gone),
  }));
}

/**
 * Counts one download and returns the file to send, if the link still works:
 * the order is paid, the limit is not reached and the link has not expired.
 * One statement, so two clicks at once cannot both use the last download.
 */
export async function takeDownload(
  storeId: string,
  token: string,
): Promise<{ path: string; name: string } | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.order_downloads d
       set downloads = d.downloads + 1, last_downloaded_at = now()
      from commerce.product_files f, commerce.orders o
     where d.store_id = ${storeId}::uuid and d.token = ${token}
       and f.store_id = d.store_id and f.id = d.file_id
       and o.store_id = d.store_id and o.id = d.order_id
       and o.status in ('paid', 'fulfilled', 'closed')
       and (d.max_downloads is null or d.downloads < d.max_downloads)
       and (d.expires_at is null or d.expires_at > now())
    returning f.path, f.name
  `);
  return row ? { path: String(row.path), name: String(row.name) } : null;
}

/** Gives back a download that could not be sent (storage was unreachable). */
export async function returnDownload(storeId: string, token: string): Promise<void> {
  await db().execute(sql`
    update commerce.order_downloads set downloads = greatest(downloads - 1, 0)
    where store_id = ${storeId}::uuid and token = ${token}
  `);
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
        where p.store_id = ${storeId}::uuid and p.provider = 'stripe' and p.enabled
          and (p.active_mode = 'test' or exists (
            select 1 from commerce.stripe_accounts a
            where a.store_id = p.store_id and a.mode = p.active_mode and a.card_payments = 'active'
          ))
      ) as payments_on,
      (select active_mode from commerce.payment_providers
        where store_id = ${storeId}::uuid and provider = 'stripe') as active_mode,
      (select amount_minor from commerce.shipping_rates
        where store_id = ${storeId}::uuid and market_code = ${marketCode}) as amount_minor,
      (select free_over_minor from commerce.shipping_rates
        where store_id = ${storeId}::uuid and market_code = ${marketCode}) as free_over_minor
  `);
  return {
    // Test payments also need Kaizen's own test keys to be set.
    paymentsOn: Boolean(row?.payments_on) && (row?.active_mode !== "test" || platformModes().includes("test")),
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
  { unpaid = false, toSend = false }: { unpaid?: boolean; toSend?: boolean } = {},
): Promise<OrderListRow[]> {
  // An order cancelled after payment (and refunded) is still an order.
  const wasPaid = sql`exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured')`;
  const rows = await db().execute<Row>(sql`
    select o.id, o.number, o.status, o.email, o.shipping_address ->> 'name' as name,
           o.placed_at, o.total_minor, o.currency,
           (select coalesce(sum(quantity), 0)::int from commerce.order_lines l where l.order_id = o.id) as items
    from commerce.orders o
    where o.store_id = ${storeId}::uuid
      and ${
        toSend
          ? sql`o.status = 'paid' and exists (select 1 from commerce.order_lines l where l.order_id = o.id and l.delivery = 'physical')`
          : unpaid
            ? sql`(o.status = 'pending_payment' or (o.status = 'cancelled' and not ${wasPaid}))`
            : sql`(o.status not in ('pending_payment', 'cancelled') or (o.status = 'cancelled' and ${wasPaid}))`
      }
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
