/**
 * The numbers of shipping methods, zones, profiles, pickup and local delivery (wave 3, D237, `docs/wave-3-shipping-methods.md` 4.8). One module so a
 * limit is one reviewed change: `shipping-limits.test.ts` pins every value, the database's checks and triggers (`*_shipping_methods_rules.sql`) use the
 * same numbers, and the screens say them out loud. Pure: no server import, no zod (the checkout, a pay route, reads some of them).
 */

/** Shipping profiles a store may have besides General. */
export const PROFILES_MAX = 20;
/** Zones in one market. */
export const ZONES_MAX = 20;
/** Methods in one market. */
export const METHODS_MAX = 10;
/** Rows (tiers) of one (method, zone, profile) group. */
export const TIERS_MAX = 10;
/** Postal-code patterns in one zone or postal-code area. */
export const PATTERNS_MAX = 1_000;
/** Characters of a zone's or an area's patterns together (Shopify's limit for a local zone's list). */
export const PATTERN_CHARS_MAX = 3_000;
/** The longest single pattern, its `*` left out: as long as the longest postal code `cleanPostalCode()` accepts. */
export const PATTERN_LENGTH_MAX = 10;
/** Local delivery areas of one place, and of a store. */
export const AREAS_PER_PLACE_MAX = 10;
export const AREAS_MAX = 30;
/** A radius area's largest radius in kilometres (Shopify's). */
export const RADIUS_KM_MAX = 160;
export const RADIUS_KM_MIN = 1;
/** "Usually ready in": hours, 0 meaning no promise (30 days at most). */
export const READY_HOURS_MAX = 720;
/** Characters of pickup instructions, a local area's delivery information, the shopper's note for the driver. */
export const INSTRUCTIONS_MAX = 1_000;
export const INFO_MAX = 500;
export const NOTE_MAX = 500;
/** A method's transit time, whole days. */
export const ESTIMATE_DAYS_MAX = 60;
/** The weight of one unit of goods with no weight of its own, in methods' weight tiers. */
export const DEFAULT_WEIGHT_GRAMS = 500;
/** The store's default weight may be set between 1 g and this. */
export const WEIGHT_GRAMS_MAX = 35_000;
/** Names of methods, zones, profiles and areas, in characters. */
export const NAME_MAX = 60;
/** The delivery postal code a cart keeps (`carts.delivery_postal_code`). */
export const POSTAL_CODE_MAX = 12;
/** The mean radius of the earth (IUGG), for the haversine distance between postal-code centres. */
export const EARTH_RADIUS_KM = 6_371.0088;
