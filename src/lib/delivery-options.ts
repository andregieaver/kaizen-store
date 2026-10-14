import { z } from "zod";

import { cleanPostalCode as cleanCode } from "./postal-code";
import type { CarrierId } from "./shipping-carriers";

/**
 * Delivery options at checkout (D135): a carrier's services and prices shown to the shopper next to the market's flat
 * rate. The shopper gives a postal code, the store's carrier agreement is asked for its services (and the pickup points
 * near the postal code), and each answer is kept as a quote (`delivery_quotes`) priced as shown: the carrier's price
 * without VAT, plus the country's standard VAT, plus what the store adds. The quote the shopper chooses is what
 * `cartSummary()` and `placeOrder()` both charge; none chosen is the flat rate. Pure rules, shared by the browser and
 * the server, which checks everything again.
 */

/** The countries a carrier's checkout services cover, now: Posten / Bring's are for parcels within Norway (D134), PostNord's for its four countries. */
export const CHECKOUT_COUNTRIES: Partial<Record<CarrierId, string[]>> = { bring: ["NO"], postnord: ["SE", "DK", "NO", "FI"], porterbuddy: ["NO"], helthjem: ["NO"] };

/**
 * Where a carrier's prices come from: its own price service for this parcel (`carrier`, Bring's Shipping Guide: the price
 * without VAT, to which the store's markup is added), or what the store enters from its agreement (`store`, PostNord has
 * no price API): per country and service, with VAT, as the shopper pays.
 */
export const CHECKOUT_PRICING: Partial<Record<CarrierId, "carrier" | "store">> = { bring: "carrier", postnord: "store", porterbuddy: "carrier", helthjem: "store" };

/** How long a quote holds: the time a shopper may take from seeing the prices to paying. */
export const QUOTE_MINUTES = 120;

/** The most services (and, apart, delivery windows) and pickup points shown, so the page stays short. */
export const MAX_OPTIONS = 6;
export const MAX_WINDOWS = 8;
export const MAX_PICKUP_POINTS = 5;

/** A postal code as the country writes it, or null when it is not one (`src/lib/postal-code.ts`, free of zod for the pay routes). */
export { cleanPostalCode } from "./postal-code";

/** What the store adds to a carrier's price. */
export type Markup = { percent: number; minor: number };

/**
 * What the shopper pays for a service: the carrier's price without VAT, with the country's standard VAT (`vatRate` as a
 * fraction, 0.25), then the store's percentage on that, then its fixed amount. Whole minor units, rounded once at each step.
 */
export function shopperPrice(netMinor: number, vatRate: number, markup: Markup): number {
  const withVat = Math.round(netMinor * (1 + Math.max(0, vatRate)));
  const marked = Math.round(withVat * (1 + Math.max(0, markup.percent) / 100));
  return Math.max(0, marked + Math.max(0, Math.round(markup.minor)));
}

/** "2 days" or "1–3 days", or null when the carrier gave no estimate. */
export function estimateDays(estimate: unknown): { min: number; max: number } | null {
  if (!estimate || typeof estimate !== "object") return null;
  const { minDays, maxDays } = estimate as { minDays?: unknown; maxDays?: unknown };
  if (typeof minDays !== "number" || typeof maxDays !== "number" || !Number.isFinite(minDays) || !Number.isFinite(maxDays)) return null;
  return { min: Math.max(0, Math.round(minDays)), max: Math.max(0, Math.round(maxDays)) };
}

/** A pickup point as kept with a quote and shown to the shopper. */
export type QuotedPickupPoint = {
  id: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  distanceMeters: number | null;
};

/** One service offered to a cart, as the shopper's page reads it; amounts are in the currency shown. */
export type DeliveryOption = {
  /** The quote's id; `flat` is the market's flat rate. */
  id: string;
  /**
   * What kind of delivery it is (D237): a carrier's service, the flat rate, one of the store's methods, a pickup place or a local area. Optional while the
   * readers learn it; absent means what `carrier` says (a carrier's service, or `flat`).
   */
  kind?: DeliveryKind;
  carrier: CarrierId | "flat";
  label: string;
  /** What it costs this basket, free above the store's threshold already taken off. */
  priceMinor: number;
  freeOverMinor: number | null;
  estimate: { min: number; max: number } | null;
  needsPickupPoint: boolean;
  /** The time window it is delivered in, for a carrier that offers windows (Porterbuddy). */
  window: { start: string; end: string } | null;
  pickupPoints: QuotedPickupPoint[];
  /** The one chosen, for a service that needs one. */
  pickupPointId: string | null;
  selected: boolean;
  /** A pickup place (D237, kind `pickup`): where, its hours, the usual ready time and the instructions in the page's language. */
  place?: { name: string; street: string; postalCode: string; city: string; country: string; hours: unknown; readyInHours: number; instructions: string };
  /** A local area's delivery information (kind `local`), in the page's language. */
  info?: string;
};

export type DeliveryOptions = {
  /** The postal code the prices are for (the cart's delivery postal code, D237, or the carriers' answer). */
  postalCode: string | null;
  options: DeliveryOption[];
  /** The price depends on a postal code that is not given yet, and pickup is not chosen: the pay press waits (D237 2.4 point 4). */
  needsPostalCode?: boolean;
  /** The cart's choice no longer prices the basket: the default is charged (D237 2.7). */
  changed?: boolean;
  /** Nothing ships this basket to the code (pickup or local delivery may still be offered). */
  noShipping?: boolean;
  /** The note for the driver kept with a local delivery choice. */
  note?: string | null;
  /** A local area covers the code but the basket is below its minimum: "Local delivery from {minimum}" (as shown). */
  localBelowMinimum?: { label: string; minimumMinor: number } | null;
};

/** What an order keeps of the delivery the shopper chose (`orders.delivery`). */
export type OrderDelivery = {
  carrier: CarrierId;
  serviceId: string;
  label: string;
  postalCode: string;
  pickupPoint: { id: string; name: string; street: string; postalCode: string; city: string } | null;
  /** The window it is delivered in, when it was a window that was chosen. */
  window: { start: string; end: string } | null;
};

const text = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");

/** Reads `orders.delivery` back, dropping anything that is not as written above. */
export function readOrderDelivery(value: unknown): OrderDelivery | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const carrier = text(v.carrier, 20);
  if (!carrier || !text(v.serviceId) || !text(v.label)) return null;
  const point = v.pickupPoint && typeof v.pickupPoint === "object" ? (v.pickupPoint as Record<string, unknown>) : null;
  const win = v.window && typeof v.window === "object" ? (v.window as Record<string, unknown>) : null;
  return {
    window: win && text(win.start, 40) && text(win.end, 40) ? { start: text(win.start, 40), end: text(win.end, 40) } : null,
    carrier: carrier as CarrierId,
    serviceId: text(v.serviceId, 40),
    label: text(v.label),
    postalCode: text(v.postalCode, 12),
    pickupPoint:
      point && text(point.id, 80)
        ? {
            id: text(point.id, 80),
            name: text(point.name),
            street: text(point.street),
            postalCode: text(point.postalCode, 12),
            city: text(point.city),
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// What an order keeps of every kind of delivery (D237, docs/wave-3-shipping-methods.md 3.1)
// ---------------------------------------------------------------------------

/** How the goods reach the buyer, as `orders.delivery_method` and the kinds of `orders.delivery` say it. */
export type DeliveryKind = "carrier" | "method" | "flat" | "pickup" | "local";

/** A carrier's service (D135), tagged; a row written before D237 has no `kind` and is read as this. */
export type CarrierDelivery = OrderDelivery & { kind: "carrier" };

/** One of the store's own shipping methods, with the zone its price came from (null: Rest of country). */
export type MethodDelivery = {
  kind: "method";
  methodId: string;
  label: string;
  zone: { id: string; name: string } | null;
  postalCode: string | null;
  estimate: { min: number; max: number } | null;
};

/** The market's flat rate (written from D237 on, so every order says what it was). */
export type FlatDelivery = { kind: "flat"; label: string; postalCode: string | null };

/** Collecting at one of the store's places: a snapshot of the place as it was when bought (editing the place later changes nothing here). */
export type PickupDelivery = {
  kind: "pickup";
  label: string;
  locationId: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  /** The place's opening hours (`OpeningHours`, src/lib/opening-hours.ts) as they were, or null. */
  hours: unknown;
  /** The pickup instructions in the order's language (else the store's main one), as plain text. */
  instructions: string;
  readyInHours: number;
};

/** The store's own local delivery to an area. */
export type LocalDelivery = { kind: "local"; label: string; areaId: string; name: string; postalCode: string; info: string };

/** `orders.delivery` of any kind; read only by `readDelivery()`. Every kind keeps a `label`. */
export type AnyOrderDelivery = CarrierDelivery | MethodDelivery | FlatDelivery | PickupDelivery | LocalDelivery;

const id = (value: unknown) => text(value, 80);

/**
 * Reads `orders.delivery` of any kind back (D237), dropping anything that is not as written: a row without `kind` (every order before D237) is a
 * carrier's, as `readOrderDelivery()` reads it. Null for nothing, or for a kind it does not know.
 */
export function readDelivery(value: unknown): AnyOrderDelivery | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const kind = v.kind === undefined ? "carrier" : v.kind;
  const label = text(v.label);
  switch (kind) {
    case "carrier": {
      const carrier = readOrderDelivery(value);
      return carrier ? { ...carrier, kind: "carrier" } : null;
    }
    case "method": {
      if (!label || !id(v.methodId)) return null;
      const zone = v.zone && typeof v.zone === "object" ? (v.zone as Record<string, unknown>) : null;
      return {
        kind: "method",
        methodId: id(v.methodId),
        label,
        zone: zone && id(zone.id) ? { id: id(zone.id), name: text(zone.name) } : null,
        postalCode: text(v.postalCode, 12) || null,
        estimate: estimateRange(v.estimate),
      };
    }
    case "flat":
      return label ? { kind: "flat", label, postalCode: text(v.postalCode, 12) || null } : null;
    case "pickup": {
      if (!label || !id(v.locationId)) return null;
      const ready = typeof v.readyInHours === "number" && Number.isFinite(v.readyInHours) ? Math.max(0, Math.round(v.readyInHours)) : 0;
      return {
        kind: "pickup",
        label,
        locationId: id(v.locationId),
        name: text(v.name),
        street: text(v.street),
        postalCode: text(v.postalCode, 12),
        city: text(v.city),
        country: text(v.country, 2),
        hours: v.hours && typeof v.hours === "object" ? v.hours : null,
        instructions: text(v.instructions, 1000),
        readyInHours: ready,
      };
    }
    case "local":
      return label && id(v.areaId)
        ? { kind: "local", label, areaId: id(v.areaId), name: text(v.name), postalCode: text(v.postalCode, 12), info: text(v.info, 500) }
        : null;
    default:
      return null;
  }
}

/** `{ min, max }` days as a method's snapshot keeps them, or null. */
function estimateRange(value: unknown): { min: number; max: number } | null {
  if (!value || typeof value !== "object") return null;
  const { min, max } = value as { min?: unknown; max?: unknown };
  if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min: Math.max(0, Math.round(min)), max: Math.max(0, Math.round(max)) };
}

/**
 * Whether the postal code of the address Stripe collected differs from the one the delivery was priced for in a way that matters (2.7): another zone
 * (a method), another local area, or another code for a carrier's service. Never for pickup or when the address has no code of the country.
 *
 * A delivery priced WITHOUT a postal code (the pay press's gate skipped, or Stripe's hosted page, 2.4) is priced at Rest of country (a method) or at the
 * flat rate: it is flagged with `priced: null` when the address falls in a zone (a method: any zone other than the one it was priced for; the flat rate:
 * a zone some active method prices, `pricedZoneOf`, so a zone the flat rate covers anyway is not flagged). The flat rate with a code is flagged only
 * the same way: when the address's priced zone differs from the code's. `zoneOf`/`pricedZoneOf`/`areaCovers` say which zone or area a code falls in
 * (`zoneFor()`/`areaFor()` over the store's rows). A flag is an alert for staff, never a change of the charge.
 */
export function postalMismatch(
  delivery: AnyOrderDelivery | null,
  country: string,
  addressCode: string | null | undefined,
  {
    zoneOf,
    pricedZoneOf,
    areaCovers,
  }: { zoneOf?: (code: string) => string | null; pricedZoneOf?: (code: string) => string | null; areaCovers?: (code: string) => boolean } = {},
): { priced: string | null; address: string } | null {
  if (!delivery || delivery.kind === "pickup" || !addressCode) return null;
  const address = cleanCode(country, addressCode);
  if (!address) return null;
  const priced = delivery.postalCode ? cleanCode(country, delivery.postalCode) : null;
  if (delivery.postalCode && !priced) return null;
  if (priced === address) return null;
  if (delivery.kind === "flat") {
    const there = pricedZoneOf ? pricedZoneOf(address) : null;
    if (!there) return null;
    return there === (priced && pricedZoneOf ? pricedZoneOf(priced) : null) ? null : { priced, address };
  }
  if (delivery.kind === "method") {
    const zone = zoneOf ? zoneOf(address) : null;
    return zone === (delivery.zone?.id ?? null) ? null : { priced, address };
  }
  // A carrier's service or a local area is never priced without a code (the choice needs one); keep the old rule for an order that somehow was.
  if (!priced) return null;
  if (delivery.kind === "carrier") return { priced, address };
  return areaCovers && areaCovers(address) ? null : { priced, address };
}

/** A pickup place's address in a line, for the order, the email and the slip: "Name, Street, 0150 City". */
export const pickupPlaceLine = (p: Pick<PickupDelivery, "name" | "street" | "postalCode" | "city">) => pickupPointLine(p);

/** A pickup point in a line, for the order, emails and the label: "Name, Street, 0150 City". */
export const pickupPointLine = (p: { name: string; street: string; postalCode: string; city: string }) =>
  [p.name, p.street, `${p.postalCode} ${p.city}`.trim()].filter(Boolean).join(", ");

// ---------------------------------------------------------------------------
// The store's settings for a carrier at checkout
// ---------------------------------------------------------------------------

/** What a store charges for a carrier's services in one country (pricing `store`): free above `freeOverMinor`, a price per service id. */
export type CountryPrices = { freeOverMinor: number | null; services: Record<string, number> };

export type CheckoutSettings = {
  enabled: boolean;
  /** The carrier's own service ids the store offers. */
  services: string[];
  markup: Markup;
  /** The basket value over which its services are free, in the country's own currency. */
  freeOverMinor: number | null;
  /** The weight of a parcel when what is bought has no weight, in grams. */
  defaultWeightGrams: number;
  /** Prices the store enters itself, by country (pricing `store`); empty for a carrier that prices the parcel. */
  prices: Record<string, CountryPrices>;
};

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  enabled: false,
  services: [],
  markup: { percent: 0, minor: 0 },
  freeOverMinor: null,
  defaultWeightGrams: 1000,
  prices: {},
};

const wholeNumber = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((value) => value.replace(",", "."))
    .pipe(z.string().regex(/^\d+(\.\d+)?$/, `${label}: enter a number.`))
    .transform(Number)
    .pipe(z.number().min(min, `${label}: at least ${min}.`).max(max, `${label}: at most ${max}.`));

/** A money amount typed in major units ("49,50") as minor units, or null when left empty. */
function minorOf(value: string, label: string): { ok: true; minor: number | null } | { ok: false; problem: string } {
  const typed = value.trim().replace(",", ".");
  if (!typed) return { ok: true, minor: null };
  if (!/^\d+(\.\d{1,2})?$/.test(typed)) return { ok: false, problem: `${label}: enter an amount like 49 or 49.50.` };
  const minor = Math.round(Number(typed) * 100);
  return minor > 100_000_000 ? { ok: false, problem: `${label}: that is too much.` } : { ok: true, minor };
}

/** The prices a store enters per country and service (`price:NO:19`) and what it is free above (`freeOver:NO`), in major units. */
function parsePrices(form: FormData, known: string[], countries: string[], problems: string[]): Record<string, CountryPrices> {
  const prices: Record<string, CountryPrices> = {};
  for (const country of countries) {
    const services: Record<string, number> = {};
    for (const id of known) {
      const typed = minorOf(String(form.get(`price:${country}:${id}`) ?? ""), `Price of ${id} in ${country}`);
      if (!typed.ok) problems.push(typed.problem);
      else if (typed.minor !== null) services[id] = typed.minor;
    }
    const free = minorOf(String(form.get(`freeOver:${country}`) ?? ""), `Free above in ${country}`);
    if (!free.ok) problems.push(free.problem);
    else if (free.minor !== null && free.minor <= 0) problems.push(`Free above in ${country}: enter an amount above zero, or leave it empty.`);
    if (Object.keys(services).length > 0) prices[country] = { freeOverMinor: free.ok ? free.minor : null, services };
  }
  return prices;
}

/**
 * What the owner's form sends, checked: the services only from `known`, the amounts in major units of the country's
 * currency. For a carrier whose prices the store enters (`pricing: "store"`) the prices come per country in `countries`.
 */
export function parseCheckoutSettings(
  form: FormData,
  known: string[],
  options: { pricing: "carrier" | "store"; countries?: string[] } = { pricing: "carrier" },
): { ok: true; settings: CheckoutSettings } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const services = [...new Set(form.getAll("service").map(String))].filter((id) => known.includes(id));
  const enabled = form.get("enabled") === "on";
  if (enabled && services.length === 0) problems.push("Choose at least one service to offer.");
  if (options.pricing === "store") {
    const prices = parsePrices(form, services, options.countries ?? [], problems);
    if (enabled && problems.length === 0 && Object.keys(prices).length === 0) problems.push("Enter a price for at least one service in one country.");
    const weight = wholeNumber("Parcel weight", 1, 35_000).safeParse(String(form.get("defaultWeight") ?? "1000") || "1000");
    if (!weight.success) problems.push(weight.error.issues[0].message);
    if (problems.length > 0 || !weight.success) return { ok: false, problems };
    return {
      ok: true,
      settings: { enabled, services, markup: { percent: 0, minor: 0 }, freeOverMinor: null, defaultWeightGrams: Math.round(weight.data), prices },
    };
  }

  const percent = wholeNumber("Percentage added", 0, 100).safeParse(String(form.get("markupPercent") ?? "0") || "0");
  if (!percent.success) problems.push(percent.error.issues[0].message);
  const fixed = minorOf(String(form.get("markupAmount") ?? ""), "Amount added");
  if (!fixed.ok) problems.push(fixed.problem);
  const freeOver = minorOf(String(form.get("freeOver") ?? ""), "Free above");
  if (!freeOver.ok) problems.push(freeOver.problem);
  else if (freeOver.minor !== null && freeOver.minor <= 0) problems.push("Free above: enter an amount above zero, or leave it empty.");
  const weight = wholeNumber("Parcel weight", 1, 35_000).safeParse(String(form.get("defaultWeight") ?? "1000") || "1000");
  if (!weight.success) problems.push(weight.error.issues[0].message);
  if (problems.length > 0 || !percent.success || !fixed.ok || !freeOver.ok || !weight.success) return { ok: false, problems };
  return {
    ok: true,
    settings: {
      enabled,
      services,
      markup: { percent: Math.round(percent.data), minor: fixed.minor ?? 0 },
      freeOverMinor: freeOver.minor,
      defaultWeightGrams: Math.round(weight.data),
      prices: {},
    },
  };
}
