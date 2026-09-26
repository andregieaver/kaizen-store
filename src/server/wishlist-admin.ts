import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";

import { bought } from "./customer-admin";

type Row = Record<string, unknown>;

/**
 * Wishlists for the store's admin (decision D36): every shopper's lists
 * and what is in them, and each item that went from a list to the cart,
 * followed to the order the cart became. Read-only: shoppers own their lists.
 */

const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const toIso = (value: unknown) => new Date(String(value)).toISOString();

export type WishlistOwner = { customerId: string; name: string; email: string } | null;

function toOwner(row: Row): WishlistOwner {
  return row.customer_id
    ? { customerId: String(row.customer_id), name: String(row.customer_name ?? ""), email: String(row.customer_email) }
    : null;
}

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

export type WishlistFigures = {
  lists: number;
  savedItems: number;
  shoppers: number;
  /** Items put in the cart from a list, and how many of those were bought. */
  toCart: number;
  bought: number;
  boughtMinor: Record<string, number>;
};

export async function wishlistFigures(storeId: string): Promise<WishlistFigures> {
  const [lists] = await db().execute<Row>(sql`
    select count(*)::int as lists,
      (select count(*)::int from commerce.wishlist_items i where i.store_id = ${storeId}::uuid) as items,
      count(distinct coalesce(w.customer_id::text, w.browser_token_hash))::int as shoppers
    from commerce.wishlists w where w.store_id = ${storeId}::uuid
  `);
  // One row per currency bought in (or one with none), each carrying the totals.
  const adds = await db().execute<Row>(sql`
    with adds as (${cartAddsQuery(storeId, sql`true`)})
    select (select count(*)::int from adds) as to_cart,
      (select count(*)::int from adds where status = 'bought') as bought,
      money.currency, money.minor
    from (select 1) one
    left join (
      select order_currency as currency, sum(bought_minor)::bigint as minor from adds
      where status = 'bought' group by order_currency
    ) money on true
  `);
  return {
    lists: Number(lists.lists),
    savedItems: Number(lists.items),
    shoppers: Number(lists.shoppers),
    toCart: Number(adds[0]?.to_cart ?? 0),
    bought: Number(adds[0]?.bought ?? 0),
    boughtMinor: Object.fromEntries(adds.filter((m) => m.currency).map((m) => [String(m.currency), Number(m.minor)])),
  };
}

// ---------------------------------------------------------------------------
// The lists
// ---------------------------------------------------------------------------

export type StoreWishlistRow = {
  id: string;
  name: string;
  owner: WishlistOwner;
  items: number;
  toCart: number;
  bought: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Every shopper's lists, most recently changed first; optionally one
 * customer's, or those matching a search by list name, customer or product.
 */
export async function listStoreWishlists(
  storeId: string,
  { q = "", customerId = null, limit = 200 }: { q?: string; customerId?: string | null; limit?: number } = {},
): Promise<StoreWishlistRow[]> {
  const search = q.trim().toLowerCase().slice(0, 100);
  const like = escapeLike(search);
  const rows = await db().execute<Row>(sql`
    with adds as (${cartAddsQuery(storeId, sql`a.wishlist_id is not null`)})
    select w.id, w.name, w.customer_id, c.name as customer_name, c.email as customer_email, w.created_at,
      greatest(w.updated_at, (select max(i.created_at) from commerce.wishlist_items i where i.wishlist_id = w.id)) as updated_at,
      (select count(*)::int from commerce.wishlist_items i where i.wishlist_id = w.id) as items,
      coalesce(s.to_cart, 0) as to_cart, coalesce(s.bought, 0) as bought
    from commerce.wishlists w
    left join commerce.customers c on c.store_id = w.store_id and c.id = w.customer_id
    left join (
      select wishlist_id, count(*)::int as to_cart, count(*) filter (where status = 'bought')::int as bought
      from adds group by wishlist_id
    ) s on s.wishlist_id = w.id
    where w.store_id = ${storeId}::uuid
      ${customerId ? sql`and w.customer_id = ${customerId}::uuid` : sql``}
      ${
        search
          ? sql`and (lower(w.name) like ${like} or lower(coalesce(c.name, '')) like ${like} or lower(coalesce(c.email, '')) like ${like}
              or exists (
                select 1 from commerce.wishlist_items i
                join commerce.product_translations t on t.product_id = i.product_id
                where i.wishlist_id = w.id and lower(t.title) like ${like}
              ))`
          : sql``
      }
    order by updated_at desc, w.id
    limit ${limit}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    owner: toOwner(row),
    items: Number(row.items),
    toCart: Number(row.to_cart),
    bought: Number(row.bought),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));
}

export type StoreWishlistItem = {
  id: string;
  productId: string;
  title: string;
  image: string | null;
  productStatus: string;
  variant: { sku: string; options: Record<string, string> } | null;
  /** Variants the shopper can choose from; one means none needs choosing. */
  variants: number;
  quantity: number;
  /** The variant's price now, or the product's lowest, in the store's first market. */
  priceMinor: number | null;
  currency: string | null;
  /** Stock that can be sold now, for the chosen variant or all of the product's; null for digital. */
  available: number | null;
  savedAt: string;
};

export type StoreWishlist = {
  id: string;
  name: string;
  owner: WishlistOwner;
  keepAfterCart: boolean;
  createdAt: string;
  updatedAt: string;
  items: StoreWishlistItem[];
};

/** One list with what is in it, newest first; only the store's own. */
export async function getStoreWishlist(
  storeId: string,
  wishlistId: string,
  market: { code: string; locale: string } | null,
): Promise<StoreWishlist | null> {
  const [list] = await db().execute<Row>(sql`
    select w.id, w.name, w.keep_after_cart, w.customer_id, c.name as customer_name, c.email as customer_email,
      w.created_at, w.updated_at
    from commerce.wishlists w
    left join commerce.customers c on c.store_id = w.store_id and c.id = w.customer_id
    where w.store_id = ${storeId}::uuid and w.id = ${wishlistId}::uuid
  `);
  if (!list) return null;
  const items = await db().execute<Row>(sql`
    select i.id, i.product_id, i.quantity, i.created_at, p.status as product_status,
      coalesce(tl.title, tf.title, p.handle) as title,
      (select coalesce(m.thumbnail_url, m.url) from commerce.product_media m
        where m.product_id = p.id order by m.position limit 1) as image,
      v.sku, v.options,
      (select count(*)::int from commerce.product_variants pv where pv.product_id = p.id and pv.active) as variants,
      (select min(cp.amount_minor) from commerce.current_prices cp
        join commerce.product_variants pv on pv.id = cp.variant_id and pv.active
        where pv.product_id = p.id and (i.variant_id is null or pv.id = i.variant_id)
          and cp.market_code = ${market?.code ?? ""}) as price_minor,
      (select min(cp.currency) from commerce.current_prices cp
        join commerce.product_variants pv on pv.id = cp.variant_id
        where pv.product_id = p.id and cp.market_code = ${market?.code ?? ""}) as currency,
      (select case when bool_and(pv.delivery <> 'physical') then null else coalesce(sum(s.available), 0) end::int
        from commerce.product_variants pv
        left join commerce.available_stock s on s.variant_id = pv.id and pv.delivery = 'physical'
        where pv.product_id = p.id and pv.active and (i.variant_id is null or pv.id = i.variant_id)) as available
    from commerce.wishlist_items i
    join commerce.products p on p.store_id = i.store_id and p.id = i.product_id
    left join commerce.product_variants v on v.store_id = i.store_id and v.id = i.variant_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market?.locale ?? ""}
    left join lateral (
      select title from commerce.product_translations where product_id = p.id order by locale limit 1
    ) tf on true
    where i.store_id = ${storeId}::uuid and i.wishlist_id = ${wishlistId}::uuid
    order by i.created_at desc, i.id
  `);
  return {
    id: String(list.id),
    name: String(list.name),
    owner: toOwner(list),
    keepAfterCart: Boolean(list.keep_after_cart),
    createdAt: toIso(list.created_at),
    updatedAt: toIso(list.updated_at),
    items: items.map((row) => ({
      id: String(row.id),
      productId: String(row.product_id),
      title: String(row.title),
      image: row.image ? String(row.image) : null,
      productStatus: String(row.product_status),
      variant: row.sku ? { sku: String(row.sku), options: (row.options ?? {}) as Record<string, string> } : null,
      variants: Number(row.variants),
      quantity: Number(row.quantity),
      priceMinor: row.price_minor === null ? null : Number(row.price_minor),
      currency: row.currency ? String(row.currency) : null,
      available: row.available === null ? null : Number(row.available),
      savedAt: toIso(row.created_at),
    })),
  };
}

export type WishedProduct = { productId: string; title: string; lists: number; bought: number };

/** The products in most lists, with how many units bought from a list. */
export async function mostWishedProducts(storeId: string, locale: string, limit = 5): Promise<WishedProduct[]> {
  const rows = await db().execute<Row>(sql`
    with adds as (${cartAddsQuery(storeId, sql`a.product_id is not null`)})
    select p.id, coalesce(tl.title, tf.title, p.handle) as title, count(distinct i.wishlist_id)::int as lists,
      (select coalesce(sum(adds.bought_quantity), 0)::int from adds where adds.product_id = p.id and adds.status = 'bought') as bought
    from commerce.wishlist_items i
    join commerce.products p on p.store_id = i.store_id and p.id = i.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title from commerce.product_translations where product_id = p.id order by locale limit 1
    ) tf on true
    where i.store_id = ${storeId}::uuid
    group by p.id, tl.title, tf.title
    order by lists desc, title
    limit ${limit}
  `);
  return rows.map((row) => ({
    productId: String(row.id),
    title: String(row.title),
    lists: Number(row.lists),
    bought: Number(row.bought),
  }));
}

// ---------------------------------------------------------------------------
// From list to cart to order
// ---------------------------------------------------------------------------

/**
 * Where an item put in the cart from a list ended up: bought (the order was
 * paid), ordered but not yet paid, an order cancelled unpaid, still in the
 * cart, taken out of the cart (or left out at checkout), or left in a cart
 * that was never checked out.
 */
export type CartAddStatus = "bought" | "awaiting_payment" | "cancelled" | "in_cart" | "removed" | "left";

export const CART_ADD_STATUS: Record<CartAddStatus, string> = {
  bought: "Bought",
  awaiting_payment: "Ordered, not paid",
  cancelled: "Order cancelled",
  in_cart: "In the cart",
  removed: "Taken out of the cart",
  left: "Left in the cart",
};

/**
 * Each add with its outcome, read from the order the cart became (the same
 * variant, bought once rather than by subscription). A line bought in a
 * smaller quantity counts only what was bought, valued at the line's price
 * after discounts.
 */
function cartAddsQuery(storeId: string, where: SQL): SQL {
  return sql`
    select a.*, o.id as order_id, o.number as order_number, o.email as order_email, o.currency as order_currency,
      least(a.quantity, o.line_quantity) as bought_quantity,
      (o.line_total * least(a.quantity, o.line_quantity) / nullif(o.line_quantity, 0))::bigint as bought_minor,
      case
        when o.id is not null and o.bought then 'bought'
        when o.id is not null and o.status = 'pending_payment' then 'awaiting_payment'
        when o.id is not null then 'cancelled'
        when c.status = 'converted' then 'removed'
        when c.status = 'open' and c.expires_at > now() then
          case when exists (
            select 1 from commerce.cart_lines cl
            where cl.store_id = a.store_id and cl.cart_id = a.cart_id and cl.variant_id = a.variant_id and cl.selling_plan_id is null
          ) then 'in_cart' else 'removed' end
        else 'left'
      end as status
    from commerce.wishlist_cart_adds a
    join commerce.carts c on c.store_id = a.store_id and c.id = a.cart_id
    left join lateral (
      select o.id, o.number, o.email, o.currency, o.status, ${bought} as bought,
        ol.quantity as line_quantity, ol.total_minor as line_total
      from commerce.orders o
      join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
        and ol.variant_id = a.variant_id and ol.selling_plan_id is null
      where o.store_id = a.store_id and o.cart_id = a.cart_id and o.placed_at >= a.created_at
      order by ${bought} desc, o.placed_at desc
      limit 1
    ) o on true
    where a.store_id = ${storeId}::uuid and ${where}
  `;
}

export type CartAddRow = {
  id: string;
  addedAt: string;
  title: string;
  sku: string;
  options: Record<string, string> | null;
  productId: string | null;
  variantId: string | null;
  quantity: number;
  currency: string;
  unitPriceMinor: number | null;
  wishlist: { id: string | null; name: string };
  /** The shopper: the list's account, else the buyer's order (a guest). */
  customer: { key: string; name: string; email: string } | null;
  status: CartAddStatus;
  order: { id: string; number: string; boughtQuantity: number; boughtMinor: number; currency: string } | null;
};

export type CartAddFilter = { wishlistId?: string; customerId?: string; orderId?: string; outcome?: "bought" | "not_bought" };

/** Items put in the cart from lists, newest first, each followed to its order. */
export async function listCartAdds(storeId: string, filter: CartAddFilter = {}, limit = 200): Promise<CartAddRow[]> {
  const where: SQL[] = [sql`true`];
  if (filter.wishlistId) where.push(sql`a.wishlist_id = ${filter.wishlistId}::uuid`);
  if (filter.customerId) where.push(sql`a.customer_id = ${filter.customerId}::uuid`);
  const rows = await db().execute<Row>(sql`
    with adds as (${cartAddsQuery(storeId, sql.join(where, sql` and `))})
    select adds.*, v.options, c.name as customer_name, c.email as customer_email,
      (select coalesce(nullif(o.shipping_address ->> 'name', ''), '') from commerce.orders o where o.id = adds.order_id) as order_name
    from adds
    left join commerce.product_variants v on v.store_id = adds.store_id and v.id = adds.variant_id
    left join commerce.customers c on c.store_id = adds.store_id and c.id = adds.customer_id
    where true
      ${filter.orderId ? sql`and adds.order_id = ${filter.orderId}::uuid` : sql``}
      ${filter.outcome === "bought" ? sql`and adds.status = 'bought'` : sql``}
      ${filter.outcome === "not_bought" ? sql`and adds.status <> 'bought'` : sql``}
    order by adds.created_at desc, adds.id
    limit ${limit}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    addedAt: toIso(row.created_at),
    title: String(row.title),
    sku: String(row.sku),
    options: row.options ? (row.options as Record<string, string>) : null,
    productId: row.product_id ? String(row.product_id) : null,
    variantId: row.variant_id ? String(row.variant_id) : null,
    quantity: Number(row.quantity),
    currency: String(row.currency),
    unitPriceMinor: row.unit_price_minor === null ? null : Number(row.unit_price_minor),
    wishlist: { id: row.wishlist_id ? String(row.wishlist_id) : null, name: String(row.wishlist_name) },
    customer: row.customer_id
      ? { key: String(row.customer_id), name: String(row.customer_name ?? ""), email: String(row.customer_email) }
      : row.order_id
        ? { key: String(row.order_id), name: String(row.order_name ?? ""), email: String(row.order_email) }
        : null,
    status: row.status as CartAddStatus,
    order: row.order_id
      ? {
          id: String(row.order_id),
          number: String(row.order_number),
          boughtQuantity: Number(row.bought_quantity ?? 0),
          boughtMinor: Number(row.bought_minor ?? 0),
          currency: String(row.order_currency),
        }
      : null,
  }));
}
