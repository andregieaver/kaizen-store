import type { BookingRequest, PickupPoint, TrackingEvent } from "./shipping-carriers";

/**
 * Helthjem (D138): what Helthjem's API is sent and how its answers are read, as pure functions so they are tested without
 * the network. The calls are in `src/server/carriers/helthjem.ts`. Written against Helthjem's public OpenAPI description
 * (developer.helthjem.no): a token from the store's client id and secret, Single Address Check for coverage, Nearby Service
 * Points, Bookings, Labels and Tracking. Helthjem has no price service: what a service costs is in the store's agreement, so
 * the store enters its own prices for checkout (`delivery-options.ts`, pricing "store").
 */

/** Helthjem's production API and its test (pre-production) API, chosen by the store's environment. */
export const HELTHJEM_HOSTS = { live: "https://api.helthjem.no", test: "https://api.pre.helthjem.no" } as const;
export const helthjemHost = (environment: string) => (environment === "live" ? HELTHJEM_HOSTS.live : HELTHJEM_HOSTS.test);

/** The services a store can offer at checkout; what each is booked as (its transport solution) is the store's own agreement. */
export const HELTHJEM_SERVICES: { id: string; name: string; needsPickupPoint: boolean; maxWeightGrams: number }[] = [
  // Helthjem delivers to the mailbox or doormat, up to 5 kg.
  { id: "home", name: "Helthjem home delivery", needsPickupPoint: false, maxWeightGrams: 5_000 },
  // Collected at a service point, up to 20 kg.
  { id: "collect", name: "Helthjem service point", needsPickupPoint: true, maxWeightGrams: 20_000 },
];

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

/** A transport solution id as the store typed it (digits), or null when it is not one. */
export function solutionId(value: string | undefined): number | null {
  return value && /^\d{1,6}$/.test(value.trim()) ? Number(value.trim()) : null;
}

/** The store's own transport solution for a service: what Helthjem is asked to book. */
export function solutionFor(service: string, details: Record<string, string>): number | null {
  return solutionId(service === "collect" ? details.collectSolutionId : details.homeSolutionId);
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export const tokenUrl = (host: string) => `${host}/auth/oauth2/v1/token`;

export const tokenBody = (clientId: string, clientSecret: string) => ({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" });

/** The bearer token and how long it lasts, in seconds; null when the answer is not one. */
export function parseToken(json: unknown): { token: string; expiresIn: number } | null {
  const body = obj(json);
  const token = text(body.token);
  const expiresIn = Number(body.expires_in);
  return token ? { token, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600 } : null;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** Single Address Check: whether this transport solution reaches this address. */
export function coverageBody(input: { shopId: number; solution: number; name: string; address: string; zipCode: string; city: string; country: string; weightGrams: number }) {
  return {
    shopId: input.shopId,
    transportSolutionId: input.solution,
    customerName: input.name,
    address: input.address,
    zipCode: input.zipCode,
    postalName: input.city,
    countryCode: input.country.toUpperCase(),
    weight: Math.max(1, Math.round(input.weightGrams)),
  };
}

/** The error key Helthjem's error answers carry, e.g. `no.carrier.support` for an address it does not deliver to. */
export const errorKey = (json: unknown): string => text(obj(json).errorKey);

export const NO_COVERAGE = "no.carrier.support";

// ---------------------------------------------------------------------------
// Service points
// ---------------------------------------------------------------------------

export function servicePointsBody(input: { shopId: number; solution: number; street?: string; zipCode: string; city?: string; country: string }) {
  return {
    shopId: input.shopId,
    transportSolutionId: input.solution,
    ...(input.street ? { streetAddress: input.street } : {}),
    zipCode: input.zipCode,
    ...(input.city ? { postalName: input.city } : {}),
    countryCode: input.country.toUpperCase(),
  };
}

const DAYS: Record<string, string> = { MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun" };

/** The service points an answer holds (grouped by freight product there), once each, in the order Helthjem gave them. */
export function parseServicePoints(json: unknown): PickupPoint[] {
  const points: PickupPoint[] = [];
  const seen = new Set<string>();
  for (const product of list(obj(json).freightProducts)) {
    for (const raw of list(obj(product).servicePoints)) {
      const p = obj(raw);
      const id = text(p.servicePointExternalId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const visiting = obj(p.visitingAddress);
      const hours = list(p.openingHours)
        .map((h) => {
          const o = obj(h);
          return DAYS[text(o.day)] && text(o.from1) && text(o.to1) ? `${DAYS[text(o.day)]} ${text(o.from1)}–${text(o.to1)}` : "";
        })
        .filter(Boolean)
        .join(", ");
      points.push({
        id,
        name: text(p.servicePointName) || id,
        address: {
          name: text(p.servicePointName) || id,
          street: [text(visiting.streetName), text(visiting.streetNumber)].filter(Boolean).join(" "),
          postalCode: text(visiting.postalCode),
          city: text(visiting.postalName),
          country: text(visiting.countryCode).toUpperCase() || "NO",
        },
        ...(hours ? { openingHours: hours } : {}),
      });
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

const address = (a: { street: string; postalCode: string; city: string; country: string }) => ({
  countryCode: a.country.toUpperCase(),
  postalName: a.city,
  zipCode: a.postalCode,
  address: a.street,
});

/** What is missing for Helthjem to take the booking, in plain words; empty when it can be made. */
export function bookingProblems(request: BookingRequest, solution: number | null, shopId: number | null): string[] {
  const problems: string[] = [];
  if (shopId === null) problems.push("The shop id is missing: add it on the carrier's page.");
  if (solution === null) problems.push(request.serviceId === "collect" ? "Add the transport solution for service point delivery on the carrier's page." : "Add the transport solution for home delivery on the carrier's page.");
  if (request.serviceId === "collect" && !request.pickupPointId) problems.push("The customer's service point is missing.");
  const to = request.to;
  if (!to.name || !to.street || !to.postalCode || !to.city) problems.push("The delivery address needs a name, street, postal code and city.");
  if (!to.phone) problems.push("The order has no phone number for the recipient.");
  if (!to.email) problems.push("The order has no email for the recipient.");
  if (!request.from.name || !request.from.street || !request.from.postalCode || !request.from.city) problems.push("Add the sender's name and address on the carrier's page.");
  return problems;
}

/** The booking request: consignee, consignor and (for a service point) the point chosen, with the parcels. */
export function bookingBody(request: BookingRequest, shopId: number, solution: number) {
  const parties: Obj[] = [
    {
      type: "consignee",
      name: request.to.name,
      ...address(request.to),
      coaddress: "",
      phone1: request.to.phone ?? "",
      phone2: null,
      email: request.to.email ?? "",
      reference: request.orderReference,
    },
    {
      type: "consignor",
      name: request.from.name,
      ...address(request.from),
      phone1: request.from.phone ?? "",
      phone2: null,
      email: request.from.email ?? "",
      reference: request.orderReference,
      coaddress: null,
    },
  ];
  if (request.serviceId === "collect" && request.pickupPointId) {
    parties.push({ type: "servicePoint", id: request.pickupPointId, countryCode: request.to.country.toUpperCase() });
  }
  return {
    shopId,
    transportSolutionId: solution,
    shipmentId: null,
    desiredDeliveryDate: null,
    messageToCarrier: request.courierInstructions ? request.courierInstructions.slice(0, 200) : null,
    messageToConsignee: null,
    parties,
    items: request.parcels.map((p, i) => ({
      itemNumber: i + 1,
      trackingReference: "",
      weight: Math.max(1, Math.round(p.weightGrams)),
      ...(p.widthMm ? { width: Math.ceil(p.widthMm / 10) } : {}),
      ...(p.heightMm ? { height: Math.ceil(p.heightMm / 10) } : {}),
      ...(p.lengthMm ? { length: Math.ceil(p.lengthMm / 10) } : {}),
      contents: "Goods",
    })),
  };
}

/** A shipment id as Helthjem writes it, "(401)70724763442660381", without the GS1 prefix: the number tracking and cancelling use. */
export const shipmentNumber = (shipmentId: string) => shipmentId.replace(/^\(\d+\)/, "");

export type ParsedBooking =
  | { ok: true; shipmentId: string; shipmentNumber: string; orderId: string; freightProductId: number | null }
  | { ok: false; problem: string };

/** The booking made: the shipment id (for the label and tracking) and which freight product Helthjem gave it. */
export function parseBooking(json: unknown): ParsedBooking {
  const body = obj(json);
  const shipmentId = text(body.shipmentId);
  if (!shipmentId) return { ok: false, problem: "Helthjem answered without a shipment number." };
  const product = Number(body.freightProductId);
  return { ok: true, shipmentId, shipmentNumber: shipmentNumber(shipmentId), orderId: text(body.orderId), freightProductId: Number.isFinite(product) ? product : null };
}

// ---------------------------------------------------------------------------
// Labels and tracking
// ---------------------------------------------------------------------------

/** The label of a shipment: its address is kept on the shipment, and the label itself is fetched when printed. */
export const labelUrl = (host: string, shipmentId: string) => `${host}/parcels/v1/labels/${encodeURIComponent(shipmentId)}/unified-large`;

/** Only Helthjem's own hosts are ever sent the store's token. */
export const isHelthjemUrl = (url: string) => /^https:\/\/api(\.pre)?\.helthjem\.no\//.test(url);

export const trackingUrl = (host: string, shipment: string) => `${host}/parcels/v1/tracking/fetch/${encodeURIComponent(shipmentNumber(shipment))}/EN/false`;

/** A parcel's events, newest first; empty when Helthjem does not know the number (yet). */
export function parseTracking(json: unknown): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  for (const shipment of list(json)) {
    for (const item of list(obj(shipment).items)) {
      for (const raw of list(obj(item).events)) {
        const e = obj(raw);
        const type = obj(e.eventType);
        const at = text(e.eventTimeUtc) || text(e.eventTime).replace(" ", "T");
        if (!at) continue;
        events.push({
          at,
          status: text(type.apiKey),
          description: text(e.message) || text(type.description) || text(e.additionalInfo),
          ...(text(e.locationContext) ? { location: text(e.locationContext) } : {}),
        });
      }
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/** What to tell the owner when Helthjem answers with a status that is not a success. */
export function helthjemProblem(status: number, json?: unknown): string {
  const key = errorKey(json);
  if (key === NO_COVERAGE) return "Helthjem does not deliver to that address with this transport solution.";
  if (key === "no.access.shop.id") return "Helthjem did not accept the shop id for these credentials. Check it on this page.";
  if (status === 401) return "Helthjem did not accept the client id and secret. Check them on this page, and that they are for the right environment (test or live).";
  if (status === 403) return "Helthjem refused access for these credentials. Check the shop id and transport solutions on this page.";
  if (status === 404) return "Helthjem did not find that.";
  if (status === 429) return "Helthjem asked us to slow down. Try again in a moment.";
  if (status >= 500) return "Helthjem is not answering right now. Try again in a moment.";
  return `Helthjem did not accept the request (${status}${key ? `: ${key}` : ""}).`;
}
