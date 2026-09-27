import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { defaultHours, openingHoursInput, parseOpeningHours, type OpeningHours } from "@/lib/opening-hours";

import { audit, type Membership } from "./auth";
import { noShowFeeFor } from "./no-show";

type Row = Record<string, unknown>;

/**
 * Bookings (D65): the module a store switches on, and what it books. This
 * file holds the store's side (the switch, staff and their hours); slots
 * and holds for shoppers are in `appointments.ts`.
 */

/** Time zones a store can be in: Europe's, as the browser and Postgres name them. */
export function storeTimeZones(): string[] {
  return Intl.supportedValuesOf("timeZone").filter((zone) => zone.startsWith("Europe/") || zone === "Atlantic/Reykjavik");
}

export const bookingsModuleInput = z.object({
  enabled: z.boolean(),
  timeZone: z.string().refine((zone) => storeTimeZones().includes(zone), "Choose a time zone."),
  reminderHours: z.coerce.number().int().min(0, "Choose when reminders go.").max(168, "Reminders go at most a week before."),
});

/** When the reminder before an appointment can go, in hours (0: none). */
export const REMINDER_HOURS = [0, 2, 12, 24, 48, 72] as const;

/** Switches appointments on or off, and says where the store's times are. Owners only. */
export async function setBookingsModule(
  { account, store }: Membership,
  input: z.infer<typeof bookingsModuleInput>,
): Promise<void> {
  await db().execute(sql`
    update commerce.stores set
      modules = case when ${input.enabled}
        then (select array_agg(distinct m) from unnest(modules || array['bookings']) m)
        else array_remove(modules, 'bookings') end,
      time_zone = ${input.timeZone},
      booking_reminder_hours = ${input.reminderHours}
    where id = ${store.id}::uuid
  `);
  await audit(account.id, store.id, input.enabled ? "bookings.enabled" : "bookings.disabled", {
    timeZone: input.timeZone,
    reminderHours: input.reminderHours,
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

/** Who or what is booked (D65, D67): staff for appointments, units (rooms, homes) for stays, items for rentals. */
export const RESOURCE_KINDS = ["staff", "unit", "item"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export type BookingResource = {
  id: string;
  kind: ResourceKind;
  name: string;
  email: string;
  hours: OpeningHours;
  capacity: number;
  active: boolean;
  /** Appointments they do. */
  services: number;
  /** Confirmed bookings still to come. */
  upcoming: number;
  /** The secret in its calendar's address for other sites (D67), once made. */
  calendarToken: string | null;
  /** The host whose room or item it is (D71); null for the store's own. */
  hostId: string | null;
};

const toResource = (row: Row): BookingResource => ({
  id: String(row.id),
  kind: RESOURCE_KINDS.find((k) => k === row.kind) ?? "staff",
  name: String(row.name),
  email: String(row.email ?? ""),
  hours: parseOpeningHours(row.hours) ?? defaultHours(),
  capacity: Number(row.capacity),
  active: Boolean(row.active),
  services: Number(row.services ?? 0),
  upcoming: Number(row.upcoming ?? 0),
  calendarToken: row.calendar_token ? String(row.calendar_token) : null,
  hostId: row.host_id ? String(row.host_id) : null,
});

const resourceColumns = sql`
  r.id, r.kind, r.name, r.email, r.hours, r.capacity, r.active, r.calendar_token, r.host_id,
  (select count(*)::int from commerce.product_resources pr where pr.store_id = r.store_id and pr.resource_id = r.id) as services,
  (select count(*)::int from commerce.bookings b
    where b.store_id = r.store_id and b.resource_id = r.id and b.status = 'confirmed' and b.starts_at > now()) as upcoming
`;

/** The store's staff who take appointments (or its units or items), in their order; those switched off last. */
export async function listResources(storeId: string, kinds: readonly ResourceKind[] = ["staff"]): Promise<BookingResource[]> {
  const rows = await db().execute<Row>(sql`
    select ${resourceColumns} from commerce.booking_resources r
    where r.store_id = ${storeId}::uuid and r.kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
    order by r.active desc, r.position, r.name
  `);
  return rows.map(toResource);
}

export async function getResource(storeId: string, id: string): Promise<BookingResource | null> {
  const [row] = await db().execute<Row>(sql`
    select ${resourceColumns} from commerce.booking_resources r
    where r.store_id = ${storeId}::uuid and r.id = ${id}::uuid
  `);
  return row ? toResource(row) : null;
}

export const resourceInput = z.object({
  name: z.string().trim().min(1, "Give them a name.").max(120),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Write an email address, or leave it empty."),
  capacity: z.coerce.number().int().min(1, "Take at least one booking at a time.").max(500),
  active: z.boolean(),
  /** JSON from the hours editor. */
  hours: z.string().transform((text, ctx) => {
    try {
      const parsed = openingHoursInput.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data as OpeningHours;
    } catch {}
    ctx.addIssue({ code: "custom", message: "The working hours could not be read. Try again." });
    return z.NEVER;
  }),
});

export type SaveResourceResult = { ok: true; id: string } | { ok: false; problems: string[] };

/** A unit or an item (D67) has no hours: it is booked by the day. It may be a host's (D71). */
const unitInput = resourceInput.omit({ hours: true }).extend({ hostId: z.uuid().nullable().default(null) });

/** Adds a member of staff (or a unit or an item), or changes one of the store's of that kind. */
export async function saveResource(
  { account, store }: Membership,
  id: string | null,
  values: Record<string, unknown>,
  kind: ResourceKind = "staff",
): Promise<SaveResourceResult> {
  const parsed = kind === "staff" ? resourceInput.safeParse(values) : unitInput.safeParse(values);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const r = parsed.data;
  const hours = JSON.stringify("hours" in r ? r.hours : defaultHours());
  // Only the store's own hosts; staff are never a host's.
  const host =
    "hostId" in r && r.hostId
      ? sql`(select id from commerce.hosts where store_id = ${store.id}::uuid and id = ${r.hostId}::uuid)`
      : sql`null::uuid`;
  const [row] = id
    ? await db().execute<Row>(sql`
        update commerce.booking_resources set
          name = ${r.name}, email = ${r.email}, capacity = ${r.capacity}, active = ${r.active},
          hours = ${kind === "staff" ? sql`${hours}::jsonb` : sql`hours`}, host_id = ${host}, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${id}::uuid and kind = ${kind}
        returning id
      `)
    : await db().execute<Row>(sql`
        insert into commerce.booking_resources (store_id, kind, name, email, capacity, active, hours, host_id, position)
        values (
          ${store.id}::uuid, ${kind}, ${r.name}, ${r.email}, ${r.capacity}, ${r.active}, ${hours}::jsonb, ${host},
          (select coalesce(max(position), -1) + 1 from commerce.booking_resources where store_id = ${store.id}::uuid)
        )
        returning id
      `);
  if (!row) return { ok: false, problems: ["They are no longer in the store."] };
  await audit(account.id, store.id, id ? "booking_resource.updated" : "booking_resource.created", { id: String(row.id) });
  return { ok: true, id: String(row.id) };
}

/**
 * Removes a member of staff: deleted when they were never booked, else
 * switched off, so their bookings keep who they were with.
 */
export async function removeResource({ account, store }: Membership, id: string): Promise<boolean> {
  const [booked] = await db().execute<Row>(sql`
    select 1 from commerce.bookings where store_id = ${store.id}::uuid and resource_id = ${id}::uuid limit 1
  `);
  const rows = booked
    ? await db().execute<Row>(sql`
        update commerce.booking_resources set active = false, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${id}::uuid returning id
      `)
    : await db().execute<Row>(sql`
        delete from commerce.booking_resources where store_id = ${store.id}::uuid and id = ${id}::uuid returning id
      `);
  if (rows.length === 0) return false;
  await audit(account.id, store.id, booked ? "booking_resource.deactivated" : "booking_resource.deleted", { id });
  return true;
}

// ---------------------------------------------------------------------------
// The store's bookings
// ---------------------------------------------------------------------------

export type StoreBooking = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "held" | "confirmed" | "cancelled";
  service: string;
  /** Who, or which unit or item. */
  staff: string;
  resourceId: string;
  kind: ResourceKind;
  orderId: string | null;
  orderNumber: string | null;
  customer: string;
  /** Marked as not having come (D66), and the fee a no-show would cost now (0 when none can be charged). */
  noShowAt: string | null;
  noShowFeeMinor: number;
  currency: string | null;
};

/**
 * Bookings between two instants, held ones only while their hold lasts,
 * earliest first: appointments starting then, or stays and rentals (D67)
 * overlapping them.
 */
export async function listBookings(
  storeId: string,
  from: Date,
  to: Date,
  kinds: readonly ResourceKind[] = ["staff"],
  /** Only a host's own rooms and items (D71). */
  hostId: string | null = null,
): Promise<StoreBooking[]> {
  const ranges = !kinds.includes("staff");
  const rows = await db().execute<Row>(sql`
    select b.id, b.starts_at, b.ends_at, b.status, r.name as staff, b.resource_id, r.kind,
      coalesce((select t.title from commerce.product_translations t where t.product_id = b.product_id order by t.locale limit 1), p.handle) as service,
      o.id as order_id, o.number as order_number, o.currency, b.no_show_at,
      coalesce(nullif(o.billing_address ->> 'name', ''), o.email, '') as customer,
      ol.total_minor, ol.venue_minor, a.no_show_percent
    from commerce.bookings b
    join commerce.booking_resources r on r.store_id = b.store_id and r.id = b.resource_id
    join commerce.products p on p.store_id = b.store_id and p.id = b.product_id
    left join commerce.orders o on o.store_id = b.store_id and o.id = b.order_id
    left join commerce.order_lines ol on ol.store_id = b.store_id and ol.id = b.order_line_id
    left join commerce.appointment_settings a on a.store_id = b.store_id and a.product_id = b.product_id
    where b.store_id = ${storeId}::uuid and r.kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
      ${hostId ? sql`and (r.host_id = ${hostId}::uuid or p.host_id = ${hostId}::uuid)` : sql``}
      and ${
        ranges
          ? sql`b.starts_at < ${to.toISOString()}::timestamptz and b.ends_at > ${from.toISOString()}::timestamptz`
          : sql`b.starts_at >= ${from.toISOString()}::timestamptz and b.starts_at < ${to.toISOString()}::timestamptz`
      }
      and (b.status = 'confirmed' or (b.status = 'held' and b.hold_expires_at > now()))
    order by b.starts_at, r.position
  `);
  return rows.map((row) => ({
    id: String(row.id),
    startsAt: new Date(String(row.starts_at)).toISOString(),
    endsAt: new Date(String(row.ends_at)).toISOString(),
    status: row.status as StoreBooking["status"],
    service: String(row.service),
    staff: String(row.staff),
    resourceId: String(row.resource_id),
    kind: RESOURCE_KINDS.find((k) => k === row.kind) ?? "staff",
    orderId: row.order_id ? String(row.order_id) : null,
    orderNumber: row.order_number ? String(row.order_number) : null,
    customer: String(row.customer ?? ""),
    noShowAt: row.no_show_at ? new Date(String(row.no_show_at)).toISOString() : null,
    noShowFeeMinor:
      row.total_minor === null
        ? 0
        : noShowFeeFor(
            { totalMinor: Number(row.total_minor), venueMinor: Number(row.venue_minor) },
            Number(row.no_show_percent ?? 0),
          ),
    currency: row.currency ? String(row.currency) : null,
  }));
}

/**
 * The store cancels a confirmed appointment: its time is free again, and
 * the order keeps a note. Paying back is done from the order, as for goods.
 */
export async function cancelBooking({ account, store }: Membership, bookingId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    update commerce.bookings set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where store_id = ${store.id}::uuid and id = ${bookingId}::uuid and status = 'confirmed'
    returning order_id, starts_at
  `);
  if (!row) return false;
  if (row.order_id) {
    await db().execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${store.id}::uuid, ${String(row.order_id)}::uuid, 'booking.cancelled',
              ${JSON.stringify({ booking: bookingId, startsAt: new Date(String(row.starts_at)).toISOString() })}::jsonb, 'staff')
    `);
  }
  await audit(account.id, store.id, "booking.cancelled", { id: bookingId });
  return true;
}
