import "server-only";

import { sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db/client";
import { buyerCookie, parseBuyer, parseProductAudience, type ProductAudience } from "@/lib/b2b";
import { CART_TTL_DAYS, MAX_LINE_QUANTITY, settleQuantity, type LineOutcome } from "@/lib/cart";
import { isNative, shown, type Market } from "@/lib/markets";
import { parsePaymentMode, type AppointmentPayment } from "@/lib/pay-later";
import { parseRentalPeriod, rangeEndsAt, type RentalPeriod } from "@/lib/booking-ranges";
import { parseDelivery, type Delivery } from "@/lib/product-input";
import { cleanGift, giftOfRow, NO_GIFT, type GiftFields, type GiftProblem } from "@/lib/gift";
import { backorderNote, lineIsOk, stockOf, type VariantStock } from "@/lib/stock-availability";
import { planPrice, sameRhythm, type PlanInterval, type PlanTerms } from "@/lib/subscriptions";
import type { ShownMeasure } from "@/lib/unit-price";
import { shownMeasureFromColumns } from "@/lib/unit-price-rules";

import { freeResourcesAt } from "./appointments";
import { attachVisitToCart } from "./analytics-visits";
import { audit, type Membership } from "./auth";
import { OFFERED, STORE_AUDIENCE, plansOffered } from "./product-conditions";
import { checkRange, linePrice, rangePricing } from "./ranges";
import { checkCartVatNumber, type CartVatDeps, type CartVatOutcome } from "./vat-checks";

/** Where a cart belongs: one market of one store. */
export type Shop = { storeId: string; market: Market };

/**
 * Carts are per store and market, since prices and currency differ. The cart
 * id lives in an httpOnly cookie: strictly necessary for the shop to work, so
 * it needs no consent (decision D14).
 */
// By country, not by the language and currency shown (D109): switching them keeps the cart.
const cookieName = ({ storeId, market }: Shop) => `cart_${storeId}_${market.code.toLowerCase()}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;
export type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

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
  /**
   * What is in one unit and what it is compared per in this market (D160), read live from the variant: the unit price is
   * `unitPrice(line.unitPriceMinor, ...)` (one unit's price as the cart shows it, whatever the quantity). Null for no
   * content, for bookings and for a line that cannot be bought.
   */
  measure: ShownMeasure | null;
  /**
   * The most units the shopper can put in the cart: what is in stock for a variant that stops selling at zero, the line maximum for
   * one that keeps selling on backorder (wave 3, D172); downloads never run out (D24).
   */
  available: number;
  /** Units in stock now (net of live checkout holds, never below zero); a download or a booking has no stock and reads as `available`. */
  inStock: number;
  /**
   * The units of this line beyond what is in stock and the days stated for them, for a variant that keeps selling on backorder (D172);
   * null for a line that is wholly in stock or whose variant stops selling at zero. The words are `m.backorder.line()`.
   */
  backorder: { units: number; days: number } | null;
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
    | (LineBooking & {
        kind: BookedKind;
        period: RentalPeriod;
        endsAt: string | null;
        staff: string | null;
        timeZone: string;
        /** A stay's nights or a rental's days or hours (D67, D69): the line itself is one booking. */
        count: number;
        /** A stay's or rental's price in parts (D70): its nights, days or hours, and the fee; null for an appointment. */
        price: { itemsMinor: number; feeMinor: number; seasonal: boolean; baseMinor: number } | null;
      })
    | null;
  /** How an appointment is paid (D66): null for goods, which are paid now. */
  payment: AppointmentPayment | null;
  /** The host whose listing it is (D71); bonus credits are the store's own, so they are not earned or used on a host's. */
  hostId: string | null;
};

/** The time an appointment (or a stay, a rental) is booked for (D65, D67), and who or what with; null is whichever is free. */
export type LineBooking = { startsAt: string; resourceId: string | null };

export type BookedKind = "appointment" | "stay" | "rental";
const bookedKind = (kind: unknown): BookedKind => (kind === "stay" || kind === "rental" ? kind : "appointment");

/** The company the shopper buys for (B2B), as entered at checkout. */
export type CartCompany = { name: string; number: string };

/**
 * The company as the cart holds it, with the EU VAT number typed for it (D157) and what became of it: the answer's status and
 * time. VIES's name and address are not here (staff only). A shopper sees only their own cart's.
 */
export type CartCompanyView = CartCompany & {
  vatNumber: string | null;
  vatCheck: { status: "valid" | "invalid" | "unavailable"; checkedAt: string } | null;
};

/**
 * The cart's lines, currency and company, and the buyer's gift (wave 3, D173): `gift` is what the cart holds when the store has gift messages on, and `NO_GIFT` when the switch is
 * off (the store ignores whatever a cart may hold then), so a page draws the box only for a cart that can have one (`getCartGift()` says whether the store offers it).
 */
export type Cart = { lines: CartLine[]; currency: string; company: CartCompanyView | null; gift: GiftFields };

/** The ids of this browser's carts in a store, in every market: what orders placed from this device are found by (D139). */
export async function deviceCartIds(storeId: string): Promise<string[]> {
  const prefix = `cart_${storeId}_`;
  return (await cookies())
    .getAll()
    .filter((cookie) => cookie.name.startsWith(prefix) && UUID.test(cookie.value))
    .map((cookie) => cookie.value);
}

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
  if (!cartId) return { lines: [], currency: market.currency, company: null, gift: NO_GIFT };

  const rows = await db().execute<Row>(sql`
    select
      cl.variant_id, cl.quantity, v.options, v.delivery, p.handle, p.id as product_id, p.audience,
      v.measure_amount, v.measure_unit, v.measure_base,
      commerce.vat_rate(c.market_code, p.vat_category) as vat_rate,
      cl.starts_at, cl.resource_id, br.name as staff, st.time_zone, aps.payment, aps.deposit_percent,
      p.kind, aps.check_in_time, aps.check_out_time, v.rental_period, p.host_id,
      c.company_name, c.organisation_number, c.vat_number, vk.status as vat_status, vk.requested_at as vat_checked_at,
      c.is_gift, c.gift_to, c.gift_from, c.gift_message,
      coalesce((select os.gift_messages from commerce.order_settings os where os.store_id = c.store_id), false) as gift_on,
      cl.selling_plan_id, sp.interval, sp.interval_count, sp.discount_percent, sp.trial_days, sp.min_cycles,
      coalesce((sp.signup_fee ->> c.market_code)::bigint, 0) as signup_fee,
      -- A purchase option still offered (Subscriptions on, D178), or buying once where that is allowed.
      (case when cl.selling_plan_id is null then not p.subscription_only else coalesce(sp.active, false) and ${plansOffered(sql`cl.store_id`)} end) as plan_ok,
      coalesce(tl.title, tf.title) as title,
      coalesce(m.thumbnail_url, m.url) as image_url, coalesce(nullif(m.alt ->> ${market.locale}, ''), commerce.media_alt(m.url, ${market.locale}), '') as image_alt,
      cp.amount_minor,
      (p.status = 'active' and v.active and ${bookable} and ${OFFERED}) as sellable,
      va.in_stock, va.raw_available, va.stock_policy, va.backorder_days
    from commerce.cart_lines cl
    join commerce.carts c on c.store_id = cl.store_id and c.id = cl.cart_id
    join commerce.stores st on st.id = cl.store_id
    left join commerce.vat_checks vk on vk.store_id = c.store_id and vk.id = c.vat_check_id
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
    left join commerce.variant_availability va on va.store_id = v.store_id and va.variant_id = v.id
    where cl.store_id = ${storeId}::uuid
      and cl.cart_id = ${cartId}::uuid
      and c.market_code = ${market.code}
      and c.status = 'open'
      and c.expires_at > now()
    order by p.handle, v.sku, cl.selling_plan_id nulls first, cl.starts_at
  `);

  // Stays and rentals are priced by their nights' seasons, with a fee (D70).
  const ranged = rows.filter((row) => row.starts_at && (row.kind === "stay" || row.kind === "rental"));
  const pricing = await rangePricing(db(), storeId, ranged.map((row) => String(row.product_id)), market.code, market);

  const first = rows[0];
  return {
    currency: market.currency,
    gift: first?.gift_on ? giftOfRow(first) : NO_GIFT,
    company:
      first?.company_name && first.organisation_number
        ? {
            name: String(first.company_name),
            number: String(first.organisation_number),
            vatNumber: first.vat_number ? String(first.vat_number) : null,
            vatCheck: first.vat_status
              ? {
                  status: first.vat_status === "valid" ? "valid" : first.vat_status === "invalid" ? "invalid" : "unavailable",
                  checkedAt: new Date(String(first.vat_checked_at)).toISOString(),
                }
              : null,
          }
        : null,
    lines: rows.map((row) => {
      // A stay or rental is one booking of so many nights, days or hours, at its whole price.
      const count = Number(row.quantity);
      const range = row.starts_at && (row.kind === "stay" || row.kind === "rental") ? (row.kind as "stay" | "rental") : null;
      const quantity = range ? 1 : count;
      // Goods that are shipped have stock (and may keep selling past it, D172); a download never runs out, a booking is one place.
      const goods = String(row.delivery) === "physical" && !range;
      const stock: VariantStock | null = goods
        ? stockOf({ in_stock: Number(row.in_stock ?? 0), raw_available: Number(row.raw_available ?? 0), stock_policy: String(row.stock_policy ?? "deny"), backorder_days: row.backorder_days === null || row.backorder_days === undefined ? null : Number(row.backorder_days) })
        : null;
      const available = range ? 1 : stock ? (stock.stockPolicy === "continue" ? MAX_LINE_QUANTITY : stock.inStock) : MAX_LINE_QUANTITY;
      const plan = row.selling_plan_id
        ? {
            id: String(row.selling_plan_id),
            interval: row.interval as PlanInterval,
            intervalCount: Number(row.interval_count),
            discountPercent: Number(row.discount_percent),
            trialDays: Number(row.trial_days),
            minCycles: Number(row.min_cycles),
            signupFeeMinor: shown(market, Number(row.signup_fee)),
          }
        : null;
      // Kept in the country's own currency; the cart is in the one shown (D109).
      const baseMinor = row.amount_minor === null ? null : planPrice(shown(market, Number(row.amount_minor)), plan?.discountPercent ?? 0);
      const price =
        range && baseMinor !== null
          ? linePrice(
              {
                kind: range,
                period: parseRentalPeriod(row.rental_period),
                startsAt: new Date(String(row.starts_at)).toISOString(),
                count,
                baseMinor,
                currency: market.currency,
                timeZone: String(row.time_zone),
              },
              pricing.get(String(row.product_id)),
            )
          : null;
      const unitPriceMinor = price ? price.totalMinor : baseMinor;
      const status: CartLineStatus =
        !row.sellable || !row.plan_ok || (plan !== null && !isNative(market)) || unitPriceMinor === null || available <= 0
          ? "unavailable"
          : !(stock ? lineIsOk(quantity, stock) : available >= quantity)
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
        // Goods only: a booking's price is for its nights, days or hours, and the database refuses a measure on one.
        measure: range || row.starts_at || status === "unavailable" ? null : shownMeasureFromColumns(row.measure_amount, row.measure_unit, row.measure_base, market.code),
        available,
        inStock: stock ? stock.inStock : available,
        backorder: stock && status === "ok" ? backorderNote(quantity, stock) : null,
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
              endsAt: rangeEnd(row, count),
              resourceId: row.resource_id ? String(row.resource_id) : null,
              staff: row.staff ? String(row.staff) : null,
              timeZone: String(row.time_zone),
              count,
              price: price && baseMinor !== null ? { itemsMinor: price.itemsMinor, feeMinor: price.feeMinor, seasonal: price.seasonal, baseMinor } : null,
            }
          : null,
        payment: row.payment
          ? { mode: parsePaymentMode(row.payment), depositPercent: Number(row.deposit_percent) }
          : null,
        hostId: row.host_id ? String(row.host_id) : null,
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

/**
 * The company the shopper buys for (B2B), or null to buy privately: kept on the cart for the order. A different company
 * (or none) takes the EU VAT number typed for the old one and its check off the cart (D157): a number belongs to one company.
 */
export async function setCartCompany(shop: Shop, given: CartCompany | null): Promise<void> {
  const cartId = await readCartId(shop);
  if (!cartId) return;
  // Only where the store sells to businesses (D178: a stale page of a store that stopped is bought privately).
  const company = given && (await sellsToBusinesses(shop.storeId)) ? given : null;
  await db().execute(sql`
    update commerce.carts set company_name = ${company?.name ?? null}, organisation_number = ${company?.number ?? null},
      vat_number = case when ${company?.number ?? null}::text is not null and organisation_number is not distinct from ${company?.number ?? null} then vat_number end,
      vat_check_id = case when ${company?.number ?? null}::text is not null and organisation_number is not distinct from ${company?.number ?? null} then vat_check_id end,
      updated_at = now()
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open'
  `);
}

/** Whether the store offers gift messages, and what the cart holds: what the cart page's gift box is drawn from (the store's switch is `order_settings.gift_messages`). */
export async function getCartGift(shop: Shop): Promise<{ enabled: boolean; gift: GiftFields }> {
  const [setting] = await db().execute<Row>(sql`select gift_messages from commerce.order_settings where store_id = ${shop.storeId}::uuid`);
  const enabled = Boolean(setting?.gift_messages);
  if (!enabled) return { enabled, gift: NO_GIFT };
  const cartId = await readCartId(shop);
  if (!cartId) return { enabled, gift: NO_GIFT };
  const [row] = await db().execute<Row>(sql`
    select is_gift, gift_to, gift_from, gift_message from commerce.carts
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and market_code = ${shop.market.code} and status = 'open' and expires_at > now()
  `);
  return { enabled, gift: row ? giftOfRow(row) : NO_GIFT };
}

export type SetCartGiftResult =
  | { ok: true; gift: GiftFields }
  | { ok: false; problem: "no_cart" }
  /** A text over its limit: refused, never cut; each problem says how many characters (or lines) too many. */
  | { ok: false; problem: "too_long"; problems: GiftProblem[] };

/**
 * The buyer's gift on the cart (wave 3, D173, `docs/wave-3-orders.md` 2.1): ticked or not, with To, From and a message, cleaned by `cleanGift()` (NFC, no control, bidirectional or zero-width
 * characters, never cut: over the limit is refused with the excess). Unticking clears the three texts. A store with gift messages off ignores everything sent to it (nothing is stored, the answer
 * is no gift). Sets no cookie and keeps nothing outside the cart; the cart's own cookie already exists.
 */
export async function setCartGift(shop: Shop, input: { isGift?: unknown; to?: unknown; from?: unknown; message?: unknown }): Promise<SetCartGiftResult> {
  const [setting] = await db().execute<Row>(sql`select gift_messages from commerce.order_settings where store_id = ${shop.storeId}::uuid`);
  if (!setting?.gift_messages) return { ok: true, gift: NO_GIFT };
  const cartId = await readCartId(shop);
  if (!cartId) return { ok: false, problem: "no_cart" };
  const cleaned = cleanGift(input, true);
  if (!cleaned.ok) return { ok: false, problem: "too_long", problems: cleaned.problems };
  const gift = cleaned.gift;
  await db().execute(sql`
    update commerce.carts set is_gift = ${gift.isGift}, gift_to = ${gift.to}, gift_from = ${gift.from}, gift_message = ${gift.message}, updated_at = now()
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and market_code = ${shop.market.code} and status = 'open'
  `);
  return { ok: true, gift };
}

export type CartVatResult = CartVatOutcome | { ok: false; problem: "no_company" };

/**
 * The shopper's EU VAT number for the cart (D157), asked of VIES (`checkCartVatNumber()`) and kept with its answer. The
 * company may be given with it (the cart page holds the company's fields until checkout starts): it is kept first, as
 * `checkoutAction()` keeps it. A cart without a company (a private buyer) has no VAT number to give. An empty number takes
 * the number off the cart. VIES being down is an *unavailable* answer: VAT is charged and nothing is blocked.
 */
export async function setCartVatNumber(
  shop: Shop,
  typed: string,
  company?: CartCompany | null,
  deps: CartVatDeps = {},
): Promise<CartVatResult> {
  const cartId = await readCartId(shop);
  if (!cartId) return { ok: false, problem: "no_cart" };
  if (company) await setCartCompany(shop, company);
  const [row] = await db().execute<Row>(sql`
    select company_name, organisation_number from commerce.carts
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open'
  `);
  if (!row?.company_name || !row.organisation_number) return { ok: false, problem: "no_company" };
  return checkCartVatNumber(shop, cartId, typed, deps);
}

/** Units in the cart, for the header. */
export async function getCartCount(shop: Shop): Promise<number> {
  const cartId = await readCartId(shop);
  if (!cartId) return 0;
  const [row] = await db().execute<Row>(sql`
    select coalesce(sum(case when cl.starts_at is null then cl.quantity else 1 end), 0)::int as count
    from commerce.cart_lines cl
    join commerce.carts c on c.store_id = cl.store_id and c.id = cl.cart_id
    where c.store_id = ${shop.storeId}::uuid and c.id = ${cartId}::uuid
      and c.market_code = ${shop.market.code}
      and c.status = 'open' and c.expires_at > now()
  `);
  return Number(row?.count ?? 0);
}

/** Whether the shopper has chosen to buy for a business (B2B). */
/** Whether the store sells to businesses as shoppers see it (B2B, D178: its chosen audience is not consumers and Sell to businesses is on). */
export async function sellsToBusinesses(storeId: string, runner: Pick<ReturnType<typeof db>, "execute"> = db()): Promise<boolean> {
  const [row] = await runner.execute<Row>(sql`select ${STORE_AUDIENCE} <> 'consumers' as yes from commerce.stores s where s.id = ${storeId}::uuid`);
  return Boolean(row?.yes);
}

async function buysForBusiness(storeId: string): Promise<boolean> {
  return parseBuyer((await cookies()).get(buyerCookie(storeId))?.value) === "business";
}

export type SellableQuantity = {
  available: number;
  kind: BookedKind | "goods";
  /** Units really in stock (net of live checkout holds); for a download or a booking, the same as `available`. */
  inStock: number;
  stockPolicy: "deny" | "continue";
  backorderDays: number | null;
};

/**
 * Units of a variant that can be sold in the market right now, or null if
 * the variant is not for sale there (inactive, or no price in the market).
 * `available` is the most a cart line may hold: the stock for a variant that
 * stops selling at zero, the line maximum for one that keeps selling on
 * backorder (wave 3, D172); `inStock` and the policy say how much of it is
 * real stock and what the shopper is told about the rest.
 */
export async function sellableQuantity(
  tx: Tx,
  { storeId, market }: Shop,
  variantId: string,
  sellingPlanId: string | null,
  booking: LineBooking | null,
  /** A stay's nights or a rental's days (D67). */
  count: number,
): Promise<SellableQuantity | null> {
  // A subscription renews at a price kept in the country's own currency, so it is bought in it only (D109).
  if (sellingPlanId && !isNative(market)) return null;
  const [row] = await tx.execute<Row>(sql`
    select v.product_id, p.kind, v.rental_period, v.delivery, va.in_stock, va.stock_policy, va.backorder_days
    from commerce.product_variants v
    join commerce.variant_availability va on va.store_id = v.store_id and va.variant_id = v.id
    join commerce.products p
      on p.store_id = v.store_id and p.id = v.product_id and p.status = 'active'
    join commerce.prices pr
      on pr.variant_id = v.id and pr.market_code = ${market.code} and pr.valid_to is null
    where v.store_id = ${storeId}::uuid and v.id = ${variantId}::uuid and v.active
      -- Appointments, stays and rentals are booked for a time (D65, D67), and goods have none.
      and (p.kind = 'goods') = ${booking === null}
      -- A product is offered only where the store sells to its kind (D178: never a business-only one where it sells to consumers, Sell to
      -- businesses switched off included), and business-only products are sold to businesses where the store sells to both (B2B).
      and ${OFFERED}
      and (p.audience <> 'businesses' or ${await buysForBusiness(storeId)}
        or (select ${STORE_AUDIENCE} from commerce.stores s where s.id = v.store_id) <> 'both')
      and ${
        sellingPlanId
          ? sql`exists (
              select 1 from commerce.selling_plans sp
              where sp.store_id = v.store_id and sp.id = ${sellingPlanId}::uuid and sp.product_id = p.id and sp.active
                and ${plansOffered(sql`sp.store_id`)}
            )`
          : sql`not p.subscription_only`
      }
  `);
  if (!row) return null;
  const physical = String(row.delivery) === "physical";
  const stock = physical
    ? stockOf({ in_stock: Number(row.in_stock ?? 0), raw_available: Number(row.in_stock ?? 0), stock_policy: String(row.stock_policy ?? "deny"), backorder_days: row.backorder_days === null || row.backorder_days === undefined ? null : Number(row.backorder_days) })
    : null;
  const room = {
    inStock: stock ? stock.inStock : MAX_LINE_QUANTITY,
    stockPolicy: stock ? stock.stockPolicy : ("deny" as const),
    backorderDays: stock ? stock.backorderDays : null,
  };
  if (!booking) return { available: stock ? (stock.stockPolicy === "continue" ? MAX_LINE_QUANTITY : stock.inStock) : MAX_LINE_QUANTITY, kind: "goods", ...room };
  const kind = bookedKind(row.kind);
  // A stay or a rental must be free for all its nights or days, and keep to the product's rules.
  if (kind !== "appointment") {
    const free = await checkRange(tx, storeId, String(row.product_id), {
      startsAt: booking.startsAt,
      count,
      unitId: booking.resourceId,
      period: parseRentalPeriod(row.rental_period),
    });
    return { available: free.ok ? count : 0, kind, ...room };
  }
  // An appointment's time must be one the product page would offer now.
  const free = await freeResourcesAt(tx, storeId, String(row.product_id), booking.startsAt, booking.resourceId);
  return { available: free && free.resourceIds.length > 0 ? 1 : 0, kind, ...room };
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
  // Which visit made the cart, for the analytics' channel of its order (D152); never in the way of adding to it.
  await attachVisitToCart(tx, storeId, id);
  await setCartCookie(shop, id);
  return id;
}

/** Makes `id` the cart of this browser in the store and market (the one cookie a cart has, strictly necessary, D14). */
export async function setCartCookie(shop: Shop, id: string): Promise<void> {
  (await cookies()).set(cookieName(shop), id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CART_TTL_DAYS * 24 * 60 * 60,
  });
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
