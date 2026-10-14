import "server-only";

/**
 * What a rule of the shipping database refused (D237, `*_shipping_methods_rules.sql`), in words for the owner who hit it. The rules raise errors whose
 * message starts with a code (`shipping_rates.gap: …`); Drizzle wraps the driver's error, so the chain of causes is walked. A code that is not known
 * propagates (a bug), never a message made up. The admin is English only.
 */
export const SHIPPING_ERROR_MESSAGES: Record<string, string> = {
  "shipping_rates.gap": "Rates: each tier starts where the one before ends, the first at 0.",
  "shipping_rates.overlap": "Rates: tiers may not overlap, and only the last is without an up to.",
  "shipping_rates.mixed_basis": "Rates: every tier of a block uses the same measure.",
  "shipping_rates.two_flat": "Rates: a flat price is one price.",
  "shipping_rates.too_many": "Rates: at most 10 tiers in a block.",
  "shipping_rates.zone_market": "Rates: the zone is in another country than the method.",
  "shipping_zones.taken": "A postal code or prefix is already in another zone of this country.",
  "shipping_zones.limit": "A country has at most 20 zones.",
  "shipping_zones.market_fixed": "A zone stays in its country.",
  "shipping_methods.limit": "A country has at most 10 methods.",
  "shipping_methods.market_fixed": "A method stays in its country and currency.",
  "shipping_profiles.limit": "A store has at most 20 shipping profiles.",
  "shipping_profiles.store_fixed": "A profile stays with its store.",
  "pickup_options.limit": "A store has at most 20 pickup places.",
  "pickup_options.place_country": "Customers can collect only at a place in a country you sell to.",
  "pickup_options.place_kind": "Customers can collect at a shop or a pickup place, not at an office.",
  "pickup_options.store_fixed": "A pickup option stays with its store.",
  "local_delivery_areas.limit": "A store has at most 30 local delivery areas.",
  "local_delivery_areas.place_limit": "A place has at most 10 local delivery areas.",
  "local_delivery_areas.market_fixed": "An area stays in its country.",
  "local_delivery_areas.no_position": "A radius area needs the place's position: add its latitude and longitude, or a postal code we know.",
  "local_delivery_areas.place_country": "The area is in another country than its place.",
  "postal_patterns.duplicate": "Postal codes: each only once.",
  "postal_patterns.malformed": "Postal codes: codes like 0150, or prefixes like 01*.",
  "postal_patterns.missing": "Enter at least one postal code or prefix.",
  "postal_patterns.too_long": "Postal codes: at most 1,000 entries and 3,000 characters in all.",
  "store_locations.pickup_option": "Customers collect at this place: switch pickup off here first, or keep it a shop or pickup place in the same country.",
  "store_locations.local_area": "A local delivery area is in this place's country: move or remove the area first.",
  "store_locations.radius_area": "An active radius area is measured from this place: it needs the place's position.",
  "order_delivery.frozen": "The delivery of a paid order cannot be changed.",
  "order_delivery.ready_once": "The order was marked ready already.",
  "shipment.method": "That kind of handover does not fit this order's delivery.",
  "shipment.pickup_order": "This order is collected at your place, not sent as a parcel.",
};

export type ShippingRefused = { ok: false; problem: string; message: string };

/** The first known shipping code in an error's chain of causes, or null. */
export function shippingCodeOf(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth++) {
    const message = current instanceof Error ? current.message : typeof current === "object" && current && "message" in current ? String((current as { message: unknown }).message) : "";
    for (const line of message.split("\n")) {
      const match = /([a-z_]+\.[a-z_]+):/.exec(line);
      if (match && match[1] in SHIPPING_ERROR_MESSAGES) return match[1];
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Runs `work`; a refusal of the shipping rules becomes `{ ok: false, problem, message }`, anything else propagates. */
export async function shippingGuard<T>(work: () => Promise<T>): Promise<T | ShippingRefused> {
  try {
    return await work();
  } catch (error) {
    const code = shippingCodeOf(error);
    if (!code) throw error;
    return { ok: false, problem: code, message: SHIPPING_ERROR_MESSAGES[code] };
  }
}
