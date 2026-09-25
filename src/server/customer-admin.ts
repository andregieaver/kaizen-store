import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { SubscriptionStatus } from "@/lib/subscriptions";

import type { Address, OrderStatus } from "./orders";

type Row = Record<string, unknown>;

/**
 * A store's customers for staff (D35): everyone who has an account or has
 * bought, one per email. Guests have no account, so a customer is found by
 * any of their records: the account, an order or a subscription. The page
 * for a customer is the account's id, or, for a guest, their latest
 * order's, so no email ever stands in an address.
 */

/** An order that was paid, even if it was cancelled and refunded later (the order's alias is `o`). */
export const bought = sql`(o.status in ('paid', 'fulfilled', 'closed')
  or (o.status = 'cancelled' and exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured')))`;

const LIVE = sql`('active', 'past_due', 'paused')`;

export type CustomerRef = { key: string; email: string; customerId: string | null };

/**
 * Whose record this is (an account, an order or a subscription), and the
 * customer's own address: the account's id, else their latest order's.
 */
export async function findCustomer(storeId: string, id: string): Promise<CustomerRef | null> {
  const [row] = await db().execute<Row>(sql`
    select lower(email) as email, id as customer_id from commerce.customers where store_id = ${storeId}::uuid and id = ${id}::uuid
    union all
    select lower(coalesce(c.email, o.email)), o.customer_id from commerce.orders o
    left join commerce.customers c on c.id = o.customer_id
    where o.store_id = ${storeId}::uuid and o.id = ${id}::uuid and (o.email <> '' or c.id is not null)
    union all
    select lower(coalesce(c.email, s.email)), s.customer_id from commerce.subscriptions s
    left join commerce.customers c on c.id = s.customer_id
    where s.store_id = ${storeId}::uuid and s.id = ${id}::uuid and (s.email <> '' or c.id is not null)
    limit 1
  `);
  if (!row) return null;
  return keyFor(storeId, String(row.email), row.customer_id ? String(row.customer_id) : null);
}

async function keyFor(storeId: string, email: string, customerId: string | null): Promise<CustomerRef | null> {
  const [row] = await db().execute<Row>(sql`
    select
      coalesce(${customerId}::uuid, (select id from commerce.customers where store_id = ${storeId}::uuid and lower(email) = ${email})) as customer_id,
      (select o.id from commerce.orders o where o.store_id = ${storeId}::uuid and lower(o.email) = ${email}
       order by ${bought} desc, o.placed_at desc limit 1) as latest_order
  `);
  const account = row?.customer_id ? String(row.customer_id) : null;
  const key = account ?? (row?.latest_order ? String(row.latest_order) : null);
  return key ? { key, email, customerId: account } : null;
}

export type CustomerSummary = CustomerRef & {
  name: string;
  /** `verified` when the email is proven, `unverified` for a password account not yet proven, null for a guest. */
  account: "verified" | "unverified" | null;
  orders: number;
  liveSubscriptions: number;
  spentMinor: Record<string, number>;
};

/** For the bar on order and subscription pages: who, and how much they have bought. */
export async function customerSummary(storeId: string, id: string): Promise<CustomerSummary | null> {
  const ref = await findCustomer(storeId, id);
  if (!ref) return null;
  const [row] = await db().execute<Row>(sql`
    select
      (select c.name from commerce.customers c where c.id = ${ref.customerId}::uuid) as account_name,
      (select c.email_verified_at is not null from commerce.customers c where c.id = ${ref.customerId}::uuid) as verified,
      (select o.shipping_address ->> 'name' from commerce.orders o
       where o.store_id = ${storeId}::uuid and lower(o.email) = ${ref.email} and o.shipping_address ->> 'name' <> ''
       order by o.placed_at desc limit 1) as order_name,
      (select count(*)::int from commerce.orders o
       where o.store_id = ${storeId}::uuid and (lower(o.email) = ${ref.email} or o.customer_id = ${ref.customerId}::uuid) and ${bought}) as orders,
      (select count(*)::int from commerce.subscriptions s
       where s.store_id = ${storeId}::uuid and (lower(s.email) = ${ref.email} or s.customer_id = ${ref.customerId}::uuid) and s.status in ${LIVE}) as live,
      (select coalesce(jsonb_object_agg(currency, total), '{}') from (
        select o.currency, sum(o.total_minor)::bigint as total from commerce.orders o
        where o.store_id = ${storeId}::uuid and (lower(o.email) = ${ref.email} or o.customer_id = ${ref.customerId}::uuid)
          and o.status in ('paid', 'fulfilled', 'closed')
        group by o.currency) t) as spent
  `);
  return {
    ...ref,
    name: String(row.account_name || row.order_name || ""),
    account: ref.customerId ? (row.verified ? "verified" : "unverified") : null,
    orders: Number(row.orders),
    liveSubscriptions: Number(row.live),
    spentMinor: (row.spent ?? {}) as Record<string, number>,
  };
}

export type CustomerListRow = {
  key: string;
  email: string;
  name: string;
  account: "verified" | "unverified" | null;
  orders: number;
  liveSubscriptions: number;
  spentMinor: Record<string, number>;
  lastOrderAt: string | null;
  since: string;
};

/** Everyone with an account or a paid order, most recently active first; optionally matching a search. */
export async function listCustomers(storeId: string, { q = "", limit = 100 }: { q?: string; limit?: number } = {}): Promise<CustomerListRow[]> {
  const search = q.trim().toLowerCase().slice(0, 100);
  const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db().execute<Row>(sql`
    with bought as (
      -- An order placed signed in belongs to the account, whatever email it was sent to.
      select lower(coalesce(c.email, o.email)) as email, o.id, o.placed_at, o.currency, o.total_minor, o.status,
        nullif(o.shipping_address ->> 'name', '') as name
      from commerce.orders o
      left join commerce.customers c on c.id = o.customer_id
      where o.store_id = ${storeId}::uuid and (o.email <> '' or c.id is not null) and ${bought}
    ),
    by_email as (
      select email, count(*)::int as orders, max(placed_at) as last_order, min(placed_at) as first_order,
        (array_agg(id order by placed_at desc))[1] as latest_order,
        (array_agg(name order by placed_at desc) filter (where name is not null))[1] as name
      from bought group by email
    ),
    spent as (
      select email, jsonb_object_agg(currency, total) as spent from (
        select email, currency, sum(total_minor)::bigint as total from bought
        where status in ('paid', 'fulfilled', 'closed') group by email, currency
      ) t group by email
    ),
    subs as (
      select lower(coalesce(c.email, s.email)) as email, count(*)::int as live from commerce.subscriptions s
      left join commerce.customers c on c.id = s.customer_id
      where s.store_id = ${storeId}::uuid and s.status in ${LIVE} group by 1
    ),
    accounts as (
      select id, lower(email) as email, nullif(name, '') as name, created_at, email_verified_at is not null as verified
      from commerce.customers where store_id = ${storeId}::uuid
    )
    select coalesce(a.email, b.email) as email, a.id as customer_id, b.latest_order,
      coalesce(a.name, b.name, '') as name, a.verified,
      coalesce(b.orders, 0) as orders, coalesce(s.live, 0) as live, coalesce(sp.spent, '{}') as spent,
      b.last_order, least(a.created_at, b.first_order) as since
    from accounts a
    full join by_email b on b.email = a.email
    left join subs s on s.email = coalesce(a.email, b.email)
    left join spent sp on sp.email = coalesce(a.email, b.email)
    where ${search ? sql`(coalesce(a.email, b.email) like ${like} or lower(coalesce(a.name, b.name, '')) like ${like})` : sql`true`}
    order by coalesce(b.last_order, a.created_at) desc nulls last
    limit ${limit}
  `);
  return rows.map((row) => ({
    key: String(row.customer_id ?? row.latest_order),
    email: String(row.email),
    name: String(row.name ?? ""),
    account: row.customer_id ? (row.verified ? "verified" : "unverified") : null,
    orders: Number(row.orders),
    liveSubscriptions: Number(row.live),
    spentMinor: (row.spent ?? {}) as Record<string, number>,
    lastOrderAt: row.last_order ? new Date(String(row.last_order)).toISOString() : null,
    since: new Date(String(row.since)).toISOString(),
  }));
}

export type CustomerDetail = CustomerSummary & {
  phone: string;
  address: Address | null;
  accountCreatedAt: string | null;
  lastSignInAt: string | null;
  firstOrderAt: string | null;
  orderList: { id: string; number: string; status: OrderStatus; placedAt: string; totalMinor: number; currency: string; items: number; subscriptionId: string | null; refunded: boolean }[];
  subscriptionList: { id: string; number: string; status: SubscriptionStatus; totalMinor: number; currency: string; interval: string; intervalCount: number; currentPeriodEnd: string | null; orders: number }[];
  wishlistItems: number;
  cartRemindersOptedOut: boolean;
};

/** Everything about one customer: who they are, what they bought, and how to reach them. */
export async function getCustomerDetail(storeId: string, ref: CustomerRef): Promise<CustomerDetail | null> {
  const summary = await customerSummary(storeId, ref.key);
  if (!summary) return null;
  const mine = (alias: string) =>
    sql`(lower(${sql.raw(alias)}.email) = ${ref.email} or ${sql.raw(alias)}.customer_id = ${ref.customerId}::uuid)`;
  const [[account], orders, subscriptions, [extra]] = await Promise.all([
    ref.customerId
      ? db().execute<Row>(sql`
          select phone, address, created_at, last_sign_in_at from commerce.customers where id = ${ref.customerId}::uuid
        `)
      : Promise.resolve([] as Row[]),
    db().execute<Row>(sql`
      select o.id, o.number, o.status, o.placed_at, o.total_minor, o.currency, o.subscription_id,
        o.shipping_address, o.billing_address,
        (select coalesce(sum(quantity), 0)::int from commerce.order_lines l where l.order_id = o.id) as items,
        exists (select 1 from commerce.refunds r join commerce.payments p on p.id = r.payment_id
                where p.order_id = o.id and r.status <> 'failed') as refunded
      from commerce.orders o
      where o.store_id = ${storeId}::uuid and ${mine("o")} and ${bought}
      order by o.placed_at desc
    `),
    db().execute<Row>(sql`
      select s.id, s.number, s.status, s.total_minor, s.currency, s.interval, s.interval_count, s.current_period_end,
        (select count(*)::int from commerce.orders o where o.subscription_id = s.id and o.status <> 'cancelled') as orders
      from commerce.subscriptions s
      where s.store_id = ${storeId}::uuid and ${mine("s")} and s.status not in ('pending', 'expired')
      order by s.created_at desc
    `),
    db().execute<Row>(sql`
      select
        (select count(*)::int from commerce.wishlist_items i join commerce.wishlists w on w.id = i.wishlist_id
         where w.store_id = ${storeId}::uuid and w.customer_id = ${ref.customerId}::uuid) as wishlist,
        exists (select 1 from commerce.email_opt_outs where store_id = ${storeId}::uuid and lower(email) = ${ref.email}) as opted_out
    `),
  ]);
  const latest = orders[0];
  const shipping = (latest?.shipping_address ?? {}) as Address;
  const billing = (latest?.billing_address ?? {}) as Address;
  const saved = (account?.address ?? {}) as Address;
  const address = saved.line1 ? saved : shipping.line1 ? shipping : null;
  return {
    ...summary,
    phone: String(account?.phone || shipping.phone || billing.phone || ""),
    address,
    accountCreatedAt: account?.created_at ? new Date(String(account.created_at)).toISOString() : null,
    lastSignInAt: account?.last_sign_in_at ? new Date(String(account.last_sign_in_at)).toISOString() : null,
    firstOrderAt: orders.length > 0 ? new Date(String(orders[orders.length - 1].placed_at)).toISOString() : null,
    orderList: orders.map((o) => ({
      id: String(o.id),
      number: String(o.number),
      status: o.status as OrderStatus,
      placedAt: new Date(String(o.placed_at)).toISOString(),
      totalMinor: Number(o.total_minor),
      currency: String(o.currency),
      items: Number(o.items),
      subscriptionId: o.subscription_id ? String(o.subscription_id) : null,
      refunded: Boolean(o.refunded),
    })),
    subscriptionList: subscriptions.map((s) => ({
      id: String(s.id),
      number: String(s.number),
      status: s.status as SubscriptionStatus,
      totalMinor: Number(s.total_minor),
      currency: String(s.currency),
      interval: String(s.interval),
      intervalCount: Number(s.interval_count),
      currentPeriodEnd: s.current_period_end ? new Date(String(s.current_period_end)).toISOString() : null,
      orders: Number(s.orders),
    })),
    wishlistItems: Number(extra?.wishlist ?? 0),
    cartRemindersOptedOut: Boolean(extra?.opted_out),
  };
}
