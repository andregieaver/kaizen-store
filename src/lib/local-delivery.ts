import type { ShippingRate } from "./checkout";
import { shippingCost } from "./checkout";
import { shown, type Market } from "./markets";
import { mostSpecific } from "./postal-patterns";
import { EARTH_RADIUS_KM } from "./shipping-limits";

/**
 * Local delivery by the store's own drivers (D237, `docs/wave-3-shipping-methods.md` 4.5): an area covers a postal code by its patterns, or by a radius
 * from one of the store's places measured between postal-code centres (`postal_points`, GeoNames, CC BY 4.0). Distances between centres, not street
 * addresses: an address near the edge may be counted in or out, and a code missing from the reference data is outside every radius area. Of the areas
 * that cover a code and whose minimum the basket reaches, the cheapest for the basket is offered (Shopify: "always charged the lowest applicable
 * delivery price"), ties by position. Pure, no zod: the checkout reads it.
 */

export type GeoPoint = { lat: number; lon: number };

/** The great-circle distance in kilometres between two points (haversine, on a sphere of the earth's mean radius). */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** An area as the checkout reads it: amounts in the market's own currency, with VAT; `origin` the place's position for a radius area. */
export type AreaTerms = {
  id: string;
  kind: "postal" | "radius";
  patterns: readonly string[];
  radiusKm: number | null;
  origin: GeoPoint | null;
  amountMinor: number;
  minBasketMinor: number | null;
  freeOverMinor: number | null;
  position: number;
  active: boolean;
};

/**
 * Whether an area covers a (clean) postal code: one of its patterns matches, or the code's centre (`point`, null when the code is not in the reference
 * data) is within the radius of its place. An inactive area covers nothing; a radius area whose place has no position covers nothing.
 */
export function areaCovers(area: AreaTerms, code: string | null, point: GeoPoint | null): boolean {
  if (!area.active || !code) return false;
  if (area.kind === "postal") return mostSpecific(area.patterns, code) !== null;
  if (!area.origin || !point || area.radiusKm === null) return false;
  return distanceKm(area.origin, point) <= area.radiusKm;
}

export type AreaQuote = {
  area: AreaTerms;
  /** What the basket pays, its free-above taken off; in the currency shown. */
  priceMinor: number;
  /** The area's price and free-above as shown, handed to `basketShipping()` as the basket's rate. */
  rate: ShippingRate;
  /** The area's minimum basket as shown, or null. */
  minimumMinor: number | null;
};

const quote = (area: AreaTerms, basketValueMinor: number, view: Pick<Market, "conversion">): AreaQuote => {
  const rate: ShippingRate = { amountMinor: shown(view, area.amountMinor), freeOverMinor: area.freeOverMinor === null ? null : shown(view, area.freeOverMinor) };
  return { area, rate, priceMinor: shippingCost(basketValueMinor, rate), minimumMinor: area.minBasketMinor === null ? null : shown(view, area.minBasketMinor) };
};

const cheaper = (a: AreaQuote, b: AreaQuote) => a.priceMinor - b.priceMinor || a.area.position - b.area.position || (a.area.id < b.area.id ? -1 : a.area.id > b.area.id ? 1 : 0);

/**
 * The local delivery a basket is offered at a postal code: the cheapest covering area whose minimum the basket value (as shown, before discounts, the
 * value free shipping is judged on) reaches; and, when there is none, the covering area with the lowest minimum the basket is below, so the checkout can
 * say "Local delivery from {minimum}". Minimums and free-above are compared as shown, each converted on its own.
 */
export function areaFor(
  areas: readonly AreaTerms[],
  code: string | null,
  point: GeoPoint | null,
  basketValueMinor: number,
  view: Pick<Market, "conversion">,
): { offered: AreaQuote | null; belowMinimum: AreaQuote | null } {
  const covering = areas.filter((a) => areaCovers(a, code, point)).map((a) => quote(a, basketValueMinor, view));
  const reached = covering.filter((q) => q.minimumMinor === null || basketValueMinor >= q.minimumMinor).sort(cheaper);
  if (reached.length > 0) return { offered: reached[0], belowMinimum: null };
  const below = covering.sort((a, b) => (a.minimumMinor ?? 0) - (b.minimumMinor ?? 0) || cheaper(a, b));
  return { offered: null, belowMinimum: below[0] ?? null };
}

/** How many of the given postal-code centres a radius from a place includes (the area page's "includes N postal codes"). */
export function codesWithin(origin: GeoPoint, radiusKm: number, points: readonly GeoPoint[]): number {
  return points.reduce((n, p) => (distanceKm(origin, p) <= radiusKm ? n + 1 : n), 0);
}
