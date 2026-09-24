import "server-only";

import { sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db/client";
import { CART_TTL_DAYS, MAX_LINE_QUANTITY, settleQuantity, type LineOutcome } from "@/lib/cart";
import type { Market } from "@/lib/markets";
import type { Delivery } from "@/lib/product-input";
import { planPrice, sameRhythm, type PlanInterval, type PlanTerms } from "@/lib/subscriptions";

/** Where a cart belongs: one market of one store. */
export type Shop = { storeId: string; market: Market };

/**
 * Carts are per store and market, since prices and currency differ. The cart
 * id lives in an httpOnly cookie: strictly necessary for the shop to work, so
 * it needs no consent (decision D14).
 */
const cookieName = ({ storeId, market }: Shop) => `cart_${storeId}_${market.slug}`;
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
  /** Units that can be sold; downloads never run out (D24). */
  available: number;
  status: CartLineStatus;
  delivery: Delivery;
  /** Bought as a subscription: the purchase option, with the price already reduced (D25). */
  plan: (PlanTerms & { id: string }) | null;
};

export type Cart = { lines: CartLine[]; currency: string };

/** The shopper's cart id for this store and market, from the cookie. */
export async function readCartId(shop: Shop): Promise<string | null> {
  const value = (await cookies()).get(cookieName(shop))?.value;
  return value && UUID.test(value) ? value : null;
}

/** The cart for this store and market, read fresh on every request. */
export async function getCart(shop: Shop): Promise<Cart> {
  const { storeId, market } = shop;
  const cartId = await readCartId(shop);
  if (!cartId) return { lines: [], currency: market.currency };

  const rows = await db().execute<Row>(sql`
    select
      cl.variant_id, cl.quantity, v.options, v.delivery, p.handle,
      cl.selling_plan_id, sp.interval, sp.interval_count, sp.discount_percent,
      -- A purchase option still offered, or buying once where that is allowed.
      (case when cl.selling_plan_id is null then not p.subscription_only else coalesce(sp.active, false) end) as plan_ok,
      coalesce(tl.title, tf.title) as title,
      coalesce(m.thumbnail_url, m.url) as image_url, coalesce(m.alt ->> ${market.locale}, '') as image_alt,
      cp.amount_minor,
      (p.status = 'active' and v.active) as sellable,
      avail.available
    from commerce.cart_lines cl
    join commerce.carts c on c.store_id = cl.store_id and c.id = cl.cart_id
    join commerce.product_variants v on v.store_id = cl.store_id and v.id = cl.variant_id
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.selling_plans sp
      on sp.store_id = cl.store_id and sp.id = cl.selling_plan_id and sp.product_id = p.id
    left join commerce.product_translations tl
      on tl.product_id = p.id and tl.locale = ${market.locale}
    left join lateral (
      select title from commerce.product_translations
      where product_id = p.id order by locale limit 1
    ) tf on true
    left join lateral (
      select url, thumbnail_url, alt from commerce.product_media
      where product_id = p.id order by position limit 1
    ) m on true
    left join commerce.current_prices cp
      on cp.variant_id = v.id and cp.market_code = c.market_code
    left join lateral (
      select case when v.delivery = 'digital' then ${MAX_LINE_QUANTITY} else coalesce(sum(s.available), 0) end::int
        as available
      from commerce.available_stock s
      join commerce.inventory_locations l
        on l.store_id = s.store_id and l.id = s.location_id and l.active
      where s.store_id = v.store_id and s.variant_id = v.id
    ) avail on true
    where cl.store_id = ${storeId}::uuid
      and cl.cart_id = ${cartId}::uuid
      and c.market_code = ${market.code}
      and c.status = 'open'
      and c.expires_at > now()
    order by p.handle, v.sku, cl.selling_plan_id nulls first
  `);

  return {
    currency: market.currency,
    lines: rows.map((row) => {
      const quantity = Number(row.quantity);
      const available = Number(row.available);
      const plan = row.selling_plan_id
        ? {
            id: String(row.selling_plan_id),
            interval: row.interval as PlanInterval,
            intervalCount: Number(row.interval_count),
            discountPercent: Number(row.discount_percent),
          }
        : null;
      const unitPriceMinor =
        row.amount_minor === null ? null : planPrice(Number(row.amount_minor), plan?.discountPercent ?? 0);
      const status: CartLineStatus =
        !row.sellable || !row.plan_ok || unitPriceMinor === null || available <= 0
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
        delivery: row.delivery === "digital" ? "digital" : "physical",
        plan,
      };
    }),
  };
}

/** Units in the cart, for the header. */
export async function getCartCount(shop: Shop): Promise<number> {
  const cartId = await readCartId(shop);
  if (!cartId) return 0;
  const [row] = await db().execute<Row>(sql`
    select coalesce(sum(cl.quantity), 0)::int as count
    from commerce.cart_lines cl
    join commerce.carts c on c.store_id = cl.store_id and c.id = cl.cart_id
    where c.store_id = ${shop.storeId}::uuid and c.id = ${cartId}::uuid
      and c.market_code = ${shop.market.code}
      and c.status = 'open' and c.expires_at > now()
  `);
  return Number(row?.count ?? 0);
}

/**
 * Units of a variant that can be sold in the market right now, or null if
 * the variant is not for sale there (inactive, or no price in the market).
 */
async function sellableQuantity(
  tx: Tx,
  { storeId, market }: Shop,
  variantId: string,
  sellingPlanId: string | null,
) {
  const [row] = await tx.execute<Row>(sql`
    select case when v.delivery = 'digital' then ${MAX_LINE_QUANTITY} else coalesce((
      select sum(s.available)
      from commerce.available_stock s
      join commerce.inventory_locations l
        on l.store_id = s.store_id and l.id = s.location_id and l.active
      where s.store_id = v.store_id and s.variant_id = v.id
    ), 0) end::int as available
    from commerce.product_variants v
    join commerce.products p
      on p.store_id = v.store_id and p.id = v.product_id and p.status = 'active'
    join commerce.prices pr
      on pr.variant_id = v.id and pr.market_code = ${market.code} and pr.valid_to is null
    where v.store_id = ${storeId}::uuid and v.id = ${variantId}::uuid and v.active
      and ${
        sellingPlanId
          ? sql`exists (
              select 1 from commerce.selling_plans sp
              where sp.store_id = v.store_id and sp.id = ${sellingPlanId}::uuid and sp.product_id = p.id and sp.active
            )`
          : sql`not p.subscription_only`
      }
  `);
  return row ? Number(row.available) : null;
}

/** Locks and returns the shopper's open cart, creating one if needed. */
async function openCart(tx: Tx, shop: Shop): Promise<string> {
  const { storeId, market } = shop;
  const existing = await readCartId(shop);
  if (existing) {
    const [row] = await tx.execute<Row>(sql`
      update commerce.carts
         set updated_at = now(),
             expires_at = now() + make_interval(days => ${CART_TTL_DAYS})
       where store_id = ${storeId}::uuid and id = ${existing}::uuid
         and market_code = ${market.code}
         and status = 'open' and expires_at > now()
      returning id
    `);
    if (row) return String(row.id);
  }
  const [row] = await tx.execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale},
            now() + make_interval(days => ${CART_TTL_DAYS}))
    returning id
  `);
  const id = String(row.id);
  (await cookies()).set(cookieName(shop), id, {
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
  shop: Shop,
  variantId: string,
  quantity: number,
  mode: "add" | "set",
  sellingPlanId: string | null = null,
): Promise<{ outcome: LineOutcome | "removed" | "plan_conflict"; quantity: number }> {
  return db().transaction(async (tx) => {
    const samePlan = sql`selling_plan_id is not distinct from ${sellingPlanId}::uuid`;
    if (mode === "set" && quantity <= 0) {
      const cartId = await readCartId(shop);
      if (cartId) {
        await tx.execute(sql`
          delete from commerce.cart_lines
          where store_id = ${shop.storeId}::uuid
            and cart_id = ${cartId}::uuid and variant_id = ${variantId}::uuid and ${samePlan}
        `);
      }
      return { outcome: "removed" as const, quantity: 0 };
    }

    const available = await sellableQuantity(tx, shop, variantId, sellingPlanId);
    if (available === null || available <= 0) {
      return { outcome: "unavailable" as const, quantity: 0 };
    }

    const cartId = await openCart(tx, shop);
    // One checkout makes one subscription, so it renews on one schedule.
    if (sellingPlanId && (await otherRhythm(tx, cartId, sellingPlanId))) {
      return { outcome: "plan_conflict" as const, quantity: 0 };
    }
    const [current] = await tx.execute<Row>(sql`
      select quantity from commerce.cart_lines
      where cart_id = ${cartId}::uuid and variant_id = ${variantId}::uuid and ${samePlan}
      for update
    `);
    const wanted = mode === "add" ? Number(current?.quantity ?? 0) + quantity : quantity;
    const settled = settleQuantity(wanted, available);

    await tx.execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity, selling_plan_id)
      values (${shop.storeId}::uuid, ${cartId}::uuid, ${variantId}::uuid, ${settled.quantity}, ${sellingPlanId}::uuid)
      on conflict on constraint cart_lines_cart_variant_plan_key do update set quantity = excluded.quantity
    `);
    return settled;
  });
}

/** Whether the cart holds a subscription that renews on another schedule than this option. */
async function otherRhythm(tx: Tx, cartId: string, sellingPlanId: string): Promise<boolean> {
  const rows = await tx.execute<Row>(sql`
    select sp.interval, sp.interval_count, (sp.id = ${sellingPlanId}::uuid) as chosen
    from commerce.selling_plans sp
    where sp.id = ${sellingPlanId}::uuid
       or sp.id in (select selling_plan_id from commerce.cart_lines where cart_id = ${cartId}::uuid)
  `);
  const chosen = rows.find((r) => r.chosen);
  if (!chosen) return false;
  const terms = (r: Row) => ({ interval: r.interval as PlanInterval, intervalCount: Number(r.interval_count) });
  return rows.some((r) => !r.chosen && !sameRhythm(terms(r), terms(chosen)));
}
