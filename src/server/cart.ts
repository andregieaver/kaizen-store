import "server-only";

import { sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db/client";
import { buyerCookie, parseBuyer, parseProductAudience, type ProductAudience } from "@/lib/b2b";
import { CART_TTL_DAYS, MAX_LINE_QUANTITY, settleQuantity, type LineOutcome } from "@/lib/cart";
import type { Market } from "@/lib/markets";
import { parsePaymentMode, type AppointmentPayment } from "@/lib/pay-later";
import { parseRentalPeriod, rangeEndsAt, type RentalPeriod } from "@/lib/booking-ranges";
import { parseDelivery, type Delivery } from "@/lib/product-input";
import { planPrice, sameRhythm, type PlanInterval, type PlanTerms } from "@/lib/subscriptions";

import { freeResourcesAt } from "./appointments";
import { audit, type Membership } from "./auth";
import { checkRange } from "./ranges";

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
  productId: string;
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
  /** Who the product is for (B2B), as kept; `companyRequired()` reads it with the store's audience. */
  audience: ProductAudience;
  /** Its product's VAT rate in the market (D65). */
  vatRate: number;
  /** Bought as a subscription: the purchase option, with the price already reduced (D25). */
  plan: (PlanTerms & { id: string; trialDays: number; minCycles: number; signupFeeMinor: number }) | null;
  /**
   * An appointment's time (D65), with whom if the shopper chose, in the
   * store's time zone; or a stay's or rental's (D67) check-in and check-out,
   * the line's quantity being its nights or days.
   */
  booking:
    | (LineBooking & { kind: BookedKind; period: RentalPeriod; endsAt: string | null; staff: string | null; timeZone: string })
    | null;
  /** How an appointment is paid (D66): null for goods, which are paid now. */
  payment: AppointmentPayment | null;
};

/** The time an appointment (or a stay, a rental) is booked for (D65, D67), and who or what with; null is whichever is free. */
export type LineBooking = { startsAt: string; resourceId: string | null };

export type BookedKind = "appointment" | "stay" | "rental";
const bookedKind = (kind: unknown): BookedKind => (kind === "stay" || kind === "rental" ? kind : "appointment");

/** The company the shopper buys for (B2B), as entered at checkout. */
export type CartCompany = { name: string; number: string };

export type Cart = { lines: CartLine[]; currency: string; company: CartCompany | null };

/** The shopper's cart id for this store and market, from the cookie. */
export async function readCartId(shop: Shop): Promise<string | null> {
  const value = (await cookies()).get(cookieName(shop))?.value;
  return value && UUID.test(value) ? value : null;
}

/**
 * An appointment, a stay or a rental is in the cart with its time, and goods
 * without one (D65, D67); a time is kept while it is at least the notice
 * away. Whether it is still free is checked when adding and again at
 * checkout.
 */
export const bookable = sql`
  ((p.kind = 'goods') = (cl.starts_at is null))
  and (cl.starts_at is null or cl.starts_at > now() + make_interval(mins => coalesce(aps.min_notice_minutes, 0)))
`;

/** The cart for this store and market, read fresh on every request. */
export async function getCart(shop: Shop): Promise<Cart> {
  const { storeId, market } = shop;
  const cartId = await readCartId(shop);
  if (!cartId) return { lines: [], currency: market.currency, company: null };

  const rows = await db().execute<Row>(sql`
    select
      cl.variant_id, cl.quantity, v.options, v.delivery, p.handle, p.id as product_id, p.audience,
      commerce.vat_rate(c.market_code, p.vat_category) as vat_rate,
      cl.starts_at, cl.resource_id, br.name as staff, st.time_zone, aps.payment, aps.deposit_percent,
      p.kind, aps.check_in_time, aps.check_out_time, v.rental_period,
      c.company_name, c.organisation_number,
      cl.selling_plan_id, sp.interval, sp.interval_count, sp.discount_percent, sp.trial_days, sp.min_cycles,
      coalesce((sp.signup_fee ->> c.market_code)::bigint, 0) as signup_fee,
      -- A purchase option still offered, or buying once where that is allowed.
      (case when cl.selling_plan_id is null then not p.subscription_only else coalesce(sp.active, false) end) as plan_ok,
      coalesce(tl.title, tf.title) as title,
      coalesce(m.thumbnail_url, m.url) as image_url, coalesce(m.alt ->> ${market.locale}, '') as image_alt,
      cp.amount_minor,
      (p.status = 'active' and v.active and ${bookable}) as sellable,
      avail.available
    from commerce.cart_lines cl
    join commerce.carts c on c.store_id = cl.store_id and c.id = cl.cart_id
    join commerce.stores st on st.id = cl.store_id
    join commerce.product_variants v on v.store_id = cl.store_id and v.id = cl.variant_id
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.selling_plans sp
      on sp.store_id = cl.store_id and sp.id = cl.selling_plan_id and sp.product_id = p.id
    left join commerce.appointment_settings aps on aps.store_id = p.store_id and aps.product_id = p.id
    left join commerce.booking_resources br on br.store_id = cl.store_id and br.id = cl.resource_id
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
      -- A stay's nights or a rental's days are checked when chosen and at checkout.
      select case when p.kind in ('stay', 'rental') then cl.quantity
        when v.delivery <> 'physical' then ${MAX_LINE_QUANTITY} else coalesce(sum(s.available), 0) end::int
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
    order by p.handle, v.sku, cl.selling_plan_id nulls first, cl.starts_at
  `);

  const first = rows[0];
  return {
    currency: market.currency,
    company:
      first?.company_name && first.organisation_number
        ? { name: String(first.company_name), number: String(first.organisation_number) }
        : null,
    lines: rows.map((row) => {
      const quantity = Number(row.quantity);
      const available = Number(row.available);
      const plan = row.selling_plan_id
        ? {
            id: String(row.selling_plan_id),
            interval: row.interval as PlanInterval,
            intervalCount: Number(row.interval_count),
            discountPercent: Number(row.discount_percent),
            trialDays: Number(row.trial_days),
            minCycles: Number(row.min_cycles),
            signupFeeMinor: Number(row.signup_fee),
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
        productId: String(row.product_id),
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
        delivery: parseDelivery(row.delivery),
        audience: parseProductAudience(row.audience),
        vatRate: Number(row.vat_rate ?? 0),
        plan,
        booking: row.starts_at
          ? {
              startsAt: new Date(String(row.starts_at)).toISOString(),
              kind: bookedKind(row.kind),
              period: parseRentalPeriod(row.rental_period),
              endsAt: rangeEnd(row, quantity),
              resourceId: row.resource_id ? String(row.resource_id) : null,
              staff: row.staff ? String(row.staff) : null,
              timeZone: String(row.time_zone),
            }
          : null,
        payment: row.payment
          ? { mode: parsePaymentMode(row.payment), depositPercent: Number(row.deposit_percent) }
          : null,
      };
    }),
  };
}

/** A stay's check-out or a rental's return (D67), from its check-in and length; null for an appointment. */
function rangeEnd(row: Row, count: number): string | null {
  const kind = bookedKind(row.kind);
  if (kind === "appointment" || !row.starts_at) return null;
  const rules = { checkInTime: String(row.check_in_time), checkOutTime: String(row.check_out_time) };
  const period = parseRentalPeriod(row.rental_period);
  return rangeEndsAt(kind, new Date(String(row.starts_at)).toISOString(), count, rules, String(row.time_zone), period);
}

/** The company the shopper buys for (B2B), or null to buy privately: kept on the cart for the order. */
export async function setCartCompany(shop: Shop, company: CartCompany | null): Promise<void> {
  const cartId = await readCartId(shop);
  if (!cartId) return;
  await db().execute(sql`
    update commerce.carts set company_name = ${company?.name ?? null}, organisation_number = ${company?.number ?? null},
      updated_at = now()
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open'
  `);
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

/** Whether the shopper has chosen to buy for a business (B2B). */
async function buysForBusiness(storeId: string): Promise<boolean> {
  return parseBuyer((await cookies()).get(buyerCookie(storeId))?.value) === "business";
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
  booking: LineBooking | null,
  /** A stay's nights or a rental's days (D67). */
  count: number,
): Promise<{ available: number; kind: BookedKind | "goods" } | null> {
  const [row] = await tx.execute<Row>(sql`
    select v.product_id, p.kind, v.rental_period, case when v.delivery <> 'physical' then ${MAX_LINE_QUANTITY} else coalesce((
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
      -- Appointments, stays and rentals are booked for a time (D65, D67), and goods have none.
      and (p.kind = 'goods') = ${booking === null}
      -- Business-only products (B2B) are sold to businesses, where the store sells to both.
      and (p.audience <> 'businesses' or ${await buysForBusiness(storeId)}
        or (select s.audience from commerce.stores s where s.id = v.store_id) <> 'both')
      and ${
        sellingPlanId
          ? sql`exists (
              select 1 from commerce.selling_plans sp
              where sp.store_id = v.store_id and sp.id = ${sellingPlanId}::uuid and sp.product_id = p.id and sp.active
            )`
          : sql`not p.subscription_only`
      }
  `);
  if (!row) return null;
  if (!booking) return { available: Number(row.available), kind: "goods" };
  const kind = bookedKind(row.kind);
  // A stay or a rental must be free for all its nights or days, and keep to the product's rules.
  if (kind !== "appointment") {
    const free = await checkRange(tx, storeId, String(row.product_id), {
      startsAt: booking.startsAt,
      count,
      unitId: booking.resourceId,
      period: parseRentalPeriod(row.rental_period),
    });
    return { available: free.ok ? count : 0, kind };
  }
  // An appointment's time must be one the product page would offer now.
  const free = await freeResourcesAt(tx, storeId, String(row.product_id), booking.startsAt, booking.resourceId);
  return { available: free && free.resourceIds.length > 0 ? 1 : 0, kind };
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
  /** Runs in the same transaction once the line is in the cart, with how many more it now holds. */
  afterAdd?: (tx: Tx, cartId: string, added: number) => Promise<void>,
  /**
   * An appointment's time (D65): one place per line, so its quantity is
   * always 1; or a stay's or rental's check-in (D67), its quantity being the
   * nights or days, which replace the line's.
   */
  booking: LineBooking | null = null,
): Promise<{ outcome: LineOutcome | "removed" | "plan_conflict" | "slot_taken"; quantity: number }> {
  return db().transaction(async (tx) => {
    const samePlan = sql`selling_plan_id is not distinct from ${sellingPlanId}::uuid
      and starts_at is not distinct from ${booking?.startsAt ?? null}::timestamptz`;
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

    const sellable = await sellableQuantity(tx, shop, variantId, sellingPlanId, booking, quantity);
    if (sellable?.available === 0 && booking) return { outcome: "slot_taken" as const, quantity: 0 };
    if (sellable === null || sellable.available <= 0) {
      return { outcome: "unavailable" as const, quantity: 0 };
    }
    const range = sellable.kind === "stay" || sellable.kind === "rental";

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
    // A time already in the cart is simply there: choosing it again is not asking for more.
    const wanted = booking ? 1 : mode === "add" ? Number(current?.quantity ?? 0) + quantity : quantity;
    const settled = range ? { outcome: "added" as const, quantity } : settleQuantity(wanted, sellable.available);

    await tx.execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity, selling_plan_id, starts_at, resource_id)
      values (${shop.storeId}::uuid, ${cartId}::uuid, ${variantId}::uuid, ${settled.quantity}, ${sellingPlanId}::uuid,
              ${booking?.startsAt ?? null}::timestamptz, ${booking?.resourceId ?? null}::uuid)
      on conflict on constraint cart_lines_cart_variant_plan_key
        do update set quantity = excluded.quantity, resource_id = excluded.resource_id
    `);
    const added = settled.quantity - Number(current?.quantity ?? 0);
    if (afterAdd && added > 0) await afterAdd(tx, cartId, added);
    return settled;
  });
}

/** Whether the cart holds a subscription that renews on another schedule than this option. */
async function otherRhythm(tx: Tx, cartId: string, sellingPlanId: string): Promise<boolean> {
  const rows = await tx.execute<Row>(sql`
    select sp.interval, sp.interval_count, sp.trial_days, (sp.id = ${sellingPlanId}::uuid) as chosen
    from commerce.selling_plans sp
    where sp.id = ${sellingPlanId}::uuid
       or sp.id in (select selling_plan_id from commerce.cart_lines where cart_id = ${cartId}::uuid)
  `);
  const chosen = rows.find((r) => r.chosen);
  if (!chosen) return false;
  const terms = (r: Row) => ({
    interval: r.interval as PlanInterval,
    intervalCount: Number(r.interval_count),
    trialDays: Number(r.trial_days),
  });
  return rows.some((r) => !r.chosen && !sameRhythm(terms(r), terms(chosen)));
}

/** Whether phones open the slide-out cart once something is added (D64): the store's choice. */
export async function setOpenCartOnAdd({ account, store }: Membership, enabled: boolean): Promise<void> {
  await db().execute(sql`update commerce.stores set open_cart_on_add = ${enabled} where id = ${store.id}::uuid`);
  await audit(account.id, store.id, "store.open_cart_on_add", { enabled });
}
