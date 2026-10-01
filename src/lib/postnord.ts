import type { PickupPoint, TrackingEvent } from "./shipping-carriers";

/**
 * PostNord (D136): what PostNord's APIs are sent and how their answers are read, as pure functions so they are tested
 * without the network. The calls themselves are in `src/server/carriers/postnord.ts`. PostNord has no price API: what a
 * service costs is in the store's agreement, so the store enters its own prices for checkout (`delivery-options.ts`,
 * pricing "store"). Used here: the service point search (where to collect), Track and Trace v5 and a connection check.
 * Every call carries the store's own API key as `apikey`. Booking and labels (the EDI API) are not built.
 */

/** PostNord's production host and its sandbox, chosen by the store's environment. */
export const POSTNORD_HOSTS = { live: "https://api2.postnord.com", test: "https://atapi2.postnord.com" } as const;

/** The services a store can offer at checkout, by PostNord's own basic service codes (check them against your agreement). */
export const POSTNORD_SERVICES: { id: string; name: string; needsPickupPoint: boolean }[] = [
  { id: "17", name: "PostNord MyPack Collect", needsPickupPoint: true },
  { id: "19", name: "PostNord MyPack Home", needsPickupPoint: false },
  { id: "18", name: "PostNord Parcel", needsPickupPoint: false },
];

export const postnordService = (id: string) => POSTNORD_SERVICES.find((s) => s.id === id) ?? null;

/** The countries PostNord's own network covers, as the stores' markets are named. */
export const POSTNORD_COUNTRIES = ["SE", "DK", "NO", "FI"];

/** A postal code in each country to ask a harmless question about, for the connection check. */
export const SAMPLE_POSTAL_CODES: Record<string, string> = { SE: "11122", DK: "1050", NO: "0150", FI: "00100" };

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

export const postnordHost = (environment: string) => (environment === "live" ? POSTNORD_HOSTS.live : POSTNORD_HOSTS.test);

// ---------------------------------------------------------------------------
// Service points
// ---------------------------------------------------------------------------

/** The nearest service points to a postal code: Business Location v5, nearest by address. */
export function servicePointsUrl(host: string, apiKey: string, country: string, postalCode: string, count = 5): string {
  const query = new URLSearchParams({
    apikey: apiKey,
    returnType: "json",
    countryCode: country.toUpperCase(),
    postalCode,
    numberOfServicePoints: String(count),
  });
  return `${host}/rest/businesslocation/v5/servicepoints/nearest/byaddress?${query.toString()}`;
}

const DAYS: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
const hhmm = (value: string) => (/^\d{4}$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : value);

/** Opening hours as a line ("Mon 09:00–18:00, Tue …") from PostNord's day/from/to entries; empty when not given. */
function openingHours(raw: unknown): string {
  return list(raw)
    .map((entry) => {
      const o = obj(entry);
      const day = DAYS[text(o.day).slice(0, 2).toUpperCase()];
      const from = text(o.from1);
      const to = text(o.to1);
      return day && from && to ? `${day} ${hhmm(from)}–${hhmm(to)}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

/** The service points an answer holds, nearest first as PostNord gave them; points without an id are left out. */
export function parseServicePoints(json: unknown): PickupPoint[] {
  const body = obj(obj(json).servicePointInformationResponse);
  const raw = list(body.servicePoints).length > 0 ? list(body.servicePoints) : list(obj(json).servicePoints);
  const points: PickupPoint[] = [];
  for (const item of raw) {
    const p = obj(item);
    const id = text(p.servicePointId);
    if (!id) continue;
    // The address a parcel is collected at; the delivery address is only a fallback.
    const visiting = obj(p.visitingAddress);
    const address = Object.keys(visiting).length > 0 ? visiting : obj(p.deliveryAddress);
    const street = [text(address.streetName), text(address.streetNumber)].filter(Boolean).join(" ");
    const meters = Number.parseFloat(text(p.routeDistance) || text(p.distance));
    const hours = openingHours(p.openingHours);
    points.push({
      id,
      name: text(p.name) || id,
      address: {
        name: text(p.name) || id,
        street,
        postalCode: text(address.postalCode),
        city: text(address.city),
        country: text(address.countryCode).toUpperCase() || "",
      },
      ...(hours ? { openingHours: hours } : {}),
      ...(Number.isFinite(meters) ? { distanceMeters: Math.round(meters) } : {}),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

/** Track and Trace v5, find by identifier. */
export function trackingUrl(host: string, apiKey: string, number: string): string {
  const query = new URLSearchParams({ apikey: apiKey, id: number, locale: "en" });
  return `${host}/rest/shipment/v5/trackandtrace/findByIdentifier.json?${query.toString()}`;
}

/** A parcel's events, newest first; empty when PostNord does not know the number (yet). */
export function parseTracking(json: unknown): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  for (const shipment of list(obj(obj(json).TrackingInformationResponse ?? obj(json).trackingInformationResponse).shipments)) {
    for (const item of list(obj(shipment).items)) {
      for (const raw of list(obj(item).events)) {
        const e = obj(raw);
        const where = obj(e.location);
        const at = text(e.eventTime);
        if (!at) continue;
        events.push({
          at,
          status: text(e.eventCode) || text(e.status),
          description: text(e.eventDescription),
          ...(text(where.displayName) || text(where.city) ? { location: text(where.displayName) || text(where.city) } : {}),
        });
      }
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/** What to tell the owner when PostNord answers with a status that is not a success. */
export function postnordProblem(status: number): string {
  if (status === 401 || status === 403) return "PostNord did not accept the API key. Check it on this page, and that it is for the right environment (test or live).";
  if (status === 404) return "PostNord did not find that.";
  if (status === 429) return "PostNord asked us to slow down. Try again in a moment.";
  if (status >= 500) return "PostNord is not answering right now. Try again in a moment.";
  return `PostNord did not accept the request (${status}).`;
}
