import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  freeUnits,
  halfDays,
  hourStarts,
  openDates,
  periodProblem,
  periodSpan,
  type RangeKind,
  type RangeProblem,
  type RangeRules,
  type RangeUnit,
  type RentalPeriod,
} from "@/lib/booking-ranges";
import { bookingPrice, feeFor, parseSeason, type BookingPrice, type Season } from "@/lib/booking-prices";
import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { minorUnitDigits } from "@/lib/money";
import { parsePaymentMode, type AppointmentPayment } from "@/lib/pay-later";

import { busyOn, type Queryable, type Tx } from "./appointments";

/**
 * Stays and rentals for shoppers (D67): which nights or days a stay or a
 * rental is free, and holding one at checkout. Dates are worked out by
 * `src/lib/booking-ranges.ts`; the hold is `commerce.hold_booking`, as for
 * appointments, over the whole span.
 */

type Row = Record<string, unknown>;

/** What a shopper sees of a stay or a rental before choosing dates. */
export type RangeOffer = {
  productId: string;
  kind: RangeKind;
  timeZone: string;
  rules: RangeRules;
  /** The rooms or items it offers, in the store's order. */
  units: { id: string; name: string }[];
  place: { name: string; address: string } | null;
  payment: AppointmentPayment;
  cancelHours: number;
};

type LoadedRange = RangeOffer & { capacities: Map<string, number> };

async function loadRange(q: Queryable, storeId: string, productId: string): Promise<LoadedRange | null> {
  const [row] = await q.execute<Row>(sql`
    select p.kind, a.check_in_time, a.check_out_time, a.min_nights, a.max_nights, a.min_notice_minutes, a.max_days_ahead,
      s.time_zone, a.payment, a.deposit_percent, a.cancel_hours, l.name as place_name, l.street, l.postal_code, l.city
    from commerce.appointment_settings a
    join commerce.products p on p.store_id = a.store_id and p.id = a.product_id
      and p.kind in ('stay', 'rental') and p.status = 'active'
    join commerce.stores s on s.id = a.store_id and 'bookings' = any(s.modules)
    left join commerce.store_locations l on l.store_id = a.store_id and l.id = a.location_id
    where a.store_id = ${storeId}::uuid and a.product_id = ${productId}::uuid
  `);
  if (!row) return null;
  const kind: RangeKind = row.kind === "rental" ? "rental" : "stay";
  const units = await q.execute<Row>(sql`
    select r.id, r.name, r.capacity
    from commerce.product_resources pr
    join commerce.booking_resources r on r.store_id = pr.store_id and r.id = pr.resource_id and r.active
      and r.kind = ${kind === "stay" ? "unit" : "item"}
    where pr.store_id = ${storeId}::uuid and pr.product_id = ${productId}::uuid
    order by r.position, r.name
  `);
  return {
    productId,
    kind,
    timeZone: String(row.time_zone),
    rules: {
      kind,
      checkInTime: String(row.check_in_time),
      checkOutTime: String(row.check_out_time),
      minNights: Number(row.min_nights),
      maxNights: Number(row.max_nights),
      minNoticeMinutes: Number(row.min_notice_minutes),
      maxDaysAhead: Number(row.max_days_ahead),
    },
    units: units.map((u) => ({ id: String(u.id), name: String(u.name) })),
    capacities: new Map(units.map((u) => [String(u.id), Number(u.capacity)])),
    payment: { mode: parsePaymentMode(row.payment), depositPercent: Number(row.deposit_percent) },
    cancelHours: Number(row.cancel_hours),
    place: row.street
      ? {
          name: String(row.place_name ?? ""),
          address: [row.street, `${row.postal_code ?? ""} ${row.city ?? ""}`.trim()].filter(Boolean).join(", "),
        }
      : null,
  };
}

/** A stay or a rental as the product page offers it, or null when it cannot be booked. */
export async function getRangeOffer(storeId: string, productId: string): Promise<RangeOffer | null> {
  const offer = await loadRange(db(), storeId, productId);
  if (!offer || offer.units.length === 0) return null;
  const { capacities: _capacities, ...shown } = offer;
  void _capacities;
  return shown;
}

/** The offer's units with what is taken on them between two instants. */
async function unitsWithBusy(
  q: Queryable,
  storeId: string,
  offer: LoadedRange,
  from: number,
  to: number,
  exceptBookingId: string | null = null,
): Promise<RangeUnit[]> {
  const ids = offer.units.map((u) => u.id);
  const busy = await busyOn(q, storeId, ids, from, to, exceptBookingId);
  return ids.map((id) => ({ id, capacity: offer.capacities.get(id) ?? 1, busy: busy.get(id) ?? [] }));
}

/** How many dates the calendar shows at a time: four weeks from a Monday. */
export const RANGE_DAYS = 28;

export type RangeMonth = { from: string; today: string; last: string; dates: { date: string; open: boolean }[] };

/**
 * Which nights (or days) from `from` some room (or item) is free, four
 * weeks at a time; without a date, from the Monday of this week.
 */
export async function rangeDates(
  storeId: string,
  productId: string,
  from: string | null = null,
  now = Date.now(),
  /** A rental's variant by the half day or hour opens a date with any free half or hour (D69). */
  period: RentalPeriod = "day",
): Promise<RangeMonth | null> {
  const offer = await loadRange(db(), storeId, productId);
  if (!offer) return null;
  const tz = offer.timeZone;
  const today = zonedDate(now, tz);
  const last = addDays(today, offer.rules.maxDaysAhead);
  const monday = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
  const start = monday(from && from > today ? (from > last ? last : from) : today);
  const units = await unitsWithBusy(
    db(),
    storeId,
    offer,
    zonedTime(start, "00:00", tz),
    zonedTime(addDays(start, RANGE_DAYS + 1), "23:59", tz),
  );
  return { from: start, today, last, dates: openDates(start, RANGE_DAYS, units, offer.rules, tz, now, period) };
}

export type RangeCheck =
  | { ok: true; offer: LoadedRange; unitIds: string[]; startsAt: number; endsAt: number }
  | { ok: false; problem: RangeProblem | "taken" | "unknown" };

/**
 * Whether `count` nights, days, half days or hours (D67, D69) from
 * `startsAt` can be booked now, and in which rooms or items: only `unitId`
 * when given.
 */
export async function checkRange(
  q: Queryable,
  storeId: string,
  productId: string,
  { startsAt, count, unitId = null, period = "day" }: { startsAt: string; count: number; unitId?: string | null; period?: RentalPeriod },
  now = Date.now(),
  exceptBookingId: string | null = null,
): Promise<RangeCheck> {
  const offer = await loadRange(q, storeId, productId);
  const start = Date.parse(startsAt);
  if (!offer || offer.units.length === 0 || Number.isNaN(start)) return { ok: false, problem: "unknown" };
  const problem = periodProblem(period, start, count, offer.rules, offer.timeZone, now);
  if (problem) return { ok: false, problem };
  const span = periodSpan(period, offer.kind, start, count, offer.rules, offer.timeZone)!;
  const units = (await unitsWithBusy(q, storeId, offer, span.startsAt, span.endsAt, exceptBookingId)).filter(
    (u) => !unitId || u.id === unitId,
  );
  const unitIds = freeUnits(units, span);
  if (unitIds.length === 0) return { ok: false, problem: "taken" };
  return { ok: true, offer, unitIds, startsAt: span.startsAt, endsAt: span.endsAt };
}

/** A time on a date a rental by the half day or hour (D69) can start, and for how many periods it is free from then. */
export type RentalTime = { startsAt: string; endsAt: string; free: number };

/**
 * The times a rental's variant by the half day or hour can start on a date:
 * the two halves, or each whole hour from pick-up, with how many hours in a
 * row are free from each (0 when taken, too soon or too far ahead).
 */
export async function rentalTimes(
  storeId: string,
  productId: string,
  date: string,
  period: Exclude<RentalPeriod, "day">,
  now = Date.now(),
): Promise<RentalTime[] | null> {
  const offer = await loadRange(db(), storeId, productId);
  if (!offer || offer.kind !== "rental") return null;
  const tz = offer.timeZone;
  const dayStart = zonedTime(date, "00:00", tz);
  const units = await unitsWithBusy(db(), storeId, offer, dayStart, zonedTime(addDays(date, 1), "00:00", tz));
  const allowed = (startsAt: number, count: number) =>
    periodProblem(period, startsAt, count, offer.rules, tz, now) === null &&
    freeUnits(units, periodSpan(period, "rental", startsAt, count, offer.rules, tz)!).length > 0;
  if (period === "half_day") {
    return halfDays(date, offer.rules, tz).map((half) => ({
      startsAt: new Date(half.startsAt).toISOString(),
      endsAt: new Date(half.endsAt).toISOString(),
      free: allowed(half.startsAt, 1) ? 1 : 0,
    }));
  }
  const starts = hourStarts(date, offer.rules, tz);
  return starts.map((startsAt, i) => {
    let free = 0;
    // The same unit must be free for every hour, so each length is checked whole.
    while (i + free < starts.length && allowed(startsAt, free + 1)) free += 1;
    return { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(startsAt + 3_600_000).toISOString(), free };
  });
}

/**
 * Holds an order line's stay or rental for the length of payment: in the
 * chosen room (or item), or the first free one. Null when it is no longer
 * free; the caller then gives up the whole order.
 */
export async function holdRange(
  tx: Tx,
  storeId: string,
  line: {
    productId: string;
    variantId: string;
    startsAt: string;
    count: number;
    period: RentalPeriod;
    resourceId: string | null;
    orderId: string;
    orderLineId: string;
    holdMinutes: number;
  },
): Promise<string | null> {
  const free = await checkRange(tx, storeId, line.productId, {
    startsAt: line.startsAt,
    count: line.count,
    unitId: line.resourceId,
    period: line.period,
  });
  if (!free.ok) return null;
  const from = new Date(free.startsAt).toISOString();
  const to = new Date(free.endsAt).toISOString();
  for (const resourceId of free.unitIds) {
    const [row] = await tx.execute<Row>(sql`
      select commerce.hold_booking(
        ${storeId}::uuid, ${line.productId}::uuid, ${line.variantId}::uuid, ${resourceId}::uuid,
        ${from}::timestamptz, ${to}::timestamptz, ${from}::timestamptz, ${to}::timestamptz,
        now() + make_interval(mins => ${line.holdMinutes}), ${line.orderId}::uuid
      ) as id
    `);
    if (row?.id) {
      await tx.execute(sql`
        update commerce.bookings set order_line_id = ${line.orderLineId}::uuid
        where store_id = ${storeId}::uuid and id = ${String(row.id)}::uuid
      `);
      return String(row.id);
    }
  }
  return null;
}

export type RangePricing = { seasons: Season[]; feeMinor: number };

/** The seasons and the market's fee (D70) of these stays and rentals, by product. */
export async function rangePricing(
  q: Queryable,
  storeId: string,
  productIds: string[],
  marketCode: string,
): Promise<Map<string, RangePricing>> {
  const pricing = new Map<string, RangePricing>();
  if (productIds.length === 0) return pricing;
  const ids = sql.join([...new Set(productIds)].map((id) => sql`${id}::uuid`), sql`, `);
  const [fees, seasons] = await Promise.all([
    q.execute<Row>(sql`
      select product_id, booking_fee from commerce.appointment_settings
      where store_id = ${storeId}::uuid and product_id in (${ids})
    `),
    q.execute<Row>(sql`
      select product_id, name, names, from_day, to_day, weekdays, percent from commerce.booking_seasons
      where store_id = ${storeId}::uuid and product_id in (${ids})
      order by position, created_at
    `),
  ]);
  for (const row of fees) pricing.set(String(row.product_id), { seasons: [], feeMinor: feeFor(row.booking_fee, marketCode) });
  for (const row of seasons) pricing.get(String(row.product_id))?.seasons.push(parseSeason(row));
  return pricing;
}

/**
 * What a cart or order line of a stay or rental costs: its nights, days or
 * hours at their seasons' prices, plus the fee (D70).
 */
export function linePrice(
  line: { kind: RangeKind; period: RentalPeriod; startsAt: string; count: number; baseMinor: number; currency: string; timeZone: string },
  pricing: RangePricing | undefined,
): BookingPrice {
  return bookingPrice(
    {
      kind: line.kind,
      period: line.period,
      startDate: zonedDate(Date.parse(line.startsAt), line.timeZone),
      count: line.count,
      baseMinor: line.baseMinor,
      seasons: pricing?.seasons ?? [],
      feeMinor: pricing?.feeMinor ?? 0,
    },
    10 ** minorUnitDigits(line.currency),
  );
}


/** A stay's or rental's seasons and fee in a market (D70), for its page. */
export async function getRangePricing(storeId: string, productId: string, marketCode: string): Promise<RangePricing> {
  return (await rangePricing(db(), storeId, [productId], marketCode)).get(productId) ?? { seasons: [], feeMinor: 0 };
}
