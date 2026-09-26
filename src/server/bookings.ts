import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { defaultHours, openingHoursInput, parseOpeningHours, type OpeningHours } from "@/lib/opening-hours";

import { audit, type Membership } from "./auth";

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
});

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
      time_zone = ${input.timeZone}
    where id = ${store.id}::uuid
  `);
  await audit(account.id, store.id, input.enabled ? "bookings.enabled" : "bookings.disabled", { timeZone: input.timeZone });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export type BookingResource = {
  id: string;
  name: string;
  email: string;
  hours: OpeningHours;
  capacity: number;
  active: boolean;
  /** Appointments they do. */
  services: number;
  /** Confirmed bookings still to come. */
  upcoming: number;
};

const toResource = (row: Row): BookingResource => ({
  id: String(row.id),
  name: String(row.name),
  email: String(row.email ?? ""),
  hours: parseOpeningHours(row.hours) ?? defaultHours(),
  capacity: Number(row.capacity),
  active: Boolean(row.active),
  services: Number(row.services ?? 0),
  upcoming: Number(row.upcoming ?? 0),
});

const resourceColumns = sql`
  r.id, r.name, r.email, r.hours, r.capacity, r.active,
  (select count(*)::int from commerce.product_resources pr where pr.store_id = r.store_id and pr.resource_id = r.id) as services,
  (select count(*)::int from commerce.bookings b
    where b.store_id = r.store_id and b.resource_id = r.id and b.status = 'confirmed' and b.starts_at > now()) as upcoming
`;

/** The store's staff who take appointments, in their order; those switched off last. */
export async function listResources(storeId: string): Promise<BookingResource[]> {
  const rows = await db().execute<Row>(sql`
    select ${resourceColumns} from commerce.booking_resources r
    where r.store_id = ${storeId}::uuid
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

/** Adds a member of staff, or changes one of the store's. */
export async function saveResource(
  { account, store }: Membership,
  id: string | null,
  values: Record<string, unknown>,
): Promise<SaveResourceResult> {
  const parsed = resourceInput.safeParse(values);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const r = parsed.data;
  const hours = JSON.stringify(r.hours);
  const [row] = id
    ? await db().execute<Row>(sql`
        update commerce.booking_resources set
          name = ${r.name}, email = ${r.email}, capacity = ${r.capacity}, active = ${r.active},
          hours = ${hours}::jsonb, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${id}::uuid
        returning id
      `)
    : await db().execute<Row>(sql`
        insert into commerce.booking_resources (store_id, kind, name, email, capacity, active, hours, position)
        values (
          ${store.id}::uuid, 'staff', ${r.name}, ${r.email}, ${r.capacity}, ${r.active}, ${hours}::jsonb,
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
  staff: string;
  orderId: string | null;
  orderNumber: string | null;
  customer: string;
};

/** Bookings between two instants, held ones only while their hold lasts, earliest first. */
export async function listBookings(storeId: string, from: Date, to: Date): Promise<StoreBooking[]> {
  const rows = await db().execute<Row>(sql`
    select b.id, b.starts_at, b.ends_at, b.status, r.name as staff,
      coalesce((select t.title from commerce.product_translations t where t.product_id = b.product_id order by t.locale limit 1), p.handle) as service,
      o.id as order_id, o.number as order_number,
      coalesce(nullif(o.billing_address ->> 'name', ''), o.email, '') as customer
    from commerce.bookings b
    join commerce.booking_resources r on r.store_id = b.store_id and r.id = b.resource_id
    join commerce.products p on p.store_id = b.store_id and p.id = b.product_id
    left join commerce.orders o on o.store_id = b.store_id and o.id = b.order_id
    where b.store_id = ${storeId}::uuid
      and b.starts_at >= ${from.toISOString()}::timestamptz and b.starts_at < ${to.toISOString()}::timestamptz
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
    orderId: row.order_id ? String(row.order_id) : null,
    orderNumber: row.order_number ? String(row.order_number) : null,
    customer: String(row.customer ?? ""),
  }));
}
