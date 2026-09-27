import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  addDays,
  bookingSpan,
  slotsOn,
  zonedDate,
  zonedTime,
  type AppointmentRules,
  type Busy,
  type Slot,
  type SlotResource,
} from "@/lib/booking-slots";
import { defaultHours, parseOpeningHours } from "@/lib/opening-hours";
import { parsePaymentMode, type AppointmentPayment } from "@/lib/pay-later";

/**
 * Appointments for shoppers (D65): the free times of an appointment, and
 * holding one at checkout. Slots are worked out by `slotsOn()`; the hold
 * itself is `commerce.hold_booking`, which checks again under a lock.
 */

type Row = Record<string, unknown>;
export type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
export type Queryable = ReturnType<typeof db> | Tx;

const DAY = 24 * 60 * 60 * 1000;

/** What a shopper sees of an appointment before choosing a time. */
export type AppointmentOffer = {
  productId: string;
  timeZone: string;
  rules: AppointmentRules;
  /** Who does it, in the store's order; the shopper may choose one. */
  staff: { id: string; name: string }[];
  place: { name: string; address: string } | null;
  /** How it is paid, and until how many hours before shoppers may cancel or move it (D66). */
  payment: AppointmentPayment;
  cancelHours: number;
};

type LoadedOffer = AppointmentOffer & { resources: Omit<SlotResource, "busy">[] };

async function loadOffer(q: Queryable, storeId: string, productId: string): Promise<LoadedOffer | null> {
  const [row] = await q.execute<Row>(sql`
    select a.duration_minutes, a.buffer_before_minutes, a.buffer_after_minutes, a.step_minutes,
      a.min_notice_minutes, a.max_days_ahead, s.time_zone, a.payment, a.deposit_percent, a.cancel_hours,
      l.name as place_name, l.street, l.postal_code, l.city
    from commerce.appointment_settings a
    join commerce.products p on p.store_id = a.store_id and p.id = a.product_id and p.kind = 'appointment' and p.status = 'active'
    join commerce.stores s on s.id = a.store_id and 'bookings' = any(s.modules)
    left join commerce.store_locations l on l.store_id = a.store_id and l.id = a.location_id
    where a.store_id = ${storeId}::uuid and a.product_id = ${productId}::uuid
  `);
  if (!row) return null;
  const resources = await q.execute<Row>(sql`
    select r.id, r.name, r.hours, r.capacity
    from commerce.product_resources pr
    join commerce.booking_resources r on r.store_id = pr.store_id and r.id = pr.resource_id and r.active
    where pr.store_id = ${storeId}::uuid and pr.product_id = ${productId}::uuid
    order by r.position, r.name
  `);
  return {
    productId,
    timeZone: String(row.time_zone),
    rules: {
      durationMinutes: Number(row.duration_minutes),
      bufferBeforeMinutes: Number(row.buffer_before_minutes),
      bufferAfterMinutes: Number(row.buffer_after_minutes),
      stepMinutes: Number(row.step_minutes),
      minNoticeMinutes: Number(row.min_notice_minutes),
      maxDaysAhead: Number(row.max_days_ahead),
    },
    staff: resources.map((r) => ({ id: String(r.id), name: String(r.name) })),
    payment: { mode: parsePaymentMode(row.payment), depositPercent: Number(row.deposit_percent) },
    cancelHours: Number(row.cancel_hours),
    place: row.street
      ? {
          name: String(row.place_name ?? ""),
          address: [row.street, `${row.postal_code ?? ""} ${row.city ?? ""}`.trim()].filter(Boolean).join(", "),
        }
      : null,
    resources: resources.map((r) => ({
      id: String(r.id),
      hours: parseOpeningHours(r.hours) ?? defaultHours(),
      capacity: Number(r.capacity),
    })),
  };
}

/** An appointment as the product page offers it, or null when it cannot be booked. */
export async function getAppointmentOffer(storeId: string, productId: string): Promise<AppointmentOffer | null> {
  const offer = await loadOffer(db(), storeId, productId);
  if (!offer || offer.staff.length === 0) return null;
  const { resources: _resources, ...shown } = offer;
  void _resources;
  return shown;
}

/**
 * Times taken on these resources that overlap the range: bookings confirmed,
 * or held and not expired; and blocks (D67), which close the whole resource,
 * so each counts once for every place it has.
 */
export async function busyOn(
  q: Queryable,
  storeId: string,
  resourceIds: string[],
  from: number,
  to: number,
  exceptBookingId: string | null = null,
) {
  const busy = new Map<string, Busy[]>(resourceIds.map((id) => [id, []]));
  if (resourceIds.length === 0) return busy;
  const rows = await q.execute<Row>(sql`
    select resource_id, blocked_from, blocked_to from commerce.bookings
    where store_id = ${storeId}::uuid
      and resource_id in (${sql.join(resourceIds.map((id) => sql`${id}::uuid`), sql`, `)})
      and (status = 'confirmed' or (status = 'held' and hold_expires_at > now()))
      and id is distinct from ${exceptBookingId}::uuid
      and blocked_from < ${new Date(to).toISOString()}::timestamptz
      and blocked_to > ${new Date(from).toISOString()}::timestamptz
    union all
    select k.resource_id, k.starts_at, k.ends_at
    from commerce.resource_blocks k
    join commerce.booking_resources r on r.store_id = k.store_id and r.id = k.resource_id
    cross join generate_series(1, r.capacity)
    where k.store_id = ${storeId}::uuid
      and k.resource_id in (${sql.join(resourceIds.map((id) => sql`${id}::uuid`), sql`, `)})
      and k.starts_at < ${new Date(to).toISOString()}::timestamptz
      and k.ends_at > ${new Date(from).toISOString()}::timestamptz
  `);
  for (const row of rows) {
    busy.get(String(row.resource_id))?.push({
      from: new Date(String(row.blocked_from)).getTime(),
      to: new Date(String(row.blocked_to)).getTime(),
    });
  }
  return busy;
}

export type SlotDay = { date: string; slots: Slot[] };

/**
 * Free times on `days` dates from `from` (the store's dates), with the
 * resources free for each; only `resourceId` when the shopper chose someone.
 */
async function daysOf(
  q: Queryable,
  storeId: string,
  offer: LoadedOffer,
  from: string,
  days: number,
  resourceId: string | null,
  now: number,
  exceptBookingId: string | null = null,
): Promise<SlotDay[]> {
  const resources = offer.resources.filter((r) => !resourceId || r.id === resourceId);
  const start = zonedTime(from, "00:00", offer.timeZone) - DAY;
  const end = zonedTime(addDays(from, days), "00:00", offer.timeZone) + DAY;
  const busy = await busyOn(q, storeId, resources.map((r) => r.id), start, end, exceptBookingId);
  const withBusy = resources.map((r) => ({ ...r, busy: busy.get(r.id) ?? [] }));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, slots: slotsOn(date, offer.timeZone, offer.rules, withBusy, now) };
  });
}

/** How many dates the product page shows at a time. */
export const SLOT_DAYS = 7;
/** How many weeks the page looks ahead for the first free time. */
const SEARCH_WEEKS = 8;

/**
 * A week of free times from `from`, or, without a date, the first week from
 * today that has any, looking a few weeks ahead.
 */
export async function appointmentSlots(
  storeId: string,
  productId: string,
  { from = null, resourceId = null }: { from?: string | null; resourceId?: string | null } = {},
  now = Date.now(),
): Promise<{ from: string; today: string; last: string; days: SlotDay[] } | null> {
  const offer = await loadOffer(db(), storeId, productId);
  if (!offer) return null;
  const today = zonedDate(now, offer.timeZone);
  const last = addDays(today, offer.rules.maxDaysAhead);
  if (resourceId && !offer.resources.some((r) => r.id === resourceId)) resourceId = null;
  if (from) {
    const start = from < today ? today : from > last ? last : from;
    return { from: start, today, last, days: await daysOf(db(), storeId, offer, start, SLOT_DAYS, resourceId, now) };
  }
  // The first week with a free time, looking a few weeks ahead at most.
  for (let start = today, weeks = 0; start <= last && weeks < SEARCH_WEEKS; start = addDays(start, SLOT_DAYS), weeks++) {
    const days = await daysOf(db(), storeId, offer, start, SLOT_DAYS, resourceId, now);
    if (days.some((d) => d.slots.length > 0)) return { from: start, today, last, days };
  }
  return { from: today, today, last, days: await daysOf(db(), storeId, offer, today, SLOT_DAYS, resourceId, now) };
}

/**
 * The resources that could take an appointment starting then, in the
 * store's order: a time the page would offer (working hours, notice, how
 * far ahead, free now), with `resourceId` alone when the shopper chose.
 */
export async function freeResourcesAt(
  q: Queryable,
  storeId: string,
  productId: string,
  startsAt: string,
  resourceId: string | null,
  now = Date.now(),
  /** A booking being moved: its own time does not count against it (D66). */
  exceptBookingId: string | null = null,
): Promise<{ offer: LoadedOffer; resourceIds: string[] } | null> {
  const offer = await loadOffer(q, storeId, productId);
  const start = Date.parse(startsAt);
  if (!offer || Number.isNaN(start)) return null;
  const date = zonedDate(start, offer.timeZone);
  const [day] = await daysOf(q, storeId, offer, date, 1, resourceId, now, exceptBookingId);
  const slot = day.slots.find((s) => Date.parse(s.startsAt) === start);
  return { offer, resourceIds: slot?.resourceIds ?? [] };
}

/**
 * Holds an order line's appointment for the length of payment: with the
 * chosen resource, or the first free one. Null when the time is no longer
 * free; the caller then gives up the whole order.
 */
export async function holdAppointment(
  tx: Tx,
  storeId: string,
  line: {
    productId: string;
    variantId: string;
    startsAt: string;
    resourceId: string | null;
    orderId: string;
    orderLineId: string;
    holdMinutes: number;
  },
): Promise<string | null> {
  const free = await freeResourcesAt(tx, storeId, line.productId, line.startsAt, line.resourceId);
  if (!free) return null;
  const span = bookingSpan(Date.parse(line.startsAt), free.offer.rules);
  const iso = (ms: number) => new Date(ms).toISOString();
  for (const resourceId of free.resourceIds) {
    const [row] = await tx.execute<Row>(sql`
      select commerce.hold_booking(
        ${storeId}::uuid, ${line.productId}::uuid, ${line.variantId}::uuid, ${resourceId}::uuid,
        ${iso(span.startsAt)}::timestamptz, ${iso(span.endsAt)}::timestamptz,
        ${iso(span.blockedFrom)}::timestamptz, ${iso(span.blockedTo)}::timestamptz,
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
