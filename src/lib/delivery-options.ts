import { z } from "zod";

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
export const CHECKOUT_COUNTRIES: Partial<Record<CarrierId, string[]>> = { bring: ["NO"], postnord: ["SE", "DK", "NO", "FI"], porterbuddy: ["NO"] };

/**
 * Where a carrier's prices come from: its own price service for this parcel (`carrier`, Bring's Shipping Guide: the price
 * without VAT, to which the store's markup is added), or what the store enters from its agreement (`store`, PostNord has
 * no price API): per country and service, with VAT, as the shopper pays.
 */
export const CHECKOUT_PRICING: Partial<Record<CarrierId, "carrier" | "store">> = { bring: "carrier", postnord: "store", porterbuddy: "carrier" };

/** How long a quote holds: the time a shopper may take from seeing the prices to paying. */
export const QUOTE_MINUTES = 120;

/** The most services (and, apart, delivery windows) and pickup points shown, so the page stays short. */
export const MAX_OPTIONS = 6;
export const MAX_WINDOWS = 8;
export const MAX_PICKUP_POINTS = 5;

/** A postal code as the country writes it, or null when it is not one. */
export function cleanPostalCode(country: string, typed: string): string | null {
  const text = typed.replace(/\s+/g, "").toUpperCase();
  switch (country.toUpperCase()) {
    case "NO":
    case "DK":
      return /^\d{4}$/.test(text) ? text : null;
    case "SE":
    case "FI":
    case "DE":
      return /^\d{5}$/.test(text) ? text : null;
    default:
      return /^[A-Z0-9-]{3,10}$/.test(text) ? text : null;
  }
}

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
};

export type DeliveryOptions = {
  /** The postal code the prices are for, when there are carrier services. */
  postalCode: string | null;
  options: DeliveryOption[];
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
