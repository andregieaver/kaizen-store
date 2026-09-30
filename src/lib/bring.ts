import type { BookingRequest, PickupPoint, ShippingAddress, ShippingOption, TrackingEvent } from "./shipping-carriers";

/**
 * Posten / Bring (D134): what Bring's APIs are sent and how their answers are read, as pure functions so they are tested
 * without the network. The calls themselves are in `src/server/carriers/bring.ts`. Written against Bring's developer
 * documentation (developer.bring.com): Shipping Guide v2 for services and prices, Pickup Point for where to collect,
 * Booking v2 for shipments and labels, and Tracking v2. Every call carries the store's own Mybring user and key.
 */

export const BRING_API = "https://api.bring.com";

/** Bring's services for parcels within Norway that a store can book. */
export const BRING_PRODUCTS: { id: string; name: string; needsPickupPoint: boolean }[] = [
  { id: "5800", name: "Pakke til hentested", needsPickupPoint: true },
  { id: "5600", name: "Pakke levert hjem", needsPickupPoint: false },
  { id: "3584", name: "Pakke i postkassen", needsPickupPoint: false },
];

export const bringProduct = (id: string) => BRING_PRODUCTS.find((p) => p.id === id) ?? null;

export type BringCredentials = { apiUid: string; apiKey: string; clientUrl: string };

export function bringHeaders(credentials: BringCredentials, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Mybring-API-Uid": credentials.apiUid,
    "X-Mybring-API-Key": credentials.apiKey,
    "X-Bring-Client-URL": credentials.clientUrl,
    Accept: "application/json",
    ...extra,
  };
}

/** A decimal amount as Bring writes it ("228.77", "1 234,50") in minor units, without floating point. */
export function amountToMinor(text: unknown, digits = 2): number | null {
  if (typeof text !== "string" && typeof text !== "number") return null;
  const clean = String(text).replace(/[\s ]/g, "").replace(",", ".");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(clean);
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(digits, "0").slice(0, digits);
  const rest = (match[3] ?? "").slice(digits);
  let minor = Number(match[2]) * 10 ** digits + Number(fraction || "0");
  if (rest && Number(rest[0]) >= 5) minor += 1;
  return match[1] ? -minor : minor;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

// ---------------------------------------------------------------------------
// Shipping Guide
// ---------------------------------------------------------------------------

export type BringParcel = { weightGrams: number; lengthCm?: number; widthCm?: number; heightCm?: number };

/** The request for the services and prices from one address to another, asking for every service a store can book. */
export function shippingGuideBody(input: {
  fromCountry: string;
  fromPostalCode: string;
  toCountry: string;
  toPostalCode: string;
  parcels: BringParcel[];
  customerNumber: string;
  productIds?: string[];
  language?: string;
}) {
  return {
    consignments: [
      {
        id: "1",
        fromCountryCode: input.fromCountry,
        fromPostalCode: input.fromPostalCode,
        toCountryCode: input.toCountry,
        toPostalCode: input.toPostalCode,
        packages: input.parcels.map((parcel, i) => ({
          id: String(i + 1),
          grossWeight: Math.max(1, Math.round(parcel.weightGrams)),
          ...(parcel.lengthCm ? { length: parcel.lengthCm } : {}),
          ...(parcel.widthCm ? { width: parcel.widthCm } : {}),
          ...(parcel.heightCm ? { height: parcel.heightCm } : {}),
        })),
        products: (input.productIds ?? BRING_PRODUCTS.map((p) => p.id)).map((id) => ({ id, customerNumber: input.customerNumber })),
      },
    ],
    withPrice: true,
    withExpectedDelivery: true,
    withGuiInformation: true,
    language: (input.language ?? "NO").toUpperCase(),
  };
}

/** The services Bring offers for the parcel, with what they cost the store (excluding VAT); the ones it cannot offer are left out. */
export function parseShippingGuide(json: unknown): { options: ShippingOption[]; problems: string[] } {
  const options: ShippingOption[] = [];
  const problems: string[] = [];
  for (const consignment of list(obj(json).consignments)) {
    for (const raw of list(obj(consignment).products)) {
      const product = obj(raw);
      const id = text(product.id);
      const errors = list(product.errors);
      if (errors.length > 0) {
        const first = obj(errors[0]);
        problems.push(text(first.description) || text(first.message) || text(first.code) || `Service ${id} is not available.`);
        continue;
      }
      const price = obj(product.price);
      const currency = text(obj(price.netPrice).currencyCode) || text(obj(price.listPrice).currencyCode) || "NOK";
      const net = obj(obj(obj(price.netPrice).priceWithoutAdditionalServices));
      const listed = obj(obj(obj(price.listPrice).priceWithoutAdditionalServices));
      const priceMinor = amountToMinor(net.amountWithoutVAT ?? listed.amountWithoutVAT);
      if (!id || priceMinor === null) continue;
      const known = bringProduct(id);
      const days = Number.parseInt(text(obj(product.expectedDelivery).workingDays), 10);
      options.push({
        serviceId: id,
        carrier: "bring",
        name: text(obj(product.guiInformation).displayName) || known?.name || `Service ${id}`,
        priceMinor,
        currency,
        ...(Number.isFinite(days) ? { estimate: { minDays: days, maxDays: days } } : {}),
        ...(known?.needsPickupPoint ? { needsPickupPoint: true } : {}),
      });
    }
  }
  return { options, problems };
}

// ---------------------------------------------------------------------------
// Pickup points
// ---------------------------------------------------------------------------

export function pickupPointsUrl(country: string, postalCode: string, count = 10): string {
  return `${BRING_API}/pickuppoint/api/pickuppoint/${encodeURIComponent(country.toUpperCase())}/postalCode/${encodeURIComponent(postalCode)}?numberOfResponses=${count}`;
}

const DAYS: Record<string, string> = { MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun" };
const hhmm = (value: string) => (/^\d{4}$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : value);

export function parsePickupPoints(json: unknown): PickupPoint[] {
  const body = obj(json);
  const raw = Array.isArray(json) ? json : list(body.pickupPoint ?? body.pickupPoints);
  const points: PickupPoint[] = [];
  for (const item of raw) {
    const p = obj(item);
    const id = text(p.id);
    if (!id) continue;
    const hours = list(p.openingHours)
      .map((h) => {
        const o = obj(h);
        return DAYS[text(o.day)] && text(o.opening) ? `${DAYS[text(o.day)]} ${hhmm(text(o.opening))}–${hhmm(text(o.closing))}` : "";
      })
      .filter(Boolean)
      .join(", ");
    const km = Number.parseFloat(text(p.distance ?? p.distanceInKm));
    points.push({
      id,
      name: text(p.name) || id,
      address: {
        name: text(p.name) || id,
        street: text(p.visitingAddress) || text(p.address),
        postalCode: text(p.visitingPostalCode) || text(p.postalCode),
        city: text(p.visitingCity) || text(p.city),
        country: text(p.countryCode).toUpperCase() || "NO",
      },
      ...(hours || text(p.openingHoursEnglish) ? { openingHours: hours || text(p.openingHoursEnglish) } : {}),
      ...(Number.isFinite(km) ? { distanceMeters: Math.round(km * 1000) } : {}),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

const party = (address: ShippingAddress) => ({
  name: address.name,
  addressLine: address.street,
  postalCode: address.postalCode,
  city: address.city,
  countryCode: address.country.toUpperCase(),
  ...(address.phone || address.email ? { contact: { ...(address.phone ? { phoneNumber: address.phone } : {}), ...(address.email ? { email: address.email } : {}) } } : {}),
});

/** The Booking v2 request for one consignment of one or more parcels. */
export function bookingBody(request: BookingRequest, customerNumber: string, now = new Date()) {
  const shipping = new Date(now.getTime() + 60 * 60 * 1000);
  return {
    schemaVersion: 1,
    consignments: [
      {
        shippingDateTime: shipping.toISOString(),
        parties: {
          sender: party(request.from),
          recipient: party(request.to),
          ...(request.pickupPointId ? { pickupPoint: { id: request.pickupPointId, countryCode: request.to.country.toUpperCase() } } : {}),
        },
        packages: request.parcels.map((parcel) => ({
          weightInKg: Math.max(0.001, Math.round(parcel.weightGrams) / 1000),
          ...(parcel.lengthMm && parcel.widthMm && parcel.heightMm
            ? { dimensions: { lengthInCm: parcel.lengthMm / 10, widthInCm: parcel.widthMm / 10, heightInCm: parcel.heightMm / 10 } }
            : {}),
        })),
        product: { id: request.serviceId, customerNumber },
      },
    ],
  };
}

export type ParsedBooking =
  | { ok: true; consignmentNumber: string; trackingNumber: string; trackingUrl: string | null; labelUrl: string | null }
  | { ok: false; problem: string };

/** What a booking answered: the parcel's tracking number and where the label is, or what Bring objected to. */
export function parseBooking(json: unknown): ParsedBooking {
  const consignment = obj(list(obj(json).consignments)[0]);
  const errors = list(consignment.errors);
  if (errors.length > 0) {
    const first = obj(errors[0]);
    const message = list(first.messages)
      .map((m) => text(obj(m).message))
      .find(Boolean);
    return { ok: false, problem: message || text(first.message) || text(first.code) || "Bring did not accept the booking." };
  }
  const consignmentNumber = text(obj(consignment.confirmation).consignmentNumber);
  const packageNumber = text(obj(list(consignment.packages)[0]).packageNumber);
  if (!consignmentNumber && !packageNumber) return { ok: false, problem: "Bring's answer had no shipment number." };
  const links = obj(consignment.links);
  const https = (value: unknown) => (/^https:\/\/\S+$/.test(text(value)) ? text(value) : null);
  return {
    ok: true,
    consignmentNumber,
    trackingNumber: packageNumber || consignmentNumber,
    trackingUrl: https(links.tracking),
    labelUrl: https(links.labels),
  };
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export const trackingApiUrl = (number: string) => `${BRING_API}/tracking/api/v2/tracking.json?q=${encodeURIComponent(number)}&lang=en`;

/** "18.11.2022" and "14:05" as a local date-time text that sorts (`2022-11-18T14:05`); the raw text when it is not that. */
function eventTime(date: string, time: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}T${/^\d{2}:\d{2}$/.test(time) ? time : "00:00"}` : [date, time].filter(Boolean).join(" ");
}

/** A parcel's events, newest first; empty when Bring does not know the number (yet). */
export function parseTracking(json: unknown): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  for (const consignment of list(obj(json).consignmentSet)) {
    for (const pack of list(obj(consignment).packageSet)) {
      for (const raw of list(obj(pack).eventSet)) {
        const e = obj(raw);
        events.push({
          at: eventTime(text(e.displayDate), text(e.displayTime)),
          status: text(e.status),
          description: text(e.description),
          ...(text(e.city) ? { location: text(e.city) } : {}),
        });
      }
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/** What to tell the owner when Bring answers with a status that is not a success. */
export function bringProblem(status: number): string {
  if (status === 401 || status === 403) return "Bring did not accept the Mybring user or key. Check them on this page.";
  if (status === 404) return "Bring did not find that.";
  if (status === 429) return "Bring asked us to slow down. Try again in a moment.";
  if (status >= 500) return "Bring is not answering right now. Try again in a moment.";
  return `Bring did not accept the request (${status}).`;
}
