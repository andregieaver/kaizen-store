import "server-only";

import { sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db/client";
import { CART_TTL_DAYS, settleQuantity, type LineOutcome } from "@/lib/cart";
import type { Market } from "@/lib/markets";

/**
 * Carts are per market, since prices and currency differ. The cart id lives
 * in an httpOnly cookie: strictly necessary for the shop to work, so it needs
 * no consent (decision D14).
 */
const cookieName = (market: Market) => `cart_${market.slug}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export type CartLineStatus = "ok" | "insufficient" | "unavailable";

export type CartLine = {
  variantId: string;
  handle: string;
  title: string;
  options: Record<string, string>;
  image: { url: string; alt: string } | null;
  quantity: number;
  unitPriceMinor: number | null;
  available: number;
  status: CartLineStatus;
};

export type Cart = { lines: CartLine[]; currency: string };

async function readCartId(market: Market): Promise<string | null> {
  const value = (await cookies()).get(cookieName(market))?.value;
  return value && UUID.test(value) ? value : null;
}

/** The cart for this market, read fresh on every request. */
export async function getCart(market: Market): Promise<Cart> {
  const cartId = await readCartId(market);
  if (!cartId) return { lines: [], currency: market.currency };

  const rows = await db().execute<Row>(sql`
    select
      cl.variant_id, cl.quantity, v.options, p.handle,
      coalesce(tl.title, tf.title) as title,
      m.url as image_url, coalesce(m.alt ->> ${market.locale}, '') as image_alt,
      cp.amount_minor,
      (p.status = 'active' and v.active) as sellable,
      avail.available
    from commerce.cart_lines cl
    join commerce.carts c on c.id = cl.cart_id
    join commerce.product_variants v on v.id = cl.variant_id
    join commerce.products p on p.id = v.product_id
    left join commerce.product_translations tl
      on tl.product_id = p.id and tl.locale = ${market.locale}
    left join lateral (
      select title from commerce.product_translations
      where product_id = p.id order by locale limit 1
    ) tf on true
    left join lateral (
      select url, alt from commerce.product_media
      where product_id = p.id order by position limit 1
    ) m on true
    left join commerce.current_prices cp
      on cp.variant_id = v.id and cp.market_code = c.market_code
    left join lateral (
      select coalesce(sum(s.available), 0)::int as available
      from commerce.available_stock s
      join commerce.inventory_locations l on l.id = s.location_id and l.active
      where s.variant_id = v.id
    ) avail on true
    where cl.cart_id = ${cartId}::uuid
      and c.market_code = ${market.code}
      and c.status = 'open'
      and c.expires_at > now()
    order by p.handle, v.sku
  `);

  return {
    currency: market.currency,
    lines: rows.map((row) => {
      const quantity = Number(row.quantity);
      const available = Number(row.available);
      const unitPriceMinor = row.amount_minor === null ? null : Number(row.amount_minor);
      const status: CartLineStatus =
        !row.sellable || unitPriceMinor === null || available <= 0
          ? "unavailable"
          : available < quantity
            ? "insufficient"
            : "ok";
      return {
        variantId: String(row.variant_id),
        handle: String(row.handle),
        title: String(row.title ?? ""),
        options: (row.options ?? {}) as Record<string, string>,
        image: row.image_url
          ? { url: String(row.image_url), alt: String(row.image_alt) }
          : null,
        quantity,
        unitPriceMinor,
        available,
        status,
      };
    }),
  };
}

/** Units in the cart, for the header. */
export async function getCartCount(market: Market): Promise<number> {
  const cartId = await readCartId(market);
  if (!cartId) return 0;
  const [row] = await db().execute<Row>(sql`
    select coalesce(sum(cl.quantity), 0)::int as count
    from commerce.cart_lines cl
    join commerce.carts c on c.id = cl.cart_id
    where c.id = ${cartId}::uuid and c.market_code = ${market.code}
      and c.status = 'open' and c.expires_at > now()
  `);
  return Number(row?.count ?? 0);
}

/**
 * Units of a variant that can be sold in the market right now, or null if
 * the variant is not for sale there (inactive, or no price in the market).
 */
async function sellableQuantity(tx: Tx, market: Market, variantId: string) {
  const [row] = await tx.execute<Row>(sql`
    select coalesce((
      select sum(s.available)
      from commerce.available_stock s
      join commerce.inventory_locations l on l.id = s.location_id and l.active
      where s.variant_id = v.id
    ), 0)::int as available
    from commerce.product_variants v
    join commerce.products p on p.id = v.product_id and p.status = 'active'
    join commerce.prices pr
      on pr.variant_id = v.id and pr.market_code = ${market.code} and pr.valid_to is null
    where v.id = ${variantId}::uuid and v.active
  `);
  return row ? Number(row.available) : null;
}

/** Locks and returns the shopper's open cart, creating one if needed. */
async function openCart(tx: Tx, market: Market): Promise<string> {
  const existing = await readCartId(market);
  if (existing) {
    const [row] = await tx.execute<Row>(sql`
      update commerce.carts
         set updated_at = now(),
             expires_at = now() + make_interval(days => ${CART_TTL_DAYS})
       where id = ${existing}::uuid and market_code = ${market.code}
         and status = 'open' and expires_at > now()
      returning id
    `);
    if (row) return String(row.id);
  }
  const [row] = await tx.execute<Row>(sql`
    insert into commerce.carts (market_code, currency, locale, expires_at)
    values (${market.code}, ${market.currency}, ${market.locale},
            now() + make_interval(days => ${CART_TTL_DAYS}))
    returning id
  `);
  const id = String(row.id);
  (await cookies()).set(cookieName(market), id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CART_TTL_DAYS * 24 * 60 * 60,
  });
  return id;
}

/**
 * Adds units of a variant, or with `mode: "set"` sets the line to exactly
 * that quantity (0 removes it). Stock is checked but not reserved: stock is
 * held only once checkout starts.
 */
export async function changeLine(
  market: Market,
  variantId: string,
  quantity: number,
  mode: "add" | "set",
): Promise<{ outcome: LineOutcome | "removed"; quantity: number }> {
  return db().transaction(async (tx) => {
    if (mode === "set" && quantity <= 0) {
      const cartId = await readCartId(market);
      if (cartId) {
        await tx.execute(sql`
          delete from commerce.cart_lines
          where cart_id = ${cartId}::uuid and variant_id = ${variantId}::uuid
        `);
      }
      return { outcome: "removed" as const, quantity: 0 };
    }

    const available = await sellableQuantity(tx, market, variantId);
    if (available === null || available <= 0) {
      return { outcome: "unavailable" as const, quantity: 0 };
    }

    const cartId = await openCart(tx, market);
    const [current] = await tx.execute<Row>(sql`
      select quantity from commerce.cart_lines
      where cart_id = ${cartId}::uuid and variant_id = ${variantId}::uuid
      for update
    `);
    const wanted = mode === "add" ? Number(current?.quantity ?? 0) + quantity : quantity;
    const settled = settleQuantity(wanted, available);

    await tx.execute(sql`
      insert into commerce.cart_lines (cart_id, variant_id, quantity)
      values (${cartId}::uuid, ${variantId}::uuid, ${settled.quantity})
      on conflict (cart_id, variant_id) do update set quantity = excluded.quantity
    `);
    return settled;
  });
}
