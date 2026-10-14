import "server-only";

import { sql } from "drizzle-orm";

import { warningWords } from "@/components/admin/shipping/shipping-hub";
import { db } from "@/db/client";
import { readDelivery } from "@/lib/delivery-options";
import { formatMoney } from "@/lib/money";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { groupHandovers, readyWords, shapeArea, shapeMethod, shapeZone, weightWords, type HandoverOrder } from "@/lib/shipping-tools";

import { listLocalAreas } from "./local-delivery";
import { OwnerToolError } from "./owner-tool-error";
import { listPickupPlaces } from "./pickup";
import { getShippingSettings } from "./settings";
import { getShippingSetup, shippingWarningsFor } from "./shipping-methods";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The AI manager's shipping tools (wave 3, D237, `docs/wave-3-shipping-methods.md` 2.6 and 5.5), read-only and ungated. `shipping_overview` answers from
 * the Shipping pages' own readers (`getShippingSetup()`, `listPickupPlaces()`, `listLocalAreas()`, `shippingWarningsFor()`, and the flat rate's
 * `getShippingSettings()`); `pickup_orders` from the conditions of the Orders page's *To hand over* and *Local deliveries* views (`order-list-sql.ts`'s `pickup`
 * and `local`, archived orders left out as the views leave them out, copied history never). Every amount is written by `formatMoney()` in the store's
 * main locale; nothing is summed or priced here, and no name or address of a customer is read. Every query names the store.
 */

type Ctx = { store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const mainLocale = (store: Store) => store.markets[0]?.locale ?? "en";

/** At most this many orders are read for `pickup_orders`; more is said, never cut silently. */
export const HANDOVER_READ_MAX = 500;

/** `shipping_overview`: the Shipping pages per country, in words. */
export async function shippingOverviewTool({ store }: Ctx, { market }: OwnerToolInput<"shipping_overview">) {
  const money = (minor: number, currency: string) => formatMoney(minor, currency, mainLocale(store));
  const wanted = market?.toUpperCase();
  const markets = store.markets.filter((m) => !wanted || m.code === wanted);
  if (wanted && markets.length === 0) return fail(`The store does not sell to ${wanted}. Its countries are ${store.markets.map((m) => m.code).join(", ") || "none yet"}.`);
  const codes = markets.map((m) => m.code);
  const [setup, places, areas, flats, warnings] = await Promise.all([
    getShippingSetup(store.id),
    listPickupPlaces(store.id),
    listLocalAreas(store.id),
    getShippingSettings(store),
    shippingWarningsFor(store.id, codes),
  ]);
  const zoneName = (id: string) => setup.zones.find((z) => z.id === id)?.name ?? "A zone that is gone";
  const profileName = (id: string) => setup.profiles.find((p) => p.id === id)?.name ?? "A profile that is gone";
  const nameOf = (code: string) => store.markets.find((m) => m.code === code)?.name ?? code;
  return {
    default_weight_per_unit: weightWords(setup.defaultWeightGrams),
    default_weight_note: "Goods with no weight of their own count as this in weight-based rates.",
    profiles: [
      { name: "General", note: "Every product not in another profile." },
      ...setup.profiles.map((p) => ({ name: p.name, products: p.products })),
    ],
    countries: markets.map((m) => {
      const flat = flats.find((f) => f.marketCode === m.code && f.amountMinor !== null);
      const methods = setup.methods.filter((x) => x.marketCode === m.code);
      const zones = setup.zones.filter((z) => z.marketCode === m.code);
      const pickups = places.filter((p) => p.country === m.code && p.option);
      const local = areas.filter((a) => a.marketCode === m.code);
      return {
        country: m.code,
        name: m.name,
        flat_rate: flat
          ? { price: money(flat.amountMinor!, flat.currency), ...(flat.freeOverMinor === null ? {} : { free_over: money(flat.freeOverMinor, flat.currency) }) }
          : "none set",
        methods: methods.map((x) => shapeMethod(x, zoneName, profileName, money)),
        zones: zones.map(shapeZone),
        pickup_places: pickups.map((p) => ({
          place: p.name,
          town: p.city,
          active: p.option!.active,
          price: p.option!.amountMinor === 0 ? "free" : money(p.option!.amountMinor, p.currency ?? m.nativeCurrency),
          ready: readyWords(p.option!.readyInHours),
        })),
        local_delivery_areas: local.map((a) =>
          shapeArea({ name: a.name, currency: a.currency, kind: a.kind, placeName: a.placeName, patterns: a.patterns, radiusKm: a.radiusKm, amountMinor: a.amountMinor, minBasketMinor: a.minBasketMinor, freeOverMinor: a.freeOverMinor, active: a.active, hasOrigin: a.origin !== null }, money),
        ),
      };
    }),
    warnings: warnings.map((w) => warningWords(w, nameOf)),
    note: "Amounts include VAT and are in each country's own currency. Shoppers are offered the methods that price their basket, the pickup places and the cheapest local area that covers their postal code; with no method, the flat rate is charged. Carriers connected under Integrations are offered beside these and are not listed here.",
    admin: `/admin/${store.slug}/settings/shipping`,
  };
}

/** `pickup_orders`: the *To hand over* and *Local deliveries* views, counted and grouped, numbers only. */
export async function pickupOrdersTool({ store }: Ctx, { kind }: OwnerToolInput<"pickup_orders">) {
  const pickup = sql`(o.delivery_method = 'pickup' and o.status = 'paid')`;
  const local = sql`(o.delivery_method = 'local' and o.status in ('paid', 'fulfilled') and o.delivered_at is null)`;
  const which = kind === "pickup" ? pickup : kind === "local" ? local : sql`(${pickup} or ${local})`;
  const rows = await db().execute<Row>(sql`
    select o.number, o.delivery_method, o.delivery, o.placed_at, o.ready_for_pickup_at,
      (select min(s.created_at) from commerce.shipments s
        where s.store_id = o.store_id and s.order_id = o.id and s.method = 'local' and s.undone_at is null) as out_at
    from commerce.orders o
    where o.store_id = ${store.id}::uuid and o.copied_from is null and o.archived_at is null and ${which}
    order by o.placed_at, o.id
    limit ${HANDOVER_READ_MAX + 1}
  `);
  const more = rows.length > HANDOVER_READ_MAX;
  const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(String(v)).toISOString());
  const orders: HandoverOrder[] = rows.slice(0, HANDOVER_READ_MAX).map((r) => {
    const d = readDelivery(r.delivery);
    const where = d && (d.kind === "pickup" || d.kind === "local") ? d.name || d.label || null : null;
    return {
      number: String(r.number),
      method: r.delivery_method === "local" ? "local" : "pickup",
      where,
      placedAt: iso(r.placed_at)!,
      readyAt: iso(r.ready_for_pickup_at),
      outAt: iso(r.out_at),
    };
  });
  const groups = groupHandovers(orders);
  const base = `/admin/${store.slug}/orders`;
  return {
    to_be_collected: orders.filter((o) => o.method === "pickup").length,
    local_deliveries_not_delivered: orders.filter((o) => o.method === "local").length,
    ...(more ? { more_than_counted: true, note_on_count: `Only the oldest ${HANDOVER_READ_MAX} are counted here; the Orders page lists them all.` } : {}),
    groups,
    ...(orders.length === 0 ? { note: kind === "local" ? "No local delivery is waiting." : kind === "pickup" ? "No order is waiting to be collected." : "No order is waiting to be collected or delivered locally." } : {}),
    pages: {
      ...(kind !== "local" ? { to_hand_over: `${base}?show=to-hand-over` } : {}),
      ...(kind !== "pickup" ? { local_deliveries: `${base}?show=local` } : {}),
    },
    how: "Ready for pickup, Collected and Out for delivery are pressed on each order's page; Ready for pickup also in bulk on the Orders page. Archived orders are left out, as on the Orders page.",
  };
}
