import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { col, typedRow, typedRows } from "./typed-rows";

/**
 * What the store's Home draws beyond the control center's figures (admin redesign round 1): the week's sales day by day against the week
 * before, the orders waiting to be sent with pictures of what is in them, the latest orders' pictures and towns, and how many orders the
 * store has had (its milestones). Counted in code from the store's own rows; the caller has checked the member may read orders.
 */

/** An order counts as a sale as the control center counts one: not cancelled, not a copy, and its payment captured. */
const PAID = sql`(o.status <> 'cancelled' and o.copied_from is null and exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured'))`;

const DAY_ROW = z.object({ day: col.text, currency: col.currency, total: col.minor, orders: col.int });

export type SalesDay = { day: string; total: number; orders: number };
export type WeekSales = { currency: string; days: SalesDay[]; prior: SalesDay[] };

/** The last 7 days (today last) and the 7 before, in the store's time zone, for the currency it sold most in; null with no sales in either. */
export async function weekSales(storeId: string, timeZone: string, now = new Date()): Promise<WeekSales | null> {
  const rows = await typedRows(DAY_ROW, sql`
    select to_char((o.placed_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as day, o.currency,
           coalesce(sum(o.total_minor), 0)::bigint as total, count(*)::int as orders
    from commerce.orders o
    where o.store_id = ${storeId}::uuid and ${PAID}
      and (o.placed_at at time zone ${timeZone})::date > ((${now.toISOString()}::timestamptz at time zone ${timeZone})::date - 14)
    group by 1, 2
  `);
  if (rows.length === 0) return null;
  const byCurrency = new Map<string, number>();
  for (const row of rows) byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.total);
  const currency = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const dayAt = (offset: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  const found = new Map(rows.filter((r) => r.currency === currency).map((r) => [r.day, r]));
  const at = (offset: number): SalesDay => {
    const day = dayAt(offset);
    const row = found.get(day);
    return { day, total: row?.total ?? 0, orders: row?.orders ?? 0 };
  };
  return { currency, days: [6, 5, 4, 3, 2, 1, 0].map(at), prior: [13, 12, 11, 10, 9, 8, 7].map(at) };
}

const PREVIEW_ROW = z.object({
  order_id: col.uuid,
  number: col.text,
  name: col.textOrNull,
  city: col.textOrNull,
  placed_at: col.timestamp,
  title: col.text,
  quantity: col.int,
  picture: col.textOrNull,
});

export type OrderPreview = {
  id: string;
  number: string;
  name: string | null;
  city: string | null;
  placedAt: string;
  items: number;
  lines: { title: string; quantity: number; picture: string | null }[];
};

/** Who an order goes to, where, and what is in it with a picture of each: for the orders given, in the order given. */
export async function orderPreviews(storeId: string, orderIds: string[]): Promise<OrderPreview[]> {
  if (orderIds.length === 0) return [];
  const rows = await typedRows(PREVIEW_ROW, sql`
    select o.id as order_id, o.number, nullif(o.shipping_address ->> 'name', '') as name, nullif(o.shipping_address ->> 'city', '') as city,
           o.placed_at, l.title, l.quantity,
           coalesce(v.image_thumbnail_url, v.image_url, m.picture) as picture
    from commerce.orders o
    join commerce.order_lines l on l.store_id = o.store_id and l.order_id = o.id
    left join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
    left join lateral (
      select coalesce(pm.thumbnail_url, pm.url) as picture from commerce.product_media pm
      where pm.store_id = v.store_id and pm.product_id = v.product_id order by pm.position limit 1
    ) m on true
    where o.store_id = ${storeId}::uuid and o.id in (${sql.join(orderIds.map((id) => sql`${id}::uuid`), sql`, `)})
    order by o.placed_at, l.id
  `);
  const byOrder = new Map<string, OrderPreview>();
  for (const row of rows) {
    const order = byOrder.get(row.order_id) ?? { id: row.order_id, number: row.number, name: row.name, city: row.city, placedAt: row.placed_at, items: 0, lines: [] };
    order.items += row.quantity;
    order.lines.push({ title: row.title, quantity: row.quantity, picture: row.picture });
    byOrder.set(row.order_id, order);
  }
  return orderIds.flatMap((id) => byOrder.get(id) ?? []);
}

const ID_ROW = z.object({ id: col.uuid });

/** The orders waiting to be sent, oldest first: the control center's own rule for "waiting to be sent". */
export async function ordersToSend(storeId: string, limit = 4): Promise<string[]> {
  const rows = await typedRows(ID_ROW, sql`
    select o.id from commerce.orders o
    where o.store_id = ${storeId}::uuid and (o.status = 'paid' or (o.status = 'authorized' and o.capture_mode = 'when_sent')) and o.copied_from is null and o.delivery_method = 'ship'
      and exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical')
    order by o.placed_at
    limit ${limit}
  `);
  return rows.map((r) => r.id);
}

const COUNT_ROW = z.object({ n: col.int });

/** How many paid orders the store has had: its milestones are counted from it. */
export async function paidOrderCount(storeId: string): Promise<number> {
  const row = await typedRow(COUNT_ROW, sql`select count(*)::int as n from commerce.orders o where o.store_id = ${storeId}::uuid and ${PAID}`);
  return row?.n ?? 0;
}

const LINE_PICTURE_ROW = z.object({ id: col.uuid, picture: col.textOrNull });

/** A picture for each of an order's lines (its variant's, else its product's first), by line id: for the order page's items. */
export async function linePictures(storeId: string, orderId: string): Promise<Map<string, string | null>> {
  const rows = await typedRows(LINE_PICTURE_ROW, sql`
    select l.id, coalesce(v.image_thumbnail_url, v.image_url, m.picture) as picture
    from commerce.order_lines l
    left join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
    left join lateral (
      select coalesce(pm.thumbnail_url, pm.url) as picture from commerce.product_media pm
      where pm.store_id = v.store_id and pm.product_id = v.product_id order by pm.position limit 1
    ) m on true
    where l.store_id = ${storeId}::uuid and l.order_id = ${orderId}::uuid
  `);
  return new Map(rows.map((r) => [r.id, r.picture]));
}

const SEND_COUNT_ROW = z.object({ n: col.int, oldest: col.timestampOrNull, first: z.string().nullable() });

/** How many orders wait to be sent, when the oldest was placed and which it is: the orders list's header and its default view (round 2, D597). */
export async function toSendSummary(storeId: string): Promise<{ count: number; oldest: string | null; firstId: string | null }> {
  const row = await typedRow(SEND_COUNT_ROW, sql`
    select count(*)::int as n, min(o.placed_at) as oldest,
           (array_agg(o.id::text order by o.placed_at))[1] as first
    from commerce.orders o
    where o.store_id = ${storeId}::uuid and (o.status = 'paid' or (o.status = 'authorized' and o.capture_mode = 'when_sent')) and o.copied_from is null and o.delivery_method = 'ship'
      and o.archived_at is null
      and exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical')
  `);
  return { count: row?.n ?? 0, oldest: row?.oldest ?? null, firstId: row?.first ?? null };
}

const SKU_ROW = z.object({ product_id: col.uuid, sku: col.text });

/** Every product's SKUs, by product: the products list searches them in the browser (round 2, D597). */
export async function productSkus(storeId: string): Promise<Record<string, string[]>> {
  const rows = await typedRows(SKU_ROW, sql`select product_id, sku from commerce.product_variants where store_id = ${storeId}::uuid`);
  const out: Record<string, string[]> = {};
  for (const row of rows) (out[row.product_id] ??= []).push(row.sku);
  return out;
}

const TEAM_ROW = z.object({ n: col.int });

/** How many people work in the store (members not switched off and not expired): the Team card's line (round 2, D597). */
export async function teamSize(storeId: string): Promise<number> {
  const row = await typedRow(TEAM_ROW, sql`
    select count(*)::int as n from commerce.store_members m
    where m.store_id = ${storeId}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
  `);
  return row?.n ?? 0;
}
