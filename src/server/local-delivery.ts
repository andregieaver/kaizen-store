import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { areaCovers, codesWithin, type AreaTerms, type GeoPoint } from "@/lib/local-delivery";
import { cleanPostalCode } from "@/lib/postal-code";
import { localAreaInput } from "@/lib/shipping-methods-schema";

import { audit } from "./auth";
import { catalogTag } from "./catalog";
import { markSentWithin as sendWithin } from "./order-admin";
import { HandoverRefused, handoverRefusal, PICKUP_REFUSALS, type PickupRefused } from "./pickup";
import { refreshTag } from "./refresh";
import { shippingGuard, type ShippingRefused } from "./shipping-errors";
import { sendOutForDelivery } from "./shopper-emails";
import { textList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * Local delivery by the store's own drivers (D237, `docs/wave-3-shipping-methods.md` 2.3 and 4.5): areas by postal-code patterns or by a radius from one
 * of the store's places, measured between postal-code centres (`postal_points`, GeoNames, CC BY 4.0; no service is called). Amounts are in the market's
 * own currency, with VAT. *Out for delivery* records a handover of method `local` through `markSent()`'s work and sends the email; *Mark delivered* on a
 * local order never taken out writes the handover first (`markDelivered()`). Every query names the store.
 */

export type LocalAreaRow = {
  id: string;
  marketCode: string;
  currency: string;
  locationId: string | null;
  placeName: string | null;
  name: string;
  names: Record<string, string>;
  kind: "postal" | "radius";
  patterns: string[];
  radiusKm: number | null;
  amountMinor: number;
  minBasketMinor: number | null;
  freeOverMinor: number | null;
  info: string;
  infoT: Record<string, string>;
  active: boolean;
  position: number;
  /** The place's position (radius areas), or null when it has none. */
  origin: GeoPoint | null;
};

/** The store's local delivery areas, by market and position. */
export async function listLocalAreas(storeId: string): Promise<LocalAreaRow[]> {
  const rows = await db().execute<Row>(sql`
    select a.*, l.name as place_name, l.latitude, l.longitude
    from commerce.local_delivery_areas a
    left join commerce.store_locations l on l.store_id = a.store_id and l.id = a.location_id
    where a.store_id = ${storeId}::uuid
    order by a.market_code, a.position, a.id
  `);
  return rows.map((r) => ({
    id: String(r.id),
    marketCode: String(r.market_code).trim(),
    currency: String(r.currency).trim(),
    locationId: r.location_id ? String(r.location_id) : null,
    placeName: r.place_name ? String(r.place_name) : null,
    name: String(r.name),
    names: (r.names ?? {}) as Record<string, string>,
    kind: r.kind === "radius" ? "radius" : "postal",
    patterns: (r.patterns ?? []) as string[],
    radiusKm: r.radius_km === null || r.radius_km === undefined ? null : Number(r.radius_km),
    amountMinor: Number(r.amount_minor),
    minBasketMinor: r.min_basket_minor === null || r.min_basket_minor === undefined ? null : Number(r.min_basket_minor),
    freeOverMinor: r.free_over_minor === null || r.free_over_minor === undefined ? null : Number(r.free_over_minor),
    info: String(r.info ?? ""),
    infoT: (r.info_t ?? {}) as Record<string, string>,
    active: Boolean(r.active),
    position: Number(r.position),
    origin: r.latitude === null || r.latitude === undefined ? null : { lat: Number(r.latitude), lon: Number(r.longitude) },
  }));
}

export type AreaSaved = { ok: true; id: string } | { ok: false; problem: "invalid" | "not_found" | "not_market"; message: string } | ShippingRefused;

/**
 * Saves a local delivery area (`localAreaInput`): new when `id` is null. The market's currency is taken from the store's market (a country it does not
 * sell to is refused, `not_market`); a place named must be the store's. Before a radius area is saved, the place's position is filled from the
 * reference data when it has none (`fillPlacePosition()`); the database refuses an active radius area at a place without one
 * (`local_delivery_areas.no_position`). Audit `shipping.local_area_saved` (ids, kind, amounts in minor units; never the patterns), catalogue's tag.
 */
export async function saveLocalArea(accountId: string, storeId: string, input: unknown): Promise<AreaSaved> {
  const parsed = localAreaInput.safeParse(input);
  if (!parsed.success) return { ok: false, problem: "invalid", message: parsed.error.issues[0]?.message ?? "Check the fields and try again." };
  const a = parsed.data;
  const result = await shippingGuard(() =>
    db().transaction(async (tx): Promise<AreaSaved> => {
      const [market] = await tx.execute<Row>(sql`select currency from commerce.markets where store_id = ${storeId}::uuid and code = ${a.marketCode}`);
      if (!market) return { ok: false, problem: "not_market", message: "This is not a country you sell to." };
      if (a.locationId) {
        const [place] = await tx.execute<Row>(sql`select id from commerce.store_locations where store_id = ${storeId}::uuid and id = ${a.locationId}::uuid`);
        if (!place) return { ok: false, problem: "not_found", message: "That place no longer exists." };
        if (a.kind === "radius") await fillPlacePosition(tx, storeId, a.locationId);
      }
      const values = sql`
        location_id = ${a.locationId}::uuid, name = ${a.name}, names = ${JSON.stringify(a.names)}::jsonb, kind = ${a.kind},
        patterns = ${textList(a.kind === "postal" ? a.patterns : [])}, radius_km = ${a.kind === "radius" ? a.radiusKm : null}::numeric,
        amount_minor = ${a.amountMinor}, min_basket_minor = ${a.minBasketMinor}, free_over_minor = ${a.freeOverMinor},
        info = ${a.info}, info_t = ${JSON.stringify(a.infoT)}::jsonb, active = ${a.active}, updated_at = now()
      `;
      if (a.id) {
        const [row] = await tx.execute<Row>(sql`
          update commerce.local_delivery_areas set ${values}
          where store_id = ${storeId}::uuid and id = ${a.id}::uuid and market_code = ${a.marketCode}
          returning id
        `);
        return row ? { ok: true, id: String(row.id) } : { ok: false, problem: "not_found", message: "That area no longer exists." };
      }
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.local_delivery_areas (
          store_id, market_code, currency, location_id, name, names, kind, patterns, radius_km, amount_minor, min_basket_minor, free_over_minor,
          info, info_t, active, position
        ) values (
          ${storeId}::uuid, ${a.marketCode}, ${String(market.currency).trim()}, ${a.locationId}::uuid, ${a.name}, ${JSON.stringify(a.names)}::jsonb, ${a.kind},
          ${textList(a.kind === "postal" ? a.patterns : [])}, ${a.kind === "radius" ? a.radiusKm : null}::numeric, ${a.amountMinor}, ${a.minBasketMinor},
          ${a.freeOverMinor}, ${a.info}, ${JSON.stringify(a.infoT)}::jsonb, ${a.active},
          (select coalesce(max(position) + 1, 0) from commerce.local_delivery_areas where store_id = ${storeId}::uuid and market_code = ${a.marketCode})
        ) returning id
      `);
      return { ok: true, id: String(row.id) };
    }),
  );
  if (result.ok) {
    await audit(
      accountId,
      storeId,
      "shipping.local_area_saved",
      { id: result.id, market: a.marketCode, kind: a.kind, patterns: a.patterns.length, radiusKm: a.radiusKm, amountMinor: a.amountMinor, minBasketMinor: a.minBasketMinor, freeOverMinor: a.freeOverMinor, active: a.active },
      { area: "settings", target: { type: "shipping", id: result.id } },
    );
    refreshTag(catalogTag(storeId));
  }
  return result;
}

/** Deletes an area (a cart that chose it falls back to the default, its note cleared by the database). */
export async function deleteLocalArea(accountId: string, storeId: string, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const rows = await db().execute<Row>(sql`delete from commerce.local_delivery_areas where store_id = ${storeId}::uuid and id = ${id}::uuid returning name`);
  if (rows.length === 0) return false;
  await audit(accountId, storeId, "shipping.local_area_deleted", { id }, { area: "settings", target: { type: "shipping", id } });
  refreshTag(catalogTag(storeId));
  return true;
}

type Tx = Pick<ReturnType<typeof db>, "execute">;

/** Fills a place's position from the postal-code reference data when it has none (`postal_points`); true when it has one afterwards. */
export async function fillPlacePosition(runner: Tx, storeId: string, locationId: string): Promise<boolean> {
  const [place] = await runner.execute<Row>(sql`
    select country, postal_code, latitude from commerce.store_locations where store_id = ${storeId}::uuid and id = ${locationId}::uuid
  `);
  if (!place) return false;
  if (place.latitude !== null && place.latitude !== undefined) return true;
  const code = cleanPostalCode(String(place.country).trim(), String(place.postal_code ?? ""));
  if (!code) return false;
  const [done] = await runner.execute<Row>(sql`
    update commerce.store_locations l set latitude = pp.latitude, longitude = pp.longitude
    from commerce.postal_points pp
    where l.store_id = ${storeId}::uuid and l.id = ${locationId}::uuid and pp.country = ${String(place.country).trim()} and pp.postal_code = ${code}
    returning l.id
  `);
  return Boolean(done);
}

/** Whether the reference data has postal-code centres for a country (a country without offers postal-code areas only). */
export async function hasPostalPoints(country: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select exists (select 1 from commerce.postal_points where country = ${country}) as has`);
  return Boolean(row?.has);
}

/** How many of a country's postal codes a radius from a point includes (the page's "includes N postal codes"). */
export async function codesInRadius(country: string, origin: GeoPoint, radiusKm: number): Promise<number> {
  // A box first (1 degree of latitude is ~111 km), then the exact distance in code.
  const dLat = radiusKm / 111 + 0.01;
  const dLon = radiusKm / (111 * Math.max(0.05, Math.cos((origin.lat * Math.PI) / 180))) + 0.01;
  const rows = await db().execute<Row>(sql`
    select latitude, longitude from commerce.postal_points
    where country = ${country} and latitude between ${origin.lat - dLat} and ${origin.lat + dLat} and longitude between ${origin.lon - dLon} and ${origin.lon + dLon}
  `);
  return codesWithin(origin, radiusKm, rows.map((r) => ({ lat: Number(r.latitude), lon: Number(r.longitude) })));
}

/**
 * *Check a postal code* on the Local delivery page: which of the market's areas cover a code (as `areaFor()` judges it, active or not shown apart), and
 * whether the code is in the reference data at all.
 */
export async function checkLocalCode(storeId: string, marketCode: string, typed: string): Promise<{ code: string | null; known: boolean; areas: { id: string; name: string; active: boolean }[] }> {
  const code = cleanPostalCode(marketCode, typed.slice(0, 20));
  if (!code) return { code: null, known: false, areas: [] };
  const [point] = await db().execute<Row>(sql`select latitude, longitude from commerce.postal_points where country = ${marketCode} and postal_code = ${code}`);
  const geo = point ? { lat: Number(point.latitude), lon: Number(point.longitude) } : null;
  const areas = (await listLocalAreas(storeId)).filter((a) => a.marketCode === marketCode);
  const covering = areas.filter((a) => areaCovers({ ...(a as AreaTerms), active: true }, code, geo));
  return { code, known: Boolean(point), areas: covering.map((a) => ({ id: a.id, name: a.name, active: a.active })) };
}

// ---------------------------------------------------------------------------
// Out for delivery (orders:write)
// ---------------------------------------------------------------------------

const outInput = z.object({ orderId: z.uuid(), seen: z.string().max(4000).nullish() });

export type OutDone = { ok: true; shipmentId: string; email: string | null } | PickupRefused | { ok: false; reason: "not_local"; message: string };

/**
 * *Out for delivery* (2.3): a handover of method `local` (every unit still to send, no tracking) through `sendWithin()` under the order's lock, the order
 * `fulfilled`; then the email, once per handover (key `order-out:{shipment}`). Refused for an order of another delivery method, an unpaid, copied or
 * cancelled one, one with a change waiting for payment, and when another handover came in between (`seen`).
 */
export async function markOutForDelivery(storeId: string, input: unknown, accountId: string | null): Promise<OutDone> {
  const parsed = outInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "not_found", message: PICKUP_REFUSALS.not_found };
  const { orderId, seen } = parsed.data;
  const done = await db()
    .transaction(async (tx) => {
      const sent = await sendWithin(tx, storeId, orderId, { carrier: "other", trackingNumber: "", trackingUrl: null }, accountId, null, { seen: seen ?? null }, "local");
      if (!sent.ok) throw new HandoverRefused(sent);
      await tx.execute(sql`
        insert into commerce.order_events (store_id, order_id, type, data, actor)
        values (${storeId}::uuid, ${orderId}::uuid, 'order.out_for_delivery', ${JSON.stringify({ by: accountId, shipment: sent.shipment.id })}::jsonb, 'staff')
      `);
      return sent.shipment.id;
    })
    .catch((error: unknown) => {
      if (error instanceof HandoverRefused) return error;
      throw error;
    });
  if (done instanceof HandoverRefused) {
    if (done.outcome.reason === "not_local") return { ok: false, reason: "not_local", message: "This order is not for local delivery." };
    return handoverRefusal(done.outcome);
  }
  const email = await sendOutForDelivery(storeId, orderId, done).catch(() => "failed" as const);
  return { ok: true, shipmentId: done, email };
}
