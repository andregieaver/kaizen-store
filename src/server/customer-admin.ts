import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { LIST_PAGE_SIZE } from "@/lib/list-page";
import type { SubscriptionStatus } from "@/lib/subscriptions";

import { customerReturns, type CustomerReturns } from "./dispute-evidence";
import type { Address, OrderStatus } from "./orders";
import { bought } from "./bought-sql";
import { col, typedRow, typedRows } from "./typed-rows";

type Row = Record<string, unknown>;

/**
 * A store's customers for staff (D35): everyone who has an account or has
 * bought, one per email. Guests have no account, so a customer is found by
 * any of their records: the account, an order or a subscription. The page
 * for a customer is the account's id, or, for a guest, their latest
 * order's, so no email ever stands in an address.
 */

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
      and o.restricted_at is null and o.anonymised_at is null
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
         and o.restricted_at is null and o.anonymised_at is null
       order by ${bought} desc, o.placed_at desc limit 1) as latest_order
  `);
  const account = row?.customer_id ? String(row.customer_id) : null;
  const key = account ?? (row?.latest_order ? String(row.latest_order) : null);
  return key ? { key, email, customerId: account } : null;
}

export type CustomerSummary = CustomerRef & {
  name: string;
  /** Their own profile picture (D97), if they have an account and chose one. */
  avatarPath: string | null;
  /** `verified` when the email is proven, `unverified` for a password account not yet proven, null for a guest. */
  account: "verified" | "unverified" | null;
  orders: number;
  liveSubscriptions: number;
  spentMinor: Record<string, number>;
  /** Their last year's orders and how many had a return or a refund (D417): the bar says when they return often. */
  returns: CustomerReturns;
};

/** For the bar on order and subscription pages: who, and how much they have bought. */
export async function customerSummary(storeId: string, id: string): Promise<CustomerSummary | null> {
  const ref = await findCustomer(storeId, id);
  if (!ref) return null;
  const [[row], returns] = await Promise.all([db().execute<Row>(sql`
    select
      (select c.name from commerce.customers c where c.id = ${ref.customerId}::uuid) as account_name,
      (select c.avatar_path from commerce.customers c where c.id = ${ref.customerId}::uuid) as avatar_path,
      (select c.email_verified_at is not null from commerce.customers c where c.id = ${ref.customerId}::uuid) as verified,
      (select o.shipping_address ->> 'name' from commerce.orders o
       where o.store_id = ${storeId}::uuid and lower(o.email) = ${ref.email} and o.shipping_address ->> 'name' <> ''
         and o.restricted_at is null and o.anonymised_at is null
       order by o.placed_at desc limit 1) as order_name,
      (select count(*)::int from commerce.orders o
       where o.store_id = ${storeId}::uuid and (lower(o.email) = ${ref.email} or o.customer_id = ${ref.customerId}::uuid) and ${bought}
         and o.restricted_at is null and o.anonymised_at is null) as orders,
      (select count(*)::int from commerce.subscriptions s
       where s.store_id = ${storeId}::uuid and (lower(s.email) = ${ref.email} or s.customer_id = ${ref.customerId}::uuid) and s.status in ${LIVE}) as live,
      (select coalesce(jsonb_object_agg(currency, total), '{}') from (
        select o.currency, sum(o.total_minor)::bigint as total from commerce.orders o
        where o.store_id = ${storeId}::uuid and (lower(o.email) = ${ref.email} or o.customer_id = ${ref.customerId}::uuid)
          and o.copied_from is null and o.status in ('paid', 'fulfilled', 'closed') and o.restricted_at is null and o.anonymised_at is null
        group by o.currency) t) as spent
  `), customerReturns(storeId, ref)]);
  return {
    ...ref,
    name: String(row.account_name || row.order_name || ""),
    avatarPath: row.avatar_path ? String(row.avatar_path) : null,
    account: ref.customerId ? (row.verified ? "verified" : "unverified") : null,
    orders: Number(row.orders),
    liveSubscriptions: Number(row.live),
    spentMinor: (row.spent ?? {}) as Record<string, number>,
    returns,
  };
}

export type CustomerListRow = {
  key: string;
  email: string;
  name: string;
  /** Their own profile picture (D97), if they have an account and chose one. */
  avatarPath: string | null;
  account: "verified" | "unverified" | null;
  orders: number;
  liveSubscriptions: number;
  spentMinor: Record<string, number>;
  lastOrderAt: string | null;
  since: string;
  /** Round 3 (D603): the latest order, for a picture of what they bought; their town; on the store's list. */
  latestOrderId: string | null;
  city: string | null;
  subscribed: boolean;
};

/** Round 3 (D603): the list's views, and its order. */
export type CustomerShow = "new" | "back" | "subscribed";
export type CustomerSort = "recent" | "orders" | "name";

/** What the list shows: a search by email or name, a tag, a view and an order (D603). */
export type CustomerFilter = { q?: string; tag?: string | null; show?: CustomerShow | null; sort?: CustomerSort };

const CUSTOMER_ROW = z.object({
  email: col.text,
  customer_id: col.uuid.nullable(),
  latest_order: col.uuid.nullable(),
  name: col.text,
  avatar_path: col.textOrNull,
  verified: col.bool.nullable(),
  orders: col.int,
  live: col.int,
  spent: z.record(z.string(), col.int),
  last_order: col.timestampOrNull,
  since: col.timestamp,
  city: col.textOrNull,
  subscribed: col.bool,
  /** How many the filter finds in all, on every page (code review 1.13, D834). */
  total: col.int,
});

/** Everyone with an account or a paid order, most recently active first; optionally matching a search. */
export async function listCustomers(storeId: string, options: CustomerFilter & { limit?: number } = {}): Promise<CustomerListRow[]> {
  return (await customerPage(storeId, options)).rows;
}

/**
 * A page of the list (code review 1.13, D834): the rows from `offset`, `limit` of them (a hundred unless said), and how many the same
 * filter finds in all. The order ends on the email, so a page's edge never loses or repeats a person.
 */
export async function customerPage(
  storeId: string,
  { q = "", tag = null, limit = LIST_PAGE_SIZE, offset = 0, show = null, sort = "recent" }: CustomerFilter & { limit?: number; offset?: number } = {},
): Promise<{ rows: CustomerListRow[]; total: number }> {
  const search = q.trim().toLowerCase().slice(0, 100);
  const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await typedRows(CUSTOMER_ROW, sql`
    with bought as (
      -- An order placed signed in belongs to the account, whatever email it was sent to.
      select lower(coalesce(c.email, o.email)) as email, o.id, o.placed_at, o.currency, o.total_minor, o.status,
        nullif(o.shipping_address ->> 'name', '') as name, nullif(o.shipping_address ->> 'city', '') as city
      from commerce.orders o
      left join commerce.customers c on c.id = o.customer_id
      -- A restricted order belongs to nobody any more (D162): it still counts in revenue elsewhere, never under a person.
      where o.store_id = ${storeId}::uuid and (o.email <> '' or c.id is not null) and ${bought} and o.restricted_at is null and o.anonymised_at is null
    ),
    by_email as (
      select email, count(*)::int as orders, max(placed_at) as last_order, min(placed_at) as first_order,
        (array_agg(id order by placed_at desc))[1] as latest_order,
        (array_agg(name order by placed_at desc) filter (where name is not null))[1] as name,
        (array_agg(city order by placed_at desc) filter (where city is not null))[1] as city
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
      select id, lower(email) as email, nullif(name, '') as name, avatar_path, created_at, email_verified_at is not null as verified
      from commerce.customers where store_id = ${storeId}::uuid
    )
    select coalesce(a.email, b.email) as email, a.id as customer_id, b.latest_order,
      coalesce(a.name, b.name, '') as name, a.avatar_path, a.verified,
      coalesce(b.orders, 0) as orders, coalesce(s.live, 0) as live, coalesce(sp.spent, '{}') as spent,
      b.last_order, least(a.created_at, b.first_order) as since, b.city,
      exists (select 1 from commerce.marketing_subscribers ms where ms.store_id = ${storeId}::uuid and ms.email = coalesce(a.email, b.email) and ms.status = 'subscribed') as subscribed,
      count(*) over ()::int as total
    from accounts a
    full join by_email b on b.email = a.email
    left join subs s on s.email = coalesce(a.email, b.email)
    left join spent sp on sp.email = coalesce(a.email, b.email)
    where ${search ? sql`(coalesce(a.email, b.email) like ${like} or lower(coalesce(a.name, b.name, '')) like ${like})` : sql`true`}
      -- A tag (D296, D366) is the store's own, by its key: the people staff tagged so.
      and ${tag ? sql`exists (select 1 from commerce.customer_tags t where t.store_id = ${storeId}::uuid and t.email = coalesce(a.email, b.email) and t.key = ${tag})` : sql`true`}
      and ${customerShowWhere(storeId, show)}
    order by ${sort === "orders" ? sql`coalesce(b.orders, 0) desc, ` : sort === "name" ? sql`lower(coalesce(a.name, b.name, coalesce(a.email, b.email))), ` : sql``}coalesce(b.last_order, a.created_at) desc nulls last, coalesce(a.email, b.email)
    limit ${limit} offset ${offset}
  `);
  return {
    rows: rows.map((row) => ({
      key: String(row.customer_id ?? row.latest_order),
      email: row.email,
      name: row.name,
      avatarPath: row.avatar_path,
      account: row.customer_id ? (row.verified ? "verified" : "unverified") : null,
      orders: row.orders,
      liveSubscriptions: row.live,
      spentMinor: row.spent,
      lastOrderAt: row.last_order,
      since: row.since,
      latestOrderId: row.latest_order,
      city: row.city,
      subscribed: row.subscribed,
    })),
    total: rows[0]?.total ?? 0,
  };
}

/** The view's rule, over the list's `a` (accounts) and `b` (by email) rows: new since the month began, bought twice or more, or on the store's list. */
function customerShowWhere(storeId: string, show: CustomerShow | null) {
  if (show === "new") return sql`least(a.created_at, b.first_order) >= date_trunc('month', now())`;
  if (show === "back") return sql`coalesce(b.orders, 0) >= 2`;
  if (show === "subscribed")
    return sql`exists (select 1 from commerce.marketing_subscribers ms where ms.store_id = ${storeId}::uuid and ms.email = coalesce(a.email, b.email) and ms.status = 'subscribed')`;
  return sql`true`;
}

export type CustomerDetail = CustomerSummary & {
  phone: string;
  address: Address | null;
  accountCreatedAt: string | null;
  lastSignInAt: string | null;
  firstOrderAt: string | null;
  orderList: { id: string; number: string; status: OrderStatus; placedAt: string; totalMinor: number; currency: string; items: number; subscriptionId: string | null; refunded: boolean; /** History copied from another store (D129). */ copied: boolean }[];
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
                where p.order_id = o.id and r.status <> 'failed') as refunded,
        o.copied_from is not null as copied
      from commerce.orders o
      -- History copied from another store (D129) is listed, but never counted.
      where o.store_id = ${storeId}::uuid and ${mine("o")} and (${bought} or o.copied_from is not null)
        and o.restricted_at is null and o.anonymised_at is null
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
      copied: Boolean(o.copied),
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

const COUNTS_ROW = z.object({ people: col.int, fresh: col.int, back: col.int, subscribed: col.int, buyers: col.int, spent: col.minor });

export type CustomerCounts = { people: number; fresh: number; back: number; subscribed: number; averageSpentMinor: number | null };

/**
 * Round 3 (D603): the list's figures. Everyone who bought (paid), how many first bought this month, how many bought twice or more, how many of
 * them are on the store's list, and what a buyer spent on average in the store's main currency (orders in another currency left out).
 */
export async function customerCounts(storeId: string, currency: string): Promise<CustomerCounts> {
  const row = await typedRow(COUNTS_ROW, sql`
    with bought as (
      select lower(coalesce(c.email, o.email)) as email, o.placed_at, o.currency, o.total_minor, o.status
      from commerce.orders o
      left join commerce.customers c on c.id = o.customer_id
      where o.store_id = ${storeId}::uuid and (o.email <> '' or c.id is not null) and ${bought} and o.restricted_at is null and o.anonymised_at is null
    ),
    people as (
      select email, count(*)::int as orders, min(placed_at) as first_order,
        coalesce(sum(total_minor) filter (where currency = ${currency} and status in ('paid', 'fulfilled', 'closed')), 0)::bigint as spent
      from bought group by email
    )
    select count(*)::int as people,
      (count(*) filter (where first_order >= date_trunc('month', now())))::int as fresh,
      (count(*) filter (where orders >= 2))::int as back,
      (count(*) filter (where exists (select 1 from commerce.marketing_subscribers ms where ms.store_id = ${storeId}::uuid and ms.email = people.email and ms.status = 'subscribed')))::int as subscribed,
      (count(*) filter (where spent > 0))::int as buyers,
      coalesce(sum(spent), 0)::bigint as spent
    from people
  `);
  if (!row) return { people: 0, fresh: 0, back: 0, subscribed: 0, averageSpentMinor: null };
  return { people: row.people, fresh: row.fresh, back: row.back, subscribed: row.subscribed, averageSpentMinor: row.buyers > 0 ? Math.round(row.spent / row.buyers) : null };
}
