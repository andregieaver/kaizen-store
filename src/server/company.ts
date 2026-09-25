import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { openingHoursInput, parseOpeningHours, type OpeningHours } from "@/lib/opening-hours";

import { audit, type Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * The store's places (decision D40): its office, with the office's hours,
 * and any shops and pickup points, each with its own address and, if it
 * has them, opening hours.
 */

export type LocationKind = "office" | "shop" | "pickup";

export const KIND_LABELS: Record<LocationKind, string> = { office: "Office", shop: "Store", pickup: "Pickup point" };

export type StoreLocation = {
  id: string;
  kind: LocationKind;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  notes: string;
  hours: OpeningHours | null;
};

export const MAX_LOCATIONS = 50;

function toLocation(row: Row): StoreLocation {
  return {
    id: String(row.id),
    kind: row.kind as LocationKind,
    name: String(row.name),
    street: String(row.street),
    postalCode: String(row.postal_code),
    city: String(row.city),
    country: String(row.country),
    phone: String(row.phone),
    notes: String(row.notes),
    hours: parseOpeningHours(row.hours),
  };
}

export type Company = { office: StoreLocation | null; places: StoreLocation[] };

/** The office, and the shops and pickup points in the order they were added. */
export async function getCompany(storeId: string): Promise<Company> {
  const rows = await db().execute<Row>(sql`
    select * from commerce.store_locations where store_id = ${storeId}::uuid
    order by kind = 'office' desc, position, created_at, id
  `);
  const all = rows.map(toLocation);
  return { office: all.find((l) => l.kind === "office") ?? null, places: all.filter((l) => l.kind !== "office") };
}

export async function getLocation(storeId: string, id: string): Promise<StoreLocation | null> {
  const [row] = await db().execute<Row>(sql`
    select * from commerce.store_locations where store_id = ${storeId}::uuid and id = ${id}::uuid
  `);
  return row ? toLocation(row) : null;
}

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`);

export const locationInput = z.object({
  kind: z.enum(["office", "shop", "pickup"]),
  name: text(80).default(""),
  street: text(200).min(1, "Enter the street address."),
  postalCode: text(20).min(1, "Enter the postcode."),
  city: text(80).min(1, "Enter the town or city."),
  country: z.string().regex(/^[A-Z]{2}$/, "Choose the country."),
  phone: text(40).default(""),
  notes: text(500).default(""),
  /** JSON from the hours editor; empty when the place shows no hours. */
  hours: z
    .string()
    .default("")
    .transform((value, ctx) => {
      if (!value) return null;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "The opening hours could not be read. Try again." });
        return z.NEVER;
      }
    })
    .pipe(openingHoursInput.nullable()),
});

export type LocationInput = z.input<typeof locationInput>;

export type SaveResult = { ok: true; id?: string } | { ok: false; problems: string[] };

/** The office (made the first time), a shop or pickup point (new when `id` is null). */
export async function saveLocation(
  { account, store }: Membership,
  id: string | null,
  input: Record<string, unknown>,
): Promise<SaveResult> {
  const parsed = locationInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const l = parsed.data;
  if (l.kind !== "office" && !l.name) {
    return { ok: false, problems: [l.kind === "shop" ? "Give the store a name." : "Give the pickup point a name."] };
  }
  const hours = l.hours ? JSON.stringify(l.hours) : null;

  if (l.kind === "office") {
    await db().execute(sql`
      insert into commerce.store_locations (store_id, kind, name, street, postal_code, city, country, phone, notes, hours)
      values (${store.id}::uuid, 'office', '', ${l.street}, ${l.postalCode}, ${l.city}, ${l.country}, ${l.phone}, ${l.notes}, ${hours}::jsonb)
      on conflict (store_id) where kind = 'office' do update set
        street = excluded.street, postal_code = excluded.postal_code, city = excluded.city, country = excluded.country,
        phone = excluded.phone, notes = excluded.notes, hours = excluded.hours, updated_at = now()
    `);
    await audit(account.id, store.id, "company.office_saved", {});
    return { ok: true };
  }

  if (id) {
    const rows = await db().execute<Row>(sql`
      update commerce.store_locations set
        name = ${l.name}, street = ${l.street}, postal_code = ${l.postalCode}, city = ${l.city}, country = ${l.country},
        phone = ${l.phone}, notes = ${l.notes}, hours = ${hours}::jsonb, updated_at = now()
      where store_id = ${store.id}::uuid and id = ${id}::uuid and kind <> 'office'
      returning id
    `);
    if (rows.length === 0) return { ok: false, problems: ["That place no longer exists."] };
    await audit(account.id, store.id, "company.place_saved", { id, kind: l.kind });
    return { ok: true, id };
  }

  const [count] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.store_locations where store_id = ${store.id}::uuid and kind <> 'office'
  `);
  if (Number(count.n) >= MAX_LOCATIONS) return { ok: false, problems: [`A store can have at most ${MAX_LOCATIONS} places.`] };
  const [row] = await db().execute<Row>(sql`
    insert into commerce.store_locations (store_id, kind, name, street, postal_code, city, country, phone, notes, hours, position)
    values (${store.id}::uuid, ${l.kind}, ${l.name}, ${l.street}, ${l.postalCode}, ${l.city}, ${l.country}, ${l.phone}, ${l.notes},
      ${hours}::jsonb, ${Number(count.n)})
    returning id
  `);
  await audit(account.id, store.id, "company.place_added", { id: String(row.id), kind: l.kind });
  return { ok: true, id: String(row.id) };
}

export async function deleteLocation({ account, store }: Membership, id: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.store_locations where store_id = ${store.id}::uuid and id = ${id}::uuid and kind <> 'office'
    returning kind, name
  `);
  if (rows.length === 0) return false;
  await audit(account.id, store.id, "company.place_deleted", { id, name: String(rows[0].name) });
  return true;
}
