import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";

import { db } from "@/db/client";
import { addDays, zonedTime } from "@/lib/booking-slots";
import { stripeLocale } from "@/lib/checkout";
import { toMarket, type Market } from "@/lib/markets";
import { marketPath, storeOrigin } from "@/lib/paths";
import { priceVat, type PriceVat } from "@/lib/pricing";
import { variantLabel } from "@/lib/product-input";
import { basketShipping } from "@/lib/subscriptions";
import type { ShownMeasure } from "@/lib/unit-price";
import { shownMeasureFromColumns } from "@/lib/unit-price-rules";
import { saleFee, type PaymentModeName } from "@/lib/stripe-account";
import {
  currentRound,
  LINE_MAX_QUANTITY,
  LIST_MAX_LINES,
  nextRound,
  upcomingDates,
  type DeliveryRound,
  type DeliverySchedule,
  type StandingStatus,
} from "@/lib/standing-orders";
import { shownOptions, t } from "@/lib/i18n";

import { audit, type Membership } from "./auth";
import { storeFeeBps } from "./billing";
import { cancelUnpaidOrder, completeOrderPayment, placeOrder } from "./checkout";
import { ensureTestAccount } from "./connect";
import type { Address } from "./orders";
import { getCheckoutAccount } from "./settings";
import { sendDeliveryCard, sendDeliveryPrepared, sendDeliveryStarted } from "./shopper-emails";
import { platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Weekly deliveries (D102): a store delivers on set days, and signed-in
 * shoppers keep a standing list of what they want each time. At each
 * cutoff the list becomes that delivery's order, at the day's prices, with
 * its stock held until the delivery day; what cannot be had is left out
 * and the shopper told. The card saved on the store's Stripe account is
 * charged when staff send the delivery (`chargeDelivery()`), for what was
 * packed. A list nobody changes repeats; a change before a cutoff goes into
 * that delivery.
 */

// ---------------------------------------------------------------------------
// Schedules (the store's)
// ---------------------------------------------------------------------------

export type ScheduleView = DeliverySchedule & {
  id: string;
  marketCode: string;
  currency: string;
  name: string;
  active: boolean;
  /** Lists on it that are not cancelled. */
  lists: number;
};

const toSchedule = (row: Row): ScheduleView => ({
  id: String(row.id),
  marketCode: String(row.market_code),
  currency: String(row.currency),
  name: String(row.name),
  deliveryWeekday: Number(row.delivery_weekday),
  cutoffDays: Number(row.cutoff_days),
  cutoffTime: String(row.cutoff_time),
  active: Boolean(row.active),
  lists: Number(row.lists ?? 0),
});

export async function listSchedules(storeId: string, { activeOnly = false, marketCode }: { activeOnly?: boolean; marketCode?: string } = {}): Promise<ScheduleView[]> {
  const rows = await db().execute<Row>(sql`
    select d.*, (select count(*)::int from commerce.standing_orders o
                  where o.store_id = d.store_id and o.schedule_id = d.id and o.status in ('active', 'paused')) as lists
    from commerce.delivery_schedules d
    where d.store_id = ${storeId}::uuid
      and (${!activeOnly} or d.active)
      and (${marketCode ?? null}::text is null or d.market_code = ${marketCode ?? null})
    order by d.market_code, d.delivery_weekday, d.name
  `);
  return rows.map(toSchedule);
}

export const scheduleInput = z.object({
  id: z.uuid().nullable(),
  marketCode: z.string().length(2),
  name: z.string().trim().min(1, "Give the delivery day a name, such as Thursday delivery.").max(80),
  deliveryWeekday: z.coerce.number().int().min(1).max(7),
  cutoffDays: z.coerce.number().int().min(1, "The cutoff is 1 to 7 days before.").max(7, "The cutoff is 1 to 7 days before."),
  cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Write the cutoff time as HH:MM."),
  active: z.boolean(),
});

export type SaveResult = { ok: true } | { ok: false; problems: string[] };

/** Adds or changes a delivery day. A market's lists follow a change from the next cutoff. */
export async function saveSchedule({ account, store }: Membership, input: z.infer<typeof scheduleInput>): Promise<SaveResult> {
  const [market] = await db().execute<Row>(sql`
    select currency from commerce.markets where store_id = ${store.id}::uuid and code = ${input.marketCode} and active
  `);
  if (!market) return { ok: false, problems: ["Choose one of the store's markets."] };
  if (input.id) {
    const [row] = await db().execute<Row>(sql`
      update commerce.delivery_schedules set name = ${input.name}, delivery_weekday = ${input.deliveryWeekday},
        cutoff_days = ${input.cutoffDays}, cutoff_time = ${input.cutoffTime}, active = ${input.active}, updated_at = now()
      where store_id = ${store.id}::uuid and id = ${input.id}::uuid
      returning id
    `);
    if (!row) return { ok: false, problems: ["This delivery day no longer exists."] };
  } else {
    await db().execute(sql`
      insert into commerce.delivery_schedules (store_id, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time, active)
      values (${store.id}::uuid, ${input.marketCode}, ${String(market.currency)}, ${input.name}, ${input.deliveryWeekday},
        ${input.cutoffDays}, ${input.cutoffTime}, ${input.active})
    `);
  }
  await audit(account.id, store.id, input.id ? "deliveries.schedule_changed" : "deliveries.schedule_added", {
    name: input.name,
    weekday: input.deliveryWeekday,
    cutoff: `${input.cutoffDays}d ${input.cutoffTime}`,
    active: input.active,
  });
  return { ok: true };
}

/** Switches weekly deliveries on or off (D102): off, shoppers cannot start lists, and cutoffs stop. */
export async function setDeliveriesModule({ account, store }: Membership, enabled: boolean): Promise<void> {
  await db().execute(sql`
    update commerce.stores set modules = case when ${enabled}
      then (select array_agg(distinct m) from unnest(modules || array['deliveries']) m)
      else array_remove(modules, 'deliveries') end
    where id = ${store.id}::uuid
  `);
  await audit(account.id, store.id, enabled ? "deliveries.enabled" : "deliveries.disabled", {});
}

// ---------------------------------------------------------------------------
// A shopper's list
// ---------------------------------------------------------------------------

/** What may go on a list: the store's own goods that are shipped and sold once, active, with a price. */
const listable = sql`
  p.status = 'active' and v.active and v.delivery = 'physical' and p.kind = 'goods'
  and not p.subscription_only and p.host_id is null
`;

export type ListLine = {
  variantId: string;
  productHandle: string;
  title: string;
  image: string | null;
  quantity: number;
  /** Today's price with VAT; null when it cannot be had in this market. */
  unitMinor: number | null;
  vat: PriceVat;
  /** What is in it now and what it is compared per in the list's market (D160): the unit price is of `unitMinor`. */
  measure: ShownMeasure | null;
  /** It can go in a delivery now: on sale, priced and in stock. */
  available: boolean;
};

export type DeliveryOrder = {
  date: string;
  orderId: string;
  number: string;
  status: string;
  totalMinor: number;
  shippingMinor: number;
  lines: { title: string; quantity: number; totalMinor: number }[];
  leftOut: LeftOut[];
  /** The card was tried and refused: the shopper pays by link. */
  payFailed: boolean;
};

export type LeftOut = { title: string; wanted: number; got: number };

export type StandingOrderView = {
  id: string;
  status: StandingStatus;
  schedule: ScheduleView;
  marketCode: string;
  currency: string;
  shippingAddress: Address;
  cardLabel: string;
  skipDates: string[];
  lines: ListLine[];
  /** What the next delivery would cost at today's prices: items, shipping and the total. */
  estimate: { itemsMinor: number; shippingMinor: number; totalMinor: number };
  /** Where a change made now goes. */
  next: DeliveryRound;
  /** The delivery days that can still be skipped. */
  upcoming: string[];
  /** The delivery being packed, if its cutoff has passed. */
  current: DeliveryOrder | null;
  /** Earlier deliveries the card did not pay for, waiting for the shopper. */
  unpaid: DeliveryOrder[];
  /** Earlier deliveries, newest first. */
  history: { date: string; outcome: string; orderId: string | null; number: string | null; status: string | null; totalMinor: number | null }[];
};

async function storeClock(storeId: string): Promise<{ timeZone: string; audience: string }> {
  const [row] = await db().execute<Row>(sql`select time_zone, audience from commerce.stores where id = ${storeId}::uuid`);
  return { timeZone: String(row?.time_zone ?? "Europe/Oslo"), audience: String(row?.audience ?? "consumers") };
}

/** The customer's open list in this store, or null. */
export async function getStandingOrder(storeId: string, customerId: string, market: Market): Promise<StandingOrderView | null> {
  const [row] = await db().execute<Row>(sql`
    select o.*, array_to_json(o.skip_dates) as skip_list, d.id as d_id, d.market_code as d_market_code, d.currency as d_currency, d.name as d_name,
      d.delivery_weekday, d.cutoff_days, d.cutoff_time, d.active as d_active
    from commerce.standing_orders o
    join commerce.delivery_schedules d on d.store_id = o.store_id and d.id = o.schedule_id
    where o.store_id = ${storeId}::uuid and o.customer_id = ${customerId}::uuid and o.status <> 'cancelled'
  `);
  if (!row) return null;
  const schedule = toSchedule({
    id: row.d_id,
    market_code: row.d_market_code,
    currency: row.d_currency,
    name: row.d_name,
    delivery_weekday: row.delivery_weekday,
    cutoff_days: row.cutoff_days,
    cutoff_time: row.cutoff_time,
    active: row.d_active,
  });
  const listId = String(row.id);
  const { timeZone, audience } = await storeClock(storeId);
  const now = Date.now();
  const lines = await listLines(storeId, listId, schedule.marketCode, market.locale, market.lang, audience);
  const [rate] = await db().execute<Row>(sql`
    select amount_minor, free_over_minor from commerce.shipping_rates
    where store_id = ${storeId}::uuid and market_code = ${schedule.marketCode}
  `);
  const counted = lines.filter((l) => l.available && l.unitMinor !== null);
  const itemsMinor = counted.reduce((sum, l) => sum + (l.unitMinor ?? 0) * l.quantity, 0);
  const shipping =
    counted.length > 0 && rate
      ? basketShipping(
          counted.map((l) => ({ totalMinor: (l.unitMinor ?? 0) * l.quantity, delivery: "physical" as const, recurring: false })),
          { amountMinor: Number(rate.amount_minor), freeOverMinor: rate.free_over_minor === null ? null : Number(rate.free_over_minor) },
        ).first
      : 0;
  const round = currentRound(schedule, now, timeZone);
  const deliveries = await db().execute<Row>(sql`
    select sd.delivery_date::text as date, sd.outcome, sd.order_id, sd.left_out, o.number, o.status, o.total_minor, o.shipping_minor
    from commerce.standing_deliveries sd
    left join commerce.orders o on o.store_id = sd.store_id and o.id = sd.order_id
    where sd.store_id = ${storeId}::uuid and sd.standing_order_id = ${listId}::uuid
    order by sd.delivery_date desc
    limit 13
  `);
  const currentRow = round ? deliveries.find((d) => d.date === round.date && d.order_id) : undefined;
  const current = currentRow ? await deliveryOrder(storeId, currentRow) : null;
  const unpaid = (
    await Promise.all(
      deliveries.filter((d) => d !== currentRow && d.status === "pending_payment").map((d) => deliveryOrder(storeId, d)),
    )
  ).filter((d) => d.payFailed);
  return {
    id: listId,
    status: row.status as StandingStatus,
    schedule,
    marketCode: schedule.marketCode,
    currency: schedule.currency,
    shippingAddress: (row.shipping_address ?? {}) as Address,
    cardLabel: String(row.card_label ?? ""),
    skipDates: ((row.skip_list ?? []) as string[]).map(String),
    lines,
    estimate: { itemsMinor, shippingMinor: shipping, totalMinor: itemsMinor + shipping },
    next: nextRound(schedule, now, timeZone),
    upcoming: upcomingDates(schedule, now, timeZone, 6),
    current,
    unpaid,
    history: deliveries
      .filter((d) => d !== currentRow)
      .map((d) => ({
        date: String(d.date),
        outcome: String(d.outcome),
        orderId: d.order_id ? String(d.order_id) : null,
        number: d.number ? String(d.number) : null,
        status: d.status ? String(d.status) : null,
        totalMinor: d.total_minor === null || d.total_minor === undefined ? null : Number(d.total_minor),
      })),
  };
}

async function deliveryOrder(storeId: string, row: Row): Promise<DeliveryOrder> {
  const lines = await db().execute<Row>(sql`
    select title, quantity, total_minor from commerce.order_lines
    where store_id = ${storeId}::uuid and order_id = ${String(row.order_id)}::uuid and variant_id is not null
    order by title
  `);
  const [failed] = await db().execute<Row>(sql`
    select exists (select 1 from commerce.payments where store_id = ${storeId}::uuid and order_id = ${String(row.order_id)}::uuid and status = 'failed') as failed
  `);
  return {
    date: String(row.date),
    orderId: String(row.order_id),
    number: String(row.number),
    status: String(row.status),
    totalMinor: Number(row.total_minor),
    shippingMinor: Number(row.shipping_minor ?? 0),
    lines: lines.map((l) => ({ title: String(l.title), quantity: Number(l.quantity), totalMinor: Number(l.total_minor) })),
    leftOut: (row.left_out ?? []) as LeftOut[],
    payFailed: row.status === "pending_payment" && Boolean(failed?.failed),
  };
}

/** A list's lines with today's price and whether they can be had. */
async function listLines(storeId: string, listId: string, marketCode: string, locale: string, lang: string, audience: string): Promise<ListLine[]> {
  const rows = await db().execute<Row>(sql`
    select l.variant_id, l.quantity, p.handle, v.options, v.measure_amount, v.measure_unit, v.measure_base,
      coalesce(tl.title, tf.title, p.handle) as title,
      coalesce(v.image_thumbnail_url, v.image_url, (select coalesce(m.thumbnail_url, m.url) from commerce.product_media m
         where m.store_id = p.store_id and m.product_id = p.id order by m.position limit 1)) as image,
      cp.amount_minor, commerce.vat_rate(${marketCode}, p.vat_category) as vat_rate,
      (${listable}) as sellable,
      coalesce((select sum(greatest(il.on_hand, 0)) from commerce.inventory_levels il
         join commerce.inventory_locations loc on loc.id = il.location_id and loc.active
         where il.store_id = v.store_id and il.variant_id = v.id), 0)
      - coalesce((select sum(r.quantity) from commerce.inventory_reservations r
         where r.store_id = v.store_id and r.variant_id = v.id and r.released_at is null and r.expires_at > now()), 0) as free
    from commerce.standing_order_lines l
    join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${marketCode}
    where l.store_id = ${storeId}::uuid and l.standing_order_id = ${listId}::uuid
    order by l.created_at, p.handle
  `);
  const m = t(lang);
  return rows.map((row) => {
    const options = (row.options ?? {}) as Record<string, string>;
    const label = variantLabel(shownOptions(m, options));
    return {
      variantId: String(row.variant_id),
      productHandle: String(row.handle),
      title: label ? `${String(row.title)} (${label})` : String(row.title),
      image: row.image ? String(row.image) : null,
      quantity: Number(row.quantity),
      unitMinor: row.amount_minor === null ? null : Number(row.amount_minor),
      vat: priceVat(audience, row.vat_rate),
      measure: shownMeasureFromColumns(row.measure_amount, row.measure_unit, row.measure_base, marketCode),
      available: Boolean(row.sellable) && row.amount_minor !== null && Number(row.free) > 0,
    };
  });
}

type OpenList = { id: string; status: StandingStatus; scheduleId: string; marketCode: string };

async function openList(storeId: string, customerId: string): Promise<OpenList | null> {
  const [row] = await db().execute<Row>(sql`
    select o.id, o.status, o.schedule_id, d.market_code
    from commerce.standing_orders o
    join commerce.delivery_schedules d on d.store_id = o.store_id and d.id = o.schedule_id
    where o.store_id = ${storeId}::uuid and o.customer_id = ${customerId}::uuid and o.status <> 'cancelled'
  `);
  return row
    ? { id: String(row.id), status: row.status as StandingStatus, scheduleId: String(row.schedule_id), marketCode: String(row.market_code) }
    : null;
}

export type ListProblem = "no_list" | "not_listable" | "full" | "not_open" | "date";
export type ListResult = { ok: true; quantity: number } | { ok: false; problem: ListProblem };

/**
 * Sets how many of a variant the list holds (0 takes it off). A delivery
 * whose cutoff has passed is made first, so the change goes into the next
 * one and never into one being packed.
 */
export async function setListQuantity(storeId: string, customerId: string, variantId: string, quantity: number, { add = false } = {}): Promise<ListResult> {
  const list = await openList(storeId, customerId);
  if (!list) return { ok: false, problem: "no_list" };
  await prepareDueFor(storeId, list.id);
  if (quantity <= 0 && !add) {
    await db().execute(sql`
      delete from commerce.standing_order_lines
      where store_id = ${storeId}::uuid and standing_order_id = ${list.id}::uuid and variant_id = ${variantId}::uuid
    `);
    await touch(storeId, list.id);
    return { ok: true, quantity: 0 };
  }
  const [ok] = await db().execute<Row>(sql`
    select 1 from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${list.marketCode}
    where v.store_id = ${storeId}::uuid and v.id = ${variantId}::uuid and ${listable}
  `);
  if (!ok) return { ok: false, problem: "not_listable" };
  const [count] = await db().execute<Row>(sql`
    select count(*)::int as n, bool_or(variant_id = ${variantId}::uuid) as has
    from commerce.standing_order_lines where store_id = ${storeId}::uuid and standing_order_id = ${list.id}::uuid
  `);
  if (!count?.has && Number(count?.n ?? 0) >= LIST_MAX_LINES) return { ok: false, problem: "full" };
  const [row] = await db().execute<Row>(sql`
    insert into commerce.standing_order_lines (store_id, standing_order_id, variant_id, quantity)
    values (${storeId}::uuid, ${list.id}::uuid, ${variantId}::uuid, ${Math.min(Math.max(quantity, 1), LINE_MAX_QUANTITY)})
    on conflict (standing_order_id, variant_id) do update set
      quantity = least(${add ? sql`standing_order_lines.quantity + excluded.quantity` : sql`excluded.quantity`}, ${LINE_MAX_QUANTITY}),
      updated_at = now()
    returning quantity
  `);
  await touch(storeId, list.id);
  return { ok: true, quantity: Number(row.quantity) };
}

const touch = (storeId: string, listId: string) =>
  db().execute(sql`update commerce.standing_orders set updated_at = now() where store_id = ${storeId}::uuid and id = ${listId}::uuid`);

/** Skips a coming delivery day, or takes the skip back. Only days whose cutoff has not passed. */
export async function setSkip(storeId: string, customerId: string, date: string, skip: boolean): Promise<ListResult> {
  const list = await openList(storeId, customerId);
  if (!list) return { ok: false, problem: "no_list" };
  const schedule = await scheduleOf(storeId, list.scheduleId);
  const { timeZone } = await storeClock(storeId);
  if (!schedule || !upcomingDates(schedule, Date.now(), timeZone, 6).includes(date)) return { ok: false, problem: "date" };
  await db().execute(sql`
    update commerce.standing_orders set
      skip_dates = ${
        skip
          ? sql`(select array_agg(distinct d order by d) from unnest(skip_dates || array[${date}::date]) d where d >= current_date - 7)`
          : sql`array_remove(skip_dates, ${date}::date)`
      },
      updated_at = now()
    where store_id = ${storeId}::uuid and id = ${list.id}::uuid
  `);
  return { ok: true, quantity: 0 };
}

async function scheduleOf(storeId: string, scheduleId: string): Promise<ScheduleView | null> {
  const [row] = await db().execute<Row>(sql`
    select * from commerce.delivery_schedules where store_id = ${storeId}::uuid and id = ${scheduleId}::uuid
  `);
  return row ? toSchedule(row) : null;
}

/** Pauses the list (no deliveries until resumed), resumes it, or ends it. Deliveries already being packed go ahead. */
export async function setListStatus(storeId: string, customerId: string, change: "pause" | "resume" | "cancel"): Promise<ListResult> {
  const list = await openList(storeId, customerId);
  if (!list || list.status === "setup" && change !== "cancel") return { ok: false, problem: list ? "not_open" : "no_list" };
  await prepareDueFor(storeId, list.id);
  const [row] = await db().execute<Row>(sql`
    update commerce.standing_orders set
      status = ${change === "pause" ? "paused" : change === "resume" ? "active" : "cancelled"},
      cancelled_at = ${change === "cancel" ? sql`now()` : sql`null`},
      updated_at = now()
    where store_id = ${storeId}::uuid and id = ${list.id}::uuid
    returning stripe_account, mode, payment_method
  `);
  // An ended list's card is no longer kept for the store.
  if (change === "cancel" && row?.payment_method && row.stripe_account && row.mode) {
    const stripe = platformStripe(row.mode as PaymentModeName);
    try {
      await stripe?.paymentMethods.detach(String(row.payment_method), {}, { stripeAccount: String(row.stripe_account) });
    } catch {
      // Already gone, or Stripe unreachable: the list no longer uses it either way.
    }
  }
  return { ok: true, quantity: 0 };
}

export const addressInput = z.object({
  name: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200),
  postalCode: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(40),
});

export async function setListAddress(storeId: string, customerId: string, address: z.infer<typeof addressInput>): Promise<ListResult> {
  const list = await openList(storeId, customerId);
  if (!list) return { ok: false, problem: "no_list" };
  await prepareDueFor(storeId, list.id);
  await db().execute(sql`
    update commerce.standing_orders set shipping_address = ${JSON.stringify({ ...address, country: list.marketCode })}::jsonb, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${list.id}::uuid
  `);
  return { ok: true, quantity: 0 };
}

// ---------------------------------------------------------------------------
// Starting a list: the card, saved on the store's Stripe account
// ---------------------------------------------------------------------------

export type StartProblem = "schedule" | "consent" | "payments_off" | "payment_error" | "address";
export type StartResult = { ok: true; url: string } | { ok: false; problem: StartProblem };

/**
 * Starts a list, or changes its card or delivery day: the shopper agrees to
 * being charged for each delivery as it is sent, and Stripe Checkout (in
 * setup mode, on the store's account) saves their card. The list is on once
 * the card is saved (`finishCardSetup()`).
 */
export async function startCardSetup(
  shop: { storeId: string; storeSlug: string; market: Market },
  customer: { id: string; email: string; name: string },
  input: { scheduleId: string; address: z.infer<typeof addressInput>; consent: boolean },
  origin: string,
): Promise<StartResult> {
  if (!input.consent) return { ok: false, problem: "consent" };
  const [schedule] = await db().execute<Row>(sql`
    select d.id, d.currency from commerce.delivery_schedules d
    join commerce.stores s on s.id = d.store_id and 'deliveries' = any(s.modules)
    where d.store_id = ${shop.storeId}::uuid and d.id = ${input.scheduleId}::uuid and d.active and d.market_code = ${shop.market.code}
  `);
  if (!schedule) return { ok: false, problem: "schedule" };
  const found = await getCheckoutAccount(shop.storeId);
  const stripe = found && platformStripe(found.mode);
  if (!found || !stripe) return { ok: false, problem: "payments_off" };
  let accountId = found.accountId;
  if (!accountId) {
    const test = await ensureTestAccount(shop.storeId);
    if (!test.ok || !test.ready) return { ok: false, problem: "payments_off" };
    accountId = test.accountId;
  }
  const address = JSON.stringify({ ...input.address, country: shop.market.code });
  const existing = await openList(shop.storeId, customer.id);
  const [list] = existing
    ? await db().execute<Row>(sql`
        update commerce.standing_orders set schedule_id = ${input.scheduleId}::uuid, shipping_address = ${address}::jsonb, updated_at = now()
        where store_id = ${shop.storeId}::uuid and id = ${existing.id}::uuid
        returning id, stripe_customer, stripe_account
      `)
    : await db().execute<Row>(sql`
        insert into commerce.standing_orders (store_id, customer_id, schedule_id, shipping_address)
        values (${shop.storeId}::uuid, ${customer.id}::uuid, ${input.scheduleId}::uuid, ${address}::jsonb)
        returning id, stripe_customer, stripe_account
      `);
  const listId = String(list.id);
  const base = `${storeOrigin(shop.storeSlug) ?? origin}${marketPath(shop.storeSlug, shop.market.slug)}`;
  try {
    // The shopper as the store's Stripe customer, once per account and mode.
    let stripeCustomer = list.stripe_customer && list.stripe_account === accountId ? String(list.stripe_customer) : null;
    if (!stripeCustomer) {
      const made = await stripe.customers.create(
        { email: customer.email, name: customer.name || undefined, metadata: { customer_id: customer.id, standing_order_id: listId } },
        { stripeAccount: accountId, idempotencyKey: `standing-customer-${listId}-${accountId}` },
      );
      stripeCustomer = made.id;
    }
    const session = await stripe.checkout.sessions.create(
      {
        mode: "setup",
        currency: shop.market.currency.toLowerCase(),
        customer: stripeCustomer,
        client_reference_id: listId,
        metadata: { standing_order_id: listId, store_id: shop.storeId },
        setup_intent_data: { metadata: { standing_order_id: listId }, description: "Subscription box" },
        locale: stripeLocale(shop.market.lang) as Stripe.Checkout.SessionCreateParams.Locale,
        success_url: `${base}/deliveries?setup={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/deliveries`,
      },
      { stripeAccount: accountId },
    );
    await db().execute(sql`
      update commerce.standing_orders set stripe_account = ${accountId}, mode = ${found.mode}, stripe_customer = ${stripeCustomer},
        setup_session = ${session.id}, updated_at = now()
      where store_id = ${shop.storeId}::uuid and id = ${listId}::uuid
    `);
    return session.url ? { ok: true, url: session.url } : { ok: false, problem: "payment_error" };
  } catch {
    return { ok: false, problem: "payment_error" };
  }
}

/** How a saved payment method reads: "Visa •••• 4242". */
export function cardLabel(method: Pick<Stripe.PaymentMethod, "type" | "card"> | null | undefined): string {
  if (!method) return "";
  if (method.type === "card" && method.card) {
    const brand = method.card.brand ? method.card.brand.charAt(0).toUpperCase() + method.card.brand.slice(1) : "Card";
    return `${brand} •••• ${method.card.last4}`;
  }
  return method.type.replaceAll("_", " ");
}

/**
 * Back from Stripe with the card saved: the list takes it and is on, with
 * the shopper's agreement kept as evidence. Safe to run more than once.
 */
export async function finishCardSetup(storeId: string, customerId: string, sessionId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select id, status, stripe_account, mode, payment_method, consent_at from commerce.standing_orders
    where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and status <> 'cancelled' and setup_session = ${sessionId}
  `);
  if (!row?.stripe_account || !row.mode) return false;
  const stripe = platformStripe(row.mode as PaymentModeName);
  if (!stripe) return false;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ["setup_intent.payment_method"] },
      { stripeAccount: String(row.stripe_account) },
    );
  } catch {
    return false;
  }
  const intent = session.setup_intent as Stripe.SetupIntent | string | null;
  if (session.status !== "complete" || typeof intent !== "object" || !intent || intent.status !== "succeeded") return false;
  const method = intent.payment_method as Stripe.PaymentMethod | string | null;
  const methodId = typeof method === "string" ? method : method?.id;
  if (!methodId) return false;
  const first = row.status === "setup";
  await db().execute(sql`
    update commerce.standing_orders set
      payment_method = ${methodId}, card_label = ${typeof method === "object" ? cardLabel(method) : ""},
      status = case when status = 'setup' then 'active' else status end,
      consent_at = coalesce(consent_at, now()), setup_session = null, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${String(row.id)}::uuid
  `);
  // The card it replaces is no longer kept.
  if (row.payment_method && row.payment_method !== methodId) {
    try {
      await stripe.paymentMethods.detach(String(row.payment_method), {}, { stripeAccount: String(row.stripe_account) });
    } catch {
      // Gone already.
    }
  }
  if (first) await sendDeliveryStarted(storeId, String(row.id));
  return true;
}

// ---------------------------------------------------------------------------
// The cutoff: lists become orders
// ---------------------------------------------------------------------------

/**
 * Every five minutes: each list whose delivery's cutoff has passed becomes
 * that delivery's order (or a record of why not), once. Lists started after
 * a cutoff join from the next delivery.
 */
export async function prepareDueDeliveries(limit = 200): Promise<{ ordered: number; other: number }> {
  const schedules = await db().execute<Row>(sql`
    select d.*, s.time_zone from commerce.delivery_schedules d
    join commerce.stores s on s.id = d.store_id and 'deliveries' = any(s.modules) and s.status <> 'closed'
    where d.active
  `);
  const counts = { ordered: 0, other: 0 };
  const now = Date.now();
  for (const row of schedules) {
    const schedule = toSchedule(row);
    const round = currentRound(schedule, now, String(row.time_zone));
    if (!round) continue;
    const lists = await db().execute<Row>(sql`
      select o.id from commerce.standing_orders o
      where o.store_id = ${String(row.store_id)}::uuid and o.schedule_id = ${schedule.id}::uuid
        and o.status in ('active', 'paused') and o.consent_at <= ${new Date(round.cutoffAt).toISOString()}::timestamptz
        and not exists (select 1 from commerce.standing_deliveries sd
                         where sd.standing_order_id = o.id and sd.delivery_date = ${round.date}::date)
      order by o.created_at
      limit ${limit}
    `);
    for (const list of lists) {
      const outcome = await prepareDelivery(String(row.store_id), String(list.id), round);
      if (outcome === "ordered") counts.ordered++;
      else if (outcome) counts.other++;
    }
  }
  return counts;
}

/** Makes the delivery whose cutoff has passed for one list, if it is not made yet (before a change the shopper makes). */
async function prepareDueFor(storeId: string, listId: string): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    select d.*, s.time_zone, o.status as list_status, o.consent_at
    from commerce.standing_orders o
    join commerce.delivery_schedules d on d.store_id = o.store_id and d.id = o.schedule_id
    join commerce.stores s on s.id = o.store_id and 'deliveries' = any(s.modules)
    where o.store_id = ${storeId}::uuid and o.id = ${listId}::uuid and d.active
  `);
  if (!row || !["active", "paused"].includes(String(row.list_status)) || !row.consent_at) return;
  const round = currentRound(toSchedule(row), Date.now(), String(row.time_zone));
  if (!round || new Date(String(row.consent_at)).getTime() > round.cutoffAt) return;
  await prepareDelivery(storeId, listId, round);
}

type Outcome = "ordered" | "skipped" | "paused" | "empty" | "unavailable";

/**
 * One list's delivery: its lines at today's prices, capped to the stock
 * there is, placed as an order through the same checkout rules as any
 * (`placeOrder()`), with its stock held until the day after the delivery.
 * The order waits for payment until the delivery is sent.
 */
export async function prepareDelivery(storeId: string, listId: string, round: DeliveryRound): Promise<Outcome | null> {
  const [list] = await db().execute<Row>(sql`
    select o.id, o.status, o.customer_id, array_to_json(o.skip_dates) as skip_dates, o.shipping_address, d.market_code,
      c.email, c.name, c.company_name, c.organisation_number, c.locale as customer_locale, s.time_zone,
      exists (select 1 from commerce.standing_deliveries sd where sd.standing_order_id = o.id and sd.delivery_date = ${round.date}::date) as done
    from commerce.standing_orders o
    join commerce.delivery_schedules d on d.store_id = o.store_id and d.id = o.schedule_id
    join commerce.customers c on c.store_id = o.store_id and c.id = o.customer_id
    join commerce.stores s on s.id = o.store_id
    where o.store_id = ${storeId}::uuid and o.id = ${listId}::uuid
  `);
  if (!list || list.done) return null;
  const record = async (outcome: Outcome, orderId: string | null, leftOut: LeftOut[] = []) => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.standing_deliveries (store_id, standing_order_id, delivery_date, outcome, order_id, left_out)
      values (${storeId}::uuid, ${listId}::uuid, ${round.date}::date, ${outcome}, ${orderId}::uuid, ${JSON.stringify(leftOut)}::jsonb)
      on conflict (standing_order_id, delivery_date) do nothing
      returning id
    `);
    return Boolean(row);
  };
  const skipped = ((list.skip_dates ?? []) as string[]).map(String).includes(round.date);
  if (list.status === "paused") return (await record("paused", null)) ? "paused" : null;
  if (list.status !== "active") return null;
  if (skipped) return (await record("skipped", null)) ? "skipped" : null;

  const [market] = await db().execute<Row>(sql`
    select code, currency, default_locale, locales from commerce.markets
    where store_id = ${storeId}::uuid and code = ${String(list.market_code)} and active
  `);
  if (!market) return (await record("unavailable", null)) ? "unavailable" : null;
  const locale = String(market.default_locale);
  // Deliveries are always in the country's own currency and language (D109).
  const shopMarket = toMarket({ code: String(market.code), currency: String(market.currency), defaultLocale: locale });

  // Twice at most: stock can go between counting it and placing the order.
  for (let attempt = 0; attempt < 2; attempt++) {
    const lines = await db().execute<Row>(sql`
      select l.variant_id, l.quantity, coalesce(tl.title, tf.title, p.handle) as title,
        (${listable} and cp.amount_minor is not null) as sellable,
        greatest(0,
          coalesce((select sum(greatest(il.on_hand, 0)) from commerce.inventory_levels il
             join commerce.inventory_locations loc on loc.id = il.location_id and loc.active
             where il.store_id = v.store_id and il.variant_id = v.id), 0)
          - coalesce((select sum(r.quantity) from commerce.inventory_reservations r
             where r.store_id = v.store_id and r.variant_id = v.id and r.released_at is null and r.expires_at > now()), 0))::int as free
      from commerce.standing_order_lines l
      join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
      left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
      left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${shopMarket.code}
      where l.store_id = ${storeId}::uuid and l.standing_order_id = ${listId}::uuid
      order by l.created_at
    `);
    if (lines.length === 0) return (await record("empty", null)) ? "empty" : null;
    const leftOut: LeftOut[] = [];
    const taken: { variantId: string; quantity: number }[] = [];
    for (const line of lines) {
      const wanted = Number(line.quantity);
      const got = line.sellable ? Math.min(wanted, Number(line.free)) : 0;
      if (got < wanted) leftOut.push({ title: String(line.title), wanted, got });
      if (got > 0) taken.push({ variantId: String(line.variant_id), quantity: got });
    }
    if (taken.length === 0) {
      if (!(await record("unavailable", null, leftOut))) return null;
      await sendDeliveryPrepared(storeId, listId, round.date);
      return "unavailable";
    }

    // The order is placed from a cart of its own, as any shopper's.
    const [cart] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, customer_id, company_name, organisation_number, expires_at)
      values (${storeId}::uuid, ${shopMarket.code}, ${shopMarket.currency}, ${locale}, ${String(list.customer_id)}::uuid,
        nullif(${String(list.company_name ?? "")}, ''), nullif(${String(list.organisation_number ?? "")}, ''), now() + interval '1 hour')
      returning id
    `);
    const cartId = String(cart.id);
    for (const line of taken) {
      await db().execute(sql`
        insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
        values (${storeId}::uuid, ${cartId}::uuid, ${line.variantId}::uuid, ${line.quantity})
      `);
    }
    const placed = await placeOrder({ storeId, market: shopMarket }, cartId, {}, { customerId: String(list.customer_id) });
    // Nobody pays this cart at a checkout: it is done with.
    await db().execute(sql`update commerce.carts set status = 'converted', updated_at = now() where store_id = ${storeId}::uuid and id = ${cartId}::uuid`);
    if (!placed.ok) {
      if (placed.problem === "stock" && attempt === 0) continue;
      const all = lines.map((l) => ({ title: String(l.title), wanted: Number(l.quantity), got: 0 }));
      if (!(await record("unavailable", null, all))) return null;
      await sendDeliveryPrepared(storeId, listId, round.date);
      return "unavailable";
    }
    const orderId = placed.order.orderId;
    if (!(await record("ordered", orderId, leftOut))) {
      // Another run made this delivery meanwhile.
      await cancelUnpaidOrder(orderId, "delivery already prepared");
      return null;
    }
    const address = (list.shipping_address ?? {}) as Address;
    // Held until the end of the day after the delivery, in the store's time zone.
    const holdUntil = new Date(zonedTime(addDays(round.date, 2), "00:00", String(list.time_zone))).toISOString();
    await db().execute(sql`
      update commerce.orders set email = ${String(list.email)},
        shipping_address = ${JSON.stringify(address)}::jsonb,
        billing_address = ${JSON.stringify({ name: address.name ?? list.name ?? null, phone: address.phone ?? null })}::jsonb
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid
    `);
    await db().execute(sql`
      update commerce.inventory_reservations set expires_at = ${holdUntil}::timestamptz
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and released_at is null
    `);
    await db().execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'delivery.prepared',
        ${JSON.stringify({ date: round.date, list: listId, leftOut })}::jsonb, 'system')
    `);
    await sendDeliveryPrepared(storeId, listId, round.date);
    return "ordered";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sending: the card is charged
// ---------------------------------------------------------------------------

export type DeliveryOfOrder = {
  listId: string;
  date: string;
  cardLabel: string;
  /** Tried and not taken: the last reason, for staff. */
  lastFailure: string | null;
};

/** The weekly delivery an order is for (D102), or null for any other order. */
export async function deliveryOfOrder(storeId: string, orderId: string): Promise<DeliveryOfOrder | null> {
  const [row] = await db().execute<Row>(sql`
    select sd.standing_order_id, sd.delivery_date::text as date, o.card_label,
      (select e.data ->> 'reason' from commerce.order_events e
        where e.store_id = sd.store_id and e.order_id = sd.order_id and e.type = 'delivery.charge_failed'
        order by e.id desc limit 1) as last_failure
    from commerce.standing_deliveries sd
    join commerce.standing_orders o on o.store_id = sd.store_id and o.id = sd.standing_order_id
    where sd.store_id = ${storeId}::uuid and sd.order_id = ${orderId}::uuid
  `);
  return row
    ? { listId: String(row.standing_order_id), date: String(row.date), cardLabel: String(row.card_label ?? ""), lastFailure: row.last_failure ? String(row.last_failure) : null }
    : null;
}

export type ChargeResult = { ok: true; paymentId: string } | { ok: false; problem: string };

/**
 * Charges a delivery's order to the list's card, off session, on the
 * store's account with Kaizen's fee, as it is sent (D102). Paid, its stock
 * is drawn as for any order. Refused, the shopper is emailed a link to pay
 * and choose another card, and the order waits.
 */
export async function chargeDelivery(storeId: string, orderId: string): Promise<ChargeResult> {
  const [row] = await db().execute<Row>(sql`
    select o.status, o.total_minor, o.currency, o.number, l.stripe_account, l.mode, l.stripe_customer, l.payment_method,
      (select count(*)::int from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'failed') as failures
    from commerce.orders o
    join commerce.standing_deliveries sd on sd.store_id = o.store_id and sd.order_id = o.id
    join commerce.standing_orders l on l.store_id = sd.store_id and l.id = sd.standing_order_id
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
  `);
  if (!row) return { ok: false, problem: "This is not a subscription box delivery." };
  if (row.status !== "pending_payment") return { ok: false, problem: "This delivery is already paid or cancelled." };
  const stripe = row.mode ? platformStripe(row.mode as PaymentModeName) : null;
  if (!stripe || !row.stripe_account || !row.stripe_customer || !row.payment_method) {
    return { ok: false, problem: "No card is saved for this delivery, or Stripe cannot be reached." };
  }
  const amount = Number(row.total_minor);
  const currency = String(row.currency);
  const stripeAccount = String(row.stripe_account);
  // A pay link the shopper opened (after a refusal) is closed first, so the delivery is never paid twice;
  // one they finished meanwhile pays it.
  const links = await db().execute<Row>(sql`
    select provider_reference from commerce.payments
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'stripe' and status = 'pending'
      and left(provider_reference, 3) = 'cs_'
  `);
  for (const link of links) {
    const reference = String(link.provider_reference);
    try {
      const session = await stripe.checkout.sessions.retrieve(reference, {}, { stripeAccount });
      if (session.status === "complete" && session.payment_status !== "unpaid") {
        await db().execute(sql`
          update commerce.payments set status = 'captured', updated_at = now()
          where store_id = ${storeId}::uuid and provider_reference = ${reference}
        `);
        await completeOrderPayment(orderId, reference);
        return { ok: true, paymentId: reference };
      }
      if (session.status === "open") await stripe.checkout.sessions.expire(reference, {}, { stripeAccount });
    } catch {
      return { ok: false, problem: "Stripe could not be asked about the customer's payment link. Try again in a moment." };
    }
    await db().execute(sql`
      update commerce.payments set status = 'cancelled', updated_at = now()
      where store_id = ${storeId}::uuid and provider_reference = ${reference}
    `);
  }
  const fee = saleFee(amount, await storeFeeBps(storeId));
  const failed = async (reason: string, reference: string | null) => {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${reference ?? `declined-${orderId}-${Number(row.failures) + 1}`},
        ${stripeAccount}, ${amount}, ${currency}, 'failed')
      on conflict do nothing
    `);
    await db().execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'delivery.charge_failed', ${JSON.stringify({ reason })}::jsonb, 'system')
    `);
    await sendDeliveryCard(storeId, orderId);
    return { ok: false as const, problem: reason };
  };
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        customer: String(row.stripe_customer),
        payment_method: String(row.payment_method),
        off_session: true,
        confirm: true,
        description: `Order ${String(row.number)}`,
        metadata: { order_id: orderId, order_number: String(row.number), store_id: storeId, kind: "delivery" },
        ...(fee !== null && { application_fee_amount: fee }),
      },
      // A new try after a refusal is a new payment.
      { stripeAccount, idempotencyKey: `delivery-${orderId}-${Number(row.failures)}` },
    );
  } catch (error) {
    const err = error as { code?: string; message?: string; payment_intent?: { id?: string } };
    const reason =
      err.code === "authentication_required"
        ? "The customer's bank wants them to confirm this payment. They have been emailed a link to pay."
        : `The card was not charged${err.message ? `: ${err.message}` : "."} The customer has been emailed a link to pay.`;
    return failed(reason, err.payment_intent?.id ?? null);
  }
  if (intent.status !== "succeeded") return failed(`Stripe did not take the payment (${intent.status}). The customer has been emailed a link to pay.`, intent.id);
  const [payment] = await db().execute<Row>(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status, kaizen_fee_minor)
    values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${intent.id}, ${stripeAccount}, ${amount}, ${currency}, 'captured', ${fee ?? 0})
    returning id
  `);
  await completeOrderPayment(orderId, intent.id);
  return { ok: true, paymentId: String(payment.id) };
}

/**
 * The shopper pays a delivery their card did not (D102): Stripe Checkout
 * on the store's account for the order, saving the card they pay with for
 * the next deliveries. The page it returns to completes the order.
 */
export async function startDeliveryPayment(
  shop: { storeId: string; storeSlug: string; market: Market },
  customerId: string,
  orderId: string,
  origin: string,
): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select o.total_minor, o.currency, o.number, l.stripe_account, l.mode, l.stripe_customer
    from commerce.orders o
    join commerce.standing_deliveries sd on sd.store_id = o.store_id and sd.order_id = o.id
    join commerce.standing_orders l on l.store_id = sd.store_id and l.id = sd.standing_order_id
    where o.store_id = ${shop.storeId}::uuid and o.id = ${orderId}::uuid and o.status = 'pending_payment'
      and l.customer_id = ${customerId}::uuid
  `);
  const stripe = row?.mode ? platformStripe(row.mode as PaymentModeName) : null;
  if (!row || !stripe || !row.stripe_account || !row.stripe_customer) return null;
  const amount = Number(row.total_minor);
  const fee = saleFee(amount, await storeFeeBps(shop.storeId));
  const base = `${storeOrigin(shop.storeSlug) ?? origin}${marketPath(shop.storeSlug, shop.market.slug)}`;
  const metadata = { order_id: orderId, order_number: String(row.number), store_id: shop.storeId, kind: "delivery" };
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer: String(row.stripe_customer),
        client_reference_id: orderId,
        metadata,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: String(row.currency).toLowerCase(),
              unit_amount: amount,
              product_data: { name: `${t(shop.market.lang).deliveries.title}: ${String(row.number)}` },
            },
          },
        ],
        payment_intent_data: {
          metadata,
          description: `Order ${String(row.number)}`,
          setup_future_usage: "off_session",
          ...(fee !== null && { application_fee_amount: fee }),
        },
        locale: stripeLocale(shop.market.lang) as Stripe.Checkout.SessionCreateParams.Locale,
        success_url: `${base}/deliveries?paid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/deliveries`,
      },
      { stripeAccount: String(row.stripe_account) },
    );
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status, kaizen_fee_minor)
      values (${shop.storeId}::uuid, ${orderId}::uuid, 'stripe', ${session.id}, ${String(row.stripe_account)}, ${amount},
        ${String(row.currency)}, 'pending', ${fee ?? 0})
    `);
    return session.url;
  } catch {
    return null;
  }
}

/** Whether an order is a weekly delivery's (its Checkout sessions neither cancel it nor change its address). */
export async function isDeliveryOrder(storeId: string, orderId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.standing_deliveries where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid
  `);
  return Boolean(row);
}

/** A delivery paid by link: the card paid with becomes the list's, for the next deliveries. */
export async function adoptDeliveryCard(storeId: string, orderId: string, session: Stripe.Checkout.Session): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    select l.id, l.mode, l.stripe_account, l.payment_method from commerce.standing_deliveries sd
    join commerce.standing_orders l on l.store_id = sd.store_id and l.id = sd.standing_order_id
    where sd.store_id = ${storeId}::uuid and sd.order_id = ${orderId}::uuid and l.status <> 'cancelled'
  `);
  const stripe = row?.mode ? platformStripe(row.mode as PaymentModeName) : null;
  if (!row || !stripe || !session.payment_intent) return;
  try {
    const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
    const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["payment_method"] }, { stripeAccount: String(row.stripe_account) });
    const method = intent.payment_method as Stripe.PaymentMethod | string | null;
    const methodId = typeof method === "string" ? method : method?.id;
    if (!methodId || methodId === row.payment_method) return;
    await db().execute(sql`
      update commerce.standing_orders set payment_method = ${methodId},
        card_label = ${typeof method === "object" ? cardLabel(method) : ""}, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${String(row.id)}::uuid
    `);
  } catch {
    // The old card stays; the shopper can change it on their page.
  }
}

// ---------------------------------------------------------------------------
// The store's view
// ---------------------------------------------------------------------------

export type RoundView = {
  schedule: ScheduleView;
  /** Being packed now: its orders. */
  current: (DeliveryRound & { orders: { orderId: string; number: string; name: string; status: string; totalMinor: number; items: number }[]; skipped: number }) | null;
  next: DeliveryRound;
};

/** Each delivery day: the round being packed (its orders), and the next cutoff. */
export async function deliveryRounds(storeId: string): Promise<RoundView[]> {
  const { timeZone } = await storeClock(storeId);
  const now = Date.now();
  const schedules = await listSchedules(storeId);
  return Promise.all(
    schedules.map(async (schedule) => {
      const round = currentRound(schedule, now, timeZone);
      if (!round) return { schedule, current: null, next: nextRound(schedule, now, timeZone) };
      const rows = await db().execute<Row>(sql`
        select sd.outcome, o.id, o.number, o.status, o.total_minor, o.shipping_address ->> 'name' as name,
          (select coalesce(sum(quantity), 0)::int from commerce.order_lines ol where ol.order_id = o.id and ol.variant_id is not null) as items
        from commerce.standing_deliveries sd
        join commerce.standing_orders l on l.store_id = sd.store_id and l.id = sd.standing_order_id and l.schedule_id = ${schedule.id}::uuid
        left join commerce.orders o on o.store_id = sd.store_id and o.id = sd.order_id
        where sd.store_id = ${storeId}::uuid and sd.delivery_date = ${round.date}::date
        order by o.number
      `);
      return {
        schedule,
        next: nextRound(schedule, now, timeZone),
        current: {
          ...round,
          skipped: rows.filter((r) => !r.id).length,
          orders: rows
            .filter((r) => r.id)
            .map((r) => ({
              orderId: String(r.id),
              number: String(r.number),
              name: String(r.name ?? ""),
              status: String(r.status),
              totalMinor: Number(r.total_minor),
              items: Number(r.items),
            })),
        },
      };
    }),
  );
}

export type ListAdminRow = {
  id: string;
  customerId: string;
  name: string;
  email: string;
  status: StandingStatus;
  schedule: string;
  lines: number;
  items: number;
  cardLabel: string;
  updatedAt: string;
};

/** The store's lists, for staff. */
export async function listStandingOrders(storeId: string): Promise<ListAdminRow[]> {
  const rows = await db().execute<Row>(sql`
    select o.id, o.customer_id, c.name, c.email, o.status, d.name as schedule, o.card_label, o.updated_at,
      (select count(*)::int from commerce.standing_order_lines l where l.standing_order_id = o.id) as lines,
      (select coalesce(sum(quantity), 0)::int from commerce.standing_order_lines l where l.standing_order_id = o.id) as items
    from commerce.standing_orders o
    join commerce.customers c on c.store_id = o.store_id and c.id = o.customer_id
    join commerce.delivery_schedules d on d.store_id = o.store_id and d.id = o.schedule_id
    where o.store_id = ${storeId}::uuid and o.status <> 'setup'
    order by (o.status = 'cancelled'), c.name, c.email
    limit 500
  `);
  return rows.map((row) => ({
    id: String(row.id),
    customerId: String(row.customer_id),
    name: String(row.name ?? ""),
    email: String(row.email),
    status: row.status as StandingStatus,
    schedule: String(row.schedule),
    lines: Number(row.lines),
    items: Number(row.items),
    cardLabel: String(row.card_label ?? ""),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }));
}

/** A customer's lists are forgotten with their account; deliveries' orders stay, as any order. */
export async function forgetStandingOrders(storeId: string, customerId: string): Promise<void> {
  const lists = await db().execute<Row>(sql`
    select id, stripe_account, mode, payment_method from commerce.standing_orders
    where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid
  `);
  for (const list of lists) {
    const stripe = list.mode ? platformStripe(list.mode as PaymentModeName) : null;
    if (stripe && list.payment_method && list.stripe_account) {
      try {
        await stripe.paymentMethods.detach(String(list.payment_method), {}, { stripeAccount: String(list.stripe_account) });
      } catch {
        // Gone already.
      }
    }
    await db().execute(sql`delete from commerce.standing_deliveries where store_id = ${storeId}::uuid and standing_order_id = ${String(list.id)}::uuid`);
    await db().execute(sql`delete from commerce.standing_orders where store_id = ${storeId}::uuid and id = ${String(list.id)}::uuid`);
  }
}

/** The delivery order a pay-link session was for, if it is this customer's (D102). */
export async function deliveryOrderForSession(storeId: string, customerId: string, sessionId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select p.order_id from commerce.payments p
    join commerce.standing_deliveries sd on sd.store_id = p.store_id and sd.order_id = p.order_id
    join commerce.standing_orders l on l.store_id = sd.store_id and l.id = sd.standing_order_id
    where p.store_id = ${storeId}::uuid and p.provider = 'stripe' and p.provider_reference = ${sessionId}
      and l.customer_id = ${customerId}::uuid
  `);
  return row ? String(row.order_id) : null;
}
